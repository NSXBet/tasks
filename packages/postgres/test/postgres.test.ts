import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { PostgresAdapter, postgresMigrations } from '../src/index.js';
import { issueId, type Issue } from '@tasks/domain';

type Call = { text: string; values?: readonly unknown[] };
type Reply = { rows?: Record<string, unknown>[]; rowCount?: number };
class MockClient {
  calls: Call[] = [];
  released = 0;
  constructor(private readonly reply: (call: Call) => Reply | Promise<Reply> = () => ({ rows: [] })) {}
  async query(text: string, values?: readonly unknown[]) {
    const call: Call = values === undefined ? { text } : { text, values };
    this.calls.push(call);
    const result = await this.reply(call);
    return { rows: result.rows ?? [], rowCount: result.rowCount ?? result.rows?.length ?? 0 };
  }
  release() { this.released++; }
}
const digest = (sql: string) => createHash('sha256').update(sql).digest('hex');
const at = new Date('2025-01-02T00:00:00.000Z');
const baseRow = { id: 'tk-1', title: 'Task', description: '', status: 'in_progress', priority: 2, type: 'task', owner: null, assignee: 'worker', created_by: 'test', created_at: 1735689600000, updated_at: at.getTime(), started_at: at.getTime(), closed_at: null, due_at: null, defer_until: null, parent_id: null, labels_json: '["x"]', notes: null, design: null, acceptance_criteria: null, estimate: null, spec_id: null, external_ref: null, metadata_json: '{"a":true}', wire_unknown_json: '{"future":1}' };
const text = (client: MockClient) => client.calls.map(x => x.text).join('\n');
const call = (client: MockClient, needle: string) => client.calls.find(x => x.text.includes(needle));

function adapter(client: MockClient) { return new PostgresAdapter({ client: client as never, now: () => at }); }

