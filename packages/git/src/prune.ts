/**
 * Worktree pruning engine (gw port): the safety checks `gw clean` runs, minus
 * the interactive prompt. Given one closed issue's recorded worktree, remove
 * the worktree and its `tk/<id>` branch only when the branch is fully merged
 * into its pinned base and both trees are clean. Every refusal is a reason
 * string, never a throw — pruning is always non-fatal to its caller.
 */
import { bunRunner, type ProcessRunner } from "./runner.js";
import { gitBranchExists, gitDefaultBranch, gitDeleteBranch, gitHasUncommittedChanges, gitStashCount, gitWorktreeList, gitWorktreeRemove } from "./commands.js";
import { runShellHook } from "./hooks.js";

/**
 * The one merge predicate every removal path shares (`tk worktree remove`,
 * close/duplicate/supersede/todo-done auto-prune, `tk worktree clean`). True
 * when any of these holds:
 *  1. ancestry — `branch` is an ancestor of `base`;
 *  2. default-tip line — `base` sits on the default branch's tip (a base is
 *     pinned as a SHA at work time, so its line keeps moving) and `branch` is
 *     an ancestor of that tip;
 *  3. patch-equivalence — `git cherry <line> <branch>` against `base` (and the
 *     tip, when rule 2's base-on-tip held) reports no `+` line, i.e. every
 *     commit landed via rebase or cherry-pick.
 * Any git failure counts as "not proven merged" for that rule.
 */
export const gitIsMergedToBase = async (cwd: string, base: string, branch: string, runner: ProcessRunner = bunRunner): Promise<boolean> => {
  const isAncestor = async (ancestor: string, descendant: string): Promise<boolean> =>
    (await runner.run(["git", "merge-base", "--is-ancestor", ancestor, descendant], cwd)).code === 0;
  if (await isAncestor(branch, base)) return true;
  const tip = await gitDefaultBranch(cwd, runner);
  const baseOnTip = tip !== null && await isAncestor(base, tip);
  if (baseOnTip && await isAncestor(branch, tip)) return true;
  const lines = baseOnTip ? [base, tip] : [base];
  for (const line of lines) {
    const cherry = await runner.run(["git", "cherry", line, branch], cwd);
    if (cherry.code === 0 && !cherry.stdout.split("\n").some((row) => row.startsWith("+"))) return true;
  }
  return false;
};

export interface PruneInput {
  readonly path: string;
  readonly branch: string;
  /** Pinned integration base; pruning refuses without one. */
  readonly base: string | null;
  /** Optional shell hook run from the worktree just before removal. */
  readonly preEnd?: string;
  /** Report eligibility without removing anything (`tk worktree clean` default). */
  readonly dryRun?: boolean;
}

export interface PruneOutcome {
  /** True when pruning is safe; true in dry-run mode without removing. */
  readonly prunable?: boolean;
  /** True when at least one of the worktree or the branch was removed. */
  readonly pruned: boolean;
  readonly removedWorktree: boolean;
  readonly removedBranch: boolean;
  /** True when neither the worktree nor the branch exists any more. */
  readonly alreadyPruned?: boolean;
  /** Why pruning did not happen; undefined when it did. */
  readonly reason?: string;
}

export const pruneClosedWorktree = async (mainRoot: string, input: PruneInput, runner: ProcessRunner = bunRunner): Promise<PruneOutcome> => {
  const { path, branch, base } = input;
  const branchPresent = await gitBranchExists(mainRoot, branch, runner);
  const entries = await gitWorktreeList(mainRoot, runner);
  const entry = entries.find((candidate) => candidate.branch === branch || candidate.path === path);
  // Nothing left to refuse or remove: report it so `tk worktree clean` skips it.
  if (!branchPresent && entry === undefined)
    return { pruned: false, prunable: false, alreadyPruned: true, removedWorktree: false, removedBranch: false, reason: "already pruned" };
  if (base === null) return { pruned: false, removedWorktree: false, removedBranch: false, reason: "no pinned base to compare against" };
  // The single merge predicate; a force branch delete below is reachable only
  // after it returned true for this exact branch.
  const mergeProven = branchPresent && await gitIsMergedToBase(mainRoot, base, branch, runner);
  if (branchPresent && !mergeProven)
    return { pruned: false, removedWorktree: false, removedBranch: false, reason: `branch ${branch} is not fully merged into ${base}` };

  let removedWorktree = false;
  if (entry !== undefined) {
    if (await gitHasUncommittedChanges(entry.path, runner))
      return { pruned: false, removedWorktree, removedBranch: false, reason: "worktree has uncommitted changes" };
    if ((await gitStashCount(entry.path, runner)) > 0)
      return { pruned: false, removedWorktree: false, removedBranch: false, reason: "worktree has stashed changes" };
    if (input.dryRun === true) return { prunable: true, pruned: false, removedWorktree: false, removedBranch: false };
    const hook = await runShellHook(input.preEnd, entry.path, runner);
    if (!hook.ok) return { pruned: false, removedWorktree, removedBranch: false, reason: `pre_end hook failed: ${hook.stderr}` };
    const removal = await gitWorktreeRemove(mainRoot, entry.path, false, runner);
    if (!removal.ok) return { pruned: false, removedWorktree, removedBranch: false, reason: `worktree remove failed: ${removal.stderr}` };
    removedWorktree = true;
  }

  let removedBranch = false;
  if (input.dryRun === true) return { prunable: true, pruned: false, removedWorktree: false, removedBranch: false };
  if (mergeProven && await gitBranchExists(mainRoot, branch, runner)) {
    // git's safe delete checks against the main checkout's HEAD — the wrong
    // reference when that checkout sits elsewhere or the merge was a rebase.
    // The predicate above already proved the merge, so fall back to `-D`.
    let deletion = await gitDeleteBranch(mainRoot, branch, false, runner);
    if (!deletion.ok) deletion = await gitDeleteBranch(mainRoot, branch, true, runner);
    removedBranch = deletion.ok;
    if (!removedBranch) {
      return {
        pruned: removedWorktree,
        removedWorktree,
        removedBranch,
        reason: removedWorktree ? `branch ${branch} kept: ${deletion.stderr}` : `branch delete failed: ${deletion.stderr}`,
      };
    }
  }
  return { pruned: removedWorktree || removedBranch, removedWorktree, removedBranch };
};
