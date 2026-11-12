---
phase: 06-worktree-lifecycle-injection
plan: 01
subsystem: git / cli worktree lifecycle
tags: [git, worktree, prune, merge-detection, cli]

requires: []
provides:
  - "gitIsMergedToBase: single merge predicate (ancestry, default-tip line, patch-equivalence via git cherry)"
  - "PruneOutcome.alreadyPruned; force branch delete only after the predicate proved the merge"
  - "tk worktree remove merge guard (--force bypass)"
  - "tk close / duplicate / supersede / todo done human prune suffix"
  - "tk worktree clean single pass with --dry-run/--yes and persisted metadata.worktreePruned"
affects: [06-02, 06-03, tk worktree, tk close]

actuals:
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "One merge predicate shared by every removal path"

key-files:
  created: []
  modified:
    - packages/git/src/prune.ts
    - packages/git/test/prune.test.ts
    - packages/cli/src/tk.ts
    - packages/cli/test/work.test.ts
    - docs/src/content/docs/overview.md

key-decisions:
  - "alreadyPruned check runs before the null-base check, so a task whose worktree and branch are gone is skipped by clean even without a pinned base"
  - "tk worktree remove: the pre-existing 'unpushed commits' problem (which fires whenever no upstream is configured) is reported only while the branch is unmerged — commits merged into the default branch cannot be lost"
  - "Prune suffix applied to close, duplicate, supersede and todo done human lines; 'already pruned' renders as '— worktree already pruned'"

requirements-completed: [LC-01, LC-02, LC-03]

coverage:
  - id: D1
    description: "gitIsMergedToBase accepts rebase/cherry-pick merges, follows the default tip for pinned SHAs, rejects partial merges"
    requirement: LC-01
    verification:
      - kind: unit
        ref: "packages/git/test/prune.test.ts#gitIsMergedToBase"
        status: pass
  - id: D2
    description: "pruneClosedWorktree prunes rebase-merged branches and reports alreadyPruned"
    requirement: LC-01
    verification:
      - kind: unit
        ref: "packages/git/test/prune.test.ts#pruneClosedWorktree"
        status: pass
  - id: D3
    description: "tk worktree remove refuses unmerged worktrees without --force"
    requirement: LC-01
    verification:
      - kind: e2e
        ref: "packages/cli/test/work.test.ts#tk worktree remove merge guard"
        status: pass
  - id: D4
    description: "tk close prunes merged/rebase-merged worktrees, keeps the frozen changeset, prints pruned/kept"
    requirement: LC-02
    verification:
      - kind: e2e
        ref: "packages/cli/test/work.test.ts#worktree lifecycle (gw port)"
        status: pass
  - id: D5
    description: "tk worktree clean dry-run/--dry-run/--yes semantics with persisted record, pre_end once per removal"
    requirement: LC-03
    verification:
      - kind: e2e
        ref: "packages/cli/test/work.test.ts#tk worktree clean lifecycle"
        status: pass
  - id: D6
    description: "Scratch-repo probe of the full close/clean lifecycle"
    verification:
      - kind: manual_procedural
        ref: "bash scratchpad/probe.sh (session scratchpad)"
        status: pass
---

# Phase 6 Plan 01: Merge-aware worktree lifecycle — Summary

Merge-aware worktree removal now runs through one predicate everywhere, `tk close` says what happened to the worktree, and `tk worktree clean` lists and removes each worktree once.

**Commits withheld per AGENTS.md** (conservative profile: no git commit/push). All changes are uncommitted in the main tree.

## Accomplishments

