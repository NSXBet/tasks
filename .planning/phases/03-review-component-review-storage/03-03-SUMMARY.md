---
phase: 03-review-component-review-storage
plan: 03
subsystem: review
tags: [vcs, tests, provider-neutral, D-04, D-05]
requirements: [REV-01]
status: complete
key-files:
  modified:
    - packages/review/src/core/watch/plan.test.ts
    - packages/review/src/core/watch/signature.test.ts
    - packages/review/src/core/run/config.test.ts
    - packages/review/src/core/run/config.ts
    - packages/review/src/extensions/apply.ts
    - packages/review/src/extension-api/types.ts
    - packages/review/src/core/patch/gitFormat.ts   # deviation, prose only
---

# Phase 03 Plan 03: Provider-neutral VCS layer in packages/review — Summary

packages/review now has no parked bundled-adapter tests, no jj/sl fixtures, and no prose that claims a bundled
Jujutsu/Sapling tier. Git exists only in @tasks/git (D-04). The neutral catalog API and `core/vcs/index.test.ts`
were not changed.

## Tasks

### Task 1: Resolve parked VCS tests
- **plan.test.ts**: removed `describe.skip("resolveWatchPlan")` and the "packages/git fold" comments. All cases
  that use diff, difftool, patch, stdin, Windows paths or the hg extension now run. The jj poll-only case now
  registers a fake adapter in the test (`id: "fake"`, with `working-tree-diff` and `revision-show` operations and
  no `watchPlan`). Its assertions are the same: a poll-only plan for `vcs`, plus a sidecar target for `show`.
- **signature.test.ts**: removed `describe.skip("computeWatchSignature")`. Deleted 3 cases that need a real git
  working tree signed through a bundled git adapter:
  - untracked-content embedding
  - excludeUntracked
  - ref-vs-working-tree untracked

  Also deleted the `git()`, `createTempRepo()` and `createGitInput()` helpers, so the file no longer spawns git.
  The direct-file/patch/sidecar case now uses a plain `createTempDir()`. The async hg extension adapter case runs
  unchanged. The unsupported-operation case now uses a fake adapter that has no `stash-show` operation. It asserts
  `"Fake does not support stash-show."` and that the adapter's `watchSignature` was never called. The old version
  depended on a bundled git adapter for the "requires Git VCS mode" message.
- **config.test.ts**:
  - deleted `createJjRepo`
  - deleted the skipped "auto-detects registered VCS checkouts…" test
  - deleted "explicit config overrides auto-detected jj mode"
  - in "defaults to git VCS mode and accepts registered VCS modes", changed `"jj"` to `"hg"`

  The unrelated `test.skip("resolves extension bootstrap config…")` was not touched.

### Task 2: Provider-neutral prose
- `config.ts` `ExtensionsConfig.enabled`: says that VCS input comes from the caller-supplied patch (derived via
  @tasks/git), so disabling extensions never removes diff input. The Jujutsu/Sapling sentence is gone.
- `config.ts` `vcs` key: `accepted: "\`git\` or an id a loaded extension backend registers"`. Behavior is unchanged.
- `extensions/apply.ts`: the doc now says base-catalog ids are reserved. The jj/sl bundled-tier clause is gone.
- `extension-api/types.ts`: "the git/jj/sl backends" became "VCS backends". The `logicalId` doc example changed
  from "A Jujutsu change id" to "A change id that survives history rewrites".

## Test counts (`bun test packages/review/src`)

| | pass | skip | fail | total |
|---|---|---|---|---|
| before (2026-11-10 baseline, re-measured) | 1066 | 28 | 0 | 1094 |
| after | 1084 | 5 | 0 | 1089 |

Five tests were deleted, all needing a bundled adapter: 3 git-working-tree signature cases and 2 jj config
cases. Four of them had been skipped; the jj-override case had been running. 19 previously skipped tests now
run and pass. 5 skips remain, all unrelated to VCS (including the extension-bootstrap theme skip).

## Verification
- Task 1 gate (0 fail, no `describe.skip` in the two watch tests, no `createJjRepo`/`packages/git fold`): **pass**
- Task 2 grep gate (no `Jujutsu|Sapling|\`jj\`|\`sl\`|git/jj/sl` in non-test review src): **pass**
- `cd packages/review && bunx tsc --noEmit -p tsconfig.json`: **fails with 1 error that is not from this plan**:
  `src/app/taskStoreCommentStore.ts(13,90): Module "@tasks/surface" has no exported member 'withLegacyHunkImport'`.
  That file belongs to the concurrent plan 03-04, which was in progress when this ran. No errors come from files
  this plan touched.

## Deviations from Plan
1. **[Rule 3 – blocking gate] `core/patch/gitFormat.ts` prose edit.** This file is outside the plan's file list,
   but its header comment mentioned "Jujutsu", which tripped the Task 2 grep gate. I changed the comment to
   "other VCS backends can emit". Only the comment changed. `extension-api/types.ts:813` (the `logicalId` doc)
   tripped the same gate and is in scope; that fix is listed under Task 2.
2. **Rule 1 – unsupported-operation test rewritten rather than deleted.** The old assertion needed a git adapter in
   the catalog. The rewrite still checks the neutral behavior, that the operation is rejected before the adapter
   signature runs, using a test-registered fake.

## Threat model
T-03-04 (repudiation of coverage) is mitigated: the before and after counts and every deleted case are listed above.

## Commits
Commits withheld per AGENTS.md (conservative profile: no git commit/push). STATE.md/ROADMAP.md not updated per orchestrator override.

## Self-Check: PASSED (with the out-of-scope tsc error noted above)
