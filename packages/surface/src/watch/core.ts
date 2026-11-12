import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import type { Issue } from '@tasks/domain';
import type { SurfaceError } from '../errors.js';
import { appErrorMessage } from '../errors.js';
import type { SurfaceStore } from '../store.js';
import type { WatchCounts, WatchEvent, WatchFrame, WatchSubscription } from './protocol.js';
import { DEFAULT_POLL_INTERVAL_MS, MAX_EVENTS_PER_TICK, MIN_POLL_INTERVAL_MS } from './protocol.js';
import { appendActivity, describeSubscription, heartbeatRuntime, newRuntimeId, registerRuntime, unregisterRuntime, type RuntimeRow } from '../runtime.js';
import { lastEventSeq, readEvents, type TaskEvent } from '../events/log.js';
import { normalizeKinds, toWatchEvent } from '../events/query.js';
import { waitForAppend } from '../events/tail.js';
import { processWakeups, type WakeupState } from './wakeups.js';

/** Statuses that remove an issue from the open/blocked counters (CLI parity). */
const TERMINAL_STATUSES: readonly string[] = ['closed'];

export interface WatchHandle {
  /** Resolves when the watcher stops (crash, backend loss, or stop()). */
  readonly done: Promise<void>;
  /** Last delivered sequence number. */
  readonly seq: () => number;
  stop(): void;
}

/** Board counters: open (not terminal), blocked by an open blocker, and the CLI's ready-to-review status. */
const boardCounts = (all: readonly Issue[]): WatchCounts => {
  const blockedIds = new Set(all.filter((issue) => issue.dependencies.some((edge) => edge.type === 'blocks' && all.some((other) => other.id === edge.target && other.status !== 'closed'))).map((issue) => issue.id));
  return {
    open: all.filter((issue) => !TERMINAL_STATUSES.includes(issue.status)).length,
    blocked: blockedIds.size,
    readyToReview: all.filter((issue) => issue.status === 'ready-to-review').length,
  };
};

/**
 * In-process watch loop over the event wire (`.tasks/events.jsonl`). Used by
 * `tk watch`'s frame mode (via `runWatchChild`), the daemon's
 * `events.subscribe`, the web server and the pi extension. It does not diff
 * the board: each tick reads the log lines past its cursor — the facts the
 * writers appended — filters them by kind/id/label and delivers them with the
 * log's own `seq`. Deferred-issue wakeups still run each tick; their writes
 * reach the log through the recorder like any other mutation.
 *
 * Starts at the log's current end (no replay) unless `subscription.after` is
 * given. Between ticks it waits on `fs.watch` (wakes within ~100ms of an
 * append), falling back to the interval.
 */
