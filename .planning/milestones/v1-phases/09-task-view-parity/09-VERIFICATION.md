---
phase: 09-task-view-parity
verified: 2026-11-11T16:07:18Z
status: passed
score: 8/8 must-haves verified
covered_files:
  - ".planning/phases/09-task-view-parity/09-01-PLAN.md"
  - ".planning/phases/09-task-view-parity/09-01-SUMMARY.md"
  - ".planning/phases/09-task-view-parity/09-02-PLAN.md"
  - ".planning/phases/09-task-view-parity/09-02-SUMMARY.md"
  - ".planning/phases/09-task-view-parity/09-03-PLAN.md"
  - ".planning/phases/09-task-view-parity/09-03-SUMMARY.md"
  - ".planning/phases/09-task-view-parity/09-04-PLAN.md"
  - ".planning/phases/09-task-view-parity/09-04-SUMMARY.md"
  - ".planning/phases/09-task-view-parity/09-05-PLAN.md"
  - ".planning/phases/09-task-view-parity/09-05-SUMMARY.md"
  - ".planning/phases/09-task-view-parity/09-06-PLAN.md"
  - ".planning/phases/09-task-view-parity/09-06-SUMMARY.md"
  - ".planning/phases/09-task-view-parity/09-07-PLAN.md"
  - ".planning/phases/09-task-view-parity/09-07-SUMMARY.md"
  - ".planning/phases/09-task-view-parity/09-08-PLAN.md"
  - ".planning/phases/09-task-view-parity/09-08-SUMMARY.md"
  - ".planning/phases/09-task-view-parity/09-09-PLAN.md"
  - ".planning/phases/09-task-view-parity/09-09-SUMMARY.md"
  - ".planning/phases/09-task-view-parity/09-10-PLAN.md"
  - ".planning/phases/09-task-view-parity/09-10-SUMMARY.md"
  - ".planning/phases/09-task-view-parity/09-11-PLAN.md"
  - ".planning/phases/09-task-view-parity/09-11-SUMMARY.md"
  - "docs/src/content/docs/architecture.md"
  - "docs/src/content/docs/overview.md"
  - "docs/src/content/docs/testing.md"
  - "packages/git/src/commands.ts"
  - "packages/git/test/adapter.test.ts"
  - "packages/review/package.json"
  - "packages/review/src/core/taskview/model.test.ts"
  - "packages/review/src/core/taskview/model.ts"
  - "packages/surface/src/operations/sessions.ts"
  - "packages/surface/src/surface.ts"
  - "packages/surface/test/sessions.test.ts"
  - "packages/terminal-image/src/index.ts"
  - "packages/terminal-image/test/terminal-image.test.ts"
  - "packages/tui/package.json"
  - "packages/tui/src/app/App.tsx"
  - "packages/tui/src/app/artifact.tsx"
  - "packages/tui/src/app/context.ts"
  - "packages/tui/src/app/detail.tsx"
  - "packages/tui/src/app/diff.tsx"
  - "packages/tui/src/app/evidence-image.tsx"
  - "packages/tui/src/app/help.tsx"
  - "packages/tui/src/app/markdown.ts"
  - "packages/tui/src/app/task.tsx"
  - "packages/tui/src/app/tasklist.tsx"
  - "packages/tui/src/review/edit.ts"
  - "packages/tui/src/review/source.ts"
  - "packages/tui/test/fixtures.ts"
  - "packages/tui/test/review.test.tsx"
  - "packages/tui/test/taskview-smoke.ts"
  - "packages/tui/test/taskview.test.tsx"
  - "packages/web/src/app.html"
  - "packages/web/src/client/review-island.tsx"
  - "packages/web/src/review.ts"
  - "packages/web/src/server.ts"
  - "packages/web/test/live.test.ts"
  - "packages/web/test/taskview.test.ts"
covered_digest: "v3:sha256:c8e8b4e306b35abd93533412cce71f2d03ae9ddad00f95150abae9f64c660018"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 5/5 must-haves verified (3 gaps from human-verification items promoted by user decision 2026-11-11)
  gaps_closed:
    - "R34 — the task view's left rail is the working tasks list, in TUI and web, alongside the VIEWS nav; selecting a task switches the task view"
    - "The web worktree chip identifies the worktree by its short repo-relative path `.worktrees/<repo>-<id>`, full path in a tooltip, readable at ≤860px"
    - "Untracked (never `git add`ed) new files appear in the live changeset — CHANGES, diff, minimap, counts — in TUI and web (tasks-n5xi)"
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "WORKSPC tab carries the mock's `commit` / `open pr` buttons"
    addressed_in: "Phase 11"
    evidence: "Orchestrator-declared out of scope for Phase 9; Phase 11 (PR sidecar) owns commit / open-pr actions"
