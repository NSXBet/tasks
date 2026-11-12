---
phase: 09-task-view-parity
plan: 10
subsystem: tui, docs
tags: [task-view, tasks-column, r34, gap-closure, tmux-probe]
status: complete
gap_closure: true
requires: [09-03, 09-04, 09-05]
provides:
  - "packages/tui/src/app/tasklist.tsx: `TaskList` column, pure `workingTasks(issues, shownId)`, `TASKS_WIDTH` (24), `TASKS_MIN_WIDTH` (130)"
  - "AppActions.openTask(id): sets detailId, keeps view `task`, closes the diff modal"
  - "App renders `<TaskView key={detailId ?? \"first\"} />`, so a task switch remounts the view and resets per-task rail/cursor/focus state"
  - "Task view `[` / `]`: previous / next working task, wrapping; stepped from a ref so a burst in one stdin write lands"
  - "Task view chips row: the branch chip wraps to its own line when it does not fit beside the worktree chip (wide layout only)"
  - "taskview-smoke.ts: 12 checks (1 new for 09-10)"
affects: [09-VERIFICATION gap 1 (TUI half); web half is 09-11]
key-files:
  created:
    - packages/tui/src/app/tasklist.tsx
  modified:
    - packages/tui/src/app/task.tsx
    - packages/tui/src/app/App.tsx
    - packages/tui/src/app/context.ts
    - packages/tui/src/app/help.tsx
    - packages/tui/test/taskview.test.tsx
    - packages/tui/test/taskview-smoke.ts
    - docs/src/content/docs/overview.md
    - docs/src/content/docs/testing.md
requirements-completed: [VIEW-01]
metrics:
  tasks: 2
  completed: 2026-11-11
actuals:
  tasks: 2
  commits: 0
---

# Phase 9 Plan 10: TUI TASKS column (R34) Summary

**What changed for the user:** the TUI task view (`5`) now has a `TASKS` column on the left, between the VIEWS nav and the work. It lists the working tasks, each with a status dot, and highlights the one on screen. `[` / `]` or a mouse click switch the whole task view to another task without leaving it. Below 130 columns the column is hidden.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | TASKS column + openTask + `[`/`]` switching | withheld | tasklist.tsx, task.tsx, App.tsx, context.ts, taskview.test.tsx |
| 2 | help, smoke probe, docs, tmux look-check | withheld | help.tsx, taskview-smoke.ts, overview.md, testing.md |

Commits were withheld per AGENTS.md (conservative profile, orchestrator override). All changes are uncommitted in the main tree. STATE.md and ROADMAP.md were not touched. Nothing under packages/surface, rpc, luau, cli watch or `packages/tui/test/review.test.tsx` was touched (those belong to the concurrent 10-02 and 09-09 executors).

## What was built

- **`TaskList`** (tasklist.tsx), 24 columns wide, right border in `colors.border`:
  - The header is `TASKS` in `colors.dim`, with `paddingTop: 1` so it lines up with the NavRail's `VIEWS`.
  - Each row is `●` in `statusColor(status)` followed by the title truncated to 19 cells.
  - The shown row gets the NavRail styling: a `▎` band in `colors.band`, a `colors.selection` background, and a bold `colors.text` title. Other rows are dim.
  - Each row is a `<box onMouseDown={() => actions.openTask(id)}>`.
  - Rows are windowed around the shown task to `height - 6` (T-09-25).
  - The footer is a dim `[ ] switch task`. No new colors.
