---
phase: 02-changeset-derivation-completion-contract
verified: 2026-11-10T12:00:00Z
status: passed
score: 7/7 must-haves verified
covered_files: [
    ".planning/phases/02-changeset-derivation-completion-contract/02-01-PLAN.md",
    ".planning/phases/02-changeset-derivation-completion-contract/02-01-SUMMARY.md",
    ".planning/phases/02-changeset-derivation-completion-contract/02-02-PLAN.md",
    ".planning/phases/02-changeset-derivation-completion-contract/02-02-SUMMARY.md",
    "packages/cli/src/presentation.ts",
    "packages/cli/src/tk.ts",
    "packages/cli/test/finish.test.ts",
    "packages/cli/test/show-changeset.test.ts",
    "packages/git/src/commands.ts",
    "packages/git/src/porcelain.ts",
    "packages/git/test/changeset.test.ts",
    "packages/rpc/src/verbs.ts",
    "packages/surface/src/operations/changeset.ts",
    "packages/surface/src/operations/finish.ts",
    "packages/surface/src/operations/mutate.ts",
    "packages/surface/src/surface.ts",
    "packages/surface/test/changeset-freeze.test.ts",
    "packages/surface/test/changeset.test.ts",
    "packages/surface/test/finish.test.ts",
    "packages/web/src/review.ts",
    "packages/web/test/review.test.ts"
]
covered_digest: "v3:sha256:752c2f8e3985cc3478c6489e35c72acda297f3442c4f25c00fa2b4eadf9612f0"
behavior_unverified: 0
overrides_applied: 0
---

# Phase 2: Changeset Derivation & Completion Contract — Verification Report

**Phase Goal:** The PR record exists — commits and diff derive live from the branch (the agent supplies nothing), and completion is `tk finish` into `ready-to-review` and nothing else
**Verified:** 2026-11-10T12:00:00Z
**Status:** passed
**Re-verification:** No — initial verification
**Mode note:** The goal is not a User Story, so MVP narrowing does not apply. Verification ran against the 4 ROADMAP success criteria plus the PLAN must-haves.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Two commits in the worktree: `tk show` lists both commits and the changed files, re-derived on every read, with no agent-supplied lists and no per-read cache (SC1, CHG-01) | ✓ VERIFIED | `deriveChangeset` (`packages/surface/src/operations/changeset.ts`) runs three adapter commands on every call and writes nothing to metadata. Its only inputs are `issue.branch` and `metadata.changeset.base`. The `show` dispatch (`tk.ts` ~1426) is its call site. Probe in a scratch repo: `tk work` then 2 commits gave `COMMITS (2)` with sha and subject, and `FILES (2) A f1 / A f2`. Tests: `show-changeset.test.ts` (live re-derive after a 3rd commit, base-pinned stability, rename, binary, branch decay) and `surface/test/changeset.test.ts` ("never caches: two calls re-run all three commands"). |
| 2 | `tk finish <id> --session <sid>` records the session, moves status to `ready-to-review`, and prints derived counts (SC2, FIN-01) | ✓ VERIFIED | `finishIssueUow` writes `agent_session` and `finished_at` and sets status `ready-to-review`. The CLI `finish` (`tk.ts` ~508 and ~1480) requires `--session` or `TK_SESSION` and prints counts from a live derivation. Probe: `✓ Finished tk-tmy — probe2 — 2 commit(s), 2 file(s), +1 −0`. Tests: `cli/test/finish.test.ts` and `surface/test/finish.test.ts`, including the missing-session, no-work-record and idempotent re-finish cases. |
| 3 | `tk finish` cannot set closed or done; the contract is enforced in code (SC3, FIN-01) | ✓ VERIFIED | `finishPolicy` allows only `to: ready-to-review`, and the only transition `finishIssueUow` requests goes through `transitionStatus(finishPolicy, …)`. `closedAt` is never stamped. The CLI and surface finish operations take no status argument, so no flag can select a target state. Tests: `surface/test/finish.test.ts` ("denies closed and done targets"); `cli/test/finish.test.ts` ("finish never freezes … only close does"). |
| 4 | At close, `{base, head, commits, files, counts}` freezes into the record exactly once. A closed task keeps rendering from the snapshot with no worktree present (SC4, CHG-02) | ✓ VERIFIED | `freezeChangesetUow` returns null unless the next status is `closed`. It also returns null when a snapshot already exists, so a second close never re-freezes. It is wired into every close-shaped save: `changeStatus` (`mutate.ts:119`), `closeMany`/duplicate/supersede (`mutate.ts:227,240,256`), the CLI `mutate` (`tk.ts:502`), `markDuplicate`, `markSuperseded` and `todoDone`. `show` reads `readChangesetSnapshot` for closed tasks before any git call. Probe: close, then `git worktree remove` and `git branch -D`, then `tk show` still lists `COMMITS (2)` and `FILES (2)`. Tests: `changeset-freeze.test.ts` (full tuple; reopen, branch decay and re-close leave the snapshot identical) and `web/test/review.test.ts` ("closed+pruned task renders from the frozen head"). |
| 5 | Tasks without branch and base render `tk show` with no COMMITS/FILES section and exit 0 (D-03 scoping) | ✓ VERIFIED | `deriveChangeset` returns null for empty inputs, and `show` only adds the `changeset` wire when it is non-null. Test: `show-changeset.test.ts` "task without tk work keeps the plain shape". |
| 6 | Prohibitions hold: no derived data in metadata before close; finish never freezes; git is shelled only through the adapter; the frozen tuple is exactly `{base, head, commits, files, counts}` | ✓ VERIFIED | `finish.ts` writes only `agent_session`, `finished_at` and the optional `agent_harness`. Test: "worked-but-unfrozen metadata keeps only the base record on the finish path". `changeset.ts` imports git only from `@tasks/git`. |
| 7 | `finish` is in the CLI `writers` set (readonly-mode block) and `work` is repaid into it (D-12) | ✓ VERIFIED | The `writers` set at `tk.ts:37` contains `"work","finish"`. |

