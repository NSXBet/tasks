/**
 * Worktree pruning engine (gw port): the safety checks `gw clean` runs, minus
 * the interactive prompt. Given one closed issue's recorded worktree, remove
 * the worktree and its `tk/<id>` branch only when the branch is fully merged
 * into its pinned base and both trees are clean. Every refusal is a reason
 * string, never a throw — pruning is always non-fatal to its caller.
 */
import { bunRunner, type ProcessRunner } from "./runner.js";
import { gitDefaultBranch } from "./commands.js";
import { gitBranchExists, gitHasUncommittedChanges, gitStashCount, gitWorktreeList, gitWorktreeRemove } from "./commands.js";
import { runShellHook } from "./hooks.js";

/** True when `branch` has no commits missing from `base` (patch-id check, so a
 *  branch merged via a merge commit counts even when `base` is a pinned SHA). */
export const gitIsMergedToBase = async (cwd: string, base: string, branch: string, runner: ProcessRunner = bunRunner): Promise<boolean> =>
  (await runner.run(["git", "cherry", base, branch], cwd)).stdout === "";

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
  /** Why pruning did not happen; undefined when it did. */
  readonly reason?: string;
}

/** True when the branch is merged into the base commit itself or into the
 *  current tip of the default branch that carries the pinned base — a base
 *  is pinned as a SHA at work time, so the line it sits on keeps moving. */
const mergedIntoBaseLine = async (mainRoot: string, base: string, branch: string, runner: ProcessRunner): Promise<boolean> => {
  const ancestor = (ref: string) => runner.run(["git", "merge-base", "--is-ancestor", branch, ref], mainRoot).then((r) => r.code === 0);
  if (await ancestor(base)) return true;
  const tip = await gitDefaultBranch(mainRoot, runner);
  if (tip === null) return false;
  const baseOnTip = (await runner.run(["git", "merge-base", "--is-ancestor", base, tip], mainRoot)).code === 0;
  return baseOnTip && await ancestor(tip);
};

export const pruneClosedWorktree = async (mainRoot: string, input: PruneInput, runner: ProcessRunner = bunRunner): Promise<PruneOutcome> => {
  const { path, branch, base } = input;
  if (base === null) return { pruned: false, removedWorktree: false, removedBranch: false, reason: "no pinned base to compare against" };
  // A missing branch means nothing is left to refuse or remove — already pruned.
  if (await gitBranchExists(mainRoot, branch, runner) && !(await mergedIntoBaseLine(mainRoot, base, branch, runner)))
    return { pruned: false, removedWorktree: false, removedBranch: false, reason: `branch ${branch} is not fully merged into ${base}` };

  const entries = await gitWorktreeList(mainRoot, runner);
  const entry = entries.find((candidate) => candidate.branch === branch || candidate.path === path);
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

  // Branch delete uses git's own safe delete (`-d`): only succeeds when merged.
  let removedBranch = false;
  if (input.dryRun === true) return { prunable: true, pruned: false, removedWorktree: false, removedBranch: false };
  if (await gitBranchExists(mainRoot, branch, runner)) {
    const deletion = await runner.run(["git", "branch", "-d", branch], mainRoot);
    removedBranch = deletion.code === 0;
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
