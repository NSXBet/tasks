import type { SurfaceError } from '../errors.js';

/**
 * Emitted watch event kinds: exactly the `type` of an `.tasks/events.jsonl`
 * line (spec §10; decided in events/derive.ts).
 */
export type WatchEventKind =
  | 'task.created'
  | 'task.status'
  | 'task.owner'
  | 'task.comment'
  | 'task.update'
  | 'task.evidence'
  | 'task.worktree'
  | 'task.pr'
  | 'task.report'
  | 'task.deleted'
  | 'run.changed';

/**
 * Pre-log kind names, still accepted in subscriptions and mapped through
 * `KIND_ALIASES` (events/query.ts). Never emitted.
 */
export type LegacyWatchEventKind =
  | 'issue.created'
  | 'issue.updated'
  | 'issue.status_changed'
  | 'issue.commented'
  | 'issue.deleted'
  | 'ready.changed'
  | 'counts.changed';

/** Board counters attached to every event and watched for changes. */
export interface WatchCounts {
  readonly open: number;
  readonly blocked: number;
  readonly readyToReview: number;
}

export interface WatchEvent {
  /** The log line's `seq`: monotonic per workspace; gaps are normal for filtered subscriptions. */
  readonly seq: number;
  /** The log line's `type`. */
  readonly kind: WatchEventKind;
  /** The log line's `ts` (ISO-8601); informational only — `seq` orders. */
  readonly at: string;
  /** The log line's `task`. */
  readonly issueId?: string;
  /** Board snapshot as of the delivering tick. */
  readonly counts?: WatchCounts;
  /** The log line's `data`, plus the envelope `actor` and `session`. */
  readonly data?: {
    readonly from?: string | null;
    readonly to?: string | null;
    readonly actor?: string | null;
    readonly session?: string | null;
    /** run.changed payload: run id plus prior/new state. */
    readonly runId?: string;
    /** @deprecated Use `comment`. Filled from `comment` for review `task.comment` events. */
    readonly commentId?: string;
    /** task.comment: `note` (plain comment) or `review` (review card transition). */
    readonly kind?: string;
    readonly comment?: string | null;
    readonly author?: string | null;
    readonly body?: string | null;
    readonly location?: string | null;
    readonly file?: string | null;
    readonly line?: number | null;
    /** task.owner: `owner` | `assignee`. */
    readonly field?: string;
    /** task.update: sorted changed field names. */
    readonly fields?: readonly string[];
    /** task.worktree. */
    readonly path?: string | null;
    readonly branch?: string | null;
    /** task.status (finish). */
    readonly finishedAt?: string | null;
    readonly refinish?: boolean;
    /** task.evidence. */
    readonly id?: string;
    readonly name?: string;
    readonly mime?: string;
    /** task.created / task.deleted. */
    readonly title?: string;
    readonly status?: string;
    readonly owner?: string | null;
    readonly assignee?: string | null;
    /** task.pr: `create` (first PR or a new number) | `state` | `close`; plus the recorded PR and the task branch. */
    readonly op?: 'create' | 'state' | 'close';
    readonly number?: number;
    readonly url?: string;
    readonly state?: 'open' | 'closed' | 'merged';
    readonly head?: string | null;
    /** task.report: the counts-only stat card data (never a diff), plus `head` above and the stamp time. */
    readonly changes?: { readonly commits: number; readonly files: number; readonly additions: number; readonly deletions: number };
    readonly at?: string | null;
  };
}

/** Control frames share the NDJSON stdout channel with events. */
export type WatchFrame =
  | { readonly type: 'ready'; readonly backend: string; readonly watermark: string }
  | { readonly type: 'event'; readonly event: WatchEvent }
  | { readonly type: 'error'; readonly error: { readonly kind: string; readonly message: string } };

export interface WatchSubscription {
  /** Spec kinds or legacy aliases (normalized through `normalizeKinds`). */
  readonly kinds?: readonly (WatchEventKind | LegacyWatchEventKind)[];
  /** Replay every log line with seq > after first; default starts at the log's current end. */
  readonly after?: number;
  readonly ids?: readonly string[];
  readonly label?: string;
  /** Poll interval in ms (default 2000, floor 250). */
  readonly interval?: number;
}

export const DEFAULT_POLL_INTERVAL_MS = 2000;
export const MIN_POLL_INTERVAL_MS = 250;
/** Log lines read per tick; a full batch skips the wait so a backlog drains promptly. */
export const MAX_EVENTS_PER_TICK = 200;

export const parseWatchArgs = (argv: readonly string[]): WatchSubscription => {
  const subscription: { kinds?: string[]; ids?: string[]; label?: string | undefined; interval?: number; after?: number } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === '--kinds') subscription.kinds = (argv[++index] ?? '').split(',').filter(Boolean);
    else if (token === '--ids') subscription.ids = (argv[++index] ?? '').split(',').filter(Boolean);
    else if (token === '--label') subscription.label = argv[++index];
    else if (token === '--interval') subscription.interval = Number(argv[++index]);
    else if (token === '--after') subscription.after = Number(argv[++index]);
  }
  const kinds = subscription.kinds === undefined ? undefined : ([...subscription.kinds] as (WatchEventKind | LegacyWatchEventKind)[]);
  const ids = subscription.ids === undefined ? undefined : [...subscription.ids];
  const label = subscription.label;
  const interval = subscription.interval;
  const after = subscription.after !== undefined && Number.isInteger(subscription.after) && subscription.after >= 0 ? subscription.after : undefined;
  return {
    ...(kinds === undefined ? {} : { kinds }),
    ...(ids === undefined ? {} : { ids }),
    ...(label === undefined ? {} : { label }),
    ...(interval === undefined ? {} : { interval }),
    ...(after === undefined ? {} : { after }),
  };
};
