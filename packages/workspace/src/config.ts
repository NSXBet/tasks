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

/** Where evidence/inline blobs live; refs on issues stay backend-agnostic. */
export const AttachmentsConfigSchema = z.object({
  /** fs (default) keeps bytes under `.tasks/attachments/`; s3 = S3-compatible; postgres stores bytes in the same database. */
  store: z.enum(['fs', 's3', 'postgres']).optional(),
  /** fs backend only: track `.tasks/attachments/**` with git-lfs (default true). */
  lfs: z.boolean().optional(),
  /** S3-compatible settings; credentials come from the ambient AWS credential chain (prefer `profile`). */
  s3: z.object({
    bucket: z.string().min(1),
    region: z.string().min(1).optional(),
    prefix: z.string().min(1).optional(),
    endpoint: z.string().min(1).optional(),
    profile: z.string().min(1).optional(),
  }).optional(),
  /** Postgres blob settings: which env var carries the connection string (default DATABASE_URL). */
  postgres: z.object({ urlEnv: z.string().min(1).optional() }).optional(),
}).strict().optional();
export type AttachmentsConfig = z.infer<typeof AttachmentsConfigSchema>;

const hookCommand = z.string().min(1).optional();

/** Spec spelling → normalized (camelCase) key for each lifecycle hook. */
const HOOK_ALIASES = [
  ['post_start', 'postStart'],
  ['post_checkout', 'postCheckout'],
  ['pre_end', 'preEnd'],
] as const;

/**
 * `worktree` block of `.tasks/config.json`. Accepts the spec's snake_case hook
 * names (`post_start`/`post_checkout`/`pre_end`) and the camelCase spellings,
 * plus `install` (and its legacy alias `pmSetup`). Unknown keys are still
 * rejected (strict). Output is always the normalized camelCase shape
 * `{ dir?, postStart?, postCheckout?, preEnd?, install? }`.
 *
 * Hooks are shell strings run from inside the worktree path (gw port), never
 * fatal to the tk command that fired them:
 * - `post_start`: after tk creates a worktree on a NEW branch;
 * - `post_checkout`: after tk creates a worktree for an already-existing branch;
 * - `pre_end`: just before tk removes a worktree (remove, close-prune, clean).
 * Re-entering an existing worktree fires neither post hook.
 * `install`: package-manager install after creation (detected from the main
 * worktree's lockfile). Default on; `false` disables.
 */
export const WorktreeConfigSchema = z.object({
  dir: z.string().min(1).optional(),
  postStart: hookCommand,
  post_start: hookCommand,
  postCheckout: hookCommand,
  post_checkout: hookCommand,
  preEnd: hookCommand,
  pre_end: hookCommand,
  install: z.boolean().optional(),
  /** Legacy alias of `install`; an explicit `install` wins. */
  pmSetup: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  for (const [snake, camel] of HOOK_ALIASES) {
    const a = value[snake];
    const b = value[camel];
    if (a !== undefined && b !== undefined && a !== b) {
      ctx.addIssue({ code: 'custom', path: [snake], message: `worktree.${snake} and worktree.${camel} both set` });
    }
  }
}).transform((value) => {
  const out: { dir?: string; postStart?: string; postCheckout?: string; preEnd?: string; install?: boolean } = {};
  if (value.dir !== undefined) out.dir = value.dir;
  for (const [snake, camel] of HOOK_ALIASES) {
    const command = value[camel] ?? value[snake];
    if (command !== undefined) out[camel] = command;
  }
  const install = value.install ?? value.pmSetup;
  if (install !== undefined) out.install = install;
  return out;
});
export type WorktreeConfig = z.output<typeof WorktreeConfigSchema>;

/** File is the default backend: git-friendly, no native driver, works with zero configuration. */
export const DEFAULT_STORAGE: StorageConfig = Object.freeze({ backend: 'file' });

export const WorkspaceConfigSchema = z.object({
  prefix: z.string().min(1).optional(),
  storage: StorageConfigSchema.optional(),
  attachments: AttachmentsConfigSchema,
  /** tk web's default port for this workspace; `--port` and `TK_WEB_PORT` override it. */
  webPort: z.number().int().min(1).max(65535).optional(),
  /** Workspace-wide worktree placement and lifecycle (see WorktreeConfigSchema). */
  worktree: WorktreeConfigSchema.optional(),
  /** tk-tui's attachment-image cell size (width x height terminal cells); the `tk-tui --image-size WxH` flag overrides it. */
  tuiImage: z.object({ width: z.number().int().min(1), height: z.number().int().min(1) }).strict().optional(),
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
