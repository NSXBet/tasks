import { describe, expect, it } from 'vitest';
import { canonicalTimestampCodec } from '@tasks/application';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { FileAdapter } from '@tasks/file';
import { SqliteAdapter } from '@tasks/sqlite';
import { join } from 'node:path';
import { decodeIssue, migrateBeadsJsonl, planIssues, resolveBeadsJsonl, splitRecords, type BeadsIssueRecord, type ProcessRunner } from '../src/index.js';

const at = '2026-08-23T16:24:18Z';
/** Shape emitted by real `bd export`: sparse, snake_case, no schema_version. */
const bead = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ _type: 'issue', id: 'demo-2jj', title: 'first task', status: 'open', priority: 1, issue_type: 'task', owner: 'o@example.test', created_at: at, created_by: 'Yuri', updated_at: at, dependency_count: 0, dependent_count: 0, comment_count: 0, ...over });
const jsonl = (...rows: readonly Record<string, unknown>[]): string => rows.map((row) => JSON.stringify(row)).join('\n');
const target = (): SqliteAdapter => { const database = new SqliteAdapter({ filename: ':memory:' }); const migrated = database.migrate(); void migrated; return database; };
const ready = async (): Promise<SqliteAdapter> => { const database = new SqliteAdapter({ filename: ':memory:' }); const result = await database.migrate(); expect(result.ok).toBe(true); return database; };
const issues = async (database: SqliteAdapter) => { const page = await database.withinTransaction((uow) => uow.list({ limit: 1000 })); if (!page.ok) throw new Error('list failed'); return page.value.items; };
const record = (over: Record<string, unknown> = {}): BeadsIssueRecord => { const decoded = decodeIssue(splitRecords(jsonl(bead(over))).records[0]!, canonicalTimestampCodec); if ('error' in decoded) throw new Error(decoded.error.message); return decoded.issue; };