export const runWatchLoop = async (
  store: SurfaceStore,
  subscription: WatchSubscription,
  onEvent: (event: WatchEvent) => void,
  shouldStop: () => boolean,
): Promise<void> => {
  const interval = Math.max(subscription.interval ?? DEFAULT_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS);
  const kinds = normalizeKinds(subscription.kinds);
  const wakeupExpiry: WakeupState = new Map();
  const runtimeId = newRuntimeId();
  const now = new Date().toISOString();
  const row: RuntimeRow = {
    id: runtimeId, kind: 'watch', label: subscription.label ?? null, pid: process.pid,
    startedAt: now, heartbeatAt: now, subscriptions: [...describeSubscription(subscription)],
  };
  // The cursor is fixed before the first tick: anything appended from here on
  // (including this loop's own wakeup writes) is delivered.
  let lastSeq = subscription.after ?? await lastEventSeq(store.tasksDir);
  // Registry bookkeeping is best-effort: a readonly or missing tasks dir must
  // never take the watch loop down.
  try {
    await registerRuntime(store.tasksDir, row);
    await appendActivity(store.tasksDir, { at: now, runtimeId, kind: 'started', detail: describeSubscription(subscription).join(' ') || 'unfiltered' });
  } catch { /* registry is advisory */ }
  let consecutiveErrors = 0;
  try {
    while (!shouldStop() && consecutiveErrors < 3) {
      let backlog = false;
      try {
        const woke = await store.transact(async (uow) => {
          const at = new Date();
          // Deferred issues whose defer_until has expired wake up here: one
          // run per expiry. The writes land in the log via the recorder.
          const wakeups = await processWakeups(uow, wakeupExpiry, at);
          if (!wakeups.ok) throw new Error(`wakeup processing failed: ${appErrorMessage(wakeups.error)}`);
          for (const wakeup of wakeups.value) {
            await appendActivity(store.tasksDir, {
              at: at.toISOString(), runtimeId, kind: 'wakeup',
              detail: wakeup.runId === null ? `issue ${wakeup.issueId} (no agent)` : `issue ${wakeup.issueId} run ${wakeup.runId}`,
            }).catch(() => { /* activity is best-effort */ });
          }
        });
        if (!woke.ok) throw new Error(woke.error.message);
        const lines = await readEvents(store.tasksDir, { after: lastSeq, limit: MAX_EVENTS_PER_TICK });
        backlog = lines.length >= MAX_EVENTS_PER_TICK;
        const candidates = lines.filter((line) => (kinds === undefined || kinds.includes(line.type))
          && (subscription.ids === undefined || (line.task !== undefined && subscription.ids.includes(line.task))));
        let delivered: readonly TaskEvent[] = candidates;
        let counts: WatchCounts | undefined;
        if (candidates.length > 0) {
          const label = subscription.label;
          const looked = await store.transact(async (uow) => {
            let keep = candidates;
            if (label !== undefined) {
              // Log lines carry no labels: look each distinct task up once per tick.
              const labelled = new Map<string, boolean>();
              for (const task of new Set(candidates.flatMap((line) => (line.task === undefined ? [] : [line.task])))) {
                const found = await uow.findById(task as Issue['id']);
                labelled.set(task, found.ok && found.value !== null && found.value.labels.includes(label));
              }
              keep = candidates.filter((line) => line.task !== undefined && labelled.get(line.task) === true);
            }
            if (keep.length === 0) return { keep, counts: undefined };
            const page = await uow.list({ limit: 100_000 });
            if (!page.ok) throw new Error('list failed during watch poll');
            return { keep, counts: boardCounts(page.value.items) };
          });
          if (!looked.ok) throw new Error(looked.error.message);
          delivered = looked.value.keep;
          counts = looked.value.counts;
        }
        if (lines.length > 0) lastSeq = lines[lines.length - 1]!.seq;
        for (const line of delivered) {
          onEvent(counts === undefined ? toWatchEvent(line) : { ...toWatchEvent(line), counts });
        }
        await heartbeatRuntime(store.tasksDir, runtimeId, new Date()).catch(() => { /* advisory */ });
        consecutiveErrors = 0;
      } catch (cause) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 3) throw cause instanceof Error ? cause : new Error(String(cause));
      }
      if (!backlog && !shouldStop()) await waitForAppend(store.tasksDir, interval, { after: lastSeq });
    }
  } finally {
    try {
      await unregisterRuntime(store.tasksDir, runtimeId);
      await appendActivity(store.tasksDir, { at: new Date().toISOString(), runtimeId, kind: 'stopped', detail: '' });
    } catch { /* registry is advisory */ }
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
 *
 * Runtime selection: `process.execPath` may be a harness binary (e.g. omp)
 * that cannot execute arbitrary TS, so prefer a real `bun` on the PATH; under
 * node use `--experimental-strip-types` (node >= 22.6).
 */
const watchRuntime = (): readonly string[] => {
  try {
    const bun = (globalThis as { Bun?: { which(cmd: string): string | null } }).Bun?.which('bun');
    if (bun !== undefined && bun !== null && bun !== '') return [bun];
  } catch { /* not a Bun host */ }
  return [process.execPath, '--experimental-strip-types'];
};

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
  if (options.subscription.after !== undefined) args.push('--after', String(options.subscription.after));
  const runtime = watchRuntime();
  const child = spawn(runtime[0]!, [...runtime.slice(1), options.watchScript, ...args], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  let seq = 0;
  let buffer = '';
  const { promise: done, resolve } = Promise.withResolvers<void>();
  const decoder = new TextDecoder();
  const pump = async (): Promise<void> => {
    // node ChildProcess streams are node streams; wrap for the web reader API.
    // Under Bun, child.stdout already exposes getReader(); node needs toWeb().
    const stdoutStream: ReadableStream<Uint8Array> =
      child.stdout === null ? new ReadableStream<Uint8Array>({ start: (c) => c.close() })
      : typeof Bun !== 'undefined' && child.stdout instanceof ReadableStream
        ? child.stdout
        : Readable.toWeb(child.stdout);
    const reader = stdoutStream.getReader();
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
      try { child.stdin?.end(); } catch { /* already gone */ }
      // stdin EOF should stop the child within one poll interval; if it has
      // not exited after 5s, terminate it directly.
      const killer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 5000);
      killer.unref?.();
    },
  };
};
