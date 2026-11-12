---
phase: 06-worktree-lifecycle-injection
verified: 2026-11-12T17:24:15Z
status: passed
score: 14/14 must-haves verified
covered_files: [".agents/skills/tasks/SKILL.md", ".planning/phases/06-worktree-lifecycle-injection/06-01-PLAN.md", ".planning/phases/06-worktree-lifecycle-injection/06-01-SUMMARY.md", ".planning/phases/06-worktree-lifecycle-injection/06-02-PLAN.md", ".planning/phases/06-worktree-lifecycle-injection/06-02-SUMMARY.md", ".planning/phases/06-worktree-lifecycle-injection/06-03-PLAN.md", ".planning/phases/06-worktree-lifecycle-injection/06-03-SUMMARY.md", "AGENTS.md", "docs/src/content/docs/integrations.md", "docs/src/content/docs/overview.md", "packages/cli/skills/tasks/SKILL.md", "packages/cli/src/onboard.ts", "packages/cli/src/presentation.ts", "packages/cli/src/tk.ts", "packages/cli/templates/agents/tk-section.md", "packages/cli/test/contract.test.ts", "packages/cli/test/tk.test.ts", "packages/cli/test/work.test.ts", "packages/git/src/hooks.ts", "packages/git/src/prune.ts", "packages/git/test/hooks.test.ts", "packages/git/test/prune.test.ts", "packages/pi-extention/skills/tasks/SKILL.md", "packages/surface/src/operations/prune.ts", "packages/workspace/src/config.ts", "packages/workspace/src/index.ts", "packages/workspace/test/workspace.test.ts"]
covered_digest: "v3:sha256:228677d3fc6f37ffee68391c58394b82f685ef733674283eedce79f4ca7b240e"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Close a task whose tk/<id> branch is merged (so the worktree and branch are pruned), then open `tk review <id>` (TUI) and the web diff view (`tk web`, /tasks/<id>/diff)."
    expected: "The review shows the task's commits and the full file diff from the frozen snapshot, with no worktree and no branch present (spec verify item 8, second clause)."
    why_human: "The CLI probe proved `tk show --json` keeps changeset.base/commits/files and `tk changes` prints `1 commit · +1 −0 · 1 file` after the prune. Rendering the diff body in the TUI/web view is visual and needs a running UI."
  - test: "In a fresh clone that has a .tasks workspace, run `tk onboard install` and `tk setup codex` (or cursor), then start a new agent session in that harness."
    expected: "The session's injected context (SessionStart → `tk prime`) shows the same contract as AGENTS.md: work in `tk work <id>`, finish with `tk finish <id> --session <sid>`, never mark done, `tk watch <id> --until`, review with `tk review <id>` / `tk comments` (spec verify item 9, second clause)."
    why_human: "`tk prime` output was verified, and agent-hooks.ts SessionStart shells out to `tk prime`. Whether a live external harness actually loads that hook output into the session can't be observed from the CLI."
---

# Phase 6: Worktree Lifecycle & Injection Verification Report

**Phase Goal:** tk replaces gw. Worktree removal is merge-aware and can be cleaned up, with hooks, and the harness learns the workflow contract.
**Verified:** 2026-11-12T17:24:15Z
**Status:** human_needed
**Re-verification:** No. This is the initial verification.

