---
phase: 09-task-view-parity
plan: 03
subsystem: tui, docs
tags: [task-view, tabbed-rail, ready-to-review, narrow-layout, tmux-probe]
status: complete
requires: [09-01, 09-02, 04-04, 04-05, 08-02]
provides:
  - "TUI TaskView: center column (title, meta, chips, `◧ v open diff`, description, ARTIFACTS, COMMENTS, doors) + tabbed rail `SESSIONS │ CHANGES │ WORKSPC │ MINIMAP`"
  - "ReviewSource.stats (patchFileStats), .worktree (matched worktree path), .dirty (gitDirtyCount)"
  - "task.tsx exports RAIL_TABS, RAIL_TAB_ROW, NARROW_WIDTH (100), LIVE_LINE, RailTab"
  - "ShellKeys: `v` → openReview(target); `s` on ready-to-review toasts instead of starting work"
  - "detail.tsx footer: `v:open diff` replaces `s:start` for ready-to-review"
  - "packages/tui/test/fixtures.ts (shared slotsFor/tk/gitIn/write/repoWithIssue/repoWithWork/scratchDir/cleanupFixtures)"
  - "packages/tui/test/taskview-smoke.ts (4 checks; `// 09-04 checks` / `// 09-05 checks` insertion points)"
affects: [09-04 (diff modal from the rail `↵`, evidence image), 09-05 (extends taskview-smoke.ts)]
key-files:
  created:
    - packages/tui/test/fixtures.ts
    - packages/tui/test/taskview.test.tsx
    - packages/tui/test/taskview-smoke.ts
  modified:
    - packages/tui/src/review/source.ts
    - packages/tui/src/app/task.tsx
    - packages/tui/src/app/detail.tsx
    - packages/tui/src/app/App.tsx
    - packages/tui/src/app/help.tsx
    - packages/tui/test/app.test.tsx
    - docs/src/content/docs/overview.md
    - docs/src/content/docs/testing.md
    - docs/src/content/docs/architecture.md
decisions:
  - "Default rail tab is CHANGES when the source has files, is branchless (shows the `no branch yet — run tk work <id>` hint) or errored; otherwise SESSIONS. Kept as `chosenTab ?? default` so it follows the source until the user presses tab."
  - "Rail is 42 columns (the 37-char tab row + border + padding); hidden below 100 terminal columns."
  - "Each rail panel is keyed by tab: OpenTUI throws (`text.chunks` null) when a `<text content>` is reconciled in place into a span-children `<text>`."
  - "Tab cycling uses a functional state update: two back-to-back presses can arrive before useKeyboard re-binds the handler, which dropped the second press."
  - "COMMENTS preview strips the stored `[review <location>] ` body tag (formatReviewThreadComment) since the row prints `→ location` itself."
  - "`↵` in CHANGES (file row) / MINIMAP selects that file (and hunk) in the review session and opens the existing diff modal; dir rows open the modal as is."
  - "CHANGES shows `live from the worktree ●` while `ReviewState.watching` is true (the 04-05 handle), mirroring the spec's `live from the worktree` note; it also gives tests a deterministic point to start editing."
  - "The `comments N · M open K ✓` summary (overview.md documents it for the TUI task view) moved from the old rail to the COMMENTS header row as a dim suffix."
requirements-completed: [VIEW-01, VIEW-02, VIEW-03]
metrics:
  tasks: 3
  completed: 2026-11-10
actuals:
  tasks: 3
  commits: 0
plan_head_before: 496745b6ad49570362ec3fc5d672b7da784b292f
plan_head_after: 496745b6ad49570362ec3fc5d672b7da784b292f
---

# Phase 9 Plan 03: TUI task view parity (D-01..D-03) Summary

The TUI task view (`5`, `tk://task`) now reads work-first. The center column shows, in order:

- the title and a meta line
- a chips row: `[ worktree <path> ]  [ <branch> → <base7> ]`
- `◧ v open diff · V diff modal · c comment`
- the description
- `ARTIFACTS — evidence on the task`, with typed counts and the IN CHANGES / UNREFERENCED groups (rows end in `● N` or `—`)
- `COMMENTS · N`, with up to 5 rows of `author: first line → location[:line]`
- the unchanged review doors lines

The right rail has four tabs, `SESSIONS │ CHANGES │ WORKSPC │ MINIMAP`. The active label is accent-coloured and has a `━` underline row. `tab` and `shift+tab` cycle the tabs, and `j`/`k` move a per-tab cursor. CHANGES renders `changesTree(source.stats, threads)` with blue `●` dots, and it re-renders live when the worktree changes, through the 04-01/04-05 watch.

