/**
 * Minimal git plumbing for worktree support.
 *
 * A `tk` workspace is just a `.tasks/` directory; nothing here is Dolt- or
 * bd-specific. `git worktree` lets several working directories share one
 * `.git`, and `git rev-parse --git-common-dir` is how any of them finds the
 * one true `.git` — that's the same mechanism bd relies on, and it works
 * identically for tk's plain sqlite/postgres/file backends. The only thing
 * `tk worktree` adds on top of `git worktree` is: locate the main worktree's
 * `.tasks/` from inside a linked worktree, and surface that as "shared"
 * config state instead of "no beads here" the way a naive upward directory
 * walk would.
 */
import { dirname } from "node:path";


/** Injected so command dispatch stays testable without a real git binary. */
export interface ProcessRunner {
  run(command: readonly string[], cwd: string): Promise<{ readonly stdout: string; readonly stderr: string; readonly code: number }>;
}

export const bunRunner: ProcessRunner = {
  async run(command, cwd) {
    try {
      const spawned = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([new Response(spawned.stdout).text(), new Response(spawned.stderr).text(), spawned.exited]);
      return { stdout: stdout.trim(), stderr: stderr.trim(), code };
    } catch (cause) {
      // ENOENT (e.g. no git on PATH) behaves like a failed probe, not a crash.
      return { stdout: "", stderr: cause instanceof Error ? cause.message : String(cause), code: 127 };
    }
  },
};

const git = async (runner: ProcessRunner, cwd: string, args: readonly string[]): Promise<string | null> => {
  const result = await runner.run(["git", ...args], cwd);
  return result.code === 0 ? result.stdout : null;
};

/** Absolute path to the shared `.git` directory, even from inside a linked worktree. */
export const gitCommonDir = (cwd: string, runner: ProcessRunner = bunRunner): Promise<string | null> => git(runner, cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);

/** Root of the checkout containing `cwd` (the linked worktree's own root, not the main one). */
export const gitToplevel = (cwd: string, runner: ProcessRunner = bunRunner): Promise<string | null> => git(runner, cwd, ["rev-parse", "--show-toplevel"]);

export const gitCurrentBranch = (cwd: string, runner: ProcessRunner = bunRunner): Promise<string | null> => git(runner, cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);

/** Default integration branch: remote HEAD when configured, otherwise main/master. */
export async function gitDefaultBranch(cwd: string, runner: ProcessRunner = bunRunner): Promise<string | null> {
  const remote = await git(runner, cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (remote !== null) return remote;
  for (const candidate of ["main", "master"]) if (await git(runner, cwd, ["rev-parse", "--verify", "--quiet", candidate])) return candidate;
  return null;
}

export interface WorktreeEntry { readonly path: string; readonly branch: string | null; readonly bare: boolean; readonly locked: boolean }

/** Parses `git worktree list --porcelain`; the main worktree is always first. */
export function parseWorktreePorcelain(text: string): readonly WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let path: string | null = null; let branch: string | null = null; let bare = false; let locked = false;
  const flush = (): void => { if (path !== null) entries.push({ path, branch, bare, locked }); path = null; branch = null; bare = false; locked = false; };
  for (const line of text.split("\n")) {
    if (line === "") { flush(); continue; }
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line.startsWith("branch ")) branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    else if (line === "bare") bare = true;
    else if (line.startsWith("locked")) locked = true;
  }
  flush();
  return entries;
}

export const gitWorktreeList = async (cwd: string, runner: ProcessRunner = bunRunner): Promise<readonly WorktreeEntry[]> => {
  const text = await git(runner, cwd, ["worktree", "list", "--porcelain"]);
  return text === null ? [] : parseWorktreePorcelain(text);
};

export interface GitOutcome { readonly ok: boolean; readonly stderr: string }

export async function gitWorktreeAdd(cwd: string, path: string, branch: string, runner: ProcessRunner = bunRunner): Promise<GitOutcome> {
  const result = await runner.run(["git", "worktree", "add", path, "-b", branch], cwd);
  return { ok: result.code === 0, stderr: result.stderr };
}

export async function gitWorktreeRemove(cwd: string, path: string, force: boolean, runner: ProcessRunner = bunRunner): Promise<GitOutcome> {
  const result = await runner.run(["git", "worktree", "remove", ...(force ? ["--force"] : []), path], cwd);
  return { ok: result.code === 0, stderr: result.stderr };
}

/** True when the working tree has uncommitted changes (tracked or staged). */
export async function gitHasUncommittedChanges(cwd: string, runner: ProcessRunner = bunRunner): Promise<boolean> {
  const status = await git(runner, cwd, ["status", "--porcelain"]);
  return (status ?? "") !== "";
}

/** True when HEAD has commits its upstream doesn't (or there is no upstream to compare against, i.e. never pushed). */
export async function gitHasUnpushedCommits(cwd: string, runner: ProcessRunner = bunRunner): Promise<boolean> {
  const upstream = await git(runner, cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream === null) return true; // no upstream configured; treat as "not safe to assume pushed"
  const ahead = await git(runner, cwd, ["rev-list", "--count", `${upstream}..HEAD`]);
  return ahead !== null && ahead !== "0";
}

export async function gitStashCount(cwd: string, runner: ProcessRunner = bunRunner): Promise<number> {
  const list = await git(runner, cwd, ["stash", "list"]);
  return list === null || list === "" ? 0 : list.split("\n").length;
}

/**
 * Root of the main worktree that owns the shared `.git`, derived from
 * `git rev-parse --git-common-dir` (always `<main-root>/.git`, even bare
 * repos report a path ending in `.git`). Used to find a linked worktree's
 * `.tasks/` when the worktree itself has none of its own.
 */
export function mainWorktreeRoot(commonDir: string): string { return dirname(commonDir); }