> **Mode note:** ROADMAP marks Phase 6 `Mode: mvp`, but the goal is not a user story (`user-story.validate` → `valid: false`). The orchestrator asked for verification, so the standard goal-backward method was applied against the 4 roadmap success criteria and the plan must_haves. If MVP framing matters, run `/gsd-mvp-phase 6` to rewrite the goal.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Closing a task whose branch is merged and clean prunes its worktree, and the close succeeds. An unmerged branch refuses the prune while the close still succeeds. `gitIsMergedToBase()` guards `tk worktree remove` and every prune path. | ✓ VERIFIED | `prune.ts` `pruneClosedWorktree` decides merged-ness only through `gitIsMergedToBase`. Every path reaches it: close (tk.ts:571), duplicate/supersede/todo done (tk.ts:646-652), RPC mutate (surface mutate.ts:127,231) and clean --yes, all via `pruneIssueWorktree`, plus `worktree remove` (tk.ts:276). **Probe p1:** merged close printed `✓ Closed tk-iqn … — worktree pruned`, and `.worktrees` and `tk/tk-iqn` were gone. Unmerged close printed `— worktree kept: branch tk/tk-etp is not fully merged into aa846d9…` and exited 0. Tests: work.test.ts `worktree lifecycle (gw port)` and prune.test.ts are green. |
| SC2 | `tk worktree clean` (dry-run by default) lists every closed-task, merged, clean worktree, and `--yes` removes them. | ✓ VERIFIED | **Probe p1:** while unmerged, clean listed `0 eligible`, with `tk-etp kept: …not fully merged`. After the merge, default and `--dry-run --json` both listed tk-etp eligible and removed nothing. `--dry-run --yes` failed with `mutually exclusive` (exit 1). `--yes` printed `✓ pruned tk-etp` and removed the worktree and branch, and `metadata.worktreePruned` was persisted. A rerun listed 0 eligible, so already-pruned tasks are skipped. Test: work.test.ts `tk worktree clean lifecycle`. |
| SC3 | Configured `worktree.post_start`/`post_checkout`/`pre_end` hooks run at their lifecycle points. `tk work`/`worktree create` post-start detects the package manager and installs deps (configurable off). | ✓ VERIFIED | **Probe p3** (snake_case config, stub package managers on PATH): `tk work` on a new branch ran `ps` plus `bun install` in the worktree. Re-entry ran nothing. With the worktree gone and the branch kept, `tk work` ran `pc` (not ps) plus install. `worktree create --branch <existing>` ran `pc`, and a new branch ran `ps`. `worktree remove`, close-prune and `clean --yes` each fired `pe` inside the worktree. A failing pre_end vetoed the close-prune (`worktree kept: pre_end hook failed`) and the close still succeeded. Precedence: bun.lock+package-lock → bun, bun.lockb+npm → bun, pnpm+yarn → pnpm, yarn+npm → yarn, npm alone → npm. `install: false` → no install. A failing install gave the note `"hooks":"package install failed (bun)"`, non-fatal. Tests: hooks.test.ts, workspace.test.ts, work.test.ts, tk.test.ts. |
| SC4 | Fresh clone → `tk onboard` → the workflow contract (work in `tk work`, finish with `tk finish --session`, never mark done, review with `tk review`) is in AGENTS.md, the `tk prime` context, and `skills/tasks/SKILL.md`. | ✓ VERIFIED | **Probe p4:** `git clone` → `tk onboard install` created AGENTS.md with the bold contract line. Hit counts: `tk work <id>` ×5, `tk finish <id> --session` ×3, never mark done ×2, `tk review <id>` ×2, `tk watch <id> --until` ×2, `tk worktree clean` ×1. A second install was byte-identical, and `onboard check` returned current with exit 0. After `tk init`, `tk prime` (ANSI-stripped) contains all clauses plus the lifecycle line. `tk skill` contains every clause. contract.test.ts (6 cases) is green. At the repo root, `tk onboard check` → current, exit 0, and `.agents/skills/tasks/SKILL.md` is byte-identical to the CLI copy (`cmp`). |
| P1 | `gitIsMergedToBase` accepts rebase/cherry-pick merges, follows the default tip for pinned SHAs, and rejects partial merges. | ✓ VERIFIED | prune.ts rules 1–3. Tests: prune.test.ts `gitIsMergedToBase` (cherryPicked/partial fixtures) are green. |
| P2 | `tk worktree remove` without `--force` refuses an unmerged branch, naming the branch and base, and removes a merged, clean one. | ✓ VERIFIED | **Probe p1:** `refusing to remove …/wt1: unpushed commits, branch wt1 is not merged into main — use --force to override` (exit 1). After the merge, `✓ Removed worktree` (exit 0). |
| P3 | After a close-prune, `tk show --json` still carries the frozen changeset (base, commits, files). | ✓ VERIFIED | **Probe p1:** base `aa846d9…`, commits `[71c5454 feat a]`, files `[A a.txt]`, `worktreePruned {pruned:true, removedWorktree:true, removedBranch:true}`. Human `tk show` lists COMMITS (1) and FILES (1). |
| P4 | Config accepts snake_case and camelCase hook keys plus `install`/legacy `pmSetup`, stays strict, and rejects conflicting spellings. | ✓ VERIFIED | config.ts `WorktreeConfigSchema` (strict, superRefine, transform). workspace.test.ts is green. The probe used snake_case keys end to end. |
| P5 | Lockfile precedence is bun → pnpm → yarn → npm, and install runs in the new worktree. Failure is a note naming the manager. | ✓ VERIFIED | hooks.ts `lockfiles` order. Probe p3 matrix (above). |
| P6 | post_start fires on a new branch, post_checkout on an existing branch, and neither on re-entry. `worktree create --branch <existing>` checks the branch out. | ✓ VERIFIED | tk.ts `provisionHooks` (L210) is called with `!branchExists` (L759) and `branchIsNew` (L259). Probe p3. |
| P7 | The root AGENTS.md managed block is current. | ✓ VERIFIED | `bun packages/cli/src/tk.ts onboard check` → `(current)`, exit 0. |
| P8 | No injection surface mentions `tk hunk`, and HUMAN_HELP has no `WIP mock`. | ✓ VERIFIED | contract.test.ts case green. grep of presentation.ts finds no match. |
| P9 | The injected text has the lifecycle line (close prunes merged/clean, `tk worktree clean [--yes]`). | ✓ VERIFIED | `tk worktree clean` appears in the fresh AGENTS.md (×1) and in prime (×1). contract.test.ts. |
| P10 | `.agents/skills/tasks/SKILL.md` is byte-identical to `packages/cli/skills/tasks/SKILL.md`. | ✓ VERIFIED | `cmp` exit 0. |

