import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Shared IO for plain-file runtime state (`runtime.json`, `inbox.json`,
 * `leases.json`): tolerant reads and atomic writes, plus the per-process
 * read-modify-write serialization keyed by `tasksDir` that keeps concurrent
 * mutators in one event loop from erasing each other's rows.
 */

export const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return fallback; }
};

/** Writes through a same-directory temp file + rename: readers either see the
 * old or the new content, never a torn file (a mid-write read once fed a CLI
 * prune garbage and cost the workspace its registry). */
export const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(join(path, '..'), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, path);
};

/** Serializes read-modify-write cycles per process: the daemon owns watch
 * heartbeats, daemon rows, web rows, and lease grants in one event loop, so
 * two unsynchronized cycles interleave and the later write erases the earlier
 * row (a 250ms heartbeat snapshot used to swallow the just-registered web
 * row). Keyed by tasksDir; never deleted — one entry per workspace, and a
 * still-settling chain must keep receiving later mutations. Cross-process
 * writers (CLI prunes) remain unordered with the daemon, which is the
 * pre-existing behavior. */
const stateLocks = new Map<string, Promise<unknown>>();
export const withStateLock = <T>(tasksDir: string, work: () => Promise<T>): Promise<T> => {
  const next = (stateLocks.get(tasksDir) ?? Promise.resolve()).catch(() => {}).then(work);
  stateLocks.set(tasksDir, next);
  return next;
};
