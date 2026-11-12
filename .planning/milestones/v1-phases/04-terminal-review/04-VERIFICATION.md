---
phase: 04-terminal-review
verified: 2026-11-10T18:09:39Z
status: passed
score: 15/15 must-haves verified
covered_files:
  - ".planning/phases/04-terminal-review/04-01-PLAN.md"
  - ".planning/phases/04-terminal-review/04-01-SUMMARY.md"
  - ".planning/phases/04-terminal-review/04-02-PLAN.md"
  - ".planning/phases/04-terminal-review/04-02-SUMMARY.md"
  - ".planning/phases/04-terminal-review/04-03-PLAN.md"
  - ".planning/phases/04-terminal-review/04-03-SUMMARY.md"
  - ".planning/phases/04-terminal-review/04-04-PLAN.md"
  - ".planning/phases/04-terminal-review/04-04-SUMMARY.md"
  - ".planning/phases/04-terminal-review/04-05-PLAN.md"
  - ".planning/phases/04-terminal-review/04-05-SUMMARY.md"
  - "docs/src/content/docs/architecture.md"
  - "docs/src/content/docs/overview.md"
  - "docs/src/content/docs/testing.md"
  - "packages/cli/src/tk.ts"
  - "packages/git/src/commands.ts"
  - "packages/git/test/adapter.test.ts"
  - "packages/review/package.json"
  - "packages/review/src/watch.ts"
  - "packages/tui/src/app/App.tsx"
  - "packages/tui/src/app/artifact.tsx"
  - "packages/tui/src/app/composer.tsx"
  - "packages/tui/src/app/context.ts"
  - "packages/tui/src/app/diff.tsx"
  - "packages/tui/src/app/help.tsx"
  - "packages/tui/src/app/hunkEdit.tsx"
  - "packages/tui/src/app/task.tsx"
  - "packages/tui/src/review/edit.ts"
  - "packages/tui/src/review/live.ts"
  - "packages/tui/src/review/selection.ts"
  - "packages/tui/src/review/source.ts"
  - "packages/tui/test/app.test.tsx"
  - "packages/tui/test/review-edit.test.ts"
  - "packages/tui/test/review-selection.test.ts"
  - "packages/tui/test/review-smoke.ts"
  - "packages/tui/test/review.test.tsx"
covered_digest: "v3:sha256:5322ce5bccfe8c57c5f8f047a331daddc3c7ea567240ac82c5432768ba731f96"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: "13/13 (2 spec-parity gaps opened by user decision 2026-11-10)"
  gaps_closed:
    - "The diff view's keybindings are hunk's own (spec §3 DIFF · FULL PAGE / DIFF · MODAL key bars)"
    - "The diff view shows `watching worktree — re-derives as commits land ●` while the live watcher is active"
  gaps_remaining: []
  regressions: []
advisory:
  - finding: "covered_digest includes files that concurrent executors 08-01 (packages/cli) and 08-02 (diff.tsx, App.tsx, context.ts: x/D/S comment controls) are editing right now, so the fingerprint will go stale when they land"
    category: other
    reason: "Not a phase-4 defect. Keybar line 2 already shows 08-02's `x ✓ done · D ✕ remove · S send to agent`. Re-run the fingerprint, or accept it as stale, after 08-02 lands."
    evidence_status: "none provided"
human_verification:
  - test: "Run `tk work <id>`, then `tk review <id>`, at about 160x40. Compare the result with docs/html/task-to-review.html §3 'DIFF · FULL PAGE'."
    expected: "The layout reads as the hunk-derived full-page diff: a files pane, a `tk/<id> ← <base>` header, unified and split hunks, and a notes rail. Two placement differences to accept or reject: the `watching worktree … ●` line sits full-width above the keybar, while the mock puts it under the files pane; and the keybar says `s files` where the mock says `s files pane`."
    why_human: "Visual fidelity to a mock can't be checked from frame substrings."
  - test: "Read the documented differences from hunk on the help screen (`?`) and in overview.md `### Review`."
    expected: "You accept these: no `r refresh` (D-02; live re-render replaces it); `z` toggles context for the whole diff (±25 lines), where hunk's is per hunk; `v`/`y` select and copy whole hunks; `a` toggles the notes rail; `t` cycles themes, with no selector; `/` searches files; the compact modal has no `c note` yet (deferred to 09-04)."
    why_human: "Product judgment. These are deliberate, documented adaptations of 'hunk's own' keys."
