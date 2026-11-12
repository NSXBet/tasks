import { hostname } from 'node:os';
import type { Issue } from '@tasks/domain';
import type { SurfaceStore } from '../store.js';
import { readCursor, writeCursor } from './cursors.js';
import { lastEventSeq, readEvents, type TaskEvent } from './log.js';
import { matchesEvent, type EventQuery, type EventQueryContext, type TaskOwnership } from './query.js';
import { tailEvents, waitForAppend } from './tail.js';

/**
 * `tk watch` modes over the event wire (spec §10 loop table): `--until`,
 * `--drain`, `--follow`, each reading `.tasks/events.jsonl` from a
 * per-subscriber cursor in `.tasks/cursors.json`. Shared by the CLI and the
 * pi extension. No daemon: a waiter sleeps on `fs.watch` of the log.
 *
 * Starting point: `from` › the subscriber's stored cursor › 0 for until/drain,
 * the log end for follow. `peek` never writes the cursor.
 */

export interface WatchModeOptions {
  readonly query: EventQuery;
  /** Cursor key in cursors.json (see {@link defaultSubscriber}). */
  readonly subscriber: string;
  /** Explicit starting seq (exclusive); overrides the stored cursor. */
  readonly from?: number;
  /** Read without moving the subscriber's cursor. */
  readonly peek?: boolean;
  /** Caller identity for `me` / `mine` in the query (default: the store actor). */
  readonly me?: string;
}

export interface WaitUntilOptions extends WatchModeOptions {
  readonly timeoutMs: number;
  /** Fallback poll ceiling between reads (default 250ms). */
  readonly pollMs?: number;
  readonly signal?: AbortSignal;
}

export interface FollowOptions extends WatchModeOptions {
  readonly onEvent: (event: TaskEvent) => void | Promise<void>;
  readonly pollMs?: number;
}

/** Default cursor name: `session:<TK_SESSION>` when set, else `cli:<actor>`. `--as <name>` overrides it in the CLI. */
export const defaultSubscriber = (env: Readonly<Record<string, string | undefined>>, actor: string): string => {
  const session = env['TK_SESSION']?.trim();
  return session !== undefined && session !== '' ? `session:${session}` : `cli:${actor}`;
};

const UNITS: Readonly<Record<string, number>> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };

/** `90s` · `30m` · `2h` · `500ms` · bare integer = ms. Throws `invalid duration: <text>`. */
export const parseDuration = (text: string): number => {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)?\s*$/.exec(text);
  if (match === null) throw new Error(`invalid duration: ${text}`);
  const value = Number(match[1]) * UNITS[match[2] ?? 'ms']!;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid duration: ${text}`);
  return Math.round(value);
};

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** Strips ANSI escapes / control characters and collapses whitespace (T-10-21). */
const clean = (value: unknown): string => String(value ?? '').replace(ANSI, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const arrow = (from: unknown, to: unknown): string => `${from === null || from === undefined ? '∅' : clean(from)} → ${to === null || to === undefined ? '∅' : clean(to)}`;

const summaryOf = (event: TaskEvent): string => {
  const data = event.data;
  switch (event.type) {
    case 'task.status': return arrow(data['from'], data['to']) + (data['current'] === true ? ' (current)' : '');
    case 'task.comment': return truncate(`${clean(data['author'] ?? event.actor)}: ${clean(data['body'])}`, 200);
    case 'task.update': return Array.isArray(data['fields']) ? data['fields'].map(clean).join(',') : '';
    case 'task.owner': return `${clean(data['field'])} ${arrow(data['from'], data['to'])}`;
    case 'task.created': case 'task.deleted': return truncate(clean(data['title']), 200);
    case 'task.evidence': return clean(data['name']);
    case 'task.worktree': return `${clean(data['branch'])} ${clean(data['path'])}`.trim();
    case 'task.pr': return `#${clean(data['number'])} ${clean(data['op'])} ${clean(data['state'])}`;
    case 'task.report': {
      const changes = (typeof data['changes'] === 'object' && data['changes'] !== null ? data['changes'] : {}) as Record<string, unknown>;
      return `${clean(changes['commits'])} commits +${clean(changes['additions'])} −${clean(changes['deletions'])} ${clean(changes['files'])} files`;
    }
    case 'run.changed': return `${clean(data['runId'])} ${arrow(data['from'], data['to'])}`;
    default: return '';
  }
};

/** Human one-liner: `#<seq> <hh:mm:ss> <task> <type> <summary>` (UTC time from the envelope). */
export const formatEventLine = (event: TaskEvent): string => {
  const time = /T(\d\d:\d\d:\d\d)/.exec(event.ts)?.[1] ?? clean(event.ts);
  return `#${event.seq} ${time} ${clean(event.task ?? '-')} ${event.type} ${summaryOf(event)}`.trimEnd();
};

const findIssue = async (store: SurfaceStore, id: string): Promise<Issue | null> => {
  const result = await store.transact(async (uow) => {
    const found = await uow.findById(id as Issue['id']);
    return found.ok ? found.value : null;
  });
  return result.ok ? result.value : null;
};

const contextFor = (store: SurfaceStore, me: string | undefined): EventQueryContext => ({
  me: me ?? store.actor,
  ownerOf: async (task: string): Promise<TaskOwnership | null> => {
    const issue = await findIssue(store, task);
    return issue === null ? null : { owner: issue.owner ?? null, assignee: issue.assignee ?? null };
  },
});

