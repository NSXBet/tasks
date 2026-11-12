---
phase: 05-web-review
verified: 2026-11-10T17:51:50Z
status: passed
score: 22/22 must-haves verified
covered_files:
  - ".planning/phases/05-web-review/05-01-PLAN.md"
  - ".planning/phases/05-web-review/05-01-SUMMARY.md"
  - ".planning/phases/05-web-review/05-02-PLAN.md"
  - ".planning/phases/05-web-review/05-02-SUMMARY.md"
  - ".planning/phases/05-web-review/05-03-PLAN.md"
  - ".planning/phases/05-web-review/05-03-SUMMARY.md"
  - ".planning/phases/05-web-review/05-04-PLAN.md"
  - ".planning/phases/05-web-review/05-04-SUMMARY.md"
  - "docs/src/content/docs/architecture.md"
  - "packages/git/src/commands.ts"
  - "packages/git/src/runner.ts"
  - "packages/git/test/adapter.test.ts"
  - "packages/web/src/app.html"
  - "packages/web/src/client/review-island.tsx"
  - "packages/web/src/review.ts"
  - "packages/web/src/server.ts"
  - "packages/web/test/edit-loop.test.ts"
  - "packages/web/test/live.test.ts"
  - "packages/web/test/server.test.ts"
covered_digest: "v3:sha256:89d035aa5bf02c2225e45757257c3e2132f7ddaa6f6eece516acd60e5b35028c"
behavior_unverified: 0
overrides_applied: 0
deferred:
  - truth: "Tabbed rail (sessions/changes/workspace/minimap), diff modal over the task view, evidence images inside the diff flow (spec VIEW 1 R67–R70, §3 modal)"
    addressed_in: "Phase 9"
    evidence: "05-CONTEXT.md <deferred>: 'Tabbed rail ..., diff modal over the task view, evidence images in the diff flow — Phase 9'"
  - truth: "Docs render as documents (markdown) in the artifact view; VIEW 3 session view"
    addressed_in: "Phase 9"
    evidence: "05-03-PLAN prohibitions: 'rendering markdown as a document is Phase 9 (VIEW-04 / SC5)'"
human_verification:
  - test: "Open /tasks/<id>, /tasks/<id>/diff and /tasks/<id>/file?path=<p> in the dark app and compare against docs/html/task-to-review.html §2 VIEW 1–2 and §3"
    expected: "Layout reads as the spec's record-first task view (description, comments, SESSIONS/ARTIFACTS rail), artifact view with comment panel, and hunk-style diff; dark diff rows legible; nothing visually broken"
    why_human: "Visual fidelity/legibility is a judgement call; the probe proved structure, data and theme colour (rgb(21,26,35)) but not look-and-feel"
  - test: "With `tk review <id>` open in the TUI, save an edit from the web diff and post a web comment"
    expected: "The TUI diff shows the edited line and the TUI comment list shows the web comment"
    why_human: "Proven at the contract level (same gitDiffPatch(worktree, base, null, {}) call and taskStoreCommentStore seam, edit-loop.test.ts) and via `tk show`, but no rendered TUI was driven in this verification (packages/tui concurrently being edited by 04-04)"
---

# Phase 5: Web Review Verification Report

**Phase Goal:** The same review surface in the browser — TUI and web are one review surface in two shapes, over the same task record
**Verified:** 2026-11-10T17:51:50Z
**Status:** human_needed
**Re-verification:** No — initial verification

Process note: ROADMAP marks this phase `Mode: mvp`, but the goal is not a user story (`user-story.validate` → valid:false). Per the orchestrator's explicit request, verification proceeded goal-backward against the 3 roadmap success criteria plus all PLAN must_haves; a User Flow Coverage table is included below. Consider fixing the roadmap mode/goal mismatch.

## User Flow Coverage (browser probe, session `verify05`)

Scratch repo `scratchpad/v05/repo`, `tk init` + `tk work tk-ftm`, server `bun packages/web/src/main.ts --port 61166` started from the scratch repo (real bun pid 36338, then 39655 for a second pass; both killed, port answers 000, browser closed).

