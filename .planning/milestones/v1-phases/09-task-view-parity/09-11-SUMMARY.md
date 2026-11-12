---
phase: 09-task-view-parity
plan: 11
subsystem: web, docs
tags: [task-view, tasks-column, worktree-label, r34, r70, gap-closure, browser-probe]
status: complete
gap_closure: true
requires: [09-06, 09-07, 09-09, 09-10]
provides:
  - "`worktreeLabel(root, path)` exported from packages/web/src/review.ts (TUI `displayPath` rule + `.worktrees/<name>` tail fallback)"
  - "`GET /api/review/:id/taskview` `workspace.worktreeLabel: string | null` (additive; `worktree` stays absolute)"
  - "Web task view: `<nav class=\"ttasks\" aria-label=\"tasks\">` as the first child of `#taskView`; `workingTasks`, `tasksColumn`, `switchTask`, `wtLabel` client helpers; `[` / `]` keys"
  - "`.wtchip` and the WORKSPC `worktree` row show the short label with the absolute path in `title`"
affects: [09-VERIFICATION gap 1 (web half), gap 2]
key-files:
  created: []
  modified:
    - packages/web/src/review.ts
    - packages/web/src/app.html
    - packages/web/test/taskview.test.ts
    - docs/src/content/docs/overview.md
    - docs/src/content/docs/architecture.md
requirements-completed: [VIEW-01, VIEW-03]
metrics:
  tasks: 2
  completed: 2026-11-11
actuals:
  tasks: 2
  commits: 0
---

# Phase 9 Plan 11: web TASKS column + short worktree label — Summary

**What changed for the user:** the web task view (`/tasks/<id>`) now has a `TASKS` column on the left, between the app sidebar (unchanged) and the work. It lists the working tasks with a status dot each and highlights the one on screen. A click on a row, or `[` / `]`, switches the page to that task in place. The worktree chip reads `worktree .worktrees/<repo>-<id>`, with the full path on hover, and it fits at 760px.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Short worktree label (server + chip + WORKSPC) | withheld | review.ts, app.html, taskview.test.ts |
| 2 | TASKS column + `[`/`]`, docs, browser probe | withheld | app.html, taskview.test.ts, overview.md, architecture.md |

Commits were withheld per AGENTS.md (conservative profile, orchestrator override). All changes are uncommitted in the main tree. STATE.md and ROADMAP.md were not touched. Nothing under packages/surface, rpc, luau, cli watch or packages/tui was touched, and the `board.get` payload is unchanged.

## What was built

- **review.ts.** `worktreeLabel(root, path)` returns:
  - `relative(root, path)` when it is non-empty, not `..`-prefixed and not absolute;
  - else the `.worktrees/<name>` tail (from the last `/.worktrees/`);
  - else the path. `null` in gives `null` out.

  `TaskViewWorkspace` gains `worktreeLabel`, and `taskViewFor` fills it.
- **app.html, label.** `wtLabel(issueId, abs)` uses the cached taskview `workspace.worktreeLabel`. Before the cache loads, it falls back to the same tail rule. The chip is `worktree ${esc(wtLabel(...))}` with `title` set to the absolute path. The WORKSPC `worktree` row shows the label with the absolute path in `title`. The 860px rules are unchanged.
- **app.html, TASKS column.**
  - `workingTasks(issues, shownId)` drops `closed`, `archived` and `deferred`, keeps board order, and appends the shown task if the filter dropped it. This is the 09-10 TUI rule.
  - `tasksColumn(issue)` renders `<nav class="ttasks" aria-label="tasks">` with a `TASKS` head, `<a class="ttask" href=taskUrl(id) data-task title>` rows, and a `[ ] switch task` foot. Each row has a `.cdot` from `STATUS_COLOR`, with a `var(--dim)` fallback. The shown row has `.on` and `aria-current="page"`.
  - The column is prepended to `#taskView.innerHTML`, before `.tmain`. It is rebuilt on every `renderTask`, so it survives the 2s poll.
  - A plain left click calls `switchTask(id)`, which runs `closeDiffModal()` then `navigate(taskUrl(id))`. Modifier clicks keep the native link.
  - Global keydown: after the `inField` and `diffModal` guards, when the view is `task`, no viewer, task modal, new-issue or palette overlay is open, and no meta/ctrl/alt is held, `[` / `]` step through `workingTasks` with wrap-around. They do nothing with fewer than two tasks.
- **CSS.**
  - `.ttasks` is 190px, with a panel border and background.
  - `.tthead` / `.ttfoot` use faint letter-spaced text.
  - `.ttask` is a flex row with an ellipsized title.
  - `.ttask.on` uses `var(--text)`, weight 650, a 2px `var(--accent)` left border and `var(--accent-bg)`, which is the token `.navitem.active` uses.
  - `@media (max-width: 1100px)` hides the column.
