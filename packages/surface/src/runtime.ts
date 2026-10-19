import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Run } from '@tasks/domain';
import type { WatchSubscription } from './watch/protocol.js';

/**
 * Runtime state lives in plain files inside `<tasksDir>`: `runtime.json` (the
 * registry of live watchers), `activity.ndjson` (append-only event trail), and
 * `inbox.json` (run read/archive markers). All readers tolerate missing or
 * malformed files: runtime state must never take a watcher or CLI command down.
 */

/**
 * tk web's default port: 0x544B — ASCII "TK". Unassigned in the IANA registry
 * and below the OS ephemeral range, so it stays free and stable.
 */
export const WEB_DEFAULT_PORT = 21579;

/**
 * tk web port precedence: the `--port` flag beats `TK_WEB_PORT`, which beats
 * the workspace config's `webPort`, which beats the default. Unparsable values
 * are skipped — the first valid source wins — and reported via `ignored` so the
 * caller can warn without bricking the command over a typo.
 */
export const resolveWebPort = (flag: string | undefined, env: string | undefined, configured: number | undefined): { readonly port: number; readonly ignored: readonly string[] } => {
  const ignored: string[] = [];
  for (const raw of [flag, env]) {
    if (raw === undefined) continue;
    const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (Number.isInteger(value) && value >= 1 && value <= 65535) return { port: value, ignored };
    ignored.push(raw);
  }
  return { port: configured ?? WEB_DEFAULT_PORT, ignored };
};

/** One live watcher row in `<tasksDir>/runtime.json`. */
export interface WatchRuntimeRow {
  readonly id: string;
  readonly kind: 'watch';
  readonly label: string | null;
  readonly pid: number;
  readonly startedAt: string;
  readonly heartbeatAt: string;
  readonly subscriptions: readonly string[];
}

/**
 * One live web-server row: fixed id `web`, replaced on every register, so the
 * registry never holds more than one web row per workspace.
 */
export interface WebRuntimeRow {
  readonly id: 'web';
  readonly kind: 'web';
  readonly pid: number;
  readonly port: number;
  readonly url: string;
  readonly workspace: string;
  readonly startedAt: string;
}

export type RuntimeRow = WatchRuntimeRow | WebRuntimeRow;

/** Fixed registry id of the workspace's web-server row. */
export const WEB_RUNTIME_ID = 'web';

/** Append-only event row in `<tasksDir>/activity.ndjson`. */
export interface ActivityRow {
  readonly at: string;
  readonly runtimeId: string;
  readonly kind: string;
  readonly detail: string;
}

/** Read/archive markers for the run inbox, persisted in `<tasksDir>/inbox.json`. */
export interface InboxMarkers {
  readonly readAt: Record<string, string>;
  readonly archived: Record<string, true>;
}

/** One derived inbox row over stored runs and the read/archive markers. */
export interface InboxEntry {
  readonly runId: string;
  readonly issueId: string;
  readonly agentId: string | null;
  readonly state: Run['state'];
  readonly trigger: Run['trigger'];
  readonly lastUpdatedAt: string;
  readonly unread: boolean;
  readonly archived: boolean;
}

const runtimePath = (tasksDir: string): string => join(tasksDir, 'runtime.json');
const webWorkspacesPath = (tasksDir: string): string => join(tasksDir, 'web-workspaces.json');
const activityPath = (tasksDir: string): string => join(tasksDir, 'activity.ndjson');
const inboxPath = (tasksDir: string): string => join(tasksDir, 'inbox.json');

const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return fallback; }
};

/** Writes through a same-directory temp file + rename: readers either see the
 * old or the new content, never a torn file (a mid-write read once fed a CLI
 * prune garbage and cost the workspace its registry). */
const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(join(path, '..'), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, path);
};