advisory:
  - finding: "`taskview-smoke.ts` flaked once under load: run 1 of 5 reported `11 passed, 1 failed` (only the tail was captured, so the failing check is unknown); runs 2-5 were `12 passed, 0 failed`. 09-10 also saw one `9 passed, 3 failed` run under load"
    category: other
    reason: "Probe timing sensitivity under concurrent load; capture the full output of a failing run to identify the check and harden its wait"
    evidence_status: "none provided (not reproducible on re-run)"
  - finding: "`packages/web/test/live.test.ts` 'worktree commit pushes a branch frame' failed once (no SSE frames seen) while taskview-smoke ran concurrently; 5/5 pass on re-run alone. The 10-04 executor is editing `/events` in the same package"
    category: other
    reason: "Load-sensitive SSE timing or a 10-04 mid-edit; not a Phase 9 file path"
    evidence_status: "none provided (passes on re-run)"
  - finding: "tk task `tasks-n5xi` (untracked files) is still `open`: 09-09 added a note but neither finished nor closed it"
    category: other
    reason: "Bookkeeping only — the fix is verified; a reviewer should `tk close tasks-n5xi` with the 09-09 report"
    evidence_status: "tk show tasks-n5xi → status open"
---

# Phase 9: Task View Parity Verification Report

**Phase Goal:** The task view matches the spec in both shapes — work front and center, sessions in a tabbed rail, review starting where the work is
**Verified:** 2026-11-11T16:07:18Z
**Status:** passed
**Re-verification:** Yes — after gap closure (plans 09-09, 09-10, 09-11)

