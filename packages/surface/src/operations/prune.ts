/**
 * Worktree auto-prune on close (step 11, gw port): when an issue with a
 * recorded worktree transitions to `closed`, its worktree and `tk/<id>`
 * branch are pruned at the same close that freezes the terminal changeset.
 * Safety checks first, removal second; a refusal is reported in
 * `metadata.worktreePruned` and never fails the close itself.
 */
import { mainWorktreeRoot, gitCommonDir, pruneClosedWorktree, bunRunner, type ProcessRunner, type PruneOutcome } from "@tasks/git";
import { readWorkspaceConfig } from "@tasks/workspace";
import type { Issue } from "@tasks/domain";
import type { IssueUnitOfWork } from "@tasks/application";

/** Recorded worktree keys written by `tk work`: `metadata.worktree` (path), `issue.branch`, `metadata.changeset.base`. */
const worktreeKeys = (issue: Issue): { path: string; branch: string; base: string | null } | null => {
  const path = issue.metadata['worktree'];
  if (typeof path !== 'string' || path === '' || issue.branch === null || issue.branch === '') return null;
  const changeset = issue.metadata['changeset'];
  const base = changeset !== null && typeof changeset === 'object' && !Array.isArray(changeset) ? (changeset as Record<string, unknown>)['base'] : null;
  return { path, branch: issue.branch, base: typeof base === 'string' && base !== '' ? base : null };
};

export type PruneRecord = {
  readonly pruned: boolean;
  readonly removedWorktree: boolean;
  readonly removedBranch: boolean;
  readonly reason?: string;
}

/**
 * Prunes one issue's recorded worktree, persists `metadata.worktreePruned`,
 * and returns the outcome. No-op (null) for issues without a worktree. Never
 * throws for git failures — the outcome record carries the refusal reason.
 */
export const pruneIssueWorktree = async (ctx: { readonly root: string; readonly tasksDir: string }, uow: IssueUnitOfWork, issue: Issue, runner: ProcessRunner = bunRunner): Promise<PruneRecord | null> => {
  const recorded = worktreeKeys(issue);
  if (recorded === null) return null;
  const commonDir = await gitCommonDir(ctx.root, runner);
  const mainRoot = commonDir === null ? ctx.root : mainWorktreeRoot(commonDir);
  const config = await readWorkspaceConfig(ctx.tasksDir).catch(() => null);
  let outcome: PruneOutcome;
  try {
    outcome = await pruneClosedWorktree(mainRoot, {
      path: recorded.path,
      branch: recorded.branch,
      base: recorded.base,
      ...(config?.worktree?.preEnd !== undefined ? { preEnd: config.worktree.preEnd } : {}),
    }, runner);
  } catch (cause) {
    outcome = { pruned: false, removedWorktree: false, removedBranch: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
  const record: PruneRecord = {
    pruned: outcome.pruned,
    removedWorktree: outcome.removedWorktree,
    removedBranch: outcome.removedBranch,
    ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
  };
  const saved = await uow.save({ ...issue, metadata: { ...issue.metadata, worktreePruned: record }, updatedAt: new Date() });
  if (!saved.ok) throw new Error('worktree prune record save failed');
  return record;
};