---

# Phase 4: Terminal Review Verification Report

**Phase goal:** The whole review loop works in the terminal, with the three views proved in the mock now live over the tk-derived diff.
**Verified:** 2026-11-10T18:09:39Z
**Status:** human_needed. Both gaps are closed and every automated check is green. The only open items are a visual-parity check and acceptance of the documented differences from hunk.
**Re-verification:** Yes. This run follows gap closure plans 04-04 and 04-05.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | SC-1: `tk review <id>` opens the vendored TUI over the tk-derived diff with no manual branch link | ✓ VERIFIED (regression) | Probe ok 1. In the verifier's own tmux run at 160x40, the frame showed `tk/tk-wmy ← 368d4f65680f · +1 −1` and the `a.ts` hunk |
| 2 | SC-2: a commit from another terminal re-renders live, with no restart and no refresh key | ✓ VERIFIED (regression) | Probe ok 3. In the verifier's run, `src/z.ts` was committed from a second shell and `A z.ts` appeared with no key sent. `r` opens nothing (0 `reply…` in the frame) |
| 3 | SC-3: an in-view edit persists to the worktree file and the diff re-renders | ✓ VERIFIED (regression) | Probe ok 6; review.test.tsx edit cases pass |
| 4 | SC-4: TUI comments land on the task record; the mock plumbing is deleted | ✓ VERIFIED (regression) | Probe ok 7 (a fresh `tk show` lists the comment) |
| 5-13 | Plan truths from 04-01..04-03: selection survives a live refresh; branchless empty state; esc cancels an edit; path guards; stale-save refusal; `E` edits a comment; `x` resolves to All resolved; rail filtered by path; docs | ✓ VERIFIED (regression) | Full TUI suite 92/92 (review.test.tsx, review-edit.test.ts); probe ok 8 |
| 14 | **Gap 1 (closed):** the diff view's keys are hunk's own (spec §3 bar) | ✓ VERIFIED | Details below |
| 15 | **Gap 2 (closed):** `watching worktree — re-derives as commits land ●` shows only while the watcher runs | ✓ VERIFIED | Details below |

Evidence for truth 14 (gap 1):
- `diff.tsx:255-291`:
  - `]`/`[` move by hunk; `.`/`,` move by file.
  - `1`/`2` set the layout; `g`/`G` jump to the first or last hunk.
  - `c`/`E`/`R` handle notes; `q` quits.
  - `s`, `l`, `a`, `t`, `z`, `/`, `v` and `y` are bound.
  - There is no `u`/`r` case.
- `App.tsx:566`: ShellKeys yields `HUNK_SHELL_KEYS` (`1`/`2`/`g`) to the diff and artifact views.
- Tests: review.test.tsx groups `tui review keys are hunk's own`, `view toggles (s l a t z)` and `search, select and copy (/ v y)` all pass.
- Probe: ok 4 (`/` search), ok 5 (`2`/`1` stay in the diff view), ok 9 (`q` quits).
- Verifier's own run: `2` gave a split row (`3 - …v3 = 3; │ 3 + …v3 = 30;`); `g` stayed in the diff view, with no graph; `q` exited the session.

Evidence for truth 15 (gap 2):
- `live.ts:45-74`: `ReviewWatchHandle { stop, watching }`. Every no-op path returns `watching: false`; only a created controller returns `watching: true`.
- `App.tsx:226/233`: sets the flag from the handle and resets it on cleanup, guarded by issue id.
- `diff.tsx:339-347`: `WatchingIndicator` renders only for a usable source, and only in `DiffView`, never in the modal or the artifact view.
- Tests: the review.test.tsx indicator cases pass (worked task, branchless, errored handle, modal and artifact). Probe ok 2.
- Verifier's own run: the line was present at open and still present after the live commit.

