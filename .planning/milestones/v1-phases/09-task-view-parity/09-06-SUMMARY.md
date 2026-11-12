---
phase: 09-task-view-parity
plan: 06
subsystem: web
tags: [web, task-view, rail, taskview, sse]
status: complete
requires: [09-01, 09-02, 05-01, 05-02, 05-03, 05-04, 07-03, 08-03]
provides:
  - "`GET /api/review/:id/taskview` → `{ stats, changes, minimap, artifacts, sessions, workspace: { branch, base, worktree, host, dirty }, comments: { counts, rows } }`"
  - "`taskViewFor(root, issue, threads, sessions, runner?)` in packages/web/src/review.ts"
  - "Web task view: work → ARTIFACTS → COMMENTS center column; tabbed rail SESSIONS · CHANGES · WORKSPC · MINIMAP (`role=tab`, `aria-selected`, `state.railTab`)"
  - "Palette: ready-to-review → `open diff <id>` instead of `start <id>`; narrow (≤860px) keeps `.wtchip`, hides `.brchip`"
affects: [09-07 (diff modal wires `[data-open-diff]` / `data-hunk`), 09-08 (artifact rows, docs)]
key-files:
  created:
    - packages/web/test/taskview.test.ts
  modified:
    - packages/web/src/review.ts
    - packages/web/src/server.ts
    - packages/web/src/app.html
    - docs/src/content/docs/architecture.md
decisions:
  - "The task view's per-issue cache is `taskviewCache` (replaces 05-02's `threadCache`); it is refetched on entering the view, on a `review` SSE frame for the task on screen, and when the board poll shows the record's `updatedAt` moved. It is never fetched on a timer."
  - "COMMENTS preview rows come from the server (`comments.rows`): `first` has the stored `[review …]` prefix stripped (same regex as the island's `displayBody`), `location` is `path:line[-end]` / `path (file)` / `evidence:<id>`, `filePath` is null for evidence rows."
  - "Changed-file rows and minimap bars are `<a data-open-diff>` links to `/tasks/:id/diff?file=` (routed in place) until 09-07 swaps in the modal; bars also carry `data-hunk`."
  - "The rail tab and CHANGES filter live in `state.railTab` / `state.changesFilter`, so the 2s poll's `innerHTML` re-render keeps them; a tab click only flips `hidden`/`aria-selected`, without a refetch."
requirements-completed: [VIEW-01, VIEW-02, VIEW-03]
metrics:
  tasks: 3
  completed: 2026-11-10
actuals:
  tasks: 3
  commits: 0
---

# Phase 9 Plan 06: Web task view — tabbed rail, artifacts-first center column — Summary

`/tasks/:id` now leads with the work. The center column reads, in order:

1. title and status chip
2. `worktree <path>` and `<branch> → <base7>` chips
3. `◧ open diff`, with the note `work already begun — opens the diff` when the task is ready-to-review
4. the description
5. `ARTIFACTS — evidence on the task`: typed `N src · N edit · N new · N other` pills, `GROUPED`, then `IN CHANGES` / `UNREFERENCED (n)` groups. Rows carry a `● N` or `—` comment pill. Image evidence gets a 28px thumbnail that opens the existing viewer, and file rows link to the 05-03 artifact view.
6. `COMMENTS · N`, with an avatar initial, the first line and `→ location`
7. the doors

The rail is tabbed exactly as in the mock: `SESSIONS · CHANGES · WORKSPC · MINIMAP`, with CHANGES selected by default. Every rail panel and the artifact and comment sections read one server-side payload, `GET /api/review/:id/taskview`. It is built through `@tasks/review/taskview` from the same working-tree patch as `/api/review/:id`, plus `surface.taskSessions` and `gitDirtyCount`.

**Commits withheld per AGENTS.md** (conservative profile). All changes are uncommitted in the main tree, and STATE.md and ROADMAP.md are untouched.

## Tasks

| Task | Name | Status | Files |
|------|------|--------|-------|
| 1 (tracer) | worktree edit → `/taskview` changes → tabbed rail CHANGES → SSE refresh | done | review.ts, server.ts, app.html, taskview.test.ts |
| 2 | SESSIONS / WORKSPC / MINIMAP panels, ARTIFACTS main column, COMMENTS preview | done | review.ts, app.html, taskview.test.ts |
| 3 | no start-work on ready-to-review; narrow view keeps the worktree chip | done | app.html, taskview.test.ts |