Ready-to-review tasks never offer start-work:
- the detail footer shows `v:open diff`
- `s` toasts `ready-to-review — v opens the diff` and leaves the status unchanged
- `v` on a list row opens that task's diff

Below 100 columns the rail is hidden and only the worktree chip stays. Before `tk work`, the chip reads `[ no worktree — tk work <id> ]`.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (tracer) | worktree edit → ReviewSource.stats → CHANGES tree, tab cycling | withheld | source.ts, task.tsx, fixtures.ts, taskview.test.tsx |
| 2 | center column + SESSIONS / WORKSPC / MINIMAP panels | withheld | task.tsx, source.ts (`dirty`), taskview.test.tsx |
| 3 | no start-work on ready-to-review, narrow layout, tmux probe | withheld | task.tsx, detail.tsx, App.tsx, taskview.test.tsx, taskview-smoke.ts |

Commits withheld per AGENTS.md (conservative profile; orchestrator override). All changes are uncommitted in the main tree. STATE.md and ROADMAP.md were not touched.

## Verification (all run, final state)

| Command | Result |
|---|---|
| `bun test --timeout 20000 packages/tui/test/taskview.test.tsx packages/tui/test/review.test.tsx` | 37 pass / 0 fail |
| `cd packages/tui && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `cd packages/tui && bun run check` | exit 0 |
| `bun test --timeout 20000 packages/tui/test` | 99 pass / 0 fail across 8 files (baseline before this plan: 94 / 0 across 7) |
| `bun packages/tui/test/taskview-smoke.ts` | `taskview-smoke: 4 passed, 0 failed` (run 3×) |
| `bun packages/tui/test/review-smoke.ts` (hunk keymap / 08-02 regression) | `review-smoke: all green (9 checks)` |
| `bun packages/tui/test/smoke.ts` (regression) | `smoke: all green (13 checks)` |
| `bun test packages/tui/test/taskview.test.tsx` repeated 4× after the watch-ready fix | 5 pass / 0 fail each time |
| `cd docs && bun run build` | Complete |

No `tk-taskview-smoke-*` or `tk-review-smoke-*` scratch dirs and no `tktv-*` or `tkrev-*` tmux processes were left after the runs.

Tracer gate: before Task 2 started, Task 1's verify ran green end-to-end (33 pass, tsc 0).

### taskview.test.tsx (5 tests)

1. **Live CHANGES and tab cycling.**
   - At 140×40 the rail tab row is shown, along with `▸ src/`, `a.ts [M] ●` and the CHANGES hint. The test waits for `live from the worktree`.
   - It then writes `src/b.ts`, runs `git add -N`, and touches the file again. The `b.ts [A] ●` row appears with no key press.
   - `tab` goes to WORKSPC (`host`), then to MINIMAP (`↵ open in the diff modal`). `shift+tab` goes back to WORKSPC.
2. **Center column order and the remaining tabs.**
   - Setup: a 1×1 PNG attached with `tk attach --evidence`, and a thread on `src/a.ts:1` written through `taskStoreCommentStore`.
   - The frame shows `◧ v open diff`, both chips, `0 src · 0 edit · 0 new · 1 other`, `UNREFERENCED (1)`, `shot.png`, `kyle: is this bounded?` and `→ src/a.ts:1`.
   - It does not show the comment's second line, `s:start`, or `STATUS  SESSION`.
   - Row order is open diff < ARTIFACTS < COMMENTS < doors.
   - Pressing tab shows WORKSPC (`state 1 dirty`), then MINIMAP (`a.ts#1` and `█`), then SESSIONS (`STATUS  SESSION`, plus the rail footer).
3. **Narrow layout.** At width 90 the frame has `[ worktree ` and the worktree dir name. It has no `SESSIONS │` and no branch chip.
4. **No worktree.** A task with no work shows `[ no worktree — tk work <id> ]` at width 90.
5. **Ready-to-review.** After `tk update --status ready-to-review`, the list view with the detail pane open shows `v:open diff` and no `s:start`.
   - `s` shows the toast, and `tk show` still reports `ready-to-review`.
   - `v` opens the diff view (`tk/<id>`, `q quit`).

## Deviations from Plan