**Score:** 15/15 truths verified (0 present but behavior-unverified).

### Live keybar and indicator vs the spec mock (verifier's tmux session `gsdverify04-<pid>`, 160x40, killed afterwards)

| Spec mock (§3 DIFF · FULL PAGE) | Live frame |
|---|---|
| `watching worktree — re-derives as commits land ●` (under the files pane) | `watching worktree — re-derives as commits land ●` (full-width row above the keybar) |
| `q quit  r refresh  c note  ]/[ hunk  ./, file  1/2 layout  s files pane  l line numbers  z context  / search  v select  y copy  a notes  t theme  ? help` | `q quit  c note  ]/[ hunk  ./, file  1/2 layout  s files  l line numbers  z context  / search  v select  y copy  a notes  t theme  ? help` |
| note card `E edit · R reply` | line 2: `R reply  E edit note  e edit hunk  x ✓ done · D ✕ remove · S send to agent  J/K note  esc back` (the `x/D/S` text comes from concurrent 08-02) |
| DIFF · MODAL `c note  ]/[ hunk  1/2 layout  ? help` | `]/[ hunk  1/2 layout  ? help  esc close  full review: tk://diff` (`c` in the modal is deferred to 09-04, per the 04-04 prohibition) |

Differences, all deliberate and documented:
- `r refresh` is dropped (D-02).
- `s files pane` is shortened to `s files` for width.
- The indicator sits on a different row than in the mock.
- The modal has no `c note` yet (Phase 9).

### Advisory (New Scope, Unevidenced)

| # | Finding | Category | Why Advisory |
|---|---|---|---|
| 1 | The fingerprint covers files that 08-01 and 08-02 are editing concurrently, so the digest will go stale | other | Phase-8 work in flight; it isn't a phase-4 defect |

### Required Artifacts

| Artifact | Expected | Status |
|---|---|---|
| `packages/tui/src/app/diff.tsx` | hunk-map `useReviewKeys`, `HUNK_SHELL_KEYS`, `WATCHING_LINE` / `WatchingIndicator`, `wrapKeyLine` keybar | ✓ VERIFIED |
| `packages/tui/src/app/App.tsx` | ShellKeys yields to the review views; `watching` and view-state actions | ✓ VERIFIED |
| `packages/tui/src/review/live.ts` | `ReviewWatchHandle` | ✓ VERIFIED |
| `packages/tui/src/review/selection.ts` | `hunkPatchTexts`, `reviewSelectionText` | ✓ VERIFIED (review-selection.test.ts) |
| `packages/git/src/commands.ts` | `contextLines` → `--unified=<n>`, validated as an integer 0..10000 | ✓ VERIFIED (adapter.test.ts 17/17) |
| `packages/tui/test/review-smoke.ts` | 9-check probe | ✓ VERIFIED |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| App.tsx ShellKeys | diff.tsx `HUNK_SHELL_KEYS` | early return when the view is diff or artifact (App.tsx:566) | WIRED |
| diff.tsx `R` | `openReviewComposer("reply")` | diff.tsx:264 | WIRED |
| App.tsx live effect | live.ts `ReviewWatchHandle.watching` | setReview `{ watching }` / reset on cleanup | WIRED |
| `z` / live onChange / saveHunkEdit | `resolveReviewSource(..., { contextLines })` | `reviewContextRef` | WIRED (the `z` survives-live-commit test passes) |
| diff.tsx `y` | `renderer.copyToClipboardOSC52` | `copyReviewSelection` + selection.ts | WIRED (spied test) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| TUI suite | `bun test --timeout 30000 packages/tui/test` | 1st run: 80 pass / 12 fail. Every failure was `tk init` → `Export named 'commentWire' not found in packages/cli/src/presentation.ts`, from 08-01 mid-edit. Re-run: **92 pass / 0 fail** (7 files) | ✓ PASS (transient) |
| Typecheck | `cd packages/tui && bun run check` | 1st run: exit 2, `diff.tsx(254,44): 'toggleReviewResolved' does not exist on AppActions`, from 08-02 mid-edit. Re-run: **exit 0** | ✓ PASS (transient) |
| Git option | `bun test packages/git/test/adapter.test.ts` | 17 pass / 0 fail | ✓ PASS |
| Docs | `cd docs && bun run build` | Complete | ✓ PASS |
| Live capture | verifier tmux script at 160x40 (open → second-shell commit → `2` → `1` → `g` → `r` → `?` → `q`) | indicator present; live re-render; split row; no graph on `g`; no composer on `r`; help lists the hunk map plus the `watching ●` legend; `q` quit | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
|---|---|---|---|
| `packages/tui/test/review-smoke.ts` | `bun packages/tui/test/review-smoke.ts` | ok 1..9, `review-smoke: all green (9 checks)` | PASS |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|---|---|---|---|
| REV-03 | 04-01..04-05 | ✓ SATISFIED | Truths 1-4, 14, 15 |

