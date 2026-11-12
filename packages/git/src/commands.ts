/**
 * Every git command tk runs, enumerated in one place.
 *
 * Each function wraps exactly one git invocation through a `ProcessRunner`
 * (default `bunRunner`) and returns either a parsed/derived value or a
 * structured outcome — never a raw spawn call at the call site.
 */
import { appendFile, lstat, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
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

/** Current branch name; null when detached (git prints the literal `HEAD`) or not a repo. */
export const gitCurrentBranch = async (cwd: string, runner: ProcessRunner = bunRunner): Promise<string | null> => {
  const branch = await git(runner, cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch === "HEAD" ? null : branch;
};

/**
 * Default integration branch: remote HEAD when configured, otherwise
 * main/master. A local-first repo routinely outgrows its remote (rewelded
 * history, unpushed work): when the local default tip descends from the
 * remote tip, the remote is stale and must not anchor changeset bases —
 * the local branch wins. In-sync, diverged, or remote-ahead cases keep
 * origin/HEAD.
 */
export async function gitDefaultBranch(cwd: string, runner: ProcessRunner = bunRunner): Promise<string | null> {
  const remote = await git(runner, cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  for (const candidate of ["main", "master"]) {
    if (!(await git(runner, cwd, ["rev-parse", "--verify", "--quiet", candidate]))) continue;
    if (remote === null) return candidate;
    // Strictly ahead only: equal tips (fresh clone, in sync) keep origin/HEAD,
    // because --is-ancestor succeeds for identical refs in both directions.
    const descends = (await runner.run(["git", "merge-base", "--is-ancestor", remote, candidate], cwd)).code === 0;
    if (!descends) return remote;
    const equal = (await runner.run(["git", "merge-base", "--is-ancestor", candidate, remote], cwd)).code === 0;
    return equal ? remote : candidate;
  }
  return remote;
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

/** Most untracked files the working-tree patch renders (sorted by path; the rest are left out). */
export const UNTRACKED_PATCH_LIMIT = 200;

/** Untracked files larger than this are left out of the working-tree patch (they still count dirty in `gitDirtyCount`). */
export const UNTRACKED_MAX_BYTES = 1024 * 1024;

/** How many `git diff --no-index` calls run at once while rendering untracked files. */
const UNTRACKED_CONCURRENCY = 8;

type PatchOptions = { readonly fullIndex?: boolean; readonly contextLines?: number };

const patchFlags = (options: PatchOptions): string[] => [
  ...(options.fullIndex === true ? ["--full-index"] : []),
  ...(validContextLines(options.contextLines) ? [`--unified=${options.contextLines}`] : []),
];

/**
 * Untracked, non-ignored paths under `cwd` (`git ls-files --others
 * --exclude-standard -z`), relative to `cwd`, sorted. Run raw so trimming
 * can't eat NUL separators; `-z` means no path quoting. Directory rows (a
 * nested repo shows as `sub/`) are dropped. Null on a non-zero exit.
 */
export const gitUntrackedFiles = async (cwd: string, runner: ProcessRunner = bunRunner): Promise<readonly string[] | null> => {
  const result = await runner.run(["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd, undefined, { raw: true });
  if (result.code !== 0) return null;
  return result.stdout
    .split("\0")
    .filter((path) => path !== "" && !path.endsWith("/"))
    .sort();
};

/** A path from `ls-files` that may reach argv: relative, no NUL, no `..` segment. */
const safeRelativePath = (path: string): boolean =>
  path !== "" && !isAbsolute(path) && !path.includes("\0") && !path.split(/[\\/]/).includes("..");

/**
 * One untracked file rendered as a new-file patch: `git diff --no-index
 * --patch [--full-index] [--unified=n] -- /dev/null <path>`. Read-only on the
 * repo (the index is never touched). `--no-index` exits 1 when the inputs
 * differ, so 0 and 1 both count as success. Run raw (stdout keeps its final
 * newline). Null — nothing spawned — for an empty, absolute, NUL-bearing or
 * `..`-escaping path; null on any other exit.
 */
export const gitDiffNewFile = async (cwd: string, path: string, options: PatchOptions = {}, runner: ProcessRunner = bunRunner): Promise<string | null> => {
  if (!safeRelativePath(path)) return null;
  const result = await runner.run(["git", "diff", "--no-index", "--patch", ...patchFlags(options), "--", "/dev/null", path], cwd, undefined, { raw: true });
  return result.code === 0 || result.code === 1 ? result.stdout : null;
};

/** Untracked files worth rendering: first `UNTRACKED_PATCH_LIMIT` paths that are regular files (or symlinks) within the size cap. */
const renderableUntracked = async (cwd: string, paths: readonly string[]): Promise<string[]> => {
  const kept: string[] = [];
  for (const path of paths.slice(0, UNTRACKED_PATCH_LIMIT)) {
    if (!safeRelativePath(path)) continue;
    try {
      const info = await lstat(join(cwd, path));
      if (info.isSymbolicLink() || (info.isFile() && info.size <= UNTRACKED_MAX_BYTES)) kept.push(path);
    } catch {
      // vanished between ls-files and stat
    }
  }
  return kept;
};

/** Runs `task` over `items` with at most `limit` in flight, preserving order. */
const mapLimited = async <T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      out[index] = await task(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};

/**
 * Unified diff patch — the one enumerated command every review surface derives
 * its diff from (web payload, TUI review source, headless review smoke).
 *
 * `to === null` diffs the working tree against `from` (single rev, so
 * uncommitted edits count) and then appends untracked, non-ignored files as
 * `/dev/null` new-file diffs (`gitUntrackedFiles` + `gitDiffNewFile`, paths
 * relative to `cwd`, which callers pass as the worktree root). The user's
 * index is never touched. Bounded: the first `UNTRACKED_PATCH_LIMIT` paths by
 * name, files over `UNTRACKED_MAX_BYTES` skipped. Otherwise the three-dot
 * merge-base range `from...to`, unchanged and without untracked files.
 * `--end-of-options` keeps a rev taken from task metadata (e.g.
 * `--output=…`) from ever being parsed as an option. Returns the patch (empty
 * string when there is no change, no trailing newline) or null when the
 * tracked diff exits non-zero (bad ref, not a repo).
 * `contextLines` (an integer 0..10000) becomes `--unified=<n>`; any other
 * value is ignored and git's default context applies.
 */
export const gitDiffPatch = async (
  cwd: string,
  from: string,
  to: string | null,
  options: PatchOptions = {},
  runner: ProcessRunner = bunRunner,
): Promise<string | null> => {
  const tracked = await git(runner, cwd, ["diff", "--patch", ...patchFlags(options), "--end-of-options", to === null ? from : `${from}...${to}`]);
  if (tracked === null || to !== null) return tracked;
  const untracked = await gitUntrackedFiles(cwd, runner);
  if (untracked === null || untracked.length === 0) return tracked;
  const paths = await renderableUntracked(cwd, untracked);
  const rendered = await mapLimited(paths, UNTRACKED_CONCURRENCY, (path) => gitDiffNewFile(cwd, path, options, runner));
  const parts = [tracked, ...rendered.map((text) => (text ?? "").replace(/\n$/, ""))].filter((part) => part !== "");
  return parts.join("\n");
};

/** Only a bounded non-negative integer may reach git's argv as `--unified=<n>`. */
const validContextLines = (value: number | undefined): value is number =>
  value !== undefined && Number.isInteger(value) && value >= 0 && value <= 10000;

/**
 * The one enumerated blob read: `git cat-file blob <rev>:<path>`, run raw
 * (untrimmed) because file bytes matter — leading/trailing whitespace and the
 * final newline survive. Returns null when `rev` is not an object id (7–64
 * hex), `path` is empty / starts with `-` or `/` / contains NUL (nothing is
 * spawned then), or git exits non-zero (path absent at that rev).
 */
export const gitShowFile = async (cwd: string, rev: string, path: string, runner: ProcessRunner = bunRunner): Promise<string | null> => {
  if (!/^[0-9a-f]{7,64}$/.test(rev) || path === "" || path.startsWith("-") || path.startsWith("/") || path.includes("\0")) return null;
  const result = await runner.run(["git", "cat-file", "blob", `${rev}:${path}`], cwd, undefined, { raw: true });
  return result.code === 0 ? result.stdout : null;
};

/** Resolved commit sha of `branch` (D-13: the recorded freeze head is always git's own output); null when the ref cannot be resolved. */
export const gitBranchHead = async (cwd: string, branch: string, runner: ProcessRunner = bunRunner): Promise<string | null> => {
  const sha = await git(runner, cwd, ["rev-parse", "--verify", branch]);
  return sha !== null && /^[0-9a-f]{40,64}$/.test(sha.trim()) ? sha.trim() : null;
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

/** Deletes a local branch (`-d`, or `-D` when `force`); `-d` refuses unmerged branches. */
export const gitDeleteBranch = async (cwd: string, branch: string, force = false, runner: ProcessRunner = bunRunner): Promise<GitOutcome> => {
  const result = await runner.run(["git", "branch", force ? "-D" : "-d", branch], cwd);
  return { ok: result.code === 0, stderr: result.stderr };
};

/**
 * Pushes a local branch to `remote` (default `origin`) and sets upstream:
 * `git push --set-upstream <remote> <branch>`. gh-free — the PR verbs push
 * through here before any gh call (Phase 11 D-01/D-04).
 */
export const gitPushBranch = async (cwd: string, branch: string, remote = "origin", runner: ProcessRunner = bunRunner): Promise<GitOutcome> => {
  const result = await runner.run(["git", "push", "--set-upstream", remote, branch], cwd);
  return { ok: result.code === 0, stderr: result.stderr };
};

/**
 * Commits staged + tracked changes in `cwd`: `git commit --all --message=<message>`.
 * The message is one `--message=` argv token, so a leading `-` can never become a
 * flag. Untracked files are never added; hooks run (no `--no-verify`); never
 * amends, never `--allow-empty`, never pushes (Phase 11 D-04, WORKSPC `commit`).
 * `nothingToCommit` is true when git refused because nothing tracked changed.
 */
export const gitCommitTracked = async (cwd: string, message: string, runner: ProcessRunner = bunRunner): Promise<GitOutcome & { readonly nothingToCommit: boolean }> => {
  const result = await runner.run(["git", "commit", "--all", `--message=${message}`], cwd);
  if (result.code === 0) return { ok: true, stderr: result.stderr, nothingToCommit: false };
  const nothingToCommit = /nothing (added )?to commit|no changes added to commit/.test(`${result.stdout}\n${result.stderr}`);
  return { ok: false, stderr: result.stderr !== "" ? result.stderr : result.stdout, nothingToCommit };
};

/** Absolute path of the repo-local `info/exclude` (shared `<common-dir>/info/exclude`, even from a linked worktree); null on failure. */
export const gitInfoExcludePath = (cwd: string, runner: ProcessRunner = bunRunner): Promise<string | null> => git(runner, cwd, ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"]);

/** True when `relPath` (relative to `cwd`) is ignored by any ignore source, tracked or not. */
export const gitIsIgnored = async (cwd: string, relPath: string, runner: ProcessRunner = bunRunner): Promise<boolean> => (await runner.run(["git", "check-ignore", "-q", "--no-index", "--", relPath], cwd)).code === 0;

const POOL_PATTERNS = new Set([".worktrees", ".worktrees/", "/.worktrees", "/.worktrees/"]);

/**
 * The one place tk writes ignore state: makes the default in-repo worktree
 * pool (`<mainRoot>/.worktrees/`) invisible to `git status` by appending the
 * constant `/.worktrees/` to the repo-local `info/exclude`. Never touches the
 * tracked `.gitignore`. Idempotent: skipped when the pool is already ignored
 * (by any source) or the exclude file already lists it. Never throws.
 */
export async function ensureWorktreePoolIgnored(mainRoot: string, runner: ProcessRunner = bunRunner): Promise<{ readonly changed: boolean; readonly ok: boolean; readonly stderr: string }> {
  if (await gitIsIgnored(mainRoot, ".worktrees/probe", runner)) return { changed: false, ok: true, stderr: "" };
  const excludePath = await gitInfoExcludePath(mainRoot, runner);
  if (excludePath === null) return { changed: false, ok: false, stderr: "cannot resolve info/exclude" };
  try {
    let current = "";
    try {
      current = await readFile(excludePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (current.split("\n").some((line) => POOL_PATTERNS.has(line.trim()))) return { changed: false, ok: true, stderr: "" };
    await mkdir(dirname(excludePath), { recursive: true });
    const lead = current !== "" && !current.endsWith("\n") ? "\n" : "";
    await appendFile(excludePath, `${lead}# tk: in-repo worktree pool\n/.worktrees/\n`);
    return { changed: true, ok: true, stderr: "" };
  } catch (error) {
    return { changed: false, ok: false, stderr: error instanceof Error ? error.message : String(error) };
  }
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

/** Entries in `git status --porcelain` (tracked, staged, untracked); null when git fails. */
export async function gitDirtyCount(cwd: string, runner: ProcessRunner = bunRunner): Promise<number | null> {
  const status = await git(runner, cwd, ["status", "--porcelain"]);
  if (status === null) return null;
  return status.split("\n").filter((line) => line.trim() !== "").length;
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

