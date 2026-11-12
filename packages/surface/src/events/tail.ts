import { watch, type FSWatcher } from 'node:fs';
import { EVENTS_FILE, lastEventSeq, readEvents, type TaskEvent } from './log.js';

/**
 * Read side of the event wire: wait for `.tasks/events.jsonl` to grow and
 * tail it from a cursor. `fs.watch` on the tasks dir wakes a reader within
 * milliseconds of an append; when `fs.watch` is unavailable (or never fires)
 * the wait degrades to a plain sleep, so the poll interval is the latency
 * ceiling, never a correctness bound — every read is `seq > after`.
 */

export interface WaitForAppendOptions {
  /** When given, resolve immediately if the log already holds a seq above this (closes the read→arm race). */
  readonly after?: number;
  /** Resolves the wait early (tailEvents' stop()). */
  readonly signal?: AbortSignal;
}

/**
 * Resolves on the first `fs.watch(tasksDir)` change naming `events.jsonl`, or
 * after `ms`, or when `signal` aborts — whichever comes first. Never rejects.
 */
export const waitForAppend = (tasksDir: string, ms: number, options: WaitForAppendOptions = {}): Promise<void> =>
  new Promise<void>((resolve) => {
    let settled = false;
    let watcher: FSWatcher | null = null;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', finish);
      try { watcher?.close(); } catch { /* already closed */ }
      resolve();
    };
    const timer = setTimeout(finish, ms);
    if (options.signal?.aborted === true) { finish(); return; }
    options.signal?.addEventListener('abort', finish);
    try {
      watcher = watch(tasksDir, { persistent: false }, (_event, filename) => {
        // Some platforms report no filename; treat that as a possible append.
        if (filename === null || filename === undefined || String(filename) === EVENTS_FILE) finish();
      });
      watcher.on('error', () => { /* degrade to the timer */ });
    } catch { /* fs.watch unavailable (missing dir, unsupported FS): the timer is the wake-up */ }
    if (options.after !== undefined) {
      const after = options.after;
      void lastEventSeq(tasksDir).then((last) => { if (last > after) finish(); }, () => { /* timer stays */ });
    }
  });

export interface TailHandle {
  stop(): void;
  /** Resolves once the tail loop has exited (after stop()). */
  readonly done: Promise<void>;
}

export interface TailOptions {
  /** Deliver lines with seq > after. Default: the current end of the log (no replay). */
  readonly after?: number;
  readonly onEvents: (events: readonly TaskEvent[]) => void | Promise<void>;
  /** Fallback poll ceiling between reads (default 250ms). */
  readonly pollMs?: number;
}

/**
 * Tails the log from a cursor: read → deliver → advance → wait. A log that
 * shrank or was replaced is simply re-read from the top; seqs at or below the
 * last delivered one are dropped, so consumers never see a line twice.
 */
export const tailEvents = (tasksDir: string, options: TailOptions): TailHandle => {
  const controller = new AbortController();
  const pollMs = options.pollMs ?? 250;
  const loop = async (): Promise<void> => {
    let last = options.after ?? await lastEventSeq(tasksDir);
    while (!controller.signal.aborted) {
      try {
        const batch = (await readEvents(tasksDir, { after: last })).filter((event) => event.seq > last);
        if (batch.length > 0 && !controller.signal.aborted) {
          last = batch[batch.length - 1]!.seq;
          await options.onEvents(batch);
        }
      } catch { /* transient read failure: retry next wake */ }
      if (controller.signal.aborted) break;
      await waitForAppend(tasksDir, pollMs, { after: last, signal: controller.signal });
    }
  };
  const done = loop();
  return { stop: () => controller.abort(), done };
};
