import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, type Result } from '@tasks/application';
import { IssueSchema, dependencyTarget, issueId, type Issue } from '@tasks/domain';
import { SqliteAdapter, sqliteMigrations } from '../dist/index.js';

const adapters: SqliteAdapter[] = [];
const createdAt = new Date('2025-01-01T00:00:00.000Z');
const initialUpdatedAt = new Date('2025-01-01T00:01:00.000Z');
const now = new Date('2025-01-02T00:00:00.000Z');

function db() {
  const adapter = new SqliteAdapter({ now: () => now });
  adapters.push(adapter);
  return adapter;
}

function issue(id: string, patch: Partial<Issue> = {}): Issue {
  return IssueSchema.parse({
    id: issueId(id),
    title: 'Task',
    description: '',
    status: 'open',
    priority: 2,
    type: 'task',
    owner: null,
    assignee: null,
    createdBy: 'test',
    createdAt,
    updatedAt: initialUpdatedAt,
    startedAt: null,
    closedAt: null,
    dueAt: null,
    deferUntil: null,
    parentId: null,
    labels: ['phase-2'],
    notes: 'notes',
    design: 'design',
    acceptanceCriteria: 'accept',
    estimate: 3,
    specId: 's',
    externalRef: 'x',
    metadata: { retained: { yes: true } },
    wireUnknown: { futureIssueField: { retained: true } },
    dependencies: [],
    dependencyCount: 0,
    dependentCount: 0,
    comments: [],
    commentCount: 0,
    ...patch,
  });
}

afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.close();
});

async function migrate(adapter: SqliteAdapter) {
  const result = await adapter.migrate();
  expect(result).toMatchObject({ ok: true, value: { currentVersion: '004-issue-branch', lockAcquired: true } });
}

async function save(adapter: SqliteAdapter, value: Issue) {
  const result = await adapter.withinTransaction(uow => uow.save(value));
  expect(result).toEqual({ ok: true, value: undefined });
}

async function find(adapter: SqliteAdapter, id: Issue['id']): Promise<Issue | null> {
  const result = await adapter.withinTransaction(uow => uow.findById(id));
  expect(result.ok).toBe(true);
  return result.ok ? result.value : null;
}

function startClaimWorker(options: { directory: string; filename: string; id: string; assignee: string }) {
  return Bun.spawn([process.execPath, new URL('./claim-worker.mjs', import.meta.url).pathname, JSON.stringify({ ...options, expectedUpdatedAt: initialUpdatedAt.toISOString(), now: now.toISOString() })], { stdout: 'pipe', stderr: 'pipe' });
}

async function collectClaim(worker: ReturnType<typeof Bun.spawn>): Promise<Result<Issue>> {
  const exitCode = await worker.exited;
  const { stdout, stderr } = worker;
  if (!(stdout instanceof ReadableStream) || !(stderr instanceof ReadableStream)) {
    throw new Error('Bun claim worker stdout and stderr must be piped streams');
  }
  const stdoutText = await new Response(stdout).text();
  const stderrText = await new Response(stderr).text();
  if (exitCode !== 0) throw new Error(`Bun claim worker exited with ${exitCode}: ${stderrText}`);
  const payload = JSON.parse(stdoutText) as { result?: Result<Issue>; error?: string };
  if (payload.result) return payload.result;
  throw new Error(payload.error ?? 'Bun claim worker failed');
}

async function releaseWorkers(workers: readonly ReturnType<typeof Bun.spawn>[], directory: string) {
  // Both independent Bun processes block on release file before contending for same SQLite claim.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const ready = await Promise.all(workers.map((_, index) => Bun.file(join(directory, `ready-${index === 0 ? 'one' : 'two'}`)).exists()));
    if (ready.every(Boolean)) {
      await writeFile(join(directory, 'release'), 'go');
      return;
    }
    await Bun.sleep(5);
  }
  throw new Error('Bun claim workers did not reach barrier');
}