> Mode note: ROADMAP marks Phase 9 `Mode: mvp`, but the goal is not a User Story. As in the initial run, the phase is verified with the standard goal-backward method against the 5 ROADMAP success criteria plus the 3 carried gaps; no User Flow Coverage table.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1 — description front and center, evidence-backed ARTIFACTS, COMMENTS preview; never leads with sessions (TUI + web) | ✓ VERIFIED (regression) | tmux 160 cols: title → meta → chips → `◧ v open diff` → description → `ARTIFACTS — evidence on the task` → `COMMENTS · 0`. Web 1280: same order. `taskview.test.tsx` "center column leads with the work" passes |
| 2 | SC2 — tabbed rail SESSIONS / CHANGES / WORKSPC / MINIMAP, CHANGES live from the worktree | ✓ VERIFIED (regression) | TUI Tab cycled CHANGES → WORKSPC (`branch tk/tk-8xk → 5a78731`, `worktree .worktrees/v09brepo-tk-8xk`, `state 2 dirty`). Web `role=tab` with `aria-selected`; CHANGES updated live (see truth 8) |
| 3 | SC3 — no start-work on ready-to-review; open diff primary; worktree chip kept on narrow views | ✓ VERIFIED (regression) | TUI @120: TASKS hidden, chips intact; web @760: `.wtchip` display:block, `.brchip` display:none, rail stacked below main. Tests from 09-03/09-06 pass |
| 4 | SC4 — changes → diff modal over the task view; modal → full view; evidence commentable in the diff flow | ✓ VERIFIED (regression) | Web: click `src/untracked.ts` row → `#diffModal` flex, `tk-8xk / src/untracked.ts A +1 −0 ⤢ full view esc close @@ -0,0 +1 @@ ＋ comment on this file`; Esc → none. taskview-smoke checks 1–9 (modal, `f` full view, `]` into EVIDENCE) green on runs 2–5 |
| 5 | SC5 — distinct commentable artifact view (DOC / CODE / EVIDENCE) | ✓ VERIFIED (regression) | taskview-smoke checks 10–11 (`o` → CODE view, `c` comment lands on record) green; web taskview tests pass |
| 6 | R34 — left `TASKS` column of working tasks beside (not replacing) the VIEWS nav; selecting a task switches the task view (TUI + web) | ✓ VERIFIED (gap closed) | **TUI** (`tasklist.tsx`, `task.tsx:105,153-160,365`, `App.tsx:278,588`): tmux @160 shows `VIEWS` and `TASKS` side by side, rows `● second open task`, `● first working task`, closed `third closed task` absent, `▎` on the shown row, footer `[ ] switch task`. `]` → header `first working task`, `tk-8xk`, chips `[ worktree .worktrees/v09brepo-tk-8xk ]  [ tk/tk-8xk → 5a78731 ]`, `▎` moved, rail followed (CHANGES for tk-8xk). @120 cols: 0 `TASKS` matches. Click covered by `mockMouse.click` test; `]]` burst covered by smoke check 12. **Web** (`app.html:1037-1056,1068,1121,1593-1597`): `#taskView.firstElementChild` = `ttasks`; text `TASKS · second open task · first working task · [ ] switch task` (closed absent); `aria-current` on `tk-8xk`; click `tk-8b9` row → URL `/tasks/tk-8b9`, `.thead` `tk-8b9 second open task`, window marker kept (no page load); `[` → tk-8xk; `]` `]` → tk-8b9 → tk-8xk (wrap); after 4.5s of polls the column and highlight remain, marker kept; `]` with the diff modal open leaves the URL unchanged; switching closes the modal (`display:none` on tk-8b9); 1000px and 760px: `.ttasks` not visible. Sidebar List/Board/Graph/Insights/Review unchanged |
| 7 | Web worktree chip reads `.worktrees/<repo>-<id>`, full path in tooltip, legible at ≤860px | ✓ VERIFIED (gap closed) | `review.ts:213` `worktreeLabel`, payload `workspace.worktreeLabel: ".worktrees/v09brepo-tk-8xk"` (worktree stays absolute). 760px: `.wtchip` text `worktree .worktrees/v09brepo-tk-8xk`, `scrollWidth 273 <= clientWidth 273`, `title` = absolute path; WORKSPC row `.worktrees/v09brepo-tk-8xk`, title absolute. Route + unit tests in `taskview.test.ts` pass |
| 8 | Untracked (never added) files appear live in CHANGES, diff, minimap, counts (TUI + web); index untouched | ✓ VERIFIED (gap closed) | `commands.ts:103-191` (`gitUntrackedFiles` + `gitDiffNewFile`, read-only, 200-file / 1 MiB caps, range form returns early). Payload stats: `src/a.ts M`, `src/live2.ts A`, `src/untracked.ts A`. TUI: writing `src/live2.ts` while the task view was open added `live2.ts [A]` within 4s. Web: writing `src/live3.ts` moved CHANGES `ALL (3)` → `ALL (4)` with `live3.ts A` within 3.5s, no reload. Diff modal on `src/untracked.ts` shows `A +1 −0`, `@@ -0,0 +1 @@`. `git diff --cached --name-only` empty throughout. Adapter tests (ignored files, index bytes unchanged, argv, caps), TUI `review.test.tsx` and web `live.test.ts` untracked cases pass |

**Score:** 8/8 truths verified (0 present, behavior-unverified)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | WORKSPC `commit` / `open pr` buttons from the mock | Phase 11 | Declared out of scope by orchestrator; Phase 11 PR sidecar |

### Advisory (New Scope, Unevidenced)

| # | Finding | Category | Why Advisory |
|---|---------|----------|--------------|
| 1 | taskview-smoke flaked 1/5 runs under load (failing check not captured) | other | not reproducible on re-run; no deterministic evidence |
| 2 | web `live.test.ts` branch-frame case failed once under concurrent load, passes alone 5/5 | other | concurrent 10-04 `/events` work; not reproducible |
| 3 | `tasks-n5xi` still `open` in tk | other | bookkeeping; fix verified |