**Score:** 7/7 truths verified (0 present, behavior-unverified). Every state-transition truth has a passing behavioral test and an independent scratch-repo probe.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/git/src/commands.ts`, `porcelain.ts` | Enumerated log/numstat/name-status commands and parsers | ✓ VERIFIED | Used by `deriveChangeset`; `packages/git/test/changeset.test.ts` passes. |
| `packages/surface/src/operations/changeset.ts` | `deriveChangeset`, `freezeChangesetUow`, `readChangesetSnapshot`, `readChangesetBase` | ✓ VERIFIED | Substantive and wired into CLI, mutate and web. |
| `packages/surface/src/operations/finish.ts` | `finishPolicy`, `finishIssueUow`, `finishIssue` | ✓ VERIFIED | Wired to the CLI, the `surface.finish` facade (`surface.ts:92,180`) and the RPC verb `issue.finish` (`rpc/src/verbs.ts:159`). |
| `packages/surface/src/operations/mutate.ts` | Close-freeze at every close path | ✓ VERIFIED | Four call sites. |
| `packages/cli/src/tk.ts`, `presentation.ts` | `finish` command, show wiring, `formatFinish`/`formatShow` | ✓ VERIFIED | Probe output confirms rendering. |
| Test files (6) | Per-layer coverage | ✓ VERIFIED | `bun test packages/surface packages/git packages/cli/test/finish.test.ts packages/cli/test/show-changeset.test.ts`: 104 pass, 0 fail. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/git/src/commands.ts` | `deriveChangeset` | `gitLogOneline`, `gitDiffNumstat`, `gitDiffNameStatus` imports | WIRED | The operation never shells git itself. |
| `deriveChangeset` | `tk show` | `tk.ts` ~1427 | WIRED | Live call. List/watch paths do not call it. |
| `freezeChangesetUow` | every close path | `mutate.ts` and `tk.ts` | WIRED | See truth 4. |
| `finishIssueUow` | CLI, facade, RPC | `tk.ts:514`, `surface.ts:180`, `verbs.ts:159` | WIRED | Single completion path. |
| show wire changeset | `formatShow` | `presentation.ts` | WIRED | COMMITS/FILES render when the payload exists. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `show` COMMITS/FILES | `derived` | `readChangesetSnapshot` (closed) or `deriveChangeset` (git) | Yes (probe shows real shas and files) | ✓ FLOWING |
| `finish` counts line | `derived` | live `deriveChangeset` | Yes (+1 −0, 2 files) | ✓ FLOWING |
| frozen snapshot | `head` | `gitBranchHead` at close | Yes (the `head` sha was present in the JSON) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Targeted tests | `bun test packages/surface packages/git packages/cli/test/finish.test.ts packages/cli/test/show-changeset.test.ts` | 104 pass, 0 fail | ✓ PASS |
| Live show with 2 commits | scratch repo: `tk work`, 2 commits, `tk show` | COMMITS (2), FILES (2) | ✓ PASS |
| Finish counts | `tk finish --session s9` | "2 commit(s), 2 file(s), +1 −0" | ✓ PASS |
| Frozen render with no worktree or branch | `tk close`, remove worktree, delete branch, `tk show` | COMMITS (2), FILES (2) | ✓ PASS |