describe('@tasks/postgres contract surface', () => {
  it('uses public schema in DDL and migration history reads/writes', async () => {
    expect(postgresMigrations).toHaveLength(1);
    expect(postgresMigrations[0]?.sql).toContain('CREATE TABLE public.schema_migrations');
    expect(postgresMigrations[0]?.sql).toContain('CREATE TABLE public.issues');
    expect(postgresMigrations[0]?.sql).toContain('REFERENCES public.issues');
    const client = new MockClient(c => c.text.includes('to_regclass') ? { rows: [{ name: 'public.schema_migrations' }] } : { rows: [{ id: '001-initial', migration_order: 1, checksum: 'x', applied_at: at.getTime() }] });
    const store = adapter(client);
    expect(await store.currentVersion()).toEqual({ ok: true, value: '001-initial' });
    expect(await store.history()).toMatchObject({ ok: true, value: [{ id: '001-initial', appliedAt: at }] });
    expect(text(client)).toContain('FROM public.schema_migrations');
    expect(text(client)).not.toMatch(/FROM schema_migrations/);
  });

  it('migrates under advisory transaction lock, releases pool client, rolls back checksum mismatch', async () => {
    const client = new MockClient(c => c.text.includes('to_regclass') ? { rows: [{ name: 'public.schema_migrations' }] } : c.text.includes('SELECT id,migration_order') ? { rows: [{ id: '001-initial', migration_order: 1, checksum: 'wrong' }] } : { rows: [] });
    const result = await adapter(client).migrate();
    expect(result).toMatchObject({ ok: false, error: { kind: 'migration', phase: 'validate_history' } });
    expect(client.calls.slice(0, 3)).toMatchObject([{ text: 'BEGIN' }, { text: 'SELECT pg_advisory_xact_lock($1)', values: [1111771443] }, { text: expect.stringContaining('to_regclass') }]);
    expect(text(client)).toContain('FROM public.schema_migrations');
    expect(text(client)).toContain('ROLLBACK');
    // injected client owned by caller: no release
    expect(client.released).toBe(0);
  });

  it('commits migrations and releases acquired pool client', async () => {
    const client = new MockClient(c => c.text.includes('to_regclass') ? { rows: [{ name: null }] } : { rows: [] });
    const pool = { connect: async () => client };
    const result = await new PostgresAdapter({ pool: pool as never, now: () => at }).migrate();
    expect(result).toMatchObject({ ok: true, value: { currentVersion: '001-initial' } });
    expect(text(client)).toContain('INSERT INTO public.schema_migrations');
    expect(text(client)).toContain('COMMIT');
    expect(client.released).toBe(1);
  });

  it('hydrates aggregate JSONB and epoch fields through actual find adapter method', async () => {
    const client = new MockClient(c => c.text.includes('FROM public.issues WHERE') ? { rows: [baseRow] } : c.text.includes('count(*)') ? { rows: [{ count: '2' }] } : c.text.includes('FROM public.issue_dependencies WHERE') ? { rows: [{ issue_id: 'tk-1', target: 'tk-blocker', type: 'blocks', created_at: at.getTime(), created_by: null, metadata_json: '{"edge":true}', wire_unknown_json: '{}' }] } : c.text.includes('FROM public.issue_comments') ? { rows: [{ id: 'c1', issue_id: 'tk-1', author: 'me', text: 'hi', created_at: at.getTime(), wire_unknown_json: '{"x":1}' }] } : { rows: [] });
    const result = await adapter(client).withinTransaction(uow => uow.findById(issueId('tk-1')));
    expect(result).toMatchObject({ ok: true, value: { createdAt: new Date(1735689600000), updatedAt: at, labels: ['x'], metadata: { a: true }, dependencies: [{ metadata: { edge: true } }], comments: [{ wireUnknown: { x: 1 } }], dependentCount: 2 } });
    expect(text(client)).toContain('BEGIN'); expect(text(client)).toContain('COMMIT');
  });

  it('parameterizes dependency/comment mutation and atomic conditional claim policy', async () => {
    const client = new MockClient(c => c.text.startsWith('UPDATE public.issues') ? { rows: [], rowCount: 0 } : { rows: [] });
    const store = adapter(client);
    const result = await store.withinTransaction(async uow => {
      await uow.addDependency({ issueId: issueId('tk-1'), target: issueId('tk-2'), type: 'blocks', createdAt: at, createdBy: null, metadata: { x: true }, wireUnknown: {} });
      await uow.removeDependency(issueId('tk-1'), issueId('tk-2'), 'blocks');
      await uow.addComment(issueId('tk-1'), 'me', 'hello');
      return uow.claimReady(issueId('tk-1'), 'worker', new Date('2025-01-01T00:00:00.000Z'));
    });
    expect(result).toMatchObject({ ok: false, error: { kind: 'conflict' } });
    expect(call(client, 'INSERT INTO public.issue_dependencies')?.values).toEqual(expect.arrayContaining(['tk-1', 'tk-2', 'blocks', JSON.stringify({ x: true })]));
    expect(call(client, 'DELETE FROM public.issue_dependencies')?.text).toContain('issue_id=$1 AND target=$2 AND type=$3');
    expect(call(client, 'INSERT INTO public.issue_comments')?.text).toContain('$6::jsonb');
    const claim = call(client, 'UPDATE public.issues')!;
    expect(claim.text).toContain('i.updated_at=$8');
    expect(claim.text).toContain('i.defer_until IS NULL OR i.defer_until<=$7');
    expect(claim.text).toContain('NOT EXISTS'); expect(claim.text).toContain('d.type=$9');
    expect(claim.text).toContain('blocker.status NOT IN ($10)');
    expect(claim.values).toEqual(['worker', 'in_progress', at.getTime(), at.getTime(), 'tk-1', 'open', at.getTime(), 1735689600000, 'blocks', 'closed']);
    expect(text(client)).toContain('ROLLBACK');
  });

  it('rejects malformed declared checksum with rollback before history access', async () => {
    const client = new MockClient();
    const step = { ...postgresMigrations[0]!, checksum: digest('different') };
    const result = await adapter(client).migrate([step]);
    expect(result).toMatchObject({ ok: false, error: { phase: 'validate_history' } });
    expect(text(client)).toContain('ROLLBACK');
    expect(text(client)).not.toContain('to_regclass');
  });
});