/** Human-readable subscription summary for the registry row and CLI output. */
export const describeSubscription = (subscription: WatchSubscription): readonly string[] => [
  ...(subscription.kinds === undefined ? [] : [`kinds=${subscription.kinds.join(',')}`]),
  ...(subscription.ids === undefined ? [] : [`ids=${subscription.ids.join(',')}`]),
  ...(subscription.label === undefined ? [] : [`label=${subscription.label}`]),
  ...(subscription.interval === undefined ? [] : [`interval=${subscription.interval}`]),
];

/** Allocates a fresh runtime id for a starting watcher. */
export const newRuntimeId = (): string => `watch-${process.pid}-${randomUUID().slice(0, 8)}`;

export const readRuntimeRegistry = (tasksDir: string): Promise<readonly RuntimeRow[]> =>
  readJson<readonly RuntimeRow[]>(runtimePath(tasksDir), []);

const writeRuntimeRegistry = (tasksDir: string, rows: readonly RuntimeRow[]): Promise<void> =>
  writeJson(runtimePath(tasksDir), rows);

/** Serializes registry read-modify-write cycles per process: the daemon owns
 * watch heartbeats, daemon rows, and web rows in one event loop, so two
 * unsynchronized cycles interleave and the later write erases the earlier
 * row (a 250ms heartbeat snapshot used to swallow the just-registered web
 * row). Keyed by tasksDir; never deleted — one entry per workspace, and a
 * still-settling chain must keep receiving later mutations. Cross-process
 * writers (CLI prunes) remain unordered with the daemon, which is the
 * pre-existing behavior. */
const registryLocks = new Map<string, Promise<unknown>>();
const withRegistryLock = <T>(tasksDir: string, work: () => Promise<T>): Promise<T> => {
  const next = (registryLocks.get(tasksDir) ?? Promise.resolve()).catch(() => {}).then(work);
  registryLocks.set(tasksDir, next);
  return next;
};

export const registerRuntime = (tasksDir: string, row: RuntimeRow): Promise<void> => withRegistryLock(tasksDir, async () => {
  const rows = (await readRuntimeRegistry(tasksDir)).filter((existing) => existing.id !== row.id);
  await writeRuntimeRegistry(tasksDir, [...rows, row]);
});

/** Refreshes the heartbeat stamp; a no-op when the row was already removed. Only watch rows heartbeat. */
export const heartbeatRuntime = (tasksDir: string, runtimeId: string, at: Date): Promise<void> => withRegistryLock(tasksDir, async () => {
  const rows = await readRuntimeRegistry(tasksDir);
  if (!rows.some((row) => row.kind === 'watch' && row.id === runtimeId)) return;
  await writeRuntimeRegistry(tasksDir, rows.map((row) => (row.kind === 'watch' && row.id === runtimeId ? { ...row, heartbeatAt: at.toISOString() } : row)));
});

export const unregisterRuntime = (tasksDir: string, runtimeId: string): Promise<void> => withRegistryLock(tasksDir, async () => {
  await writeRuntimeRegistry(tasksDir, (await readRuntimeRegistry(tasksDir)).filter((row) => row.id !== runtimeId));
});

/** Known tk web workspaces: the boot workspace plus every one opened through it. Lives beside the runtime registry in the boot workspace. */
export const readWebWorkspaces = async (tasksDir: string): Promise<readonly string[]> =>
  (await readJson<readonly string[]>(webWorkspacesPath(tasksDir), [])).filter((path) => typeof path === 'string');

export const writeWebWorkspaces = async (tasksDir: string, paths: readonly string[]): Promise<void> => {
  await writeJson(webWorkspacesPath(tasksDir), [...paths]);
};

/** Identity the server reports on `GET /api/status`; port is the ground truth for instance identity. */
export interface WebServerStatus {
  /** Wire marker distinguishing tk web servers from any other HTTP service on the port. */
  readonly tk: 'web';
  readonly workspace: string;
  /** Every workspace the server has served (boot workspace first) — feeds the browser's workspace picker. */
  readonly workspaces: readonly string[];
  readonly pid: number;
  readonly port: number;
  readonly url: string;
  readonly startedAt: string;
  readonly dev: boolean;
}

