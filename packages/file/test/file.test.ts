import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { IssueSchema, dependencyTarget, issueId, type Issue } from '@tasks/domain';
import { FileAdapter } from '../dist/index.js';

const dirs: string[] = [];
const createdAt = new Date('2025-01-01T00:00:00.000Z');
const initialUpdatedAt = new Date('2025-01-01T00:01:00.000Z');
const now = new Date('2025-01-02T00:00:00.000Z');

async function makeAdapter(): Promise<{ adapter: FileAdapter; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'tasks-file-test-'));
  dirs.push(dir);
  const adapter = new FileAdapter({ dir, now: () => now });
  await adapter.migrate();
  return { adapter, dir };
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

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('FileAdapter', () => {
  it('creates meta.json on migrate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tasks-file-test-'));
    dirs.push(dir);
    const adapter = new FileAdapter({ dir, now: () => now });
    const result = await adapter.migrate();
    expect(result.ok).toBe(true);
    expect(existsSync(join(dir, 'meta.json'))).toBe(true);
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'));
    expect(meta.backend).toBe('file');
  });

  it('saves and retrieves an issue', async () => {
    const { adapter } = await makeAdapter();
    const i = issue('tk-abc123');
    const saveResult = await adapter.withinTransaction(uow => uow.save(i));
    expect(saveResult.ok).toBe(true);

    const findResult = await adapter.withinTransaction(uow => uow.findById(issueId('tk-abc123')));
    expect(findResult.ok).toBe(true);
    if (findResult.ok) {
      expect(findResult.value).not.toBeNull();
      expect(findResult.value!.id).toBe('tk-abc123');
      expect(findResult.value!.title).toBe('Task');
      expect(findResult.value!.metadata).toEqual({ retained: { yes: true } });
      expect(findResult.value!.wireUnknown).toEqual({ futureIssueField: { retained: true } });
    }
  });

  it('writes issue as JSON file', async () => {
    const { adapter } = await makeAdapter();
    await adapter.withinTransaction(uow => uow.save(issue('tk-abc123')));
    const filePath = join(dirs[0]!, 'issues', 'tk-abc123.json');
    expect(existsSync(filePath)).toBe(true);
    const wire = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(wire.id).toBe('tk-abc123');
    expect(wire.status).toBe('open');
  });

  it('lists issues with status filter', async () => {
    const { adapter } = await makeAdapter();
    await adapter.withinTransaction(async uow => {
      await uow.save(issue('tk-aaa111'));
      await uow.save(issue('tk-bbb222', { status: 'closed' as Issue['status'] }));
      await uow.save(issue('tk-ccc333'));
      return { ok: true as const, value: undefined };
    });

    const listResult = await adapter.withinTransaction(uow => uow.list({ status: 'open' as Issue['status'] }));
    expect(listResult.ok).toBe(true);
    if (listResult.ok) {
      expect(listResult.value.items.length).toBe(2);
      expect(listResult.value.items.map(i => i.id)).toEqual(['tk-aaa111', 'tk-ccc333']);
    }
  });

  it('adds and removes dependencies', async () => {
    const { adapter } = await makeAdapter();
    await adapter.withinTransaction(uow => uow.save(issue('tk-aaa111')));
    await adapter.withinTransaction(uow => uow.save(issue('tk-bbb222')));

    await adapter.withinTransaction(uow => uow.addDependency({
      issueId: issueId('tk-aaa111'),
      target: dependencyTarget('tk-bbb222'),
      type: 'blocks',
      createdAt: now,
      createdBy: 'test',
      metadata: {},
      wireUnknown: {},
    }));

    let found = await adapter.withinTransaction(uow => uow.findById(issueId('tk-aaa111')));
    expect(found.ok && found.value!.dependencies.length).toBe(1);

    await adapter.withinTransaction(uow => uow.removeDependency(issueId('tk-aaa111'), dependencyTarget('tk-bbb222'), 'blocks'));
    found = await adapter.withinTransaction(uow => uow.findById(issueId('tk-aaa111')));
    expect(found.ok && found.value!.dependencies.length).toBe(0);
  });

  it('computes dependentCount on the target of a dependency, via both findById and list', async () => {
    // File backend keeps one JSON document per issue with no cross-issue index, so
    // dependentCount cannot be maintained incrementally on write like dependencyCount is —
    // it must be recomputed on every read from the full set of dependency edges.
    const { adapter } = await makeAdapter();
    await adapter.withinTransaction(uow => uow.save(issue('tk-aaa111')));
    await adapter.withinTransaction(uow => uow.save(issue('tk-bbb222')));
    await adapter.withinTransaction(uow => uow.save(issue('tk-ccc333')));

    const addBlock = (from: string) => adapter.withinTransaction(uow => uow.addDependency({
      issueId: issueId(from),
      target: dependencyTarget('tk-bbb222'),
      type: 'blocks',
      createdAt: now,
      createdBy: 'test',
      metadata: {},
      wireUnknown: {},
    }));
    await addBlock('tk-aaa111');
    await addBlock('tk-ccc333');

    const bySingleRead = await adapter.withinTransaction(uow => uow.findById(issueId('tk-bbb222')));
    expect(bySingleRead.ok && bySingleRead.value!.dependentCount).toBe(2);
    expect(bySingleRead.ok && bySingleRead.value!.dependencyCount).toBe(0);

    const listed = await adapter.withinTransaction(uow => uow.list({}));
    const target = listed.ok ? listed.value.items.find(i => i.id === 'tk-bbb222') : undefined;
    expect(target?.dependentCount).toBe(2);

    await adapter.withinTransaction(uow => uow.removeDependency(issueId('tk-aaa111'), dependencyTarget('tk-bbb222'), 'blocks'));
    const afterRemoval = await adapter.withinTransaction(uow => uow.findById(issueId('tk-bbb222')));
    expect(afterRemoval.ok && afterRemoval.value!.dependentCount).toBe(1);
  });

  it('adds comments', async () => {
    const { adapter } = await makeAdapter();
    await adapter.withinTransaction(uow => uow.save(issue('tk-aaa111')));
    await adapter.withinTransaction(uow => uow.addComment(issueId('tk-aaa111'), 'alice', 'hello'));

    const found = await adapter.withinTransaction(uow => uow.findById(issueId('tk-aaa111')));
    expect(found.ok && found.value!.comments.length).toBe(1);
    expect(found.ok && found.value!.comments[0]!.text).toBe('hello');
  });

  it('heals a hand-edited undershooting comment_count instead of rejecting the issue', async () => {
    // A hand edit appended a comment without bumping comment_count; the stored count
    // undershot loaded comments. max(stored, loaded) at wire decode keeps the store
    // readable and the next write persists the healed value.
    const { adapter, dir } = await makeAdapter();
    await adapter.withinTransaction(uow => uow.save(issue('tk-aaa111')));
    const issuePath = join(dir, 'issues', 'tk-aaa111.json');
    const document = JSON.parse(readFileSync(issuePath, 'utf-8')) as Record<string, unknown>;
    document['comments'] = [...(document['comments'] as readonly unknown[]), { id: 'comment-1', issue_id: 'tk-aaa111', author: 'alice', text: 'hello', created_at: '2025-01-02T00:00:00.000Z' }];
    document['comment_count'] = 0;
    writeFileSync(issuePath, JSON.stringify(document));

    const found = await adapter.withinTransaction(uow => uow.findById(issueId('tk-aaa111')));
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value!.commentCount).toBe(1);

    await adapter.withinTransaction(uow => uow.addComment(issueId('tk-aaa111'), 'bob', 'second'));
    const reread = JSON.parse(readFileSync(issuePath, 'utf-8')) as { comment_count: number };
    expect(reread.comment_count).toBe(2);
  });

  it('records audit history', async () => {
    const { adapter } = await makeAdapter();
    await adapter.withinTransaction(uow => uow.save(issue('tk-aaa111')));

    const histResult = await adapter.withinTransaction(uow => uow.history(issueId('tk-aaa111')));
    expect(histResult.ok).toBe(true);
    if (histResult.ok) {
      expect(histResult.value.length).toBeGreaterThan(0);
      expect(histResult.value[0]!.action).toBe('save');
    }
  });

  it('claimReady succeeds for open unblocked issue', async () => {
    const { adapter } = await makeAdapter();
    await adapter.withinTransaction(uow => uow.save(issue('tk-aaa111')));

    const result = await adapter.withinTransaction(uow => uow.claimReady(issueId('tk-aaa111'), 'bob'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.assignee).toBe('bob');
      expect(result.value.status).toBe('in_progress');
    }
  });

  it('claimReady fails for blocked issue', async () => {
    const { adapter } = await makeAdapter();
    const blocker = issue('tk-bbb222');
    await adapter.withinTransaction(uow => uow.save(blocker));
    await adapter.withinTransaction(uow => uow.save(issue('tk-aaa111', {
      dependencies: [{
        issueId: issueId('tk-aaa111'),
        target: dependencyTarget('tk-bbb222'),
        type: 'blocks',
        createdAt: now,
        createdBy: 'test',
        metadata: {},
        wireUnknown: {},
      }],
      dependencyCount: 1,
    })));

    const result = await adapter.withinTransaction(uow => uow.claimReady(issueId('tk-aaa111'), 'bob'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('conflict');
  });

  it('pagination works with cursor', async () => {
    const { adapter } = await makeAdapter();
    await adapter.withinTransaction(async uow => {
      for (let i = 1; i <= 5; i++) {
        await uow.save(issue(`tk-item${String(i).padStart(2, '0')}`));
      }
      return { ok: true as const, value: undefined };
    });

    const page1 = await adapter.withinTransaction(uow => uow.list({ limit: 2 }));
    expect(page1.ok).toBe(true);
    if (page1.ok) {
      expect(page1.value.items.length).toBe(2);
      expect(page1.value.nextCursor).not.toBeNull();

      const page2 = await adapter.withinTransaction(uow => uow.list({ limit: 2, cursor: page1.value.nextCursor! }));
      expect(page2.ok).toBe(true);
      if (page2.ok) {
        expect(page2.value.items.length).toBe(2);
        expect(page2.value.items[0]!.id).toBe('tk-item03');
      }
    }
  });
});
