/**
 * Live review source: resolves an issue's branch, base, and unified patch
 * into the vendored Hunk diff model — no fixtures. The base is the issue's
 * pinned changeset record when present, else the merge-base against the
 * default branch (three-dot parity with `deriveChangeset`); the patch comes
 * from `gitDiffPatch` in @tasks/git — single-rev (working tree vs base) in
 * the branch's worktree so uncommitted work is included. Issues without a
 * branch resolve to an empty source; the view asks for `tk work <id>`.
 */
import type { Issue } from "@tasks/domain";
import { readChangesetBase, readChangesetSnapshot } from "@tasks/surface";
import {
  bunRunner,
  gitDefaultBranch,
  gitDiffPatch,
  gitDirtyCount,
  gitMergeBase,
  gitToplevel,
  gitWorktreeList,
  type ProcessRunner,
} from "@tasks/git";
import { countHunkDiffStats, createHunkDiffFilesFromPatch, type HunkDiffFile } from "@tasks/review/opentui";
import { patchFileStats, type PatchFileStat } from "@tasks/review/taskview";

/** How the review decided where to diff, for the header line. */
export interface ReviewSource {
  readonly issueId: string;
  readonly branch: string | null;
  /** Where git ran: the branch's worktree root, else the workspace root. */
  readonly cwd: string;
  readonly base: string | null;
  readonly files: readonly HunkDiffFile[];
  readonly additions: number;
  readonly deletions: number;
  /** `no-branch`: the issue has no branch yet, so there is nothing to diff (D-01). */
  readonly empty: "no-branch" | null;
  /** Non-null means the review source is unusable; `files` stays empty. */
  readonly error: string | null;
  /** Per-file / per-hunk stats of the same patch (`patchFileStats`); `[]` for empty, error and no-branch sources. */
  readonly stats: readonly PatchFileStat[];
  /** The branch's matched worktree path; null when no worktree has the branch checked out. */
  readonly worktree: string | null;
  /** Uncommitted entries in the worktree (`gitDirtyCount`); null without a worktree or when git fails. */
  readonly dirty: number | null;
}

/** Object ids only — frozen metadata must never reach git as an option. */
const SHA = /^[0-9a-f]{7,64}$/;

/** Context lines per side when the reviewer expands context (`z`); git's default is 3. */
export const EXPANDED_CONTEXT_LINES = 25;

/** Per-resolve diff options: `contextLines` widens the patch's hunk context (undefined = git's default). */
export interface ResolveReviewOptions {
  readonly contextLines?: number;
}

/** Resolves the live review source for one issue, tolerating every failure as `error`. */
export const resolveReviewSource = async (
  issue: Issue,
  cwd: string,
  runner: ProcessRunner = bunRunner,
  options: ResolveReviewOptions = {},
): Promise<ReviewSource> => {
  const base = {
    issueId: issue.id,
    branch: issue.branch,
    files: [] as readonly HunkDiffFile[],
    additions: 0,
    deletions: 0,
    empty: null,
    stats: [] as readonly PatchFileStat[],
    worktree: null,
    dirty: null,
  };
  const pinned = readChangesetBase(issue.metadata)?.base ?? null;

  if (issue.branch === null || issue.branch === "") {
    // No branch yet: nothing to diff — never the workspace working tree (D-01).
    return { ...base, cwd, base: pinned, empty: "no-branch", error: null };
  }

  const worktrees = await gitWorktreeList(cwd, runner);
  const worktree = worktrees.find((entry) => entry.branch === issue.branch);
  if (worktree === undefined) {
    // Closed + pruned: no worktree left. Render the changeset frozen at close (base...head),
    // which stays reachable once merged — the web's /api/review fallback, mirrored (CHG-02, spec verify 8).
    const frozen = readChangesetSnapshot(issue.metadata);
    if (frozen !== null && SHA.test(frozen.base) && SHA.test(frozen.head)) {
      const patch = await gitDiffPatch(cwd, frozen.base, frozen.head, options.contextLines === undefined ? {} : { contextLines: options.contextLines }, runner);
      if (patch === null) return { ...base, cwd, base: frozen.base, error: `frozen snapshot ${frozen.head.slice(0, 12)} is no longer reachable; patch unavailable` };
      if (patch.trim() === "") return { ...base, cwd, base: frozen.base, error: null };
      return finish({ ...base, cwd, base: frozen.base }, patch);
    }
    return { ...base, cwd, base: pinned ?? "HEAD", error: `branch ${issue.branch} is not checked out (run \`tk work ${issue.id}\` first)` };
  }
  const worktreeRoot = await gitToplevel(worktree.path, runner) ?? worktree.path;
  const located = { ...base, worktree: worktree.path, dirty: await gitDirtyCount(worktreeRoot, runner) };

  const resolvedBase = pinned ?? await defaultMergeBase(cwd, issue.branch, runner);
  if (resolvedBase === null) {
    return { ...located, cwd: worktreeRoot, base: pinned ?? "HEAD", error: `base unpinned: no changeset record and no default branch for ${issue.branch}` };
  }
  const patch = (await gitDiffPatch(worktreeRoot, resolvedBase, null, options.contextLines === undefined ? {} : { contextLines: options.contextLines }, runner)) ?? "";
  if (patch.trim() === "") return { ...located, cwd: worktreeRoot, base: resolvedBase, error: null };
  return finish({ ...located, cwd: worktreeRoot, base: resolvedBase }, patch);
};

const defaultMergeBase = async (cwd: string, branch: string, runner: ProcessRunner): Promise<string | null> => {
  const defaultBranch = await gitDefaultBranch(cwd, runner);
  if (defaultBranch === null) return null;
  return gitMergeBase(cwd, branch, defaultBranch, runner);
};

const finish = (partial: Omit<ReviewSource, "files" | "additions" | "deletions" | "error" | "stats">, patch: string): ReviewSource => {
  const files = createHunkDiffFilesFromPatch(patch, partial.issueId);
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    const stats = countHunkDiffStats(file.metadata);
    additions += stats.additions;
    deletions += stats.deletions;
  }
  return { ...partial, files, additions, deletions, error: null, stats: patchFileStats(patch) };
};

/**
 * Anchors a hunk selection to a line number: the first line of the selected
 * hunk on the new side, parsed from the file's patch text. Null when the
 * hunk has no new-side lines (pure deletion) — threads still anchor by file.
 * Superseded for edit ranges by `hunkEditRange` in ./edit.ts (reads the
 * parsed metadata); kept for comment anchors.
 */
export const hunkAnchorLine = (file: HunkDiffFile, hunkIndex: number): number | null => {
  const starts: number[] = [];
  for (const raw of (file.patch ?? "").split("\n")) {
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (match !== null) starts.push(Number(match[1]));
  }
  const line = starts[hunkIndex];
  return line === undefined ? null : line;
};
