/**
 * Live review source: resolves an issue's branch, base, and unified patch
 * into the vendored Hunk diff model — no fixtures. The base is the issue's
 * pinned changeset record when present, else the merge-base against the
 * default branch (three-dot parity with `deriveChangeset`); the patch is a
 * single-rev `git diff <base>` in the branch's worktree so uncommitted work
 * is included. Issues without a branch fall back to the working-tree diff
 * (`git diff HEAD`) of the workspace itself.
 */
import type { Issue } from "@tasks/domain";
import { readChangesetBase } from "@tasks/surface";
import {
  bunRunner,
  gitDefaultBranch,
  gitMergeBase,
  gitToplevel,
  gitWorktreeList,
  type ProcessRunner,
} from "@tasks/git";
import { countHunkDiffStats, createHunkDiffFilesFromPatch, type HunkDiffFile } from "@tasks/review/opentui";

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
  /** Non-null means the review source is unusable; `files` stays empty. */
  readonly error: string | null;
}

const runGitDiff = async (cwd: string, range: readonly string[], runner: ProcessRunner): Promise<string> => {
  const result = await runner.run(["git", "diff", ...range], cwd);
  return result.code === 0 ? result.stdout : "";
};

/** Resolves the live review source for one issue, tolerating every failure as `error`. */
export const resolveReviewSource = async (
  issue: Issue,
  cwd: string,
  runner: ProcessRunner = bunRunner,
): Promise<ReviewSource> => {
  const base = {
    issueId: issue.id,
    branch: issue.branch,
    files: [] as readonly HunkDiffFile[],
    additions: 0,
    deletions: 0,
  };
  const pinned = readChangesetBase(issue.metadata)?.base ?? null;

  if (issue.branch === null || issue.branch === "") {
    // No branch yet: review the working tree as-is.
    const patch = await runGitDiff(cwd, ["HEAD"], runner);
    if (patch.trim() === "") return { ...base, cwd, base: pinned ?? "HEAD", error: null };
    return finish({ ...base, cwd, base: pinned ?? "HEAD" }, patch);
  }

  const worktrees = await gitWorktreeList(cwd, runner);
  const worktree = worktrees.find((entry) => entry.branch === issue.branch);
  if (worktree === undefined) {
    return { ...base, cwd, base: pinned ?? "HEAD", error: `branch ${issue.branch} is not checked out (run \`tk work ${issue.id}\` first)` };
  }
  const worktreeRoot = await gitToplevel(worktree.path, runner) ?? worktree.path;

  const resolvedBase = pinned ?? await defaultMergeBase(cwd, issue.branch, runner);
  if (resolvedBase === null) {
    return { ...base, cwd: worktreeRoot, base: pinned ?? "HEAD", error: `base unpinned: no changeset record and no default branch for ${issue.branch}` };
  }
  const patch = await runGitDiff(worktreeRoot, [resolvedBase], runner);
  if (patch.trim() === "") return { ...base, cwd: worktreeRoot, base: resolvedBase, error: null };
  return finish({ ...base, cwd: worktreeRoot, base: resolvedBase }, patch);
};

const defaultMergeBase = async (cwd: string, branch: string, runner: ProcessRunner): Promise<string | null> => {
  const defaultBranch = await gitDefaultBranch(cwd, runner);
  if (defaultBranch === null) return null;
  return gitMergeBase(cwd, branch, defaultBranch, runner);
};

const finish = (partial: Omit<ReviewSource, "files" | "additions" | "deletions" | "error">, patch: string): ReviewSource => {
  const files = createHunkDiffFilesFromPatch(patch, partial.issueId);
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    const stats = countHunkDiffStats(file.metadata);
    additions += stats.additions;
    deletions += stats.deletions;
  }
  return { ...partial, files, additions, deletions, error: null };
};

/**
 * Anchors a hunk selection to a line number: the first line of the selected
 * hunk on the new side, parsed from the file's patch text. Null when the
 * hunk has no new-side lines (pure deletion) — threads still anchor by file.
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
