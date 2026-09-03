import type { SurfaceError } from '../errors.js';

/** Watch event kinds the backends can actually detect today. */
export type WatchEventKind =
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
  /** Per-watcher monotonic sequence; ordering authority (never timestamps). */
  readonly seq: number;
  readonly kind: WatchEventKind;
  /** ISO-8601 event time; informational only. */
  readonly at: string;
  readonly issueId?: string;
  /** Board snapshot as of this tick (present on every event, absent on none). */
  readonly counts?: WatchCounts;
  readonly data?: {
    readonly from?: string;
    readonly to?: string;
    readonly actor?: string | null;
  };
}

/** Control frames share the NDJSON stdout channel with events. */
export type WatchFrame =
  | { readonly type: 'ready'; readonly backend: string; readonly watermark: string }
  | { readonly type: 'event'; readonly event: WatchEvent }
  | { readonly type: 'error'; readonly error: { readonly kind: string; readonly message: string } };

export interface WatchSubscription {
  readonly kinds?: readonly WatchEventKind[];
  readonly ids?: readonly string[];
  readonly label?: string;
  /** Poll interval in ms (default 2000, floor 250). */
  readonly interval?: number;
}

export const DEFAULT_POLL_INTERVAL_MS = 2000;
export const MIN_POLL_INTERVAL_MS = 250;
/** Diff cap per tick; overflow collapses into one summary event per issue. */
export const MAX_EVENTS_PER_TICK = 200;

export const parseWatchArgs = (argv: readonly string[]): WatchSubscription => {
  const subscription: { kinds?: string[]; ids?: string[]; label?: string | undefined; interval?: number } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === '--kinds') subscription.kinds = (argv[++index] ?? '').split(',').filter(Boolean);
    else if (token === '--ids') subscription.ids = (argv[++index] ?? '').split(',').filter(Boolean);
    else if (token === '--label') subscription.label = argv[++index];
    else if (token === '--interval') subscription.interval = Number(argv[++index]);
  }
  const kinds = subscription.kinds === undefined ? undefined : ([...subscription.kinds] as WatchEventKind[]);
  const ids = subscription.ids === undefined ? undefined : [...subscription.ids];
  const label = subscription.label;
  const interval = subscription.interval;
  return {
    ...(kinds === undefined ? {} : { kinds }),
    ...(ids === undefined ? {} : { ids }),
    ...(label === undefined ? {} : { label }),
    ...(interval === undefined ? {} : { interval }),
  };
};
