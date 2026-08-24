import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Storage backend is a `.tasks/config.json` property, resolved once per
 * workspace — no command reads a runtime `--backend` flag. `tk init` accepts
 * `--backend`/`--filename`/`--url-env` purely as a convenience for writing
 * this key; it still only ever ends up in the config file, and every other
 * command still resolves the backend exclusively from that file.
 */
const FileStorageConfigSchema = z.object({ backend: z.literal('file') }).strict();
const SqliteStorageConfigSchema = z.object({
  backend: z.literal('sqlite'),
  /** Relative to `.tasks/`, or absolute. Defaults to `tasks.db`. */
  filename: z.string().min(1).optional(),
}).strict();
const PostgresStorageConfigSchema = z.object({
  backend: z.literal('postgres'),
  /** Literal connection string. Prefer `urlEnv` so secrets never land in a committed file. */
  url: z.string().min(1).optional(),
  /** Env var holding the connection string. Falls back to `TASKS_DATABASE_URL` when neither is set. */
  urlEnv: z.string().min(1).optional(),
}).strict();

export const StorageConfigSchema = z.discriminatedUnion('backend', [
  FileStorageConfigSchema,
  SqliteStorageConfigSchema,
  PostgresStorageConfigSchema,
]);
export type StorageConfig = z.infer<typeof StorageConfigSchema>;

/** File is the default backend: git-friendly, no native driver, works with zero configuration. */
export const DEFAULT_STORAGE: StorageConfig = Object.freeze({ backend: 'file' });

export const WorkspaceConfigSchema = z.object({
  prefix: z.string().min(1).optional(),
  storage: StorageConfigSchema.optional(),
}).passthrough();
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export const configPath = (tasksDir: string): string => join(tasksDir, 'config.json');

const exists = async (path: string): Promise<boolean> => {
  try { await access(path); return true; } catch { return false; }
};

/** True only if `dir` exists and actually contains at least one entry — an incidentally
 *  empty directory (e.g. left behind by a failed or aborted run) must never look like a
 *  real file-backend workspace. */
const hasAnyEntry = async (dir: string): Promise<boolean> => {
  try { return (await readdir(dir)).length > 0; } catch { return false; }
};

/** Missing `config.json` reads as `{}` (fresh/ephemeral workspace); malformed shape fails loudly. */
export async function readWorkspaceConfig(tasksDir: string): Promise<WorkspaceConfig> {
  const raw = await readFile(configPath(tasksDir), 'utf8').catch((cause: unknown) => {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return '{}';
    throw cause;
  });
  const parsed: unknown = JSON.parse(raw);
  return WorkspaceConfigSchema.parse(parsed);
}

export async function writeWorkspaceConfig(tasksDir: string, config: WorkspaceConfig): Promise<void> {
  await writeFile(configPath(tasksDir), `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Resolves the effective storage backend. An explicit `storage` key always wins.
 * When absent, this infers from what's actually on disk rather than defaulting
 * blindly — a workspace with a live `tasks.db` and no `storage` key predates this
 * feature and must keep resolving to sqlite, not silently switch to an empty
 * file-backend view. Only a truly empty/new workspace defaults to `file`; a merely
 * *present but empty* `issues/` directory (e.g. left over from an aborted run) must
 * not be enough to override that — only real issue files count.
 */
export async function resolveStorageConfig(tasksDir: string, config: WorkspaceConfig): Promise<StorageConfig> {
  if (config.storage) return config.storage;
  const [hasSqliteFile, hasFileBackendIssues] = await Promise.all([
    exists(join(tasksDir, 'tasks.db')),
    hasAnyEntry(join(tasksDir, 'issues')),
  ]);
  if (hasSqliteFile && !hasFileBackendIssues) return { backend: 'sqlite' };
  return DEFAULT_STORAGE;
}