### What changed

- **review.ts:**
  - New `taskViewFor` and the payload types `TaskViewPayload`, `TaskViewWorkspace` and `TaskViewCommentRow`.
  - `ReviewIssueLike` gains `attachments?`.
  - `dirty` is null when there is no worktree, or when the worktree directory is gone.
  - `host` comes from `os.hostname()`.
- **server.ts:** inside the review route block, `sub === "taskview" && GET` returns `taskViewFor(active.root, issue, threads().list(rid).threads, active.surface.taskSessions(rid))`. A task without a branch returns 200 with empty lists.
- **app.html:**
  - `threadCache`/`loadThreads` are replaced by `taskviewCache`/`loadTaskView`. The in-flight guard coalesces overlapping requests into one re-run.
  - The `review` SSE listener and `applyRoute` now call `loadTaskView`.
  - `renderTask` was rebuilt with these helpers: `artifactsSection`, `commentsPreview(issue, cached)`, `railPanels`, `selectRailTab` (Left/Right arrow keys move between tabs) and `RAIL_TABS`.
  - The palette shows `rtr ? open diff : start`.
  - New CSS: `.rtabs`, `.rtab[aria-selected="true"]` (accent text with a 2px accent underline), `.rpanel`, `.crow`, `.stable`, `.wsrow`, `.mmap`/`.mbar`, `.arow`/`.athumb`, `.pill.amber`/`.pill.del`, and a 860px media block (`.brchip` hidden; `.wtchip` ellipsized).
  - All interpolated values go through `esc()`. Numeric style values are coerced with `Number()`, and URLs are built with `encodeURIComponent`.
  - Not touched: `renderList`, `cardHtml`, `.lrow` (07-03), the island and its comment controls (08-03), and the `/diff`, `/file` and edit routes (05-0x).
- **taskview.test.ts (new, 3 cases):**
  - The changes tree, `needsReview` clearing after `resolved`, the comment row shape, and a branchless task returning 200 with empty lists.
  - Evidence counts and comment pills, host, dirty, minimap, and the sessions row after `tk finish --session s1`.
  - Shell checks: the `RAIL_TABS` labels, `railTab: "changes"`, `role="tablist"`, `/taskview`, and the palette guard.
- **architecture.md:** the Web Path review sentence now describes the task view layout, the `/taskview` payload and its refresh triggers, the palette rule and the narrow behaviour. I made this change because of the AGENTS.md doc rule; 09-08 still owns the fuller doc pass.

## Verification

| Command | Result |
|---|---|
| `bun test --timeout 20000 packages/web/test/taskview.test.ts packages/web/test/server.test.ts` | 19 pass, 0 fail |
| `bun test --timeout 20000 packages/web/test` | 26 pass, 0 fail (5 files) |
| `cd packages/web && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `cd docs && bun run build` | Complete |

**Browser probe.** Session `AGENT_BROWSER_SESSION=gsd0906`, port 51013. I started the server after all code edits and used the scratch repo from the plan's `probe_recipe`.

- **Task 1:**
  - `.rtab[data-tab="changes"][aria-selected="true"]` was present on load.
  - The CHANGES panel showed `ALL (1) TO REVIEW (1) ▸ src/ ● a.ts M ●`.
  - I wrote `b.ts` and ran `git add -N`, then waited 2.5s. The panel then showed `b.ts A ●` with no reload.
  - Clicking WORKSPC hid `[data-panel=changes]` and showed workspace.
  - Over 6s idle, the `/taskview` resource count stayed at 2 → 2, so there is no polling. WORKSPC stayed selected across the 2s polls.
- **Task 2:** I attached `shot.png` as evidence, ran `tk finish --session s1`, and added an evidence comment and a line comment.
  - `#taskView`: ARTIFACTS appears before COMMENTS, `1 OTHER` is shown, `shot.png ● 1`, and no `[review` prefix is visible. The comments appeared through the `updatedAt` refetch, not through an SSE frame.
  - SESSIONS: `DONE  omp · session s1  10s`.
  - WORKSPC: `branch tk/tk-lsv → c45399e`, the worktree, `host Yuris-MacBook-Pro-2.local`, `2 DIRTY`.
  - MINIMAP: 2 `[data-hunk]` bars.
  - The thumbnail opens the viewer.
  - A CHANGES `a.ts` click goes to `/tasks/tk-lsv/diff?file=src%2Fa.ts`, and back returns to `/tasks/tk-lsv`.
  - A comment row click goes to `/tasks/tk-lsv/file?path=src%2Fa.ts`.
