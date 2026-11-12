import { hostname } from 'node:os';
import { join } from 'node:path';
import { readJson, writeJson } from '../state-io.js';
import { withEventsLock } from './log.js';

/**
 * Per-subscriber read cursors over the event wire, in `<tasksDir>/cursors.json`
 * (spec §10: "each subscriber holds {host, seq} cursors"). The value is the
 * last seq the subscriber consumed, keyed by host so per-host sequences can
 * merge across machines later. Reads are tolerant (malformed → empty); writes
 * are atomic temp+rename under the events lock, so they serialize with
 * appends and with each other across processes.
 */

export const CURSORS_FILE = 'cursors.json';

export interface CursorsFile {
  readonly version: 1;
  readonly subscribers: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

const cursorsPath = (tasksDir: string): string => join(tasksDir, CURSORS_FILE);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Tolerant read: anything that is not a well-formed cursors file reads as empty; bad entries are dropped. */
export const readCursors = async (tasksDir: string): Promise<CursorsFile> => {
  const raw = await readJson<unknown>(cursorsPath(tasksDir), null);
  const subscribers: Record<string, Record<string, number>> = {};
  if (isRecord(raw) && isRecord(raw['subscribers'])) {
    for (const [name, hosts] of Object.entries(raw['subscribers'])) {
      if (!isRecord(hosts)) continue;
      const kept: Record<string, number> = {};
      for (const [host, seq] of Object.entries(hosts)) {
        if (typeof seq === 'number' && Number.isInteger(seq) && seq >= 0) kept[host] = seq;
      }
      subscribers[name] = kept;
    }
  }
  return { version: 1, subscribers };
};

/** The subscriber's cursor for `host` (default this host); null when unset. */
export const readCursor = async (tasksDir: string, subscriber: string, host: string = hostname()): Promise<number | null> => {
  const file = await readCursors(tasksDir);
  return file.subscribers[subscriber]?.[host] ?? null;
};

const update = (tasksDir: string, subscriber: string, host: string, seq: number, onlyWhenAbsent: boolean): Promise<number> =>
  withEventsLock(tasksDir, async () => {
    const file = await readCursors(tasksDir);
    const current = file.subscribers[subscriber]?.[host];
    if (onlyWhenAbsent && current !== undefined) return current;
    const next: CursorsFile = {
      version: 1,
      subscribers: { ...file.subscribers, [subscriber]: { ...file.subscribers[subscriber], [host]: seq } },
    };
    await writeJson(cursorsPath(tasksDir), next);
    return seq;
  });

/** Stores `seq` as the subscriber's cursor for `host` (default this host). Other subscribers/hosts are kept. */
export const writeCursor = async (tasksDir: string, subscriber: string, seq: number, host: string = hostname()): Promise<void> => {
  if (!Number.isInteger(seq) || seq < 0) throw new Error(`invalid cursor seq: ${seq}`);
  await update(tasksDir, subscriber, host, seq, false);
};

/** Writes `seq` only when the subscriber has no cursor yet for `host`; returns the cursor now in effect. */
export const seedCursor = async (tasksDir: string, subscriber: string, seq: number, host: string = hostname()): Promise<number> => {
  if (!Number.isInteger(seq) || seq < 0) throw new Error(`invalid cursor seq: ${seq}`);
  return update(tasksDir, subscriber, host, seq, true);
};