### Required Artifacts (gap-closure plans)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/git/src/commands.ts` | `gitUntrackedFiles`, `gitDiffNewFile`, caps; `gitDiffPatch` working-tree form includes untracked | ✓ VERIFIED | substantive; consumed unchanged by TUI source/live and web `diffPatch` (live payload shows `A` rows) |
| `packages/git/test/adapter.test.ts` | untracked / ignored / index / caps / range cases | ✓ VERIFIED | in passing `packages/git` run |
| `packages/tui/src/app/tasklist.tsx` | `TaskList`, `workingTasks`, `TASKS_WIDTH` 24, `TASKS_MIN_WIDTH` 130 | ✓ VERIFIED | imported and rendered by task.tsx; observed in tmux |
| `packages/tui/src/app/App.tsx` / `context.ts` | `openTask`, keyed `<TaskView key=…>` | ✓ VERIFIED | `App.tsx:278`, `:588`; rail reset on switch observed |
| `packages/tui/test/taskview.test.tsx`, `taskview-smoke.ts` | TASKS frame tests, smoke check 12 | ✓ VERIFIED | pass |
| `packages/web/src/review.ts` | `worktreeLabel` + `workspace.worktreeLabel` | ✓ VERIFIED | live payload |
| `packages/web/src/app.html` | `.ttasks`, `[`/`]`, `wtLabel`, 1100px rule, quote-safe `esc` | ✓ VERIFIED | observed in browser; `esc` ends with `.replace(/"/g, "&quot;")` (line 634) |
| `packages/web/test/taskview.test.ts`, `live.test.ts` | label + shell + untracked live cases | ✓ VERIFIED | pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `gitDiffPatch` (to === null) | TUI `source.ts` / `live.ts`, web `review.ts diffPatch` | single adapter call | WIRED | untracked rows in both shapes with no consumer change |
| tasklist row click / task.tsx `[` `]` | `actions.openTask` → `detailId` → keyed TaskView → `ensureReview` | AppActions | WIRED | header, chips and rail followed the switch in tmux |
| app.html `.ttask` click / `[` `]` | `switchTask` → `closeDiffModal` → `navigate(taskUrl(id))` | client router | WIRED | URL changed, no page load, modal closed |
| app.html `.wtchip` / WORKSPC row | `taskview.workspace.worktreeLabel` (tail-rule fallback) | `taskviewCache` | WIRED | label matches payload |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| TUI / web TASKS column | `state.board.issues` / `state.issues` | board RPC (real task store) | yes — 2 working tasks, closed one filtered | ✓ FLOWING |
| web chip label | `workspace.worktreeLabel` | `worktreeLabel(root, worktree)` from issue metadata | yes | ✓ FLOWING |
| CHANGES untracked rows | `patchFileStats(patch)` | `git ls-files --others` + `git diff --no-index` | yes — `live2.ts`, `live3.ts`, `untracked.ts` | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase test suites (run 1) | `bun test --timeout 30000 packages/tui/test packages/web/test packages/git packages/review/src/core/taskview` | 239 pass, 1 fail, 1 error, 24 files (175s). The fail and error are `packages/web/test/server.test.ts` failing to load: `Export named 'createEventRing' not found in module packages/web/src/server.ts` — the concurrent 10-04 executor had the test ahead of the source | ✓ PASS (concurrent mid-edit, not Phase 9) |
| Web + git re-run (run 2, with taskview-smoke running concurrently) | `bun test --timeout 30000 packages/web/test packages/git` | 120 pass, 1 fail (16 files): `live.test.ts` "worktree commit pushes a branch frame" saw no SSE frames; `server.test.ts` now loads and passes | ⚠️ load-sensitive |
| Web live re-run (run 3) | `bun test --timeout 30000 packages/web/test/live.test.ts` | 5 pass, 0 fail | ✓ PASS |
| Typecheck tui / web / git | `bunx tsc --noEmit -p tsconfig.json` | exit 0 ×3 | ✓ PASS |
| Docs build | `cd docs && bun run build` | exit 0 | ✓ PASS |
| taskview payload | `curl /api/review/tk-8xk/taskview` | `worktreeLabel ".worktrees/v09brepo-tk-8xk"`, stats include `A` untracked rows, `dirty: 3` | ✓ PASS |
| TUI e2e (tmux 160×45 → 120, socket `v09b-sock`, killed after) | `bun packages/tui/src/main.tsx <scratch>`, keys `5`, `]`, Tab, BTab, live file write, resize | as in truths 6 and 8 | ✓ PASS |
| Web e2e (agent-browser `verify09b`, port 60729, 1280 / 1000 / 760; bun pid killed, browser closed, port answers 000) | see truths 6–8 | all steps matched | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `packages/tui/test/taskview-smoke.ts` | `bun packages/tui/test/taskview-smoke.ts` ×5 | run 1: `11 passed, 1 failed` (failing check not captured); runs 2, 3, 4, 5 (run 5 under concurrent web+git test load): `12 passed, 0 failed`, exit 0 | PASS (1 flake, see advisory) |
| `packages/tui/test/review-smoke.ts` | `bun packages/tui/test/review-smoke.ts` | `review-smoke: all green (9 checks)` | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| VIEW-01 | 09-01, 09-03, 09-05, 09-06, 09-08, 09-10, 09-11 | work front and center; evidence artifacts; comments; left TASKS rail (R34) | ✓ SATISFIED | truths 1, 6 |
| VIEW-02 | 09-01, 09-02, 09-03, 09-06, 09-09 | tabbed rail; changes reads the worktree live (R67) incl. untracked | ✓ SATISFIED | truths 2, 8 |
| VIEW-03 | 09-03, 09-06, 09-11 | no start-work on ready-to-review; open diff primary; worktree legible narrow (R69, R70) | ✓ SATISFIED | truths 3, 7 |
| VIEW-04 | 09-01, 09-02, 09-04, 09-05, 09-07, 09-08 | diff modal, full view, evidence in diff flow, artifact view | ✓ SATISFIED | truths 4, 5 |