1. **[Rule 1 — Bug] Panel switch crashed the renderer.** Switching from CHANGES to MINIMAP made React reuse a `<text content=…>` as a span-children `<text>`. OpenTUI then threw `null is not an object (evaluating 'text.chunks')` and the ErrorBoundary took over. The panel container is now keyed by tab.
2. **[Rule 1 — Bug] Fast tab presses were lost.** Two back-to-back `tab` presses only moved one tab, because the handler's `tab` was stale. Tab cycling now uses a functional `setChosenTab` update, and the `j`/`k` cursor reads `current[tab]` inside its updater.
3. **[Rule 1 — Test race] Edits before the watch subscribed were missed.** The live test sometimes wrote `b.ts` before `startReviewWatch` had subscribed. The controller's initial signature then already included the edit, so no refresh fired. Two changes fix this:
   - CHANGES shows `live from the worktree ●` while `ReviewState.watching` is true, and the test waits for that line before editing. This is the same pattern review.test.tsx uses with `WATCHING_LINE`.
   - The test touches `b.ts` again after `git add -N`, because the worktree index lives outside the watched tree.
4. **[Adaptation] Default tab.** The plan says the default is CHANGES with files, else SESSIONS. With that rule, branchless and errored tasks would hide the `no branch yet — run tk work <id>` hint. Existing review.test.tsx and app.test.tsx tests assert that hint, and so does the 04-01 wording. So CHANGES is also the default for no-branch and error sources.
5. **[Rule 3] Changed `packages/tui/test/app.test.tsx`, which is not in `files_modified`.** Its task-view test asserted the old rail's `THREADS 0 open`. It now asserts `COMMENTS · 0`, and the test was renamed "…tabbed rail". Its other assertions are unchanged and still pass: `v open diff · V diff modal · c comment`, `no branch yet`, both doors, and `comments 0 · 0 open 0 ✓`.
6. **[Rule 2 — Docs, per AGENTS.md] Updated docs and help.**
   - overview.md gets a Task row in the TUI view table and a "Task view (`5`)" paragraph covering the center column, rail tabs, keys, narrow layout and the ready-to-review rule.
   - testing.md gets the inventory entry and a "Task-view probe" paragraph.
   - architecture.md describes the new `ReviewSource` fields.
   - help.tsx (not in `files_modified`) gains a task-view section and the list's `v` / ready-to-review `s` line.
7. **[Adaptation] Comment preview body.** Stored root bodies carry `[review src/a.ts:1] …` from `formatReviewThreadComment`. The preview strips that tag so the row reads `kyle: is this bounded? → src/a.ts:1`.
8. **Extras beyond the plan:**
   - `↵` on a CHANGES file or MINIMAP bar selects that file or hunk and opens the existing diff modal. This makes the footer hints true; 09-04 owns the modal itself.
   - The `comments N · …` summary stays on the COMMENTS header row, because overview.md documents it for the TUI task view.
   - A test for the no-worktree chip.
   - The ready-to-review test also checks `v` → diff.
9. **TDD order:** I wrote the implementation before each task's frame tests, so no separate RED run was shown. None of the asserted strings existed before this plan, so the new cases could not have passed against the old view.

## Keymap regressions checked (04-04 / 04-05 / 08-02)

- The task view binds only `tab`, `shift+tab`, `j`/`k`/arrows, `↵`, `v`, `V`, `c` and `q`. It returns early while the diff modal, the composer, the task modal, the palette or help is open.
- In diff and artifact views, `1`, `2` and `g` still go to review (`HUNK_SHELL_KEYS` is untouched). `]`/`[`, `.`/`,`, `x`/`D`/`S` and the watching indicator are untouched in diff.tsx.
- review-smoke is green with 9 checks.
- ShellKeys gains `v` only in list and board target resolution, and `s` there is gated on ready-to-review. The task, diff and artifact views still return before that switch.

## Threat Model

- **T-09-05:** every agent-written value (title, description, session label, comment body, file names) renders through `<text content>` or `<span>` children into OpenTUI's cell buffer. No `process.stdout.write` was added.
- **T-09-06:**
  - The description is capped at 20 lines.
  - The comments preview shows at most 5 rows.
  - Every rail panel is windowed to `termHeight − 10` rows around its cursor.
  - The center column is a `<scrollbox>`.
- **T-09-SC:** no package installs.

## Known Stubs / Follow-ups

- `modal.tsx` (task modal over the board) and the command palette still offer `s` start on a ready-to-review task. They were out of this plan's files and are worth a follow-up so D-03 holds everywhere.
- 04-01 watch (existing behaviour, not new): an edit made between the source resolving and the watcher subscribing is not picked up until the next event. The new `live from the worktree ●` line shows when the watch is live.

## Self-Check: PASSED

- FOUND: packages/tui/test/fixtures.ts, packages/tui/test/taskview.test.tsx, packages/tui/test/taskview-smoke.ts
- FOUND: `stats`, `worktree` and `dirty` on `ReviewSource` (source.ts); `RAIL_TAB_ROW` and `LIVE_LINE` exports (task.tsx); `v:open diff` (detail.tsx); `ready-to-review — v opens the diff` (App.tsx)
- Commits: none, withheld per AGENTS.md