### Probe Execution

No probes declared. Step 7c: skipped.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CHG-01 | 02-01 | Commits and diff derive live from the branch vs the pinned base on every read, with no agent-supplied lists and no caching | ✓ SATISFIED | Truths 1, 5 and 6. |
| CHG-02 | 02-02 | Terminal `{base, head, files}` snapshot frozen once at close; closed tasks render from it with no worktree | ✓ SATISFIED | Truth 4. |
| FIN-01 | 02-02 | `tk finish --session` records the session, moves the task to `ready-to-review`, and cannot set closed or done | ✓ SATISFIED | Truths 2, 3 and 7. |

No orphaned requirements: REQUIREMENTS.md maps exactly CHG-01, CHG-02 and FIN-01 to Phase 2, and plans 02-01 and 02-02 claim all three.

### Effect of Uncommitted Later Work on Phase 02's Contract

- **`packages/web/src/review.ts`:** The frozen-snapshot fallback consumes `readChangesetSnapshot` and re-derives the patch from `frozen.base...frozen.head`. It guards against non-SHA refs. This extends CHG-02 rendering to the web and does not weaken it. Covered by `web/test/review.test.ts`.
- **`finishIssueUow`:** It gained an optional `harness` parameter that writes `agent_harness`. The status contract is unchanged, and the finish tests still pass.
- **`surface.ts`:** It gained review-comment facade methods. These are unrelated to changeset and finish, and there is no interaction with the freeze.
- **`tk show`:** It now adds `review_doors` to the wire and a doors renderer. The changeset payload shape is unchanged.
- **Test status:** The user reports `bun test` at 1473 pass, 0 fail. The targeted re-run passed.

### Anti-Patterns Found

No TBD/FIXME/XXX debt markers or stubs were found in the verified paths. The review findings (WR-1, WR-2, IN-1 to IN-4) were all fixed per `02-REVIEW-DISPOSITION.md` (open: 0).

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/surface/src/operations/finish.ts` | ~58 | `finish` on a `closed` task succeeds and moves it back to `ready-to-review` (probe: close, then finish, gave status `ready-to-review`). The frozen snapshot is kept but `show` goes back to live derivation, since it only uses the snapshot while closed. | ℹ️ Info | The finish policy permits any source state. Closed and done are still unreachable through finish, so FIN-01 holds. Consider whether a closed source should be refused. |
| `.planning/REQUIREMENTS.md` | CHG-01/02, FIN-01 | Checkboxes are still `[ ]` and ROADMAP lists Phase 2 as unchecked at the top level. | ℹ️ Info | The orchestrator should tick these. |

### Human Verification Required

None. UAT (`02-UAT.md`) shows all tests as pass. The automated, behavioral and scratch-repo probe evidence covers every truth.

### Gaps Summary

No gaps. All four ROADMAP success criteria and all three requirement IDs are met in the code. The uncommitted later work (web fallback, harness field, review comments, doors) does not regress Phase 02's contract.

---

_Verified: 2026-11-10T12:00:00Z_
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
- Phase-specific recheck (7/7 truths). Scratch-repo probe: after 2 commits, `tk show` gave `COMMITS (2)` / `FILES (2) A f1 A f2`. `tk finish` with TK_SESSION gave `ready-to-review`. After `tk close`, worktree removal and branch deletion, `tk show` still renders `COMMITS (2)` / `FILES (2)` from the frozen snapshot. `finishPolicy` allows only `ready-to-review`. `freezeChangesetUow` is wired at mutate.ts:119,227,240,256 and in tk.ts close, markDuplicate, markSuperseded and todoDone. The `writers` set contains `work` and `finish`. The `issue.finish` verb is present.
