import type { LegacyWatchEventKind, WatchEvent, WatchEventKind } from '../watch/protocol.js';
import type { TaskEvent } from './log.js';

/**
 * Read-side vocabulary of the event wire: legacy kind aliases, the
 * log-line → `WatchEvent` mapping, and the spec §10 watch query grammar
 * (`task=` · `status=` · `owner=` · `type=` · `actor=` · `mine`; comma = AND,
 * `|` = alternatives).
 */

/** Legacy subscription names → the log types they now cover. Emitted kinds are always the spec names. */
export const KIND_ALIASES: Readonly<Record<LegacyWatchEventKind, readonly WatchEventKind[]>> = {
  'issue.created': ['task.created'],
  'issue.status_changed': ['task.status'],
  'issue.commented': ['task.comment'],
  'issue.deleted': ['task.deleted'],
  'issue.updated': ['task.update', 'task.owner', 'task.evidence', 'task.worktree', 'task.pr', 'task.report'],
  'ready.changed': ['task.created', 'task.status', 'task.deleted', 'task.update'],
  'counts.changed': ['task.created', 'task.status', 'task.deleted', 'task.update'],
};

const isLegacy = (kind: string): kind is LegacyWatchEventKind => Object.hasOwn(KIND_ALIASES, kind);

/**
 * Expands legacy names through {@link KIND_ALIASES} and dedupes. Unknown names
 * pass through unchanged (they simply match nothing). `undefined` stays
 * `undefined` (= every kind).
 */
export function normalizeKinds(kinds: readonly string[]): WatchEventKind[];
export function normalizeKinds(kinds: readonly string[] | undefined): WatchEventKind[] | undefined;
export function normalizeKinds(kinds: readonly string[] | undefined): WatchEventKind[] | undefined {
  if (kinds === undefined) return undefined;
  const out = new Set<string>();
  for (const kind of kinds) {
    if (isLegacy(kind)) for (const mapped of KIND_ALIASES[kind]) out.add(mapped);
    else out.add(kind);
  }
  return [...out] as WatchEventKind[];
}

/** One log line as a `WatchEvent`: kind = type, at = ts, issueId = task, seq = log seq, data = line data + actor/session. */
export const toWatchEvent = (line: TaskEvent): WatchEvent => {
  const data: Record<string, unknown> = {
    actor: line.actor,
    ...(line.session !== undefined ? { session: line.session } : {}),
    ...line.data,
  };
  if (line.type === 'task.comment' && line.data['kind'] === 'review' && typeof line.data['comment'] === 'string') {
    data['commentId'] = line.data['comment'];
  }
  return {
    seq: line.seq,
    kind: line.type,
    at: line.ts,
    ...(line.task !== undefined ? { issueId: line.task } : {}),
    data: data as NonNullable<WatchEvent['data']>,
  };
};

// ── query grammar ────────────────────────────────────────────────────────────

export type EventQueryKey = 'task' | 'status' | 'owner' | 'type' | 'actor';
export type EventQueryClause =
  | { readonly key: EventQueryKey; readonly values: readonly string[] }
  | { readonly key: 'mine' };
export interface EventQuery {
  readonly clauses: readonly EventQueryClause[];
}

const KEYS: readonly EventQueryKey[] = ['task', 'status', 'owner', 'type', 'actor'];

/**
 * Parses `key=v1|v2,key2=v,mine`. Whitespace around clauses and values is
 * ignored; an empty query matches everything. Unknown keys, empty values and
 * malformed clauses throw `invalid watch query: <clause>`.
 */
export const parseEventQuery = (text: string): EventQuery => {
  const clauses: EventQueryClause[] = [];
  for (const raw of text.split(',')) {
    const clause = raw.trim();
    if (clause === '') continue;
    if (clause === 'mine') { clauses.push({ key: 'mine' }); continue; }
    const eq = clause.indexOf('=');
    if (eq <= 0) throw new Error(`invalid watch query: ${clause}`);
    const key = clause.slice(0, eq).trim();
    const values = clause.slice(eq + 1).split('|').map((value) => value.trim());
    if (!(KEYS as readonly string[]).includes(key) || values.some((value) => value === '')) {
      throw new Error(`invalid watch query: ${clause}`);
    }
    clauses.push({ key: key as EventQueryKey, values });
  }
  return { clauses };
};

/** ANDs a `task=<id>|<id>` clause (the positional ids of `tk watch <id…>`); no ids → unchanged. */
export const withTasks = (query: EventQuery | string, ids: readonly string[]): EventQuery => {
  const parsed = typeof query === 'string' ? parseEventQuery(query) : query;
  if (ids.length === 0) return parsed;
  return { clauses: [...parsed.clauses, { key: 'task', values: [...ids] }] };
};

export interface TaskOwnership {
  readonly owner: string | null;
  readonly assignee: string | null;
}

export interface EventQueryContext {
  /** The caller identity; `me` in `owner=`/`actor=` values resolves to it. */
  readonly me: string;
  /** Current owner/assignee of a task (null when gone). Needed by `mine` and non-`task.owner` `owner=` clauses. */
  readonly ownerOf?: (task: string) => Promise<TaskOwnership | null>;
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * Does one log line satisfy every clause?
 * - `task=` the line's task · `type=` its type (legacy aliases accepted) · `actor=` the envelope actor
 * - `status=` a `task.status` line whose `data.to` is one of the values
 * - `owner=` a `task.owner` line whose `data.to` is one of the values; any other
 *   line matches when its task's current owner is (via `ctx.ownerOf`)
 * - `mine` the line's task is owned by or assigned to `ctx.me`
 */
export const matchesEvent = async (event: TaskEvent, query: EventQuery, ctx: EventQueryContext): Promise<boolean> => {
  let ownership: TaskOwnership | null | undefined;
  const lookup = async (): Promise<TaskOwnership | null> => {
    if (ownership !== undefined) return ownership;
    ownership = event.task === undefined || ctx.ownerOf === undefined ? null : await ctx.ownerOf(event.task);
    return ownership;
  };
  const resolve = (values: readonly string[]): readonly string[] => values.map((value) => (value === 'me' ? ctx.me : value));
  for (const clause of query.clauses) {
    switch (clause.key) {
      case 'mine': {
        const owned = await lookup();
        if (owned === null || (owned.owner !== ctx.me && owned.assignee !== ctx.me)) return false;
        break;
      }
      case 'task':
        if (event.task === undefined || !clause.values.includes(event.task)) return false;
        break;
      case 'type':
        if (!normalizeKinds(clause.values).includes(event.type)) return false;
        break;
      case 'actor':
        if (!resolve(clause.values).includes(event.actor)) return false;
        break;
      case 'status': {
        const to = str(event.data['to']);
        if (event.type !== 'task.status' || to === null || !clause.values.includes(to)) return false;
        break;
      }
      case 'owner': {
        const wanted = resolve(clause.values);
        if (event.type === 'task.owner') {
          const to = str(event.data['to']);
          if (to === null || !wanted.includes(to)) return false;
        } else {
          const owned = await lookup();
          if (owned === null || owned.owner === null || !wanted.includes(owned.owner)) return false;
        }
        break;
      }
    }
  }
  return true;
};