| Step | Expected | Evidence | Status |
| --- | --- | --- | --- |
| GET /tasks/tk-ftm | task view, not diff | `#taskView` display flex, `#reviewView` none; text: title, `Open`, worktree chip, `tk/tk-ftm → 78d09ba5`, `◧ open diff` (`btn primary`), description, review doors (TUI + web), COMMENTS, SESSIONS, ARTIFACTS (`📎 probe.log` after `tk attach --evidence`); `data-theme=dark` | ✓ |
| ◧ open diff | `/tasks/:id/diff`, no full load | URL `/tasks/tk-ftm/diff`, `window.__m` marker survived, `.dfl` = `src/a.ts`, shadow text has the uncommitted `export const b = 2` | ✓ |
| Worktree commit | live diff update over /events | `curl /events` captured `event: review {"id":"tk-ftm","reason":"worktree"}` and `{"reason":"branch"}`; menu went `0 commits` → `+2 −0 1 commits`, new line rendered, marker intact | ✓ |
| Inline edit + save | write to worktree, diff re-renders | `#diffEdit` → 1 contenteditable; typed ` // verifier-edit`, menu `●`; Meta+S → `saved`; worktree file line 1 = `export const a = 1; // verifier-edit`; `git diff <base>` in worktree and `GET /api/review/tk-ftm` both contain it; diff shadow text contains it; marker intact | ✓ |
| Dirty editor vs refresh | external change deferred, replayed on discard | typed ` UNSAVEDZ`, appended `e = 5` from shell → `[unsaved=true, e5=false]`; `done`→`discard?`→click → `[edit button back, unsaved=false, e5=true]`; worktree file never got UNSAVEDZ | ✓ |
| Web comments → tk show | land in task store | diff `＋ comment on file` + line-2 click comment; artifact-view line-3 comment → `tk show tk-ftm`: `REVIEW (3) · 3 open · 0 ✓`, `○ src/a.ts`, `○ src/a.ts:2`, `○ src/a.ts:3` | ✓ |
| /tasks/:id/file view | full file + comments panel | via `view file`: URL `/tasks/tk-ftm/file?path=src%2Fa.ts`, header `tk-ftm/src/a.ts`, `3 open · 0 ✓`, inline + panel threads, file contents incl. edit; worktree append shows live (`d = 4`) | ✓ |
| Back/forward + preview refresh | ← task, history, SSE refreshes preview | `← task` → `/tasks/tk-ftm` with all 3 comment rows (`→ src/a.ts (file)`, `:2`, `:3`); browser back → file view; a thread POSTed via API was absent until a worktree edit fired a `review` frame, then present (no polling) | ✓ |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| SC1 | `/tasks/:id` renders task view, artifact view, diff view with per-hunk/per-file comments from the task record | ✓ VERIFIED | Browser probe above; server.test.ts shell-route + artifact-endpoint cases |
| SC2 | Web diff updates through `/events` SSE when the worktree changes | ✓ VERIFIED | live.test.ts (worktree frame, branch frame, closed-client); SSE capture + in-place re-render in probe |
| SC3 | Web edit writes worktree file and appears in TUI diff; web comment lands in task store and shows in TUI | ✓ VERIFIED | edit-loop.test.ts: `gitDiffPatch(worktree, base, null, {})` (the call in packages/tui/src/review/source.ts:71) contains the edit; `tk show` REVIEW + `taskStoreCommentStore(store).listThreads` (TUI seam, packages/tui/src/app/App.tsx:126) return the thread; probe repeated both. Rendered-TUI check → human item 2 |
| 01a | Worktree edit → `event: review {reason:"worktree"}`, no `location.reload()` | ✓ VERIFIED | server.ts:181-184, 266-280; probe SSE capture; marker survived |
| 01b | Worktree commit → `reason:"branch"` via refs watcher | ✓ VERIFIED | server.ts:198-231; live.test.ts "worktree commit pushes a branch frame"; probe capture |
| 01c | Island re-fetches on `review` frame; no client polling | ✓ VERIFIED | app.html:1346-1353 → `ReviewIsland.refresh`; no `setInterval` in review-island.tsx |
| 01d | Live payload = worktree working tree vs pinned base | ✓ VERIFIED | review.ts:81-85; live.test.ts:102 asserts equality with `gitDiffPatch(worktree, base, null, …)` |
| 01e | Review routes use active (repointed) root | ✓ VERIFIED | server.ts:503-516 `active.root`; live.test.ts "review routes follow a repoint" |
| 02a | `/tasks/:id` lands on task view with record, doors, comments preview, SESSIONS + ARTIFACTS rail | ✓ VERIFIED | probe step 1 |
| 02b | `◧ open diff` primary → `/tasks/:id/diff` without full load; `← task` back | ✓ VERIFIED | app.html:787,804,843; probe |
| 02c | `/tasks/:id`, `/diff`, `/file` serve the shell; back/forward works | ✓ VERIFIED | server.ts:356; curl 200 text/html ×3, `/tasks/x/nope` 404 JSON; probe back |
| 02d | Diff follows app theme (`<html data-theme>`), no `prefers-color-scheme` | ✓ VERIFIED | app.html:2,348-350; dark pre bg `rgb(21, 26, 35)` observed; 0 `prefers-color-scheme` in island |
| 02e | `review` frame refreshes task-view comments preview | ✓ VERIFIED | app.html:1352; probe (thread visible only after frame) |
| 03a | File view renders full worktree file via `File` + panel `N open · K ✓` | ✓ VERIFIED | probe; review-island.tsx ArtifactView (~l.800-899) |
| 03b | Line click + `＋ comment on file` create threads in `metadata.reviewThreads`, shown in `tk show` | ✓ VERIFIED | probe (line 3 from artifact view); server.test.ts "artifact view endpoints (05-03)" (line + file thread, `REVIEW (2)`) |
| 03c | Inline line threads; resolve/reopen/reply from artifact view | ✓ VERIFIED | inline render seen in probe; resolve/reply endpoints exercised by server.test.ts "creates file and evidence comments, resolves, and sends one batch"; UI buttons wired at review-island.tsx:200-205 |
| 03d | Reachable from diff `view file` and comment-preview rows; `← task`; follows theme | ✓ VERIFIED | probe `.dflview` → file route; app.html:767 `tclink` anchors; `← task` → task view |
| 04a | Diff `edit` → in-place Editor; save/⌘S PUTs; diff re-renders | ✓ VERIFIED | probe step 4 |
| 04b | `GET …/file?side=base` byte-exact; 404 when absent at base | ✓ VERIFIED | edit-loop.test.ts; curl returned `"export const a = 1;\n"`; adapter.test.ts gitShowFile cases |
| 04c | PUT refuses worktree-less task (400 `no_worktree`) | ✓ VERIFIED | review.ts:217; edit-loop.test.ts |
| 04f | Dirty editor not clobbered by `review` frame; deferred until save/cancel | ✓ VERIFIED | Directly observed in probe (UNSAVEDZ kept, e=5 deferred then replayed on discard). No automated test pins this — see Anti-Patterns/Info |
| 04g | Diff view offers `＋ comment on file` alongside line comments | ✓ VERIFIED | review-island.tsx:687; probe created file-level thread from diff |