- **`workingTasks(issues, shownId)`** filters out `closed`, `archived` and `deferred`, keeps board order, and appends the shown task when the filter dropped it.
- **`openTask(id)`** calls `setDetailId(id)`, `setView("task")` and `setDiffOpen(false)`. `openDetail` could not be reused because it switches to the list view.
- **Keyed remount.** App renders `<TaskView key={detailId ?? "first"} />`, so `chosenTab`, `cursors`, `artifactCursor`, `focus`, `sessions` and their refs reset on a switch. The `ensureReview(issue.id)` effect fires on mount, so the review session follows the new task (checked: the rail switches to the new task's `no branch yet — run tk work <id>` hint in the tmux capture).
- **`[` / `]` in task.tsx.** They are handled after the existing diff modal, composer, modal, palette and help guard, and before `tab`. The handler builds `workingTasks(board, shown)`, steps with wrap-around and calls `openTask`. It does nothing with fewer than two tasks.
- **Width math.** `centerWidth` subtracts `TASKS_WIDTH` when `termWidth >= 130`. At 90 columns the 09-03 narrow layout is unchanged: the worktree chip stays and the rail is hidden.

## Keymap collisions checked

- **Task view.** `[` and `]` were free. The existing keys (tab/shift-tab, j/k/↑/↓, J/K, o, ↵, v, V, c, q) are untouched.
- **Diff view (full page).** Its hunk `[` / `]` live in `useReviewKeys` (diff.tsx). The TaskView is not mounted there, and ShellKeys' `HUNK_SHELL_KEYS` early return is unchanged. review-smoke (9 checks) and taskview-smoke check 7 (`]` walks into EVIDENCE) pass.
- **Diff modal over the task view.** `useReviewKeys(true)` handles `[` / `]` there. The TaskView handler returns early on `state.diffOpen`, so the modal's hunk keys never switch tasks.
- **ShellKeys.** It returns early for the task view except `escape`, and has no `[` / `]` binding, so nothing is shadowed.

## Verification

| Command | Result |
|---------|--------|
| `bun test --timeout 30000 packages/tui/test/taskview.test.tsx packages/tui/test/app.test.tsx` | 38 pass / 0 fail |
| `cd packages/tui && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `bun test --timeout 30000 packages/tui/test` | 114 pass / 0 fail (8 files) |
| `bun packages/tui/test/taskview-smoke.ts` | `12 passed, 0 failed` in 6 of 7 non-mutation runs (3 of 4 on the final code); see the flake note below |
| `bun packages/tui/test/review-smoke.ts` | `review-smoke: all green (9 checks)` |
| `bun packages/tui/test/smoke.ts` | `smoke: all green (13 checks)` |
| `cd docs && bun run build` | Complete |

**Flake note.** One taskview-smoke run reported `9 passed, 3 failed`. It ran right after my own tmux look-check and while the concurrent executors were running their suites. Only the tail line was captured, so I don't know which checks failed. The three full runs after it, with the identical final code, were all `12 passed, 0 failed`. A single such run is not proof that the probe is stable under load.

**Mutation checks (the tests bite):**
- With the `TaskList` render and the `[` / `]` handler disabled, the two TASKS frame tests fail.
- Without the synchronous `shownRef.current = next.id`, smoke check 12 fails: a `]]` burst in one `send-keys` write moved only one row. With the line restored it passes.
- With two separate `send-keys` calls the remount landed between the keys and hid the bug, so the probe sends both keys in one write.

### taskview.test.tsx (4 new tests, `tui task view TASKS column (09-10, R34)`)

1. **Unit test for `workingTasks`.** It drops closed, deferred and archived tasks, keeps order, appends a shown closed task, ignores an unknown or null id, and checks that `TASKS_MIN_WIDTH` is 130.
2. **160 columns, A in progress, B open, C closed:**
   - The frame shows `TASKS`, `VIEWS`, `● live review`, `● second task` and `[ ] switch task`, and no `closed task`. A's row carries `▎`.
   - `]` → the header shows `B · open`, B's row carries `▎`, and the rail tab row is still there.
   - `[` → back to A. `[` again wraps to B, and `]` returns to A.
   - `mockMouse.click` on B's row switches to B.
3. **Closed shown task.** `detailId = C` lists C and highlights it.
4. **120 columns.** No `TASKS` and no `● second task`; the center column and rail render.

### tmux look-check (real binary)

Scratch repo under the session scratchpad: three tasks, one with `tk work`, one open, one closed. Socket `-L p0910-<pid>`; the session was killed and the repo removed afterwards (`tmux ls` shows no p0910 session). Captures are in the scratchpad:
- `09-10-tasks-160.txt`: `VIEWS` and `TASKS` columns side by side. The closed task is absent from the list and the shown row has `▎●`.
- `09-10-tasks-160-next.txt`: after `]` the header and the `▎` row changed to the next task, and the rail followed (`no branch yet — run tk work <id>`).
- `09-10-tasks-120.txt`: no `TASKS`, and the center column and rail are intact.

## Deviations from Plan

1. **[Rule 1 — Bug] Branch chip squeezed to `…` beside the TASKS column.**
   - The new column takes 24 cells, so at 140 columns the center shrinks to about 53 cells. A long worktree chip then left no room, and `[ tk/<id> → <base> ]` rendered as a wrapped `…`.
   - This broke the 09-03 test "center column leads with the work" (it expects `[ tk/<id> → `).
   - Fix: when both chips don't fit, the branch chip moves to its own line under the worktree chip. This applies to the wide layout only; the narrow layout keeps only the worktree chip, as before.
   - The existing test is unchanged and passes.
2. **[Rule 1 — Bug] `[` / `]` burst raced the keyed remount.**
   - The plan says to "read the board through the closure; the keyed remount re-binds after each switch". But two keys in one stdin chunk both reach the old handler.
   - Fix: a `shownRef` that the handler advances synchronously, following the 09-04 `tabRef` / `cursorsRef` pattern. The smoke check guards it.
3. **[Adaptation] Header text and window size.**
   - The header is plain `TASKS`, not letter-spaced, to match the NavRail's `VIEWS` and stay greppable by the tests and the probe.
   - The rows window is `height - 6`, not `height - 3`. That makes room for the top padding, header, footer hint, status bar and composer line, so the column never draws more rows than fit.
   - The windowing helper is local to tasklist.tsx (it centers on the shown row). The task.tsx `windowed` helper was not exported, which avoids a task ↔ tasklist import cycle.
4. **[Rule 2] testing.md** (not in `files_modified`). The task-view probe paragraph now describes check 12 and the 12-check count, per AGENTS.md (docs land with the change).

## Threat model

- **T-09-24.** Titles render through OpenTUI `<span>` text, truncated to the column, on the same path as list and kanban titles.
- **T-09-25.** Rows are windowed to the terminal height.
- **T-09-SC.** No package installs.

## Self-Check: PASSED

- The created file exists: `packages/tui/src/app/tasklist.tsx`.
- Every verify command was run, and the results above are the observed output.
- There are no commits to check (withheld per AGENTS.md).