const startingPoint = async (store: SurfaceStore, options: WatchModeOptions, fallback: () => Promise<number>): Promise<number> => {
  if (options.from !== undefined) return options.from;
  return (await readCursor(store.tasksDir, options.subscriber)) ?? fallback();
};

const advance = async (store: SurfaceStore, options: WatchModeOptions, seq: number): Promise<void> => {
  if (options.peek !== true) await writeCursor(store.tasksDir, options.subscriber, seq);
};

const valuesOf = (query: EventQuery, key: 'task' | 'status'): readonly string[] | null => {
  const clauses = query.clauses.filter((clause): clause is { key: typeof key; values: readonly string[] } => clause.key === key);
  return clauses.length === 0 ? null : [...new Set(clauses.flatMap((clause) => clause.values))];
};

/**
 * Status precheck for `--until`: when the query names statuses and tasks, a
 * named task already in a listed status yields a synthesized `task.status`
 * line (`data.current: true`, `seq` = log end). `applies` tells the caller
 * the precheck ran, so history lines for those statuses are stale.
 */
const precheck = async (store: SurfaceStore, query: EventQuery, ctx: EventQueryContext): Promise<{ applies: boolean; hit: TaskEvent | null }> => {
  const tasks = valuesOf(query, 'task');
  const statuses = valuesOf(query, 'status');
  if (tasks === null || statuses === null) return { applies: false, hit: null };
  // The synthesized line has no real actor: actor clauses are not applied to it.
  const relaxed: EventQuery = { clauses: query.clauses.filter((clause) => clause.key !== 'actor') };
  const end = await lastEventSeq(store.tasksDir);
  for (const task of tasks) {
    const issue = await findIssue(store, task);
    if (issue === null) continue;
    const line: TaskEvent = {
      seq: end, host: hostname(), ts: new Date().toISOString(), task, type: 'task.status', actor: ctx.me,
      data: { from: issue.status, to: issue.status, current: true },
    };
    if (await matchesEvent(line, relaxed, ctx)) return { applies: true, hit: line };
  }
  return { applies: true, hit: null };
};

/**
 * `--until`: the first matching line past the starting point, else sleep on
 * the log until one appends or `timeoutMs` passes (→ null). On a match the
 * cursor moves to that line's seq. See {@link precheck} for status queries:
 * when it applies and nothing matches now, history is skipped (a stale
 * approval from an earlier round never matches) and only new lines count.
 */
export const waitUntil = async (store: SurfaceStore, options: WaitUntilOptions): Promise<TaskEvent | null> => {
  const ctx = contextFor(store, options.me);
  const deadline = Date.now() + options.timeoutMs;
  const checked = await precheck(store, options.query, ctx);
  if (checked.hit !== null) {
    await advance(store, options, checked.hit.seq);
    return checked.hit;
  }
  let after = await startingPoint(store, options, async () => 0);
  if (checked.applies) after = Math.max(after, await lastEventSeq(store.tasksDir));
  const pollMs = options.pollMs ?? 250;
  for (;;) {
    const lines = await readEvents(store.tasksDir, { after });
    for (const line of lines) {
      if (await matchesEvent(line, options.query, ctx)) {
        await advance(store, options, line.seq);
        return line;
      }
    }
    if (lines.length > 0) after = lines[lines.length - 1]!.seq;
    const remaining = deadline - Date.now();
    if (remaining <= 0 || options.signal?.aborted === true) return null;
    await waitForAppend(store.tasksDir, Math.min(remaining, pollMs), { after, ...(options.signal !== undefined ? { signal: options.signal } : {}) });
  }
};

/**
 * `--drain`: every matching line past the starting point (fresh subscriber:
 * from seq 0), then the cursor moves to the log end read.
 */
export const drainEvents = async (store: SurfaceStore, options: WatchModeOptions): Promise<TaskEvent[]> => {
  const ctx = contextFor(store, options.me);
  const after = await startingPoint(store, options, async () => 0);
  const lines = await readEvents(store.tasksDir, { after });
  const matched: TaskEvent[] = [];
  for (const line of lines) if (await matchesEvent(line, options.query, ctx)) matched.push(line);
  const end = lines.length > 0 ? lines[lines.length - 1]!.seq : after;
  if (end !== after || options.from !== undefined) await advance(store, options, end);
  return matched;
};

export interface FollowHandle {
  stop(): void;
  readonly done: Promise<void>;
}

/**
 * `--follow`: streams matching lines as they append (fresh subscriber: from
 * the log end), writing the cursor after each delivered batch.
 */
export const followEvents = (store: SurfaceStore, options: FollowOptions): FollowHandle => {
  const ctx = contextFor(store, options.me);
  let handle: { stop(): void; done: Promise<void> } | null = null;
  let stopped = false;
  const done = (async () => {
    const after = await startingPoint(store, options, () => lastEventSeq(store.tasksDir));
    if (stopped) return;
    handle = tailEvents(store.tasksDir, {
      after,
      ...(options.pollMs !== undefined ? { pollMs: options.pollMs } : {}),
      onEvents: async (batch) => {
        for (const line of batch) if (await matchesEvent(line, options.query, ctx)) await options.onEvent(line);
        await advance(store, options, batch[batch.length - 1]!.seq);
      },
    });
    await handle.done;
  })();
  return {
    stop: () => { stopped = true; handle?.stop(); },
    done,
  };
};