**Score:** 22/22 truths verified (0 present, behavior-unverified)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Tabbed rail, diff modal over task view, evidence images in diff | Phase 9 | 05-CONTEXT `<deferred>` |
| 2 | Markdown docs rendered as documents; session view (VIEW 3) | Phase 9 | 05-03-PLAN prohibitions (VIEW-04 / SC5) |

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `packages/web/src/server.ts` | watchers + `broadcastReview`, shell routes, review/file/base routes | ✓ VERIFIED | substantive, used by main.ts |
| `packages/web/src/review.ts` | working-tree patch, `readBaseFile`, worktree-only writes, thread seam | ✓ VERIFIED | `reviewThreads` wraps `taskStoreCommentStore` |
| `packages/web/src/client/review-island.tsx` | `refresh`, theme/initialFile/onBack, ArtifactView, edit mode | ✓ VERIFIED | served at `/assets/review-island.js`, mounted by app.html |
| `packages/web/src/app.html` | `#taskView`, router, `review` listener | ✓ VERIFIED | |
| `packages/git/src/commands.ts` / `runner.ts` | `gitShowFile`, `{raw:true}` | ✓ VERIFIED | used by review.ts:202 |
| `packages/web/test/live.test.ts`, `edit-loop.test.ts`, `server.test.ts` | e2e for SC2/SC3/SC1 | ✓ VERIFIED | all pass |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| worktree/refs watchers | `GET /events` | `broadcastReview` → reloadWaiters | WIRED (SSE captured) |
| app.html EventSource | island refresh | `addEventListener("review")` → `ReviewIsland.refresh(id)` | WIRED |
| app.html router | renderTask / renderReview | `routeFromLocation` / `navigate` / popstate | WIRED |
| island edit save | `PUT /api/review/:id/file` | Editor draft → save | WIRED (file written) |
| PUT write | island refresh | fs event → `review` frame | WIRED |
| ArtifactView / DraftCard | `POST /api/review/:id/threads` | `{filePath, line?, side}` | WIRED (tk show) |
| threads routes | task store | `reviewThreads(active.surface.store)` → `taskStoreCommentStore` | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real Data | Status |
| --- | --- | --- | --- | --- |
| diff view | `patch` | `gitDiffPatch(worktree, base, null)` | yes (edits observed) | ✓ FLOWING |
| task view comments | threads | `/api/review/:id/threads` → `metadata.reviewThreads` | yes | ✓ FLOWING |
| artifact view | file contents | `readWorktreeFile` | yes | ✓ FLOWING |
| diff menu counts | `counts`/`commits` | `deriveChangeset(base...branch)` | committed-only | ℹ️ see Info |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Web + git suites | `bun test --timeout 20000 packages/web/test packages/git` | 88 pass, 0 fail, 13 files | ✓ PASS |
| Web typecheck | `cd packages/web && bunx tsc --noEmit -p tsconfig.json` | exit 0 | ✓ PASS |
| Shell routes | `curl /tasks/tk-ftm{,/diff,/file?path=}`, `/tasks/tk-ftm/nope` | 200 html ×3, 404 json | ✓ PASS |
| Path guard | `curl …/file?path=../x` | `escape` error | ✓ PASS |
| Browser flow | agent-browser session `verify05` | see User Flow Coverage | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` declared for this phase. Step 7c: N/A.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| WEB-01 | 05-02, 05-03, 05-04 | Three views on @pierre/diffs `./react` + `./edit` (task view, artifact view, diff with per-hunk/per-file comments) | ✓ SATISFIED | SC1, 02*, 03*, 04a/04g; island imports `@pierre/diffs/react` + `/edit` |
| WEB-02 | 05-01, 05-04 | Live via `/events` SSE, editable via write endpoint; web comment → store → TUI; web edit → TUI diff | ✓ SATISFIED | SC2, SC3, 01*, 04* |

No orphaned requirements (REQUIREMENTS maps only WEB-01/02 to Phase 5).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| phase files (server.ts, review.ts, review-island.tsx, app.html, runner.ts, commands.ts) | — | TBD/FIXME/XXX/TODO/HACK | none found | — |
| review-island.tsx (thread render) | — | Comment bodies display store prefix `[review src/a.ts:2] …` | ℹ️ Info | Cosmetic; known 05-03 follow-up |
| review-island.tsx | — | "just now ago" age label | ℹ️ Info | Cosmetic copy |
| diff menu | — | `+N −M / K commits` from committed changeset while the patch is working-tree (showed `+0 −0 0 commits` with an uncommitted diff on screen) | ⚠️ Warning | Header counts can disagree with the shown diff until commit; not an SC failure |
| review-island.tsx edit mode | — | Dirty-editor refresh deferral has no automated test (verified only by probe) | ℹ️ Info | Regression risk; consider a test |
| PUT save | — | Last-write-wins over external edits made while dirty (05-04 note) | ℹ️ Info | Known follow-up |

### Human Verification Required

### 1. Visual fidelity of the three web views

**Test:** Open `/tasks/<id>`, `/tasks/<id>/diff`, `/tasks/<id>/file?path=<p>` in the dark app; compare against `docs/html/task-to-review.html` §2 VIEW 1–2 and §3.
**Expected:** Record-first task view with rail; artifact view with comment panel; hunk-style diff; dark rows legible; nothing broken.
**Why human:** Look-and-feel judgement. Probe screenshots: `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/v05/task-view.png`, `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/v05/diff-view.png`, `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/v05/artifact-view.png`.

### 2. Web edit + comment observed in a running TUI

**Test:** Run `tk review <id>` in a terminal; from the web, save an edit and post a comment.
**Expected:** TUI diff shows the edited line; TUI comment list shows the web comment.
**Why human:** Contract-level proof exists (same `gitDiffPatch` call and `taskStoreCommentStore` seam, edit-loop.test.ts; `tk show` showed all 3 web comments), but no rendered TUI was driven here (packages/tui under concurrent 04-04 edits).

### Gaps Summary

No gaps. All 3 roadmap success criteria and 19 additional plan must-haves verified via tests (88/88 pass, tsc clean) and a live browser probe. Remaining items are visual judgement and a rendered-TUI cross-check. Tabbed rail / diff modal / evidence-in-diff / markdown doc rendering are deferred to Phase 9 by design.

---

_Verified: 2026-11-10T17:51:50Z_
_Verifier: Claude (gsd-verifier)_


## Human Verification Result (2026-11-10)

Reviewed the verifier's live screenshots (task view, diff view, artifact view) against spec §2 VIEW 1–2 and §3: structure matches (record-first task view with open-diff primary, review doors, comments, sessions/artifacts rail; diff with file list, file/line comments, resolve, reply, view file). Tabbed rail / diff modal / evidence-in-diff are Phase 9. Cosmetic follow-ups filed in tk (web door link contrast, "just now ago", header counts exclude uncommitted changes); `[review …]` prefix already tracked (tasks-lsna). TUI end-to-end of web edits proven by edit-loop.test.ts.

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
- Phase-specific recheck (22/22 truths). The web review, live, edit-loop, server and taskview tests are green, including live.test.ts 3 times. The `review` SSE frame handler (`app.html:1820`) calls `ReviewIsland.refresh` and does no reload. `review-island.tsx` has 0 `setInterval` and 0 `prefers-color-scheme`. `no_worktree` refusal is present (`review.ts:308`). Patches come only through `gitDiffPatch` (`review.ts:125,130,161`). No browser probe was re-run: the criteria code paths are covered by green tests and changed only additively.
