---
phase: 05-web-review
plan: 02
subsystem: web
tags: [web, review, router, task-view, theme]
requires:
  - phase: 05-01
    provides: "`event: review` SSE frame; ReviewIsland.refresh"
provides:
  - "`/tasks/:id` lands on the task view (record first) with `◧ open diff` as the primary action"
  - "`/tasks/:id/diff` diff deep link (`?file=` preselects) with `← task` back; history push/pop between the two views"
  - "Shell route for `/tasks/:id`, `/tasks/:id/diff`, `/tasks/:id/file` (file view itself is 05-03)"
  - "Island props `onBack`, `initialFile`, `theme`; diff follows `<html data-theme>`"
affects: [packages/web, docs/architecture.md, 05-03]
key-files:
  modified:
    - packages/web/src/server.ts
    - packages/web/src/app.html
    - packages/web/src/client/review-island.tsx
    - packages/web/test/server.test.ts
    - docs/src/content/docs/architecture.md
decisions:
  - "Router state lives in `state.route`; `switchView` (sidebar/keys) pushes `/` with `{view}` history state so reload/back stay honest after leaving a routed view"
  - "Island remount key is `id + initialFile`, so a `?file=` change remounts with the new preselection"
  - "`/tasks/:id/file?path=` is excluded from the `?path=<workspace>` repoint deep link"
  - "Dark diff background: `--diffs-dark-bg: var(--panel)` on `.dbody diffs-container` (in addition to the plan's two overrides) — the only variable that actually reaches code rows"
requirements: [WEB-01]
metrics:
  tasks: 3
  completed: 2026-11-10
---

# Phase 05 Plan 02: Task view landing, diff deep link, diff follows app theme — Summary

`GET /tasks/:id` now opens the task record, not the diff. The page shows the title, a status chip, the worktree path chip, a `branch → base` chip, the description, the review doors, a COMMENTS preview built from the review threads, and a rail with SESSIONS and ARTIFACTS. The primary action, `◧ open diff`, moves to `/tasks/:id/diff` with `history.pushState`, so there is no page reload. The diff view has a `← task` button, and browser back/forward moves between the two views. The diff now takes its theme from `<html data-theme>` (default `dark`) and no longer reads the OS color scheme.

**Commits withheld per AGENTS.md** (no git commit/push; all changes are in the main working tree; STATE.md/ROADMAP.md untouched).

## Tasks

| Task | Name | Status | Files |
|------|------|--------|-------|
| 1 (tracer) | `/tasks/:id` → task view → `◧ open diff` → `/tasks/:id/diff` and back | done | server.ts, app.html, review-island.tsx, test/server.test.ts |
| 2 | diff follows the app theme | done | app.html, review-island.tsx |
| 3 | docs: web doors land on the task view | done | architecture.md |