**Score:** 14/14 truths verified (0 present but behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/git/src/prune.ts` | single merge predicate, alreadyPruned, `-D` only after the predicate | ✓ VERIFIED | `mergeProven` gates the `-D` fallback. `mergedIntoBaseLine` is gone. |
| `packages/git/src/hooks.ts` | lockfile precedence, `SetupOutcome.pm` | ✓ VERIFIED | |
| `packages/git/test/hooks.test.ts` | unit coverage | ✓ VERIFIED | green |
| `packages/workspace/src/config.ts` | aliases, install, strict | ✓ VERIFIED | |
| `packages/cli/src/tk.ts` | remove guard, clean single pass, pruneSuffix, provisionHooks | ✓ VERIFIED | wired at L210/259/276/345/571/759, 1587-1604 |
| `packages/cli/test/work.test.ts` | lifecycle e2e | ✓ VERIFIED | green |
| `packages/cli/test/contract.test.ts` | drift guard across all surfaces | ✓ VERIFIED | green |
| `packages/cli/templates/agents/tk-section.md` | single block source | ✓ VERIFIED | onboard.ts reads it (L51-59) |
| `docs/src/content/docs/integrations.md` / `overview.md` | doc homes | ✓ VERIFIED | `## Agent injection — the workflow contract` (L131), `#### Lifecycle hooks and dependency setup`, clean bullet (L527). `cd docs && bun run build` → Complete. |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| prune.ts `pruneClosedWorktree` | `gitIsMergedToBase` | direct call | ✓ WIRED |
| tk.ts `runWorktree remove` | `gitIsMergedToBase` | guard unless `--force` (L276) | ✓ WIRED |
| tk.ts `runWorktree clean --yes` | surface `pruneIssueWorktree` | one `store.transact` per eligible task (L327-331) | ✓ WIRED |
| surface `pruneIssueWorktree` | config `worktree.preEnd` | `readWorkspaceConfig` → `preEnd` input | ✓ WIRED (probe: pe fired on close and clean) |
| tk.ts `work()` / `worktree create` | `readWorkspaceConfig` install/postStart/postCheckout | `provisionHooks` | ✓ WIRED |
| tk.ts | `runPackageManagerSetup` | `install !== false` | ✓ WIRED |
| onboard.ts | `templates/agents/tk-section.md` | file read and hash in BEGIN marker | ✓ WIRED |
| agent-hooks.ts SessionStart | `tk prime` (PRIME) | subprocess `runTkPrime` (L59, L105) | ✓ WIRED (live harness injection is a human item) |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real Data | Status |
|----------|------|--------|-----------|--------|
| close human line `pruneSuffix` | `metadata.worktreePruned` | `pruneIssueWorktree` → `pruneClosedWorktree` git ops | yes (probe) | ✓ FLOWING |
| `tk show` after prune | `metadata.changeset` | `freezeChangesetUow` at close | yes (probe: commits/files) | ✓ FLOWING |
| `tk worktree clean` list | candidates | store list → dry-run `pruneClosedWorktree` | yes | ✓ FLOWING |

### Behavioral Spot-Checks

Scratch repos are under `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/{p1,p3,p4}`.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| merged close prunes | `tk close <A>` | `— worktree pruned`. No worktree or branch remains. | ✓ PASS |
| unmerged close keeps, succeeds | `tk close <B>` | `— worktree kept: … not fully merged`, exit 0 | ✓ PASS |
| frozen changeset survives | `tk show <A> --json`, `tk changes <A>` | commits 1, files a.txt; `1 commit · +1 −0 · 1 file` | ✓ PASS |
| clean dry-run / --yes | `tk worktree clean`, `--dry-run --json`, `--yes` | lists only / pruned once / 0 eligible after | ✓ PASS |
| remove guard | `tk worktree remove wt1` | refused until merged | ✓ PASS |
| hooks at lifecycle points | `tk work`, re-entry, re-provision, `worktree create [--branch existing]`, remove, close, clean --yes | ps / none / pc / pc / ps / pe / pe / pe | ✓ PASS |
| pm detection + toggle | lockfile matrix, `install:false`, failing stub | bun/bun/pnpm/yarn/npm. Off with install:false. Failure gave a non-fatal note. | ✓ PASS |
| fresh clone onboard | `git clone` → `tk onboard install` ×2 → `check` | contract present, idempotent, current | ✓ PASS |

### Test and Typecheck Runs

| Run | Command | Result |
|-----|---------|--------|
| 1 (full) | `bun test packages/git packages/workspace packages/cli/test packages/surface/test` | **405 pass, 1 fail** (406 tests, 42 files, 223s). The failure was `review-record-verify.test.ts` › "item 1 (Product): tk show renders the PR-shaped record" with `unexpected metadata key report`. That is Phase 7/11 scope: the concurrent 11-01 executor was adding the `report` finish cache, and the test's allow-list (L88) already includes `report`. |
| 2 (rerun) | `bun test packages/cli/test/review-record-verify.test.ts packages/cli/test/work.test.ts packages/cli/test/contract.test.ts packages/git/test/prune.test.ts packages/git/test/hooks.test.ts packages/workspace packages/surface/test/prune.test.ts` | **79 pass, 0 fail**. The run-1 failure was transient and came from the concurrent edit. It is not a Phase 6 regression. |
| typecheck | `bunx tsc --noEmit -p tsconfig.json` in packages/git, workspace, cli | exit 0 / 0 / 0 |
| docs | `cd docs && bun run build` | Complete |

### Probe Execution

No `scripts/*/tests/probe-*.sh` is declared or present for this phase. The verifier ran its own scratch-repo probes (above). The SUMMARY probe claims were not relied on.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| LC-01 | 06-01 | `gitIsMergedToBase()` guards `tk worktree remove` and every prune path | ✓ SATISFIED | SC1, P1, P2 |
| LC-02 | 06-01 | `tk close` auto-prunes. Safety first, failures non-fatal. | ✓ SATISFIED | SC1, P3, pre_end veto probe |
| LC-03 | 06-01 | `tk worktree clean` dry-run by default, `--yes` removes | ✓ SATISFIED | SC2 |
| LC-04 | 06-02 | post_start/post_checkout/pre_end hooks plus pm install (configurable off) | ✓ SATISFIED | SC3, P4–P6 |
| INJ-01 | 06-03 | onboard / prime / SKILL.md / root AGENTS.md state the contract | ✓ SATISFIED | SC4, P7–P10 |

No orphaned requirements. REQUIREMENTS.md maps only LC-01..04 and INJ-01 to Phase 6, and every one is claimed by a plan. The REQUIREMENTS.md checkboxes are still `[ ]`. The orchestrator owns that update.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (all covered files) | — | TBD/FIXME/XXX | none found | — |
| `packages/cli/src/tk.ts` | 243, 286 | `readWorkspaceConfig(...).catch(() => ({}))` / `null` | ⚠️ Warning | Probe: an unknown key (`postStrat`) in `worktree` makes `tk worktree create` silently drop **all** hooks while still running the default install. `tk list` in the same repo fails loudly (exit 1). The strict schema rejects the typo, but the lifecycle callers hide the rejection. `pruneIssueWorktree` (surface prune.ts:39) does the same for `pre_end`. This existed before the phase and does not break an SC. Suggested follow-up: surface the config error as a hook note. |
| `packages/git/src/prune.ts` | 74-77 | merge check skipped when the branch is absent but the worktree path still exists | ℹ️ Info | Only reachable for a detached worktree whose `tk/<id>` branch was deleted out-of-band. Dirty/stash checks still apply, but unmerged detached commits could be removed. Edge case. |
| `packages/git/src/hooks.ts` | 17-20 | `runShellHook` sets no `TK_TASK` / `TK_WORKTREE_PATH` env | ℹ️ Info | Spec §11 says post_start "runs with TK_TASK and TK_WORKTREE_PATH set". Not in the roadmap SCs or CONTEXT. Possible follow-up. |
| prune reason text | — | `pre_end hook failed: ` with empty stderr | ℹ️ Info | Cosmetic. The exit code is not shown when the hook writes nothing to stderr. |
| `tk show` human | — | `WORKTREE:` still prints the pruned path | ℹ️ Info | Cosmetic. The path no longer exists after a prune. |
| `tk onboard install` | — | second run prints "Updated existing tk section" on a byte-identical file | ℹ️ Info | Message only. Already noted in 06-03-SUMMARY. |

**Spec deviation (accepted by CONTEXT, info):** the spec §11 gw audit lists "package-manager auto-install on start" as *skip* and hooks as "post_start only". The ROADMAP SC3 and 06-CONTEXT decisions deliberately chose default-on install plus all three hooks. The roadmap is the contract, so this is not a gap. Squash merges (several commits squashed into one) are not proven merged by `git cherry`, so prune refuses them. That is the safe direction.

### Human Verification Required

#### 1. Diff renders from the frozen snapshot after the prune (spec verify item 8)

**Test:** Close a merged task so its worktree and branch are pruned. Open `tk review <id>` and the web diff (`/tasks/<id>/diff`).
**Expected:** The commits and the full per-file diff render with no worktree and no branch present.
**Why human:** The CLI (`tk show --json`, `tk changes`) proves the snapshot survives. Diff rendering in the TUI and web is visual.

#### 2. Primed agent session shows the contract (spec verify item 9)

**Test:** In a fresh clone with a .tasks workspace, run `tk onboard install` and `tk setup codex` (or cursor), then start an agent session.
**Expected:** The SessionStart-injected context shows the same contract clauses as AGENTS.md.
**Why human:** This needs a live external harness. `tk prime` output and the agent-hooks.ts → `tk prime` wiring are already verified.

### Gaps Summary

There are no gaps. All 4 roadmap success criteria and the 10 plan-level truths are verified by passing tests and by the verifier's own scratch-repo probes. The one run-1 test failure is outside Phase 6 (Phase 7/11 `report` key from the concurrent 11-01 executor) and passed on rerun. Status is `human_needed` only for the two visual or external-harness halves of spec verify items 8 and 9. Note: `packages/cli/src/tk.ts` and `presentation.ts` are being edited concurrently by 11-01, so `covered_digest` will go stale after those edits land.

---

_Verified: 2026-11-12T17:24:15Z_
_Verifier: Claude (gsd-verifier)_


## Human Verification Result (2026-11-12)

Passed on automated evidence per the user's standing choice (phase 10: "Pass + track live check"); live-harness / real-GitHub checks are tracked as tk UAT tasks.
