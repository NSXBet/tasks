/**
 * Enumerated synchronous git commands for git-hook contexts.
 *
 * Hooks run inside git's own process tree and some call sites cannot await,
 * so these use the `SyncProcessRunner` shape from `runner.ts` (still the only
 * spawning module). Each function is one git invocation with argv-only
 * arguments and `--` before pathspecs. `env` is passed through verbatim:
 * omit it to inherit the hook's env (e.g. GIT_INDEX_FILE), or pass a scrubbed
 * env to force git to rediscover the repo from `cwd`.
 */
import { spawnSyncRunner, type SyncProcessRunner } from "./runner.js";

export interface GitSyncResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitSyncOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly runner?: SyncProcessRunner;
}

const gitSync = (args: readonly string[], options: GitSyncOptions): GitSyncResult => {
  const result = (options.runner ?? spawnSyncRunner).runSync(["git", ...args], options.cwd, options.env);
  return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr };
};

/** `git config --get <key>`; not ok when the key is unset. */
export const gitConfigGetSync = (key: string, options: GitSyncOptions = {}): GitSyncResult => gitSync(["config", "--get", key], options);

/** `git config <key> <value>`. */
export const gitConfigSetSync = (key: string, value: string, options: GitSyncOptions = {}): GitSyncResult => gitSync(["config", key, value], options);

/** `git config --unset <key>`. */
export const gitConfigUnsetSync = (key: string, options: GitSyncOptions = {}): GitSyncResult => gitSync(["config", "--unset", key], options);

/** `git ls-files --error-unmatch -- <file>`; ok iff the file is tracked. */
export const gitIsTrackedSync = (file: string, options: GitSyncOptions = {}): GitSyncResult => gitSync(["ls-files", "--error-unmatch", "--", file], options);

/** `git diff --cached [--diff-filter=<f>] --name-only -- <pathspec>`. */
export const gitDiffCachedNamesSync = (pathspec: string, options: GitSyncOptions & { readonly diffFilter?: string } = {}): GitSyncResult =>
  gitSync(["diff", "--cached", ...(options.diffFilter === undefined ? [] : [`--diff-filter=${options.diffFilter}`]), "--name-only", "--", pathspec], options);

/** `git add -- <file>`. */
export const gitAddSync = (file: string, options: GitSyncOptions = {}): GitSyncResult => gitSync(["add", "--", file], options);
