import type { Issue } from '@tasks/domain';
import { issueId } from '@tasks/domain';
import type { SurfaceStore } from '../store.js';
import { getOrThrow, readCurrentId } from '../store.js';
import { MessageError } from '../errors.js';

/** Options accepted by `list`/`ready`; mirrors the CLI's filters. */
export interface ListOptions {
  readonly status?: string;
  readonly parent?: string;
  readonly assignee?: string;
  readonly type?: string;
  readonly priority?: number;
  readonly label?: string;
  readonly limit?: number;
  /** Defer `issue.deferUntil <= now` and open blocker checks are always applied by ready. */
  readonly claim?: boolean;
}

const now = (): Date => new Date();

export const showIssue = (store: SurfaceStore, id: string) => store.transact(async (uow) => getOrThrow(uow, id));

export const listIssues = (store: SurfaceStore, options: ListOptions = {}) => store.transact(async (uow) => {
  const page = await uow.list({
    ...(options.status === undefined || options.status === 'all' ? {} : { status: options.status }),
    limit: options.limit ?? 100_000,
  });
  if (!page.ok) throw new MessageError('list failed');
  let items = page.value.items.filter((issue) =>
    (options.parent === undefined || issue.parentId === options.parent)
    && (options.assignee === undefined || issue.assignee === options.assignee)
    && (options.type === undefined || issue.type === options.type)
    && (options.priority === undefined || issue.priority === options.priority)
    && (options.label === undefined || issue.labels.includes(options.label)));
  if (options.claim === true) {
    items = items.filter((issue) => issue.status === 'open'
      && (issue.deferUntil === null || issue.deferUntil <= now())
      && !issue.dependencies.some((edge) => edge.type === 'blocks'
        && page.value.items.some((candidate) => candidate.id === edge.target && candidate.status !== 'closed')));
  }
  return items;
});

/** Ready issues (unblocked, not deferred); optional atomic claim of the first. */
export const readyIssues = (store: SurfaceStore, options: ListOptions & { readonly claim?: boolean } = {}) => store.transact(async (uow) => {
  const page = await uow.list({ limit: options.limit ?? 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  const nowDate = now();
  const items = page.value.items.filter((issue) => issue.status === 'open'
    && (issue.deferUntil === null || issue.deferUntil <= nowDate)
    && !issue.dependencies.some((edge) => edge.type === 'blocks'
      && page.value.items.some((candidate) => candidate.id === edge.target && candidate.status !== 'closed')));
  if (options.claim !== true) return items;
  const pick = items[0];
  if (pick === undefined) throw new MessageError('no ready issue to claim');
  const claimed = await uow.claimReady(pick.id, store.actor);
  if (!claimed.ok) throw new MessageError('claim failed');
  return [claimed.value];
});

export const blockedIssues = (store: SurfaceStore) => store.transact(async (uow) => {
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  const all = page.value.items;
  return all.filter((issue) => issue.dependencies.some((edge) => edge.type === 'blocks'
    && all.some((other) => other.id === edge.target && other.status !== 'closed')));
});

export const searchIssues = (store: SurfaceStore, text: string) => store.transact(async (uow) => {
  const needle = text.toLowerCase();
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  return page.value.items.filter((issue) => [issue.id, issue.title, issue.description, issue.notes ?? '', ...issue.labels].join('\n').toLowerCase().includes(needle));
});

/** Structured query: `<field><op><value>` with fields id,status,type,priority,assignee,owner,label,title. */
export const queryIssues = (store: SurfaceStore, expression: string) => store.transact(async (uow) => {
  const match = expression.trim().match(/^([a-z_]+)\s*(=|!=|~)\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z0-9_.-]+))$/i);
  if (!match) throw new MessageError('invalid query: supported fields are id, status, type, priority, assignee, owner, label, title; operators =, !=, ~');
  const [, field, operator, quotedDouble, quotedSingle, bare] = match;
  const value = quotedDouble ?? quotedSingle ?? bare ?? '';
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  const values = (issue: Issue): readonly string[] => {
    switch (field) {
      case 'id': return [issue.id];
      case 'status': return [issue.status];
      case 'type': return [issue.type];
      case 'priority': return [String(issue.priority)];
      case 'assignee': return [issue.assignee ?? ''];
      case 'owner': return [issue.owner ?? ''];
      case 'label': return issue.labels;
      case 'title': return [issue.title];
      default: throw new MessageError(`invalid query field: ${field}`);
    }
  };
  return page.value.items.filter((issue) => {
    const candidate = values(issue);
    return operator === '=' ? candidate.includes(value)
      : operator === '!=' ? !candidate.includes(value)
        : candidate.some((entry) => entry.toLowerCase().includes(value.toLowerCase()));
  });
});

export const staleIssues = (store: SurfaceStore, days: number) => store.transact(async (uow) => {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  return page.value.items.filter((issue) => issue.status !== 'closed' && issue.updatedAt < cutoff);
});

export const orphanIssues = (store: SurfaceStore) => store.transact(async (uow) => {
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  return page.value.items.filter((issue) => issue.status !== 'closed'
    && issue.assignee === null && issue.labels.length === 0
    && issue.dependencies.length === 0 && issue.parentId === null);
});

export const childrenOf = (store: SurfaceStore, id: string) => store.transact(async (uow) => {
  await getOrThrow(uow, id);
  const parentId = issueId(id);
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  return page.value.items.filter((issue) => issue.parentId === parentId);
});

export const epicView = (store: SurfaceStore, id: string) => store.transact(async (uow) => {
  const epicIssue = await getOrThrow(uow, id);
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  const children = page.value.items.filter((issue) => issue.parentId === epicIssue.id);
  const done = children.filter((issue) => issue.status === 'closed').length;
  return { epic: epicIssue, children, done, eligible: children.length > 0 && done === children.length && epicIssue.status !== 'closed' };
});

/** Current issue pointer, or null when unset. */
export const currentId = (store: SurfaceStore) => readCurrentId(store.tasksDir);
