import type { IssueUnitOfWork } from '@tasks/application';
import type { Issue } from '@tasks/domain';
import type { SurfaceError } from '../errors.js';
import type { SurfaceStore } from '../store.js';
import type { WatchEvent, WatchEventKind, WatchFrame, WatchSubscription } from './protocol.js';
import { DEFAULT_POLL_INTERVAL_MS, MAX_EVENTS_PER_TICK, MIN_POLL_INTERVAL_MS } from './protocol.js';

export interface WatchHandle {
  /** Resolves when the watcher stops (crash, backend loss, or stop()). */
  readonly done: Promise<void>;
  /** Last delivered sequence number. */
  readonly seq: () => number;
  stop(): void;
}

/**
 * Internal poll state: per-issue updatedAt watermarks plus the ready-set
 * fingerprint. Ordering authority is the emitted `seq`, never timestamps.
 */
interface ReaderState {
  readonly lastUpdatedAt: Map<string, string>;
  readyHash: string | null;
}

/**
 * One poll against the unit-of-work: read the full issue page (limit 100k
 * matches CLI parity), diff per-issue `updatedAt` against watermarks, classify
 * events, recompute the ready-set hash. Works uniformly across file/sqlite/
 * postgres through the existing port; per-backend watermark readers can refine
 * this later without changing the event contract.
 */
export const diffOnce = async (
  uow: IssueUnitOfWork,
  subscription: WatchSubscription,
  state: ReaderState,
): Promise<readonly WatchEvent[]> => {
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new Error('list failed during watch poll');
  const all = page.value.items;
  const at = new Date().toISOString();
  const events: WatchEvent[] = [];

  const matchesSubscription = (issue: Issue): boolean =>
    (subscription.ids === undefined || subscription.ids.includes(issue.id))
    && (subscription.label === undefined || issue.labels.includes(subscription.label));

  for (const issue of all) {
    const previous = state.lastUpdatedAt.get(issue.id);
    const current = issue.updatedAt.toISOString();
    if (previous === undefined) {
      if (matchesSubscription(issue)) events.push({ seq: 0, kind: 'issue.created', at, issueId: issue.id });
    } else if (previous !== current && matchesSubscription(issue)) {
      const kind: WatchEventKind = 'issue.updated';
      events.push({ seq: 0, kind, at, issueId: issue.id });
    }
    state.lastUpdatedAt.set(issue.id, current);
  }
  for (const id of [...state.lastUpdatedAt.keys()]) {
    if (!all.some((issue) => issue.id === id)) {
      state.lastUpdatedAt.delete(id);
      if (subscription.ids === undefined || subscription.ids.includes(id)) {
        events.push({ seq: 0, kind: 'issue.deleted', at, issueId: id });
      }
    }
  }

  const blockedIds = new Set(all.filter((issue) => issue.dependencies.some((edge) => edge.type === 'blocks' && all.some((other) => other.id === edge.target && other.status !== 'closed'))).map((issue) => issue.id));
  const readyIds = all.filter((issue) => issue.status === 'open'
    && (issue.deferUntil === null || issue.deferUntil <= new Date())
    && !blockedIds.has(issue.id)).map((issue) => issue.id).sort();
  const readyHash = readyIds.join(',');
  if (state.readyHash !== null && readyHash !== state.readyHash) {
    events.push({ seq: 0, kind: 'ready.changed', at });
  }
  state.readyHash = readyHash;

  const filtered = events.filter((event) => subscription.kinds === undefined || subscription.kinds.includes(event.kind));
  return filtered.length <= MAX_EVENTS_PER_TICK ? filtered : filtered.slice(0, MAX_EVENTS_PER_TICK);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * In-process watch loop (CLI foreground mode and tests). The extension instead
 * spawns `runWatchChild` in a child process and reads NDJSON frames.
 */
export const runWatchLoop = async (
  store: SurfaceStore,
  subscription: WatchSubscription,
  onEvent: (event: WatchEvent) => void,
  shouldStop: () => boolean,
): Promise<void> => {
  const interval = Math.max(subscription.interval ?? DEFAULT_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS);
  const state: ReaderState = { lastUpdatedAt: new Map(), readyHash: null };
  let seq = 0;
  let consecutiveErrors = 0;
  while (!shouldStop() && consecutiveErrors < 3) {
    try {
      const events = await store.transact((uow) => diffOnce(uow, subscription, state));
      if (!events.ok) throw new Error(events.error.message);
      for (const event of events.value) {
        seq += 1;
        onEvent({ ...event, seq });
      }
      consecutiveErrors = 0;
    } catch (cause) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= 3) throw cause instanceof Error ? cause : new Error(String(cause));
    }
    await sleep(interval);
  }
};

