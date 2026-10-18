/**
 * Lazy changeset derivation (CHG-01): reads the branch record live, never
 * caches, and never writes to metadata. Scoped to `tk show` (D-03).
 *
 * Command reconciliation (D-01/D-02), verbatim from the plan:
 * - Commits use a TWO-DOT range `git log --oneline base..branch` — every
 *   commit on the branch not on the base, ordered newest-first by git.
 * - Files and counts use the THREE-DOT merge-base form
 *   `git diff --numstat base...branch` — only commits the branch actually
 *   owns, so changes already present in base are never double-counted.
 * - The two are reconciled in the operation's doc comment, not silently:
 *   `base` is the pinned value captured at `tk work` (which may be a merge
 *   base or an exact pin). If it is already a merge base, two- and three-dot
 *   agree exactly. If it is a hard pin (e.g. pinned against a moving default
 *   branch), the diff three-dot form re-derives the merge base at read time
 *   and therefore stays stable for base-pinned stability even as the
 *   integration branch advances, while the log two-dot form may surface
 *   commits the integration branch has since gained. Derivation trusts the
 *   diff form for payload completeness; log stays two-dot for the D-01
 *   literal contract so the PR record lists exactly what the branch claims.
 */
import { bunRunner, gitDiffNameStatus, gitDiffNumstat, gitLogOneline, type ProcessRunner } from "@tasks/git";

export interface ChangesetCommit {
  readonly sha: string;
  readonly subject: string;
}

export interface ChangesetFile {
  readonly path: string;
  readonly status: string;
}

export interface ChangesetCounts {
  readonly additions: number;
  readonly deletions: number;
}

export interface ChangesetPayload {
  readonly commits: readonly ChangesetCommit[];
  readonly files: readonly ChangesetFile[];
  readonly counts: ChangesetCounts;
}

/**
 * Derives commits, files, and counts for `branch` against the pinned `base`,
 * re-run on every call (D-01): no memoization, no metadata read-back other
 * than the base/branch the caller supplies. Returns null when the inputs are
 * empty or any git command fails (e.g. deleted branch decay, missing base).
 */
export async function deriveChangeset(
  context: { readonly cwd: string },
  base: string,
  branch: string,
  runner: ProcessRunner = bunRunner,
): Promise<ChangesetPayload | null> {
  if (base === "" || branch === "") return null;
  const cwd = context.cwd;
  const [log, numstat, nameStatus] = await Promise.all([
    gitLogOneline(cwd, base, branch, runner),
    gitDiffNumstat(cwd, base, branch, runner),
    gitDiffNameStatus(cwd, base, branch, runner),
  ]);
  if (log === null || numstat === null || nameStatus === null) return null;
  const counts = {
    additions: numstat.reduce((sum, entry) => sum + entry.additions, 0),
    deletions: numstat.reduce((sum, entry) => sum + entry.deletions, 0),
  };
  return {
    commits: log.map((entry) => ({ sha: entry.sha, subject: entry.subject })),
    files: nameStatus.map((entry) => ({ path: entry.path, status: entry.status })),
    counts,
  };
}