- **Task 3:** the task was ready-to-review after `tk finish`.
  - At 1280×900 there is 1 `#taskView .btn.primary`.
  - The palette, filtered by id, lists `open diff tk-lsv`, `send … to review`, `reopen`, `close` and `claim`, and has no `start tk-lsv`. Choosing `open diff` goes to `/tasks/tk-lsv/diff`.
  - Regression check: an open task (`tk-huy`) still lists `start tk-huy`. Its CHANGES panel says `no branch yet — tk work tk-huy`.
  - At 600×900 after a reload: `.wtchip` visible = true, `.brchip` visible = false, the rail sits below the main column at full width, and there is no horizontal overflow.
- **Screenshots:**
  - `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0906b/09-06-rail.png`
  - `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0906b/09-06-wide.png`
  - `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0906b/09-06-narrow.png`
- **Teardown:** the browser is closed. The real bun pid 73241 was killed, `pgrep` finds nothing, and the port answers 000.

## Deviations from Plan

1. **[Rule 2] Refetch when `updatedAt` moves.** A comment or an attachment changes the record but sends no `review` SSE frame. With a cache filled only on SSE, the COMMENTS and ARTIFACTS sections would go stale until a worktree edit. `renderTask` therefore refetches once when the issue's `updatedAt` differs from the value the cache was read at. This is not timer polling; the probe confirmed 0 fetches while idle.
2. **[Rule 2] Server-side prefix strip.** The plan's `first: first line of first comment` would have shown the stored `[review src/a.ts:1] ` prefix in the task view. 08-03 strips it only in the island. `commentRow` strips it with the same regex.
3. **`comments.rows[].filePath` added** (null for evidence). The task view needs it to link file-located rows to the 05-03 artifact view, and it avoids parsing `location` on the client.
4. **`.wtchip` uses `display: inline-block`**, not the plan's `inline-flex`. `text-overflow: ellipsis` does not apply to the text node inside a flex container. With inline-block the path ellipsizes correctly at 600px.
5. **Shell assertion shape.** The tab buttons are rendered from `RAIL_TABS` in JS, so the served HTML has no literal `data-tab="sessions"`. The test asserts the `RAIL_TABS` definition, the default `railTab: "changes"`, `role="tablist"` and the palette ternary instead. The browser probe proves the rendered DOM.
6. **TDD order.** The route tests (cases 1 and 2) were written right after `taskViewFor` and the route, so they passed on first run; no RED run was captured for them. The shell case was RED (missing tabs) before the app.html change and GREEN after.
7. **Extras:** Left/Right arrow keys move between rail tabs (WAI-ARIA tabs pattern, `tabindex` roving). The CHANGES empty state names `tk work <id>` for a branchless task. The ARTIFACTS empty state names `tk attach <id> --evidence <file>`.

## Threat Model

- **T-09-12** (mitigated): every interpolation uses `esc()`, including `data-open-diff`, `data-file` and `title` values. Links use `encodeURIComponent`. Style heights and bar indices are `Number()`-coerced, and colours come from fixed literals.
- **T-09-13** (accepted): `workspace.host` is sent to the localhost-bound server.
- **T-09-14** (mitigated): only the task on screen refetches, triggered by SSE or an `updatedAt` change. The poll re-renders from the cache, and an in-flight guard coalesces bursts.
- **T-09-SC:** no package installs.

## Notes / Follow-ups

- 09-07: wire `a[data-open-diff]` (rows and `.mbar` with `data-hunk`) to the modal. They currently route to `/diff?file=`. Clicking the selected CHANGES tab does nothing yet.
- WORKSPC has no `commit` / `open pr` buttons (they are in the mock). No plan covers them.
- The wide view wraps a long worktree path onto two lines inside the chip. This is acceptable, but a later polish could ellipsize it at all widths.

## Self-Check: PASSED

- FOUND: packages/web/test/taskview.test.ts; modified review.ts, server.ts, app.html, architecture.md present.
- Every verify command was re-run green after the last code edit. The docs build ran after the docs edit.
- Commits: none (withheld per AGENTS.md).