### Task 1 — One merge predicate (LC-01)
- `packages/git/src/prune.ts`: `gitIsMergedToBase(cwd, base, branch, runner)` now returns true if any rule holds: (1) the branch is an ancestor of base; (2) base is an ancestor of the default-branch tip and the branch is an ancestor of that tip; (3) `git cherry <line> <branch>` exits 0 with no `+` line against base (and against the tip when (2)'s base-on-tip held). Any git error fails that rule. The private `mergedIntoBaseLine` is gone; `pruneClosedWorktree` calls the predicate.
- `PruneOutcome.alreadyPruned`: when neither the branch nor the worktree exists, `pruneClosedWorktree` returns `{ pruned:false, prunable:false, alreadyPruned:true, reason:"already pruned" }` before any dry-run return.
- Branch delete: tries `-d`, then `-D` via `gitDeleteBranch(..., true)`. The `-D` path runs only when `mergeProven` (the predicate's result for this exact branch) is true.
- Tests: a `cherryPicked(partial)` fixture, plus cases for rebase-merge true, pinned-SHA default-tip line, partial merge false, rebase-merged prune removing the branch, and already-pruned (dry and non-dry). The old idempotency test checked `reason === undefined`; it now checks `alreadyPruned`/`"already pruned"`, because the plan changed that contract.
- CLI e2e: close prunes a cherry-picked worktree and branch. The merged-close test now commits a real file and checks that `tk show --json` still has `changeset.base`, non-empty `commits`, and the file in `files` after the prune.

### Task 2 — remove guard + close output (LC-01, LC-02)
- `tk worktree remove` without `--force` resolves the base as `gitDefaultBranch(mainRoot) ?? gitCurrentBranch(mainRoot)`. It runs `gitIsMergedToBase(target.path, base, target.branch ?? "HEAD")` and refuses with `branch <b> is not merged into <base>` (or `cannot verify merge: no default branch`) plus the existing `— use --force to override`.
- Local helper `pruneSuffix(issue)` in tk.ts appends `— worktree pruned` / `— worktree kept: <reason>` / `— worktree already pruned` to the human lines of close, duplicate, supersede, and todo done. JSON shapes are unchanged.

### Task 3 — `tk worktree clean` (LC-03)
- `--dry-run --yes` fails with `--dry-run and --yes are mutually exclusive`. The candidate pass is always a dry run and skips `alreadyPruned`.
- `--yes` runs one `store.transact` per eligible task, calling `pruneIssueWorktree` on a fresh read. This persists `metadata.worktreePruned`. A non-pruned record (such as a pre_end veto) moves the task to `refused`. The old second prune loop is deleted.
- Help text updated. `docs/src/content/docs/overview.md` `### Task worktrees` gained bullets on merge-aware removal, auto-prune on close, clean semantics, and the preEnd veto. The hooks bullet is left for 06-02.

## Deviations from Plan

1. **[Rule 1 — bug blocking a must-have] Unpushed check in `tk worktree remove`.** `gitHasUnpushedCommits` returns true whenever no upstream is set. That made every local worktree unremovable without `--force`, which contradicts "a merged, clean worktree is removed" and the fresh-worktree case. Fix: "unpushed commits" counts as a problem only while the branch is unmerged. Dirty and stash checks are unchanged.
2. **alreadyPruned ordering.** The already-pruned short-circuit runs before the `base === null` refusal, not just before the dry-run return. Otherwise a gone worktree with no pinned base would be listed under clean's `refused` forever.
3. **Test timeouts.** Two new multi-spawn CLI tests got explicit timeouts (60s, 120s); the 5s default timed out.
4. Test helper `mergeTaskBranch` now passes `-c user.name/-c user.email`, because non-ff merges create a merge commit.

## Verification (all run, all green)

- `bun test packages/git/test/prune.test.ts packages/surface/test/prune.test.ts packages/cli/test/work.test.ts packages/cli/test/tk.test.ts` → 93 pass, 0 fail (`prune.test.ts` alone: 13 pass; `work.test.ts`: 19 pass).
- `cd packages/git && bunx tsc --noEmit -p tsconfig.json` → exit 0.
- `cd packages/cli && bunx tsc --noEmit -p tsconfig.json` → exit 0.
- `cd docs && bun run build` → Complete.
- Scratch-repo probe (session scratchpad, not the repo):
  - Task 1 was cherry-picked onto main after another main commit. `tk close` printed `✓ Closed tk-xjy — x — worktree pruned`. `.worktrees` was empty, there were no `tk/*` branches, and `tk show --json` gave `commits 1 files [f.txt A]`.
  - Task 2 was unmerged. `tk close` printed `— worktree kept: branch tk/tk-gsi is not fully merged into <sha>`, and `tk worktree clean` listed it as kept.
  - After `git merge`, `clean --dry-run` showed 1 eligible and `clean --yes` printed `✓ pruned tk-gsi`. A final `clean` showed 0 eligible, with no worktrees or branches left.

## Notes for concurrent work
- tk.ts edits are limited to the `@tasks/git` import line (added `gitIsMergedToBase`), the `runWorktree` remove/clean branches, the `worktree clean` help line, the new `pruneSuffix` helper (above `get`), and the human-output lambdas for close/duplicate/supersede/todo done. The finish path, args, and presentation.ts were not touched.
- `packages/git/src/index.ts` is unchanged (prune.ts was already re-exported). `packages/git/src/commands.ts` is unchanged.