/** True when the pid belongs to a live process; EPERM means the process exists but is not ours to signal. */
export const pidAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
};

/** Asks a candidate endpoint for `/api/status`; null unless it identifies as tk web. Never trusts registry rows — the port is probed. */
export const probeWebServer = async (url: string, timeoutMs = 800): Promise<WebServerStatus | null> => {
  try {
    const response = await fetch(new URL('/api/status', url), { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return null;
    const record = body as Record<string, unknown>;
    const { tk, pid, port, workspace, startedAt, dev, workspaces } = record;
    if (tk !== 'web' || typeof pid !== 'number' || typeof port !== 'number' || typeof workspace !== 'string' || typeof startedAt !== 'string') return null;
    // Older servers omit the list; fall back to the one workspace they serve.
    const known = Array.isArray(workspaces) && workspaces.every((path) => typeof path === 'string') ? workspaces : [workspace];
    return { tk: 'web', workspace, workspaces: known, pid, port, startedAt, url: typeof record['url'] === 'string' ? record['url'] : url, dev: dev === true };
  } catch { return null; }
};

export const appendActivity = async (tasksDir: string, row: ActivityRow): Promise<void> => {
  await mkdir(tasksDir, { recursive: true });
  await appendFile(activityPath(tasksDir), `${JSON.stringify(row)}\n`);
};

/** Reads the activity trail, oldest last; `limit` keeps only the newest rows. */
export const readActivity = async (tasksDir: string, limit?: number): Promise<readonly ActivityRow[]> => {
  let raw = '';
  try { raw = await readFile(activityPath(tasksDir), 'utf8'); } catch { return []; }
  const rows = raw.split('\n').flatMap((line): readonly ActivityRow[] => {
    if (line.trim() === '') return [];
    try { return [JSON.parse(line) as ActivityRow]; } catch { return []; }
  });
  return limit === undefined ? rows : rows.slice(-limit);
};

export const readInboxMarkers = (tasksDir: string): Promise<InboxMarkers> =>
  readJson<InboxMarkers>(inboxPath(tasksDir), { readAt: {}, archived: {} });

export const writeInboxMarkers = (tasksDir: string, markers: InboxMarkers): Promise<void> =>
  writeJson(inboxPath(tasksDir), markers);

export const markInboxRead = async (tasksDir: string, runId: string, at: Date = new Date()): Promise<void> => {
  const markers = await readInboxMarkers(tasksDir);
  await writeInboxMarkers(tasksDir, { readAt: { ...markers.readAt, [runId]: at.toISOString() }, archived: markers.archived });
};

export const markInboxArchived = async (tasksDir: string, runId: string): Promise<void> => {
  const markers = await readInboxMarkers(tasksDir);
  await writeInboxMarkers(tasksDir, { readAt: markers.readAt, archived: { ...markers.archived, [runId]: true } });
};

/** Derives inbox entries: unread before read, terminal-state aware, archived last. */
export const inboxEntries = (runs: readonly Run[], markers: InboxMarkers): readonly InboxEntry[] => {
  const entries = runs.map((run): InboxEntry => ({
    runId: run.id, issueId: run.issueId, agentId: run.agentId, state: run.state, trigger: run.trigger,
    lastUpdatedAt: run.updatedAt.toISOString(),
    unread: markers.readAt[run.id] === undefined, archived: markers.archived[run.id] === true,
  }));
  const rank = (entry: InboxEntry): number => entry.archived ? 2 : entry.unread ? 0 : 1;
  return [...entries].sort((first, second) => rank(first) - rank(second) || second.lastUpdatedAt.localeCompare(first.lastUpdatedAt) || first.runId.localeCompare(second.runId));
};