---
phase: 01-git-adapter-worktree-entry
verified: 2026-11-10T17:40:00Z
status: passed
score: 9/9 must-haves verified
covered_files: [
  ".planning/phases/01-git-adapter-worktree-entry/01-01-PLAN.md",
  ".planning/phases/01-git-adapter-worktree-entry/01-01-SUMMARY.md",
  ".planning/phases/01-git-adapter-worktree-entry/01-02-PLAN.md",
  ".planning/phases/01-git-adapter-worktree-entry/01-02-SUMMARY.md",
  ".planning/phases/01-git-adapter-worktree-entry/01-03-PLAN.md",
  ".planning/phases/01-git-adapter-worktree-entry/01-03-SUMMARY.md",
  ".planning/phases/01-git-adapter-worktree-entry/01-04-PLAN.md",
  ".planning/phases/01-git-adapter-worktree-entry/01-04-SUMMARY.md",
  "packages/cli/src/hooks.ts",
  "packages/cli/src/presentation.ts",
  "packages/cli/src/tk.ts",
  "packages/cli/test/tk.test.ts",
  "packages/cli/test/work.test.ts",
  "packages/git/src/commands.ts",
  "packages/git/src/hooks.ts",
  "packages/git/src/index.ts",
  "packages/git/src/porcelain.ts",
  "packages/git/src/resolver.ts",
  "packages/git/src/runner.ts",
  "packages/git/src/sync.ts",
  "packages/git/test/adapter.test.ts",
  "packages/git/test/concurrency.test.ts",
  "packages/git/test/porcelain.test.ts",
  "packages/git/test/resolver.test.ts",
  "packages/git/test/runner.test.ts",
  "packages/git/test/sync.test.ts",
  "packages/surface/src/discover.ts"
]
covered_digest: "v3:sha256:064c5c336011a748818408bfa0cbdf26938d7f3ef03c5c373d896248d5e49999"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 7/9
  gaps_closed:
    - "SC2/GIT-02: the contract text now states the in-repo `.worktrees/` default (user decision 2026-11-10). `tk worktree create` resolves against mainRoot, so nothing nests. The default pool is auto-excluded through info/exclude, and the hook argument order is fixed."
    - "SC3/GIT-01: packages/surface/src/git.ts is deleted, and discover.ts uses @tasks/git. hooks.ts has no git spawns and goes through the @tasks/git sync commands."
  gaps_remaining: []
  regressions: []
advisory:
  - finding: "packages/web/src/review.ts:85,90,115 and packages/tui/src/review/source.ts:37 build `git diff` argv inline and run it through the @tasks/git runner (bunRunner). They are not enumerated adapter commands. They do go through the one runner, so they are not scattered subprocess calls."
    category: architectural
    reason: "This is new scope: Phase 3/5 review code, not part of the previous gaps. A concurrent executor is adding `gitDiffPatch` to packages/git/src/commands.ts to fold these call sites. That fold resolves this finding."
    evidence_status: "none provided (no failing test; in-flight fold)"
---

# Phase 1: Git Adapter & Worktree Entry Verification Report

**Phase Goal:** The PR container exists. Every task can get a worktree on its own branch, and all git access flows through one typed adapter.
**Verified:** 2026-11-10T17:40:00Z
**Status:** passed
**Re-verification:** Yes. This run follows gap closure (plans 01-03 and 01-04). The previous result was gaps_found at 7/9. The two previous gaps were re-checked in full against the uncommitted working tree. The seven truths that passed before got a regression check.
**Mode note:** ROADMAP marks the phase `mvp`, but the goal is not a User Story. Standard goal-backward verification was used against the three ROADMAP SCs, the cross-cutting constraints, and the PLAN must-haves.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1 / GIT-03: `tk work <id>` creates a worktree on `tk/<id>`, it appears in `git worktree list`, and the base SHA, path and branch are recorded. `tk show` renders BRANCH/BASE/WORKTREE. | ✓ VERIFIED | Scratch probe: `tk work tk-txx --json` returned `branch tk/tk-txx`, a 40-hex base and `created:true`. `git worktree list` shows `.worktrees/repo-tk-txx [tk/tk-txx]`. `tk show` prints the BRANCH, BASE and WORKTREE lines. `work.test.ts` passes. |
| 2 | SC2 / GIT-02: placement comes from one resolver. The default is in-repo `<repoRoot>/.worktrees/<repoName>-<id>` (auto-ignored), overridden by `worktree.dir` config or per-task metadata. The same resolver serves `tk worktree create`. | ✓ VERIFIED | `resolver.ts:47` default is `.worktrees/<name>`, matching the updated ROADMAP SC2 and REQUIREMENTS GIT-02. Both consumers call it with `repoRoot: mainRoot` (`tk.ts:235`, `tk.ts:715`). `grep "repoRoot: start"` finds nothing. Probe: `tk worktree create zz` run from inside a task worktree landed at `<repo>/.worktrees/zz` (OK no-nest). `ensureWorktreePoolIgnored` (`commands.ts:127-146`) runs before the add whenever `source === "default"` (`tk.ts:238-241`, `tk.ts:732-735`). Probe: `.git/info/exclude` holds `/.worktrees/` exactly once, no `.gitignore` was created, and `git status` lists no `.worktrees`. |
| 3 | SC3 / GIT-01: every git call goes through the typed adapter, with no scattered git subprocess calls. The inline runWorktree path logic is deleted. | ✓ VERIFIED | `packages/surface/src/git.ts` is absent, and `discover.ts:4` imports `gitCommonDir`/`mainWorktreeRoot` from `@tasks/git`. `hooks.ts:19` imports the sync commands. Its only remaining `spawnSync` calls (:593 chained hook, :648 runTk) do not invoke git. Repo-wide grep: every `"git"` argv in non-test `src` is inside `packages/git/src`, except the review diff call sites in web and tui. Those still run through the `@tasks/git` runner (see Advisory). `runner.ts` is the only module that spawns git. The node probe against `packages/git/dist` printed `node ok …/.git`, so `rootFrom` works in the pi host. |
| 4 | Porcelain parsing maps 1:1: one record per entry, never merged | ✓ VERIFIED (regression) | `porcelain.test.ts` passes |
| 5 | Empty porcelain input returns `[]` | ✓ VERIFIED (regression) | `porcelain.test.ts` passes |
| 6 | Order is preserved and the adapter does not sort | ✓ VERIFIED (regression) | `porcelain.test.ts` passes |
| 7 | The resolver is pure and does no I/O; races surface as git's own error | ✓ VERIFIED | `resolver.ts` imports only `node:path`. The exclude write lives in `commands.ts`, not in the resolver. `concurrency.test.ts` and `resolver.test.ts` pass. In the probe, an occupied placement made the command fail with git's `already exists`. |
| 8 | Re-running `tk work` re-enters and never rewrites the pinned base | ✓ VERIFIED (regression) | The `work.test.ts` re-entry scenario passes |
| 9 | Prohibitions: evidence is git-derived only, failures are surfaced and never masked, and only `changeset.base` is pinned | ✓ VERIFIED | WR-04 rollback (`tk.ts:736-744`) fails with the original stderr and appends the rollback error only when the rollback itself failed. Probe: the occupied placement left no `tk/<id>` behind (OK no orphan branch), and a pre-existing `tk/<id>` survived (OK pre-existing branch kept). |

**Score:** 9/9 truths verified (0 present, behavior-unverified)

#### Gap-closure must-haves (01-03 / 01-04)

| Must-have | Status | Evidence |
|-----------|--------|----------|
| `tk worktree create` from a linked worktree goes to `<mainRoot>/.worktrees/<name>` | ✓ | probe OK no-nest; tk.test.ts no-nest test |
| `tk worktree create` hooks run with `(command, cwd)` and exit 0 | ✓ | `tk.ts:247,249` `runShellHook(postStart, path)`; probe `HOOK_RAN` present in `.worktrees/zz`; `grep "runShellHook(path"` finds nothing |
| `/.worktrees/` is added once to info/exclude, never to `.gitignore`, and skipped when already ignored | ✓ | probe count = 1, no `.gitignore`; `commands.ts:128` check-ignore short-circuit; work.test.ts committed-.gitignore case |
| WR-01: detached HEAD gives null | ✓ | `commands.ts:25-28`; probe `tk worktree info` shows `Branch: (detached)` |
| WR-02: `$`-patterns in names stay literal | ✓ | `resolver.ts` `expand()` uses function replacement; resolver.test.ts passes |
| WR-04: rollback deletes only a branch this run created, using `-d` | ✓ | probe and work.test.ts |
| surface/git.ts deleted; discover.ts on `@tasks/git` | ✓ | `ls` fails; `discover.ts:4` |
| Default runner is portable to node | ✓ | `runner.ts` falls back to `bunRunner` → `nodeRunner` when `Bun` is absent; node dist probe passed |
| hooks.ts has no `spawnSync("git"` | ✓ | grep finds nothing; uses `gitConfig*Sync` / `gitIsTrackedSync` / `gitDiffCachedNamesSync` / `gitAddSync` |
| Hook env semantics are preserved | ✓ | `hooks.ts:687`, the staged-deletion check, inherits the env; `:694` and `gitAddFile` (`:728`) pass the scrubbed env; hooks.test.ts passes |

### Advisory (New Scope, Unevidenced)

| # | Finding | Category | Why Advisory |
|---|---------|----------|--------------|
| 1 | `web/src/review.ts:85,90,115` and `tui/src/review/source.ts:37` build `git diff` argv inline. They use the adapter runner but not an enumerated command. | architectural | This is new scope (review code from Phase 3/5) with no failing evidence. A concurrent executor is adding `gitDiffPatch` to `commands.ts` to fold these call sites. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/git/src/runner.ts` | The only spawn module: async plus sync runners | ✓ VERIFIED | `nodeRunner`, portable non-throwing `bunRunner`, `spawnSyncRunner` |
| `packages/git/src/sync.ts` | Enumerated sync commands | ✓ VERIFIED | Exported via `index.ts:3`; consumed by hooks.ts |
| `packages/git/src/commands.ts` | Enumerated commands, including exclude and delete-branch | ✓ VERIFIED | `gitInfoExcludePath`, `gitIsIgnored`, `ensureWorktreePoolIgnored`, `gitDeleteBranch` |
| `packages/git/src/resolver.ts` | One pure resolver | ✓ VERIFIED | Its `.worktrees` default matches the contract |
| `packages/cli/src/tk.ts` | Both consumers use mainRoot, exclude, rollback | ✓ VERIFIED (wired) | :235-249, :715-752 |
| `packages/surface/src/discover.ts` | `rootFrom` on `@tasks/git` | ✓ VERIFIED | :4 |
| `packages/cli/src/hooks.ts` | No local git runner | ✓ VERIFIED | :19 import; no git spawns |
| `packages/surface/src/git.ts` | Deleted | ✓ VERIFIED (absent) | |
| `packages/cli/src/git.ts` | Deleted | ✓ VERIFIED (absent) | |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `tk.ts` `worktree create` | `resolveWorktreePath` / `gitWorktreeAdd` | `repoRoot: mainRoot`, cwd mainRoot (:235, :242) | WIRED |
| `tk.ts` `work()` and `worktree create` | `ensureWorktreePoolIgnored(mainRoot)` | when `source === "default"`, before the add (:239, :733) | WIRED |
| `surface/discover.ts` | `@tasks/git` `gitCommonDir` / `mainWorktreeRoot` | import :4 | WIRED |
| `cli/hooks.ts` | `@tasks/git` sync commands | import :19 | WIRED |
| `work()` | task record | `uow.save` | WIRED (the probe shows the values in `tk show`) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `work()` | `base` | `gitMergeBase` | Yes (probe SHA `a8808a4…`) | ✓ FLOWING |
| `work()` / `worktree create` | `path` | resolver → `gitWorktreeAdd` | Yes | ✓ FLOWING |
| `tk show` | BRANCH/BASE/WORKTREE | task metadata | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase suites | `bun test packages/git packages/surface packages/cli/test` | 258 pass, 0 fail, 30 files (first run, no transient failures) | ✓ PASS |
| Worktree plus evidence | scratch `tk work <id> --json` | `tk/tk-txx`, 40-hex base, `created:true` | ✓ PASS |
| No nesting | `cd <task wt> && tk worktree create zz` | `<repo>/.worktrees/zz` | ✓ PASS |
| Hooks from `tk worktree create` | `postStart: touch HOOK_RAN` | sentinel in the new worktree, exit 0 | ✓ PASS |
| Auto-exclude | `git status --porcelain`; `.git/info/exclude` | no `.worktrees`; `/.worktrees/` appears once; no `.gitignore` | ✓ PASS |
| Detached HEAD label | `tk worktree info` in a detached worktree | `Branch: (detached)` | ✓ PASS |
| WR-04 rollback | occupied placement → `tk work` | fails with git's `already exists`; no `tk/<id>` left behind | ✓ PASS |
| WR-04 pre-existing branch kept | `git branch tk/<id>` plus occupied placement | branch survives | ✓ PASS |
| Node host | `node -e "import {gitCommonDir} from './dist/index.js'…"` | `node ok …/.git` | ✓ PASS |

Probe dir: `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/probe.9EOc`

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| (none declared) | no `scripts/*/tests/probe-*.sh` | The 01-03 manual scratch probe was run by the verifier (above) | N/A |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| GIT-01 | 01-01, 01-04 | Typed adapter: one runner, enumerated commands, porcelain parsing | ✓ SATISFIED | Truth 3. The second adapter is gone and hooks use the adapter. |
| GIT-02 | 01-01, 01-02, 01-03 | One resolver, `.worktrees/` default (auto-ignored), config, override; shared by both consumers | ✓ SATISFIED | Truth 2 |
| GIT-03 | 01-02, 01-03 | `tk work <id>` creates or enters `tk/<id>`, recording base, path and branch | ✓ SATISFIED | Truth 1 |

There are no orphaned requirements. REQUIREMENTS.md maps exactly GIT-01, GIT-02 and GIT-03 to Phase 1.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/web/src/review.ts`, `packages/tui/src/review/source.ts` | 85/90/115, 37 | inline `git diff` argv through the adapter runner | 📋 Advisory | Covered by the in-flight `gitDiffPatch` fold |
| `packages/beads/src/export.ts` | 18-24 | its own `Bun.spawn` runner | ℹ️ Info | It runs `bd`, not git, so it is out of SC3 scope |
| phase files | — | TBD/FIXME/XXX/HACK/PLACEHOLDER | — | none |

Previous review warnings WR-01, WR-02 and WR-04 and the hook argument-order bug are all closed.

**Concurrency note:** other executors are editing `packages/cli/src/tk.ts` (removing the tk hunk) and `packages/git/src/commands.ts` (adding `gitDiffPatch`) at the same time. The fingerprint above was taken from the tree as it stood during this run, so it will go stale once those edits land. The phase-1 hunks checked here (runWorktree create, `work()`, and the commands named above) are not the subject of those edits.

### Human Verification Required

None.

### Gaps Summary

Both previous gaps are closed. Placement is consistent across the two consumers from any cwd. The in-repo pool is auto-excluded through info/exclude and never through `.gitignore`. The contract text matches the `.worktrees/` default. All git access in surface discovery and the git hooks now goes through `@tasks/git`'s single runner module, which works under both Bun and node. The review warnings left over from 01-REVIEW (WR-01, WR-02, WR-04) are fixed and covered by tests. One advisory remains: the review diff call sites still build their argv inline. A concurrent change is folding them into the adapter, and this advisory does not block the phase.

---

_Verified: 2026-11-10T17:40:00Z_
_Verifier: Claude (gsd-verifier)_

## Regression sweep (2026-11-12)

This is a consolidated stale-phase regression sweep (user decision 2026-11-12). The fingerprint went stale because later phases edited covered files. No criterion regressed. I recomputed `covered_digest` over the same `covered_files` list (no files were deleted) and changed no source code.

Gate results, all on the current working tree:
- `bun test --timeout 15000` (full suite): 1897 pass, 5 skip, 0 fail. 1902 tests across 179 files in 465s.
- `bun run check` passes (rc 0) in domain, git, workspace, surface, rpc, review, cli, tui, web and daemon.
- `lune run luau/tk/tests/run_all.luau` (packages/lua): all 6 suites pass.
- `bun packages/tui/test/review-smoke.ts` is all green (9 checks). `bun packages/tui/test/smoke.ts` is all green (13 checks).
- `bun packages/tui/test/taskview-smoke.ts` ran 5 times: 11/12, 11/12, 12/12, 12/12, 12/12. The failing check was check 12 (the TASKS `]`/`[`/`]]` check), which is the known flake. In the failing frames the switching itself was correct relative to the task actually shown (u4i →`]` xdw →`[` u4i →`]]` zfd). The cause is the smoke's start-state assumption. The `5` task view has `detailId` null, so it shows `board.issues[0]`, and that changes when the probe creates two tasks. The `${id} · ` wait is also satisfied early by a phase-10 event toast (`· tk-xdw · review comment …`).
- `bun test packages/review/test/headless-smoke.test.ts`: 2 pass. `bun test packages/web/test/live.test.ts` ran 3 times: 5/5 pass each time, including 'branch frame'.
- `cd docs && bun run build`: Complete (rc 0).
- Phase-specific recheck (9/9 truths). In a scratch repo, `tk work` gave `tk/<id>`, a 40-hex base and `created:true`. The worktree is at `.worktrees/<repo>-<id>`. `/.worktrees/` appears exactly once in info/exclude, and no `.gitignore` exists. `tk show` lists BRANCH, BASE and WORKTREE. `packages/surface/src/git.ts`, `packages/cli/src/git.ts` and `packages/cli/src/hunk.ts` are absent. `discover.ts:4` and `hooks.ts:19` import from `@tasks/git`. `hooks.ts` has no `spawnSync("git"`. Grepping non-test `packages/*/src` outside `packages/git` for git argv finds nothing (the earlier review-diff advisory is resolved: web and tui now call `gitDiffPatch`). `ensureWorktreePoolIgnored` is wired at `tk.ts:250,763`. git, surface and cli tests are green in the full suite.