/**
 * Child-process entry: NDJSON frames on stdout, exit 0 on stdin EOF (parent
 * death), 2 when no workspace, 3 after three consecutive poll errors.
 */
export const runWatchChild = async (store: SurfaceStore, subscription: WatchSubscription): Promise<void> => {
  const write = (frame: WatchFrame): void => {
    process.stdout.write(`${JSON.stringify(frame)}\n`);
  };
  write({ type: 'ready', backend: store.backend, watermark: new Date().toISOString() });
  let stopping = false;
  // Drain stdin: 'end' only fires when the pipe is consumed AND the parent
  // closes its write end — parent death (or handle.stop()) therefore stops
  // the child promptly. Draining is required; a bare 'end' listener is not.
  void (async () => {
    for await (const _ of process.stdin) { /* discard */ }
    stopping = true;
  })();
  try {
    await runWatchLoop(store, subscription, (event) => write({ type: 'event', event }), () => stopping);
    process.exitCode = 0;
  } catch (cause) {
    write({ type: 'error', error: { kind: 'runtime', message: cause instanceof Error ? cause.message : String(cause) } });
    process.exitCode = 3;
  }
};

/**
 * Extension-side spawn: launch the bundled `tk-watch` script for a workspace,
 * parse NDJSON frames from stdout, deliver events to `onEvent`. stdin stays
 * open until `handle.stop()`; when the parent session dies the child sees EOF
 * and exits 0.
 */
export const spawnWatchChild = (options: {
  readonly watchScript: string;
  readonly root: string;
  readonly subscription: WatchSubscription;
  readonly onEvent: (event: WatchEvent) => void;
  readonly onError?: (error: SurfaceError) => void;
}): WatchHandle => {
  const args = [options.root];
  if (options.subscription.kinds !== undefined) args.push('--kinds', options.subscription.kinds.join(','));
  if (options.subscription.ids !== undefined) args.push('--ids', options.subscription.ids.join(','));
  if (options.subscription.label !== undefined) args.push('--label', options.subscription.label);
  if (options.subscription.interval !== undefined) args.push('--interval', String(options.subscription.interval));
  const child = Bun.spawn([process.execPath, options.watchScript, ...args], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
  });
  let seq = 0;
  let buffer = '';
  const { promise: done, resolve } = Promise.withResolvers<void>();
  const pump = async (): Promise<void> => {
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line !== '') {
          try {
            const frame = JSON.parse(line) as WatchFrame;
            if (frame.type === 'event') {
              seq = frame.event.seq;
              options.onEvent(frame.event);
            } else if (frame.type === 'error') {
              options.onError?.(frame.error as SurfaceError);
            }
          } catch { /* partial or malformed line: skip */ }
        }
        newline = buffer.indexOf('\n');
      }
    }
    resolve();
  };
  void pump();
  return {
    done,
    seq: () => seq,
    stop: () => {
      try { child.stdin.end(); } catch { /* already gone */ }
      // stdin EOF should stop the child within one poll interval; if it has
      // not exited after 5s, terminate it directly.
      const killer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 5000);
      killer.unref?.();
    },
  };
};
