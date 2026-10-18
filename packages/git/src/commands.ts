/**
 * Every git command tk runs, enumerated in one place.
 *
 * Each function wraps exactly one git invocation through a `ProcessRunner`
 * (default `bunRunner`) and returns either a parsed/derived value or a
 * structured outcome — never a raw spawn call at the call site.
 */
import { dirname } from "node:path";
import { bunRunner, type ProcessRunner } from "./runner.js";
import { parseLogOneline, parseNameStatus, parseNumstat, parseWorktreePorcelain, type LogOnelineEntry, type NameStatusEntry, type NumstatEntry, type WorktreeEntry } from "./porcelain.js";

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

/** Merge base of two refs, or null when they have none (or a ref is missing). */
export async function gitMergeBase(cwd: string, a: string, b: string, runner: ProcessRunner = bunRunner): Promise<string | null> {
  return git(runner, cwd, ["merge-base", a, b]);
}

export interface GitOutcome {
  readonly ok: boolean;
  readonly stderr: string;
}

/** Commits between `base` and `branch` in log order (two-dot range, D-01 literal); null when the command fails. */
export const gitLogOneline = async (cwd: string, base: string, branch: string, runner: ProcessRunner = bunRunner): Promise<readonly LogOnelineEntry[] | null> => {
  const text = await git(runner, cwd, ["log", "--oneline", `${base}..${branch}`]);
  return text === null ? null : parseLogOneline(text);
};

/** Aggregate per-file additions/deletions across the merge-base range (three-dot, D-01 literal); null when the command fails. */
export const gitDiffNumstat = async (cwd: string, base: string, branch: string, runner: ProcessRunner = bunRunner): Promise<readonly NumstatEntry[] | null> => {
  const text = await git(runner, cwd, ["diff", "--numstat", `${base}...${branch}`]);
  return text === null ? null : parseNumstat(text);
};

/** Changed files with verbatim porcelain status codes across the merge-base range (three-dot, D-02 shape); null when the command fails. */
export const gitDiffNameStatus = async (cwd: string, base: string, branch: string, runner: ProcessRunner = bunRunner): Promise<readonly NameStatusEntry[] | null> => {
  const text = await git(runner, cwd, ["diff", "--name-status", `${base}...${branch}`]);
  return text === null ? null : parseNameStatus(text);
};

export const gitWorktreeList = async (cwd: string, runner: ProcessRunner = bunRunner): Promise<readonly WorktreeEntry[]> => {
  const text = await git(runner, cwd, ["worktree", "list", "--porcelain"]);
  return text === null ? [] : parseWorktreePorcelain(text);
};

export async function gitWorktreeAdd(cwd: string, path: string, branch: string, createBranch = true, runner: ProcessRunner = bunRunner): Promise<GitOutcome> {
  const result = await runner.run(createBranch ? ["git", "worktree", "add", path, "-b", branch] : ["git", "worktree", "add", path, branch], cwd);
  return { ok: result.code === 0, stderr: result.stderr };
}

/** True when a local branch with this exact name exists. */
export const gitBranchExists = async (cwd: string, branch: string, runner: ProcessRunner = bunRunner): Promise<boolean> => (await runner.run(["git", "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd)).code === 0;

/** Creates a local branch at the current HEAD; a non-zero exit (e.g. already exists) surfaces in the outcome. */
export const gitCreateBranch = async (cwd: string, branch: string, runner: ProcessRunner = bunRunner): Promise<GitOutcome> => {
  const result = await runner.run(["git", "branch", branch], cwd);
  return { ok: result.code === 0, stderr: result.stderr };
};

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
export function mainWorktreeRoot(commonDir: string): string {
  return dirname(commonDir);
}