No orphaned requirements.

### Anti-Patterns Found

None.
- TBD/FIXME/XXX in the phase source files: 0.
- `@tasks/web` in packages/tui: 0.
- Stale `u unified` / `r reply` / `] [ file` text in packages/tui/src and docs: 0.

`D`/`S` are now bound in diff.tsx, but that is 08-02's own claimed scope, not a phase-4 violation.

### Human Verification Required

#### 1. Visual parity with spec §3 DIFF · FULL PAGE

**Test:** Run `tk review <id>` at about 160x40 and compare it with the mock.

**Expected:** You accept the layout. The indicator is full-width above the keybar rather than under the files pane, and the keybar reads `s files` where the mock has `s files pane`.

**Why human:** Visual fidelity.

#### 2. The documented differences from hunk

**Test:** Review the help screen and overview.md `### Review`.

**Expected:** You accept these differences:
- no `r refresh`
- `z` works on the whole diff
- `v`/`y` work on whole hunks
- `a` toggles the notes rail
- `t` cycles themes
- `/` searches files
- the modal has no `c` until 09-04

**Why human:** Product judgment on deliberate adaptations.

### Gaps Summary

Both gaps from the previous verification are closed and have behavioral evidence: unit and integration tests, the 9-check tmux probe, and the verifier's own 160-column live capture. There are no regressions. The 4 roadmap SCs and all 9 earlier plan truths still pass. The status is human_needed only because the visual-parity check and the acceptance of the documented differences from hunk need a person.

---

_Verified: 2026-11-10T18:09:39Z_
_Verifier: Claude (gsd-verifier)_


## Human Verification Result (2026-11-10)

Accepted under the user's "Match the spec" decision: hunk's keymap adopted; documented deliberate deviations (no `r refresh` — live re-render replaces it; `z`/`v`/`y` whole-diff/whole-hunk; `a` notes rail; `t` theme cycle; `/` file search; `s files` label; indicator row above the keybar) accepted. Compact-modal `c note` deferred to 09-04.

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
- Phase-specific recheck (15/15 truths). `review-smoke.ts` is all green, 9/9 (open, live re-render, edit, comment to the record, `/` search, `1`/`2` layout, branchless, `q` quits). `HUNK_SHELL_KEYS` is wired (`App.tsx:16,655`). `WatchingIndicator` is at `diff.tsx:455`, and `live.ts` returns `watching: false` on no-op handles. The TUI review suites are green in the full run.


Fingerprint regenerated 2026-11-12 after the milestone-audit gap fix (packages/tui/src/review/source.ts frozen-snapshot fallback; packages/tui/test/frozen-source.test.ts 2/2, full tui suite 127/0, tsc clean, live tmux on a closed+pruned task).