describe('@tasks/sqlite', () => {
  it('applies checksummed migrations once and rejects changed durable history', async () => {
    const adapter = db();
    expect(await adapter.currentVersion()).toEqual({ ok: true, value: null });
    await migrate(adapter);

    const history = await adapter.history();
    expect(history.ok && history.value).toHaveLength(4);
    expect(history.ok && history.value?.[0]).toMatchObject({
      id: '001-initial', order: 1, checksum: sqliteMigrations[0]?.checksum,
    });
    expect(history.ok && history.value?.[1]).toMatchObject({ id: '002-issue-history', order: 2, checksum: sqliteMigrations[1]?.checksum });
    expect(history.ok && history.value?.[2]).toMatchObject({ id: '003-issue-commits', order: 3, checksum: sqliteMigrations[2]?.checksum });
    expect(history.ok && history.value?.[3]).toMatchObject({ id: '004-issue-branch', order: 4, checksum: sqliteMigrations[3]?.checksum });
    expect(await adapter.migrate()).toMatchObject({ ok: true, value: { applied: [] } });

    const changed = { ...sqliteMigrations[0]!, checksum: 'not-the-durable-checksum' };
    const mismatch = await adapter.migrate([changed]);
    expect(mismatch).toMatchObject({ ok: false, error: { kind: 'migration', phase: 'validate_history' } });
  });

  it('round-trips every issue persistence field including unknown wire data', async () => {
    const adapter = db();
    await migrate(adapter);
    const parent = issue('tk-parent');
    const value = issue('tk-one', {
      updatedAt: new Date('2025-01-01T02:00:00.000Z'),
      startedAt: new Date('2025-01-01T01:00:00.000Z'),
      dueAt: new Date('2025-01-03T00:00:00.000Z'),
      deferUntil: new Date('2025-01-01T12:00:00.000Z'),
      parentId: parent.id,
      wireUnknown: { futureIssueField: { retained: ['yes'] } },
    });
    await save(adapter, parent);
    await save(adapter, value);

    expect(await find(adapter, value.id)).toEqual(value);
  });

  it('does not claim blocked, deferred, or non-ready issues; claims after blocker closes', async () => {
    const adapter = db();
    await migrate(adapter);
    const blocker = issue('tk-blocker');
    const target = issue('tk-target');
    const deferred = issue('tk-deferred', { deferUntil: new Date('2025-01-03T00:00:00.000Z') });
    const inProgress = issue('tk-in-progress', { status: 'in_progress', startedAt: initialUpdatedAt });
    await save(adapter, blocker);
    await save(adapter, target);
    await save(adapter, deferred);
    await save(adapter, inProgress);

    const dependency = await adapter.withinTransaction(uow => uow.addDependency({
      issueId: target.id, target: blocker.id, type: 'blocks', createdAt, createdBy: null,
      metadata: {}, wireUnknown: { futureEdgeField: true },
    }));
    expect(dependency).toEqual({ ok: true, value: undefined });
    for (const value of [target, deferred, inProgress]) {
      expect(await adapter.withinTransaction(uow => uow.claimReady(value.id, 'worker'))).toMatchObject({ ok: false, error: { kind: 'conflict' } });
    }

    const closedBlocker = issue('tk-blocker', {
      status: 'closed',
      closedAt: new Date('2025-01-01T01:00:00.000Z'),
      updatedAt: new Date('2025-01-01T01:00:00.000Z'),
    });
    await save(adapter, closedBlocker);
    const claim = await adapter.withinTransaction(uow => uow.claimReady(target.id, 'worker'));
    expect(claim).toMatchObject({ ok: true, value: { status: 'in_progress', assignee: 'worker', startedAt: now, updatedAt: now } });
    const history = await adapter.withinTransaction(uow => uow.history(target.id));
    expect(history).toMatchObject({ ok: true, value: expect.arrayContaining([expect.objectContaining({ action: 'claim_ready', actor: 'worker', data: { assignee: 'worker', status: 'in_progress' } })]) });
    expect(await find(adapter, target.id)).toMatchObject({
      status: 'in_progress', assignee: 'worker', startedAt: now, updatedAt: now,
      dependencies: [{ wireUnknown: { futureEdgeField: true } }], dependencyCount: 1,
    });
  });

  it('enforces conditional claim compare-and-swap and preserves failed claimant state', async () => {
    const adapter = db();
    await migrate(adapter);
    const value = issue('tk-race');
    await save(adapter, value);

    const winner = await adapter.withinTransaction(uow => uow.claimReady(value.id, 'one', initialUpdatedAt));
    const loser = await adapter.withinTransaction(uow => uow.claimReady(value.id, 'two', initialUpdatedAt));
    expect(winner).toMatchObject({ ok: true, value: { assignee: 'one', status: 'in_progress' } });
    expect(loser).toMatchObject({ ok: false, error: { kind: 'conflict' } });
    expect(await find(adapter, value.id)).toMatchObject({ assignee: 'one', status: 'in_progress', updatedAt: now });
  });

  it('allows exactly one concurrent file-backed conditional claim and persists winner', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tk-sqlite-'));
    const filename = join(directory, 'issues.sqlite');
    const first = new SqliteAdapter({ filename, now: () => now });
    const second = new SqliteAdapter({ filename, now: () => now });

    try {
      await migrate(first);
      const value = issue('tk-file-race');
      await save(first, value);

      const workers = [
        startClaimWorker({ directory, filename, id: value.id, assignee: 'one' }),
        startClaimWorker({ directory, filename, id: value.id, assignee: 'two' }),
      ];
      const results = await Promise.all([
        collectClaim(workers[0]!),
        collectClaim(workers[1]!),
        releaseWorkers(workers, directory),
      ]).then(([firstResult, secondResult]) => [firstResult, secondResult]);
      const successes = results.filter(result => result.ok);
      const conflicts = results.filter(result => !result.ok);

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({ ok: false, error: { kind: 'conflict' } });

      const winner = successes[0];
      if (!winner?.ok) throw new Error('expected one successful claim');
      expect(winner.value).toMatchObject({ status: 'in_progress' });
      expect(await find(second, value.id)).toMatchObject({
        status: 'in_progress', assignee: winner.value.assignee, updatedAt: now,
      });
    } finally {
      first.close();
      second.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('opens existing database readonly and rejects all writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tk-sqlite-readonly-'));
    const filename = join(directory, 'issues.sqlite');
    const writer = new SqliteAdapter({ filename, now: () => now });
    try {
      await migrate(writer);
      const value = issue('tk-readonly');
      await save(writer, value);
      const reader = new SqliteAdapter({ filename, readonly: true, now: () => now });
      try {
        expect(await find(reader, value.id)).toEqual(value);
        const write = await reader.withinTransaction(uow => uow.claimReady(value.id, 'blocked'));
        expect(write).toMatchObject({ ok: false, error: { kind: 'repository', operation: 'claimReady' } });
      } finally { reader.close(); }
    } finally {
      writer.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('persists comments, dependency metadata and nested unknown wire JSON', async () => {
    const adapter = db();
    await migrate(adapter);
    const value = issue('tk-comments');
    await save(adapter, value);
    const result = await adapter.withinTransaction(async uow => {
      const dependency = await uow.addDependency({
        issueId: value.id, target: dependencyTarget('external:remote:capability'), type: 'related', createdAt,
        createdBy: 'author', metadata: { known: true }, wireUnknown: { future: ['keep'] },
      });
      return dependency.ok ? uow.addComment(value.id, 'author', 'hello') : dependency;
    });
    expect(result).toEqual({ ok: true, value: undefined });

    expect(await find(adapter, value.id)).toMatchObject({
      dependencies: [{ target: 'external:remote:capability', metadata: { known: true }, wireUnknown: { future: ['keep'] } }],
      dependencyCount: 1,
      comments: [{ issueId: value.id, author: 'author', text: 'hello', wireUnknown: {} }],
      commentCount: 1,
    });
  });

  it('rolls back Result failures without persisting partial work', async () => {
    const adapter = db();
    await migrate(adapter);
    const value = issue('tk-rollback');
    const result = await adapter.withinTransaction(async uow => {
      await uow.save(value);
      return err({ kind: 'conflict', message: 'stop' });
    });
    expect(result).toEqual({ ok: false, error: { kind: 'conflict', message: 'stop' } });
    expect(await find(adapter, value.id)).toBeNull();
  });
});
