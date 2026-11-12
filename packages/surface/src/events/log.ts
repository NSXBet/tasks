import { appendFile, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { withStateLock } from '../state-io.js';

/**
 * The workspace event wire (spec §10 "The script and the wire"): one
 * append-only `<root>/.tasks/events.jsonl`, one JSON object per line, written
 * in-process by whichever command made the change. No daemon, no broker.
 *
 * `seq` is assigned under a two-layer lock (in-process promise chain +
 * cross-process `mkdir` lock), so it is strictly increasing and gap-free
 * across concurrent writers on one host. Readers skip torn or unparsable
 * lines, so a crash mid-append never poisons the log.
 */

export const EVENTS_FILE = 'events.jsonl';
const LOCK_DIR = 'events.lock';
const LOCK_RETRY_MS = 5;
const LOCK_DEADLINE_MS = 5_000;
const LOCK_STALE_MS = 10_000;
const TAIL_WINDOW = 64 * 1024;

export type TaskEventType =
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

export interface TaskEvent {
  readonly seq: number;
  readonly host: string;
  readonly ts: string;
  readonly task?: string;
  readonly type: TaskEventType;
  readonly actor: string;
  readonly session?: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/** What derivation produces; the stamp (seq/host/ts/actor/session) is added at append time. */
export type EventDraft = Omit<TaskEvent, 'seq' | 'host' | 'ts' | 'actor' | 'session'>;

export interface EventStamp {
  readonly actor: string;
  readonly session?: string | undefined;
  readonly host?: string;
  readonly now?: Date;
}

const eventsPath = (tasksDir: string): string => join(tasksDir, EVENTS_FILE);

const isEvent = (value: unknown): value is TaskEvent =>
  typeof value === 'object' && value !== null && typeof (value as { seq?: unknown }).seq === 'number' && typeof (value as { type?: unknown }).type === 'string';

const parseLine = (line: string): TaskEvent | null => {
  if (line.trim() === '') return null;
  try {
    const value: unknown = JSON.parse(line);
    return isEvent(value) ? value : null;
  } catch {
    return null;
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const pidAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (cause) { return (cause as NodeJS.ErrnoException).code === 'EPERM'; }
};

/** A lock is stale when older than {@link LOCK_STALE_MS}, or its recorded holder is gone and it is older than one second. */
const lockIsStale = async (lockPath: string): Promise<boolean> => {
  try {
    const info = await stat(lockPath);
    const age = Date.now() - info.mtimeMs;
    if (age > LOCK_STALE_MS) return true;
    if (age < 1_000) return false;
    const pid = Number.parseInt((await readFile(join(lockPath, 'pid'), 'utf8').catch(() => '')).trim(), 10);
    return Number.isInteger(pid) && pid > 0 && !pidAlive(pid);
  } catch {
    return false;
  }
};

/**
 * Serializes event appends for one workspace. In-process: chained through
 * `withStateLock` keyed `<tasksDir>#events`. Cross-process: `mkdir` of
 * `events.lock` with a `pid` file (mirrors the file adapter's lock), retried
 * every 5ms up to 5s; a lock older than 10s is taken over. Throws when the
 * deadline passes — callers treat the append as skipped.
 */
export const withEventsLock = <T>(tasksDir: string, work: () => Promise<T>): Promise<T> =>
  withStateLock(`${tasksDir}#events`, async () => {
    const lockPath = join(tasksDir, LOCK_DIR);
    await mkdir(tasksDir, { recursive: true });
    const start = Date.now();
    for (;;) {
      try {
        await mkdir(lockPath);
        await writeFile(join(lockPath, 'pid'), `${process.pid}\n`).catch(() => {});
        break;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
        if (await lockIsStale(lockPath)) { await rm(lockPath, { recursive: true, force: true }); continue; }
        if (Date.now() - start > LOCK_DEADLINE_MS) throw new Error(`events lock busy: ${lockPath}`);
        await sleep(LOCK_RETRY_MS);
      }
    }
    try {
      return await work();
    } finally {
      await rm(lockPath, { recursive: true, force: true }).catch(() => {});
    }
  });

/** Last complete line's seq: scans the final 64 KiB backwards, falling back to a full read. 0 for a missing/empty log. */
export const lastEventSeq = async (tasksDir: string): Promise<number> => {
  let handle;
  try { handle = await open(eventsPath(tasksDir), 'r'); } catch { return 0; }
  try {
    const { size } = await handle.stat();
    if (size === 0) return 0;
    const fromTail = async (window: number): Promise<number | null> => {
      const length = Math.min(window, size);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      const lines = buffer.toString('utf8').split('\n');
      // A partial first line only exists when the window does not start the file.
      const firstComplete = length < size ? 1 : 0;
      for (let index = lines.length - 1; index >= firstComplete; index -= 1) {
        // The final segment is only complete when the file ends in a newline (then it is '').
        if (index === lines.length - 1) continue;
        const event = parseLine(lines[index]!);
        if (event !== null) return event.seq;
      }
      return null;
    };
    const tail = await fromTail(TAIL_WINDOW);
    if (tail !== null) return tail;
    if (size <= TAIL_WINDOW) return 0;
    return (await fromTail(size)) ?? 0;
  } finally {
    await handle.close();
  }
};

/**
 * Appends drafts as one `appendFile` under the events lock, assigning
 * `seq = last + i + 1`. Each line is `JSON.stringify` + `\n`, so user text can
 * never forge a second line. Returns the stamped events.
 */
export const appendEvents = async (tasksDir: string, drafts: readonly EventDraft[], stamp: EventStamp): Promise<readonly TaskEvent[]> => {
  if (drafts.length === 0) return [];
  return withEventsLock(tasksDir, async () => {
    const path = eventsPath(tasksDir);
    // Re-terminate a torn trailing line so the next line starts clean.
    let prefix = '';
    try {
      const info = await stat(path);
      if (info.size > 0) {
        const handle = await open(path, 'r');
        try {
          const last = Buffer.alloc(1);
          await handle.read(last, 0, 1, info.size - 1);
          if (last.toString('utf8') !== '\n') prefix = '\n';
        } finally { await handle.close(); }
      }
    } catch { /* missing file */ }
    const last = await lastEventSeq(tasksDir);
    const host = stamp.host ?? hostname();
    const ts = (stamp.now ?? new Date()).toISOString();
    const session = stamp.session !== undefined && stamp.session !== '' ? stamp.session : undefined;
    const events: TaskEvent[] = drafts.map((draft, index) => ({
      seq: last + index + 1,
      host,
      ts,
      ...(draft.task !== undefined ? { task: draft.task } : {}),
      type: draft.type,
      actor: stamp.actor,
      ...(session !== undefined ? { session } : {}),
      data: draft.data,
    }));
    await appendFile(path, prefix + events.map((event) => `${JSON.stringify(event)}\n`).join(''));
    return events;
  });
};

/** Every complete, parsable line with `seq > after`, in file order (at most `limit`). `[]` for a missing log. */
export const readEvents = async (tasksDir: string, options: { readonly after?: number; readonly limit?: number } = {}): Promise<readonly TaskEvent[]> => {
  let text: string;
  try { text = await readFile(eventsPath(tasksDir), 'utf8'); } catch { return []; }
  const after = options.after ?? 0;
  const lines = text.split('\n');
  // The last segment has no terminating newline: it is either '' or a torn write.
  lines.pop();
  const events: TaskEvent[] = [];
  for (const line of lines) {
    const event = parseLine(line);
    if (event === null || event.seq <= after) continue;
    events.push(event);
    if (options.limit !== undefined && events.length >= options.limit) break;
  }
  return events;
};