describe('beads record stream', () => {
  it('treats non-issue records as carried data rather than failures', async () => {
    const database = await ready();
    const source = jsonl(bead(), { _type: 'memory', key: 'some-memory', value: 'some memory' }, bead({ id: 'demo-6rj', title: 'second' }));
    const result = await migrateBeadsJsonl(database, source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.imported).toBe(2);
    expect(result.value.carried).toEqual([{ line: 2, type: 'memory', raw: { _type: 'memory', key: 'some-memory', value: 'some memory' } }]);
    expect(result.value.rejected).toEqual([]);
    database.close();
  });

  it('tolerates blank lines, CRLF and trailing newline without shifting line numbers', () => {
    const { records, errors } = splitRecords(`${JSON.stringify(bead())}\r\n\r\n${JSON.stringify(bead({ id: 'demo-6rj' }))}\n`);
    expect(errors).toEqual([]);
    expect(records.map((entry) => entry.line)).toEqual([1, 3]);
  });

  it('defaults a missing _type to issue, matching legacy exports', () => {
    const { records } = splitRecords(JSON.stringify({ ...bead(), _type: undefined }));
    expect(records[0]!.type).toBe('issue');
  });

  it('reports the offending line and field for malformed records', async () => {
    const database = await ready();
    const result = await migrateBeadsJsonl(database, jsonl(bead(), { _type: 'issue', id: 'demo-bad', title: 'x', status: 'open', priority: 1, created_at: 'nope', updated_at: at }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.imported).toBe(1);
    expect(result.value.rejected).toHaveLength(1);
    expect(result.value.rejected[0]).toMatchObject({ line: 2, field: 'created_at' });
    expect(result.value.rejected[0]!.message).toContain('ISO-8601');
    database.close();
  });

  it('aborts the whole batch in strict mode', async () => {
    const database = await ready();
    const result = await migrateBeadsJsonl(database, jsonl(bead(), { _type: 'issue', id: 'demo-bad' }), { strict: true });
    expect(result.ok).toBe(false);
    expect(await issues(database)).toHaveLength(0);
    database.close();
  });
});

describe('parent ordering', () => {
  it('orders children after parents regardless of export order', () => {
    const child = record({ id: 'demo-2', title: 'child', parent: 'demo-1' });
    const parent = record({ id: 'demo-1', title: 'parent' });
    const plan = planIssues([child, parent]);
    expect(plan.ordered.map((entry) => entry.issue.id)).toEqual(['demo-1', 'demo-2']);
    expect(plan.detached).toEqual([]);
  });

  it('imports a child listed before its parent', async () => {
    const database = await ready();
    const source = jsonl(bead({ id: 'demo-2', title: 'child', parent: 'demo-1' }), bead({ id: 'demo-1', title: 'parent' }));
    const result = await migrateBeadsJsonl(database, source);
    expect(result.ok).toBe(true);
    const stored = await issues(database);
    expect(stored.find((issue) => issue.id === 'demo-2')?.parentId).toBe('demo-1');
    database.close();
  });

  it('detaches and reports parents missing from the export', async () => {
    const database = await ready();
    const result = await migrateBeadsJsonl(database, jsonl(bead({ id: 'demo-2', parent: 'demo-gone' })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.detachedParents).toEqual([{ issueId: 'demo-2', parentId: 'demo-gone', line: 1 }]);
    expect((await issues(database))[0]!.parentId).toBeNull();
    database.close();
  });

  it('keeps parents already durable in the target', async () => {
    const database = await ready();
    expect((await migrateBeadsJsonl(database, jsonl(bead({ id: 'demo-1', title: 'parent' })))).ok).toBe(true);
    const second = await migrateBeadsJsonl(database, jsonl(bead({ id: 'demo-2', title: 'child', parent: 'demo-1' })));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.detachedParents).toEqual([]);
    database.close();
  });

  it('breaks parent cycles instead of deadlocking', () => {
    const first = record({ id: 'demo-1', parent: 'demo-2' });
    const second = record({ id: 'demo-2', parent: 'demo-1' });
    const plan = planIssues([first, second]);
    expect(plan.ordered).toHaveLength(2);
    expect(plan.cycles.length).toBeGreaterThan(0);
    expect(plan.ordered.some((entry) => entry.issue.parentId === null)).toBe(true);
  });
});

describe('fidelity and atomicity', () => {
  it('preserves estimated_minutes, labels, comments and dependencies', async () => {
    const database = await ready();
    const source = jsonl(
      bead({ id: 'demo-8a1', title: 'rich', issue_type: 'bug', priority: 0, status: 'in_progress', assignee: 'alice', design: 'D', acceptance_criteria: 'AC', notes: 'N', estimated_minutes: 90, started_at: at, labels: ['red'], comments: [{ id: 'c1', issue_id: 'demo-8a1', author: 'Yuri', text: 'a comment', created_at: at }], comment_count: 1 }),
      bead({ id: 'demo-6rj', title: 'second', dependencies: [{ issue_id: 'demo-6rj', depends_on_id: 'demo-8a1', type: 'blocks', created_at: at, created_by: 'Yuri', metadata: '{}' }], dependency_count: 1 }),
    );
    expect((await migrateBeadsJsonl(database, source)).ok).toBe(true);
    const stored = await issues(database);
    const rich = stored.find((issue) => issue.id === 'demo-8a1')!;
    expect(rich).toMatchObject({ estimate: 90, design: 'D', acceptanceCriteria: 'AC', notes: 'N', assignee: 'alice', type: 'bug', status: 'in_progress' });
    expect(rich.labels).toEqual(['red']);
    expect(rich.comments[0]!.text).toBe('a comment');
    const blocked = stored.find((issue) => issue.id === 'demo-6rj')!;
    expect(blocked.dependencies[0]).toMatchObject({ target: 'demo-8a1', type: 'blocks' });
    database.close();
  });

  it('retains unknown beads fields for lossless re-export', async () => {
    const database = await ready();
    expect((await migrateBeadsJsonl(database, jsonl(bead({ future_beads_field: { keep: true } })))).ok).toBe(true);
    expect((await issues(database))[0]!.wireUnknown).toEqual({ future_beads_field: { keep: true } });
    database.close();
  });

  it('keeps dependencies on targets outside the export, which beads allows', async () => {
    const database = await ready();
    const source = jsonl(bead({ id: 'demo-2', dependencies: [{ issue_id: 'demo-2', depends_on_id: 'external:other:cap', type: 'blocks', created_at: at, created_by: null, metadata: '{}' }], dependency_count: 1 }));
    expect((await migrateBeadsJsonl(database, source)).ok).toBe(true);
    expect((await issues(database))[0]!.dependencies[0]!.target).toBe('external:other:cap');
    database.close();
  });

  it('writes nothing when a later record in the batch cannot be persisted', async () => {
    const database = await ready();
    // Comment IDs are globally unique; a duplicate makes the second save fail mid-batch.
    const duplicate = (id: string) => bead({ id, comments: [{ id: 'shared-comment', issue_id: id, author: 'Yuri', text: 'x', created_at: at }], comment_count: 1 });
    const result = await migrateBeadsJsonl(database, jsonl(duplicate('demo-1'), duplicate('demo-2')));
    expect(result.ok).toBe(false);
    expect(await issues(database)).toHaveLength(0);
    database.close();
  });

  it('reports without writing in dry-run mode', async () => {
    const database = await ready();
    const result = await migrateBeadsJsonl(database, jsonl(bead()), { dryRun: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ dryRun: true, imported: 1 });
    expect(await issues(database)).toHaveLength(0);
    database.close();
  });
});

describe('conflict policy', () => {
  const existing = jsonl(bead({ id: 'demo-1', title: 'original' }));
  it('skips existing issues by default and leaves them untouched', async () => {
    const database = await ready();
    expect((await migrateBeadsJsonl(database, existing)).ok).toBe(true);
    const result = await migrateBeadsJsonl(database, jsonl(bead({ id: 'demo-1', title: 'changed' })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ imported: 0, skipped: ['demo-1'] });
    expect((await issues(database))[0]!.title).toBe('original');
    database.close();
  });

  it('overwrites on request', async () => {
    const database = await ready();
    expect((await migrateBeadsJsonl(database, existing)).ok).toBe(true);
    const result = await migrateBeadsJsonl(database, jsonl(bead({ id: 'demo-1', title: 'changed' })), { onConflict: 'overwrite' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.overwritten).toEqual(['demo-1']);
    expect((await issues(database))[0]!.title).toBe('changed');
    database.close();
  });

  it('fails loudly on request without partial writes', async () => {
    const database = await ready();
    expect((await migrateBeadsJsonl(database, existing)).ok).toBe(true);
    const result = await migrateBeadsJsonl(database, jsonl(bead({ id: 'demo-1', title: 'changed' }), bead({ id: 'demo-9' })), { onConflict: 'fail' });
    expect(result.ok).toBe(false);
    expect(await issues(database)).toHaveLength(1);
    database.close();
  });

  it('is idempotent when re-run', async () => {
    const database = await ready();
    const source = jsonl(bead({ id: 'demo-1' }), bead({ id: 'demo-2', parent: 'demo-1' }));
    expect((await migrateBeadsJsonl(database, source)).ok).toBe(true);
    expect((await migrateBeadsJsonl(database, source)).ok).toBe(true);
    expect(await issues(database)).toHaveLength(2);
    database.close();
  });
});

describe('source resolution', () => {
  const runner = (stdout: string, code = 0, stderr = ''): ProcessRunner => ({ run: async () => ({ stdout, stderr, code }) });

  it('rejects a directory with no beads workspace', async () => {
    const result = await resolveBeadsJsonl('/nonexistent-beads-root', { runner: runner('') });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('no beads workspace found');
  });

  it('exposes the sqlite adapter as a migration target through the port', () => {
    const database = target();
    expect(typeof database.withinTransaction).toBe('function');
    database.close();
  });
});

describe('adapter portability', () => {
  /** The migrator talks only to UnitOfWork, so every adapter is a valid target. */
  it('migrates into the file adapter with the same guarantees', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tasks-beads-file-'));
    try {
      const adapter = new FileAdapter({ dir: directory });
      expect((await adapter.migrate()).ok).toBe(true);
      const source = jsonl(bead({ id: 'demo-2', title: 'child', parent: 'demo-1', estimated_minutes: 30 }), bead({ id: 'demo-1', title: 'parent' }), { _type: 'memory', key: 'k', value: 'v' });
      const result = await migrateBeadsJsonl(adapter, source);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({ imported: 2 });
      expect(result.value.carried).toHaveLength(1);
      const page = await adapter.withinTransaction((uow) => uow.list({ limit: 100 }));
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      const child = page.value.items.find((issue) => issue.id === 'demo-2');
      expect(child).toMatchObject({ parentId: 'demo-1', estimate: 30 });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
