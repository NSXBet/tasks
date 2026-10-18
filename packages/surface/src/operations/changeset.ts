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
import type { Issue, JsonValue, Metadata } from '@tasks/domain';
import type { IssueUnitOfWork } from '@tasks/application';
import { bunRunner, gitBranchHead, gitDiffNameStatus, gitDiffNumstat, gitLogOneline, type ProcessRunner } from "@tasks/git";

export interface ChangesetCommit {
  readonly [key: string]: JsonValue;
  readonly sha: string;
  readonly subject: string;
}

export interface ChangesetFile {
  readonly [key: string]: JsonValue;
  readonly path: string;
  readonly status: string;
}

export interface ChangesetCounts {
  readonly [key: string]: JsonValue;
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

/* ------------------------------------------------------------------ */
/* Terminal snapshot freeze (CHG-02): close freezes exactly once.      */
/* ------------------------------------------------------------------ */

export interface ChangesetFrozen extends ChangesetPayload {
  readonly [key: string]: JsonValue;
  readonly base: string;
  readonly head: string;
}

/** Narrowing read over the stored `changeset` metadata (CHG-01's wireChangesetBase style): all of base+head+commits+files+counts present means frozen; head absent means not yet frozen. */
export const readChangesetSnapshot = (metadata: Metadata): ChangesetFrozen | null => {
  const raw = metadata["changeset"];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const base = record["base"];
  const head = record["head"];
  if (typeof base !== "string" || base === "" || typeof head !== "string" || head === "") return null;
  const commits = record["commits"];
  const files = record["files"];
  const counts = record["counts"];
  if (!Array.isArray(commits) || !Array.isArray(files) || counts === null || typeof counts !== "object" || Array.isArray(counts)) return null;
  return { base, head, commits: commits as ChangesetPayload["commits"], files: files as ChangesetPayload["files"], counts: counts as ChangesetCounts };
};

/** Reads the live-only changeset record (base, optionally head) from metadata; null when absent or base-less. */
export const readChangesetBase = (metadata: Metadata): { readonly base: string; readonly head: string | null } | null => {
  const raw = metadata["changeset"];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record["base"] !== "string" || record["base"] === "") return null;
  return {
    base: record["base"],
    head: typeof record["head"] === "string" && record["head"] !== "" ? record["head"] : null,
  };
};

/**
 * Freeze (CHG-02): fires only when the caller is committing a transition TO
 * `closed` (refuses otherwise). Inside the caller's open transaction, derive
 * the changeset live and return the full tuple `{base, head, commits, files,
 * counts}` — the head is the branch's actual tip at freeze time, every value
 * derives from git output, never caller input (D-05). The helper NEVER saves:
 * callers merge the tuple into their single save as `metadata["changeset"]`
 * (one save per close, no double-write).
 *
 * Returns null (nothing to freeze — close proceeds) when: next status is not
 * closed; a snapshot is already frozen (exactly-once guard — never re-freeze);
 * the branch or base is missing; or derivation fails. Branch-less records
 * derive null, so there is nothing to freeze by construction.
 */
export const freezeChangesetUow = async (
  uow: IssueUnitOfWork,
  ctx: { readonly cwd: string },
  issue: Issue,
  nextStatus: string,
  runner: ProcessRunner = bunRunner,
): Promise<ChangesetFrozen | null> => {
  if (nextStatus !== "closed") return null;
  if (readChangesetSnapshot(issue.metadata) !== null) return null;
  if (issue.branch === null || issue.branch === "") return null;
  const record = readChangesetBase(issue.metadata);
  if (record === null) return null;
  const payload = await deriveChangeset(ctx, record.base, issue.branch, runner);
  if (payload === null) return null;
  const head = await gitBranchHead(ctx.cwd, issue.branch, runner);
  if (head === null) return null;
  return { base: record.base, head, ...payload };
};