### What changed
- **server.ts:** the shell regex is now `/^\/tasks\/[^/]+(?:\/(?:diff|file))?\/?$/`, plus `/`. Any other `/tasks/...` path still gets the JSON `not_found` 404.
- **app.html:**
  - `<html data-theme="dark">`.
  - New `#taskView` container, plus `"task"` in `render()`'s view toggle. The filterbar stays hidden there, and the sidebar has no new item.
  - Router: `routeFromLocation()` decodes inside try/catch and returns `{view, id, file, path}`. `applyRoute()` checks the id against `state.issues` and toasts `no task <id>` when it is unknown. `navigate(url)` pushes history state, and a `popstate` listener re-applies the route. `/tasks/:id/file` lands on the task view until 05-03 wires it.
  - The one-shot `deepLinked` block in `refresh()` is replaced by a first-load `applyRoute`.
  - `renderTask()` reuses `statchip`, `doorsHtml`, `agentLine`, `commentsLine`, `blobAtts`, `blobUrl` and `openViewer` unchanged. Every interpolated value goes through `esc()` (T-05-04).
  - Comment rows show a status glyph, the author, the first line of the body, and `→ filePath:line[–endLine]`, `filePath (file)` or `evidence:<id>`.
  - Threads are cached in `threadCache: Map`. They are fetched when the task view opens and when a `review` SSE frame names the task on screen. The 2s poll re-renders from the cache.
  - `renderReview` passes `onBack`, `initialFile` and `theme`. A routed diff for a task with no branch/base shows "no changes to review yet on <id>" with a back button; it never falls through to another task's diff.
  - CSS: `.tview` layout, with the rail stacking under `@media (max-width: 860px)`. The `[data-theme="dark"]` diff background overrides are listed under Deviations.
  - `renderList`, `cardHtml` and `.lrow` are untouched (07-03's doors stay intact).
- **review-island.tsx:**
  - `IslandProps` gains `onBack?`, `initialFile?` and `theme?`.
  - Theme state starts from the prop and follows a `MutationObserver` on `<html data-theme>`; the observer disconnects on unmount.
  - `FileDiff` gets `theme: {dark: "pierre-dark", light: "pierre-light"}` and `themeType: theme`. The `matchMedia` read is gone.
  - The `← task` button (`#diffBack`) shows in `.dmenu`, and also in the "no changes against base" head.
  - `initialFile` seeds `selectedPath`, and the default-selection effect now waits for the payload so the seed is not dropped before load.
- **server.test.ts:** new case checks that `/tasks/abc`, `/tasks/abc/`, `/tasks/abc/diff`, `/tasks/abc/diff/` and `/tasks/abc/file` each return 200 `text/html` with `id="taskView"` and `data-theme="dark"`, and that `/tasks/abc/nope` returns the JSON 404 `not_found`. It failed before the change and passes after.
- **architecture.md (~line 164):** the `GET /tasks/:id` sentence now covers the task-view landing, the `/tasks/:id/diff` deep link (`?file=`, `← task`) and the theme source. The rest of the paragraph is kept.

## Deviations from Plan

**1. [Rule 1 - Bug] The plan's diff background overrides don't reach code rows**
- **Found during:** Task 2 probe. Code-row background stayed `rgb(10,10,10)` with only `--diffs-bg-context-override` and `--diffs-bg-separator-override` set.
- **Cause:** @pierre/diffs paints rows and `pre` with `--diffs-bg = light-dark(var(--diffs-light-bg), var(--diffs-dark-bg))`. The theme sets `--diffs-dark-bg:#0a0a0a` on the shadow `:host`.
- **Fix:** kept both plan overrides (both names exist in `dist/style.js`) and added `[data-theme="dark"] .dbody diffs-container { --diffs-dark-bg: var(--panel); }`. A light-DOM rule outranks `:host`. Dark rows now paint `rgb(21,26,35)` (= `--panel`), and light mode is unaffected (`rgb(255,255,255)`).

**2. [Rule 2 - Correctness] `?path=` collision**
- The existing `?path=<workspace>` deep link would have repointed the workspace on `/tasks/:id/file?path=…`. It now returns early whenever the URL is a `/tasks/...` route.

**3. [Rule 2] Sidebar view switches after a routed view**
- `switchView` now pushes `/` (with `{view}` history state) when leaving a `/tasks/...` URL. Without this, a reload after clicking List would land back on the task.

## Verification

| Check | Result |
|-------|--------|
| `bun test --timeout 20000 packages/web/test` | 20 pass, 0 fail (new deep-link case was RED before the server/app change) |
| `cd packages/web && bunx tsc --noEmit -p tsconfig.json` | clean |
| `cd docs && bun run build` | Complete |
| `grep -c 'prefers-color-scheme' packages/web/src/client/review-island.tsx` | 0 |
| Task 1 probe (session `gsd0502`) | `#taskView` text has `probe task`, `SESSIONS`, `ARTIFACTS`, `probe note`, `src/a.ts:1`; `#reviewView` hidden; click `#openDiff` → URL `/tasks/tk-gxc/diff`, `.dmenu` present, `window.__marker` survived (no full load); back → `#taskView` visible; forward → diff; `#diffBack` → task view |
| Extra probe | Plain task (no worktree): "no changes to review yet" chip, and `/diff` shows the back message. `/tasks/<id>/file?path=src/a.ts` lands on the task view with no workspace repoint. `/tasks/nope` toasts `no task nope`. Sidebar List → `/`. `?file=src/b.ts` preselects `src/b.ts`. A new thread plus a worktree edit (a `review` frame) refreshes the COMMENTS preview in place, with the marker intact |
| Task 2 probe | Code row luminance: dark 0.0102 (`rgb(21,26,35)`), then `data-theme=light` gives 1.0 (`rgb(255,255,255)`), and flipping back to dark gives dark again. Evidence: `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0502/diff-dark.png`, `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0502/diff-light.png`, `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0502/task-view.png` |
| Probe teardown | server killed (verified not running), browser session closed |

### Probe observation (not a code change)
During an early probe run, `/api/review/:id` stalled in the browser twice. It stayed on "loading review…" and the fetch never completed, while `curl` to the same URL answered in about 80ms. That server had been running while I edited `app.html` mid-probe, which makes the dev shell ticker broadcast `data: reload` to every page.

To check, I restarted the server with temporary server-side request timing. 13 of 13 open-diff clicks completed in 66–85ms server time with no stall. I then removed the instrumentation; `server.ts` is byte-identical to the pre-debug version.

I could not pin down the root cause. My hypothesis is browser connection/reload churn from the shell ticker, not the new router. If it shows up outside dev edits, it needs a follow-up.

## Threat Model
- T-05-04 mitigated: every record field in `renderTask` and `commentsPreview` goes through `esc()`, including the title, description, comment author and body, location, attachment name, worktree path and branch. Attachment URLs come from `blobUrl` (`encodeURIComponent`).
- T-05-05 mitigated: `decodeURIComponent` runs in try/catch, the id is looked up in `state.issues` before use, and URLs are built with `encodeURIComponent` (`taskUrl` and `diffUrl`).
- T-05-SC: no new packages.

## Notes / Follow-ups
- No light palette exists yet. The app ships dark only, and `data-theme="light"` currently flips only the diff, as the plan intended.
- `/tasks/:id/file` is served and routed to the task view; 05-03 owns the file view.

## Self-Check: PASSED
- All modified files are present, and every verify command was re-run green after the last edit. No `DBG` lines remain in `server.ts`.