- **Rail tab on switch.** `state.railTab` is global in 09-06 and not keyed per task, so the chosen rail tab is kept across a task switch. This matches web 09-06 behaviour. It differs from the TUI, where the keyed remount resets the tab.
- **Docs.**
  - overview.md, web task-view paragraph: the short chip label with the full path on hover, and the TASKS column (rows rule, click or `[` / `]`, closes the diff modal, hidden at ≤1100px).
  - architecture.md: `workspace.worktreeLabel` in the taskview payload shape, the `worktreeLabel` rule, and that the column is client-rendered and switches through the router.

## Verification (all run)

| Command | Result |
|---|---|
| `bun test --timeout 30000 packages/web/test/taskview.test.ts` (RED before review.ts) | fails: `Export named 'worktreeLabel' not found` |
| `bun test --timeout 30000 packages/web/test/taskview.test.ts` | 12 pass / 0 fail |
| `bun test --timeout 30000 packages/web/test` | 36 pass / 0 fail (5 files) |
| `cd packages/web && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `cd docs && bun run build` | Complete |

New tests (`short worktree label + TASKS column (09-11)`):
1. A `worktreeLabel` unit test covering under root, the outside-root `.worktrees` tail, absolute, root itself (→ absolute) and null.
2. Route test: `workspace.worktreeLabel` matches `^\.worktrees/[^/]+-<id>$`, `worktree` stays the absolute fixture path, and a branchless task gives `null`.
3. Shell string checks: `<nav class="ttasks" aria-label="tasks">`, `aria-current="page"`, `workingTasks`, the `[` / `]` key branch, `${tasksColumn(issue)}`, the 1100px media rule, and the chip's `wtLabel` interpolation.

### Browser probe

The probe used `AGENT_BROWSER_SESSION=gsd0911` and a free port. The scratch repo was under the session scratchpad and had 3 tasks: ID1 under `tk work` with an edit, ID2 open, ID3 closed. The real `bun` pid was killed and the browser closed (`pgrep` shows the server gone).

| Step | Observed |
|---|---|
| 760×900, `/tasks/ID1`: `.wtchip` text | `worktree .worktrees/repo-tk-qux` (exact, no ellipsis) |
| `scrollWidth <= clientWidth` | true |
| `.wtchip` title | absolute `/private/tmp/…/repo/.worktrees/repo-tk-qux` |
| WORKSPC worktree row | `.worktrees/repo-tk-qux`, title = absolute path |
| 1280×900: `.ttasks` text | `TASKS · second open task · first working task · [ ] switch task`; closed task absent |
| `#taskView.firstElementChild` | `ttasks` |
| `aria-current` row | `tk-qux` (ID1) |
| click ID2 row | url `/tasks/tk-bnf`, `.thead` `tk-bnf second open task`, current `tk-bnf`; a window marker survived, so there was no page load |
| `[` | back to ID1 (wraps, board order is ID2, ID1) |
| `]`, `]` | ID2, then wraps to ID1 |
| wait 4500 (two polls) | `.ttasks` visible, highlight unchanged, same document |
| `#openDiff` → modal open; Esc → hidden; click ID2 | on ID2, `#diffModal` hidden |
| 1000×900 `is visible .ttasks` | false |
| Regression spot checks | `/tasks/ID1/diff` lists `a.ts`, and the task column is not visible there. `/tasks/ID1/file?path=src/a.ts` shows `CODE`, and the file body (in shadow DOM) contains `export const a`. The list view has 3 `.lrow`. |

Scratch artifacts:
- `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0911/09-11-narrow-chip.png`
- `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0911/09-11-tasks-1280.png`
- `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0911/09-11-tasks-1000.png`
- `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0911/09-11-file.png`

Compared with spec VIEW 1, the 1280 shot shows the `TASKS` header, a status dot per row, and the current row highlighted with an accent left border, an accent background and bold text.

## Deviations from Plan

1. **[Rule 2 — Security, T-09-26] `esc()` now also escapes `"`.** The existing `esc` (textContent → innerHTML) left double quotes raw. That made `title="${esc(path)}"` breakable by a path or title containing `"`. `esc` now ends with `.replace(/"/g, "&quot;")`. In text context `&quot;` renders as `"`, so existing output is unchanged. This is app-wide hardening, and the full web suite passes.
2. **[Adaptation] `switchTask` closes the diff modal explicitly** before `navigate`. `render()` would also close it once `state.selected` changes. The explicit call keeps `renderTask` from being skipped by its `diffModal !== null` early return.
3. **[Adaptation] `[` / `]` also skip while the viewer, task modal, new-issue or palette overlay is open**, and with meta/ctrl/alt held. This is the plan's "no modal open" made concrete.
4. **Not done:** the scratch repo directory removal was denied by the sandbox. It is left under the session scratchpad and is harmless.

## Threat model

- **T-09-26.** Ids, titles, labels and `title=` attributes all go through `esc()`, which is now quote-safe. Hrefs come from `taskUrl` (`encodeURIComponent`). The dot colour comes only from the fixed `STATUS_COLOR` map, with a literal fallback.
- **T-09-27.** Accepted. The absolute path was already in the payload.
- **T-09-SC.** No package installs.

## Self-Check: PASSED

- Every verify command was run, and the results above are the observed output.
- There are no commits to check (withheld per AGENTS.md).