No orphaned requirements: REQUIREMENTS.md maps only VIEW-01..04 to Phase 9.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| gap-closure files (commands.ts, tasklist.tsx, task.tsx, App.tsx, review.ts, app.html) | — | TBD / FIXME / XXX / TODO / HACK | none found | — |
| `packages/web/src/app.html` (1280px) | review doors | the `web http://localhost:…/tasks/<id>` door link renders low-contrast (link colour on a highlighted background) at 1280; readable at 760 | ℹ️ Info | cosmetic, predates the gap closure |
| `packages/web/src/app.html` (760px) | top bar | header overflows at 760px (`New issue` clipped, `stop` off-screen) | ℹ️ Info | predates Phase 9 gap closure; not in VIEW-03 scope (worktree chip is) |
| scratch repo | — | after `tk work`, the task still reads `open` in both TUI and web meta (`tk-8xk · open`), so both TASKS dots share a colour | ℹ️ Info | `tk work` status semantics, not a Phase 9 file |
| web vs TUI | — | the TUI keyed remount resets the rail tab on a task switch; the web keeps the global `state.railTab` | ℹ️ Info | documented in 09-11 SUMMARY |

### Concurrency note

The 10-04 executor (packages/web `/events`, app.html event refresh) and the 10-05 executor (packages/tui store/board) were active. Run 1 of the suite hit a 10-04 mid-edit: `server.test.ts` imported `createEventRing` before `server.ts` exported it. A scratch file `packages/web/test/zzbase-live.tmp.test.ts` and `packages/web/src/zzbase-server.tmp.ts` also exist, presumably theirs. In run 2 `server.test.ts` passed, and the only failure was a load-timed SSE case that passed alone. Both runs are reported above.

### Human Verification Required

None. Every gap was closed and checked live in the real TUI binary (tmux) and the web (agent-browser) against a scratch `tk work` repo with three tasks and untracked files.

### Gaps Summary

All three gaps from the previous verification are closed and nothing regressed.

1. **R34 working-tasks rail.** It is present in both shapes, beside the existing VIEWS nav, filters out closed tasks, highlights the shown task, and switches by click or `[` / `]` with wrap-around. It hides below 130 columns in the TUI and at ≤1100px in the web.
2. **Web worktree chip.** It reads `worktree .worktrees/<repo>-<id>` with no truncation at 760px, and the absolute path is in the tooltip.
3. **Untracked files.** They appear live as `A` rows in CHANGES, the diff modal and the payload stats in both shapes, and the index is never touched.

Remaining are advisories only: one taskview-smoke flake under load, one load-timed web SSE test, and `tasks-n5xi` still open in tk. WORKSPC commit / open-pr is deferred to Phase 11.

---

_Verified: 2026-11-11T16:07:18Z_
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
- Phase-specific recheck (8/8 truths). The taskview smoke checks 1–11 (SC1–SC5) were green on all 5 runs. Check 12 (R34) was green on 3 of 5 runs. In the 2 failing runs the captured frames still show correct `]`/`[`/`]]` switching and highlighting (see the flake analysis above). It stays an advisory, not a gap. `tasklist.tsx` and `worktreeLabel` (`review.ts:218`) are present. `gitUntrackedFiles` and `gitDiffNewFile` are at `commands.ts:103,124`. The taskview, review and live untracked tests are green.
- Advisory carried forward: the check-12 harness is still timing and start-state sensitive. The `${id} · ` wait can also match an event toast. Hardening the smoke (`openTask(id)` before creating tasks, and anchoring the header match) is a test-only follow-up.


Fingerprint regenerated 2026-11-12 after the milestone-audit gap fix (packages/tui/src/review/source.ts frozen-snapshot fallback; packages/tui/test/frozen-source.test.ts 2/2, full tui suite 127/0, tsc clean, live tmux on a closed+pruned task).
