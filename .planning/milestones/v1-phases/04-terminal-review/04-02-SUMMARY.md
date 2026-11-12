---
phase: 04-terminal-review
plan: 02
subsystem: tui, review
tags: [in-view-edit, path-guard, tui]
requires: [04-01]
provides:
  - "packages/tui/src/review/edit.ts: hunkEditRange, guardWorktreePath (realpath-checked), readHunkRegion, applyHunkEdit"
  - "packages/tui/src/app/hunkEdit.tsx: HunkEditBuffer (inline textarea; ctrl+s save, esc cancel)"
  - "ReviewState.edit + AppActions.openHunkEdit / saveHunkEdit / cancelHunkEdit"
affects: [04-03 (comments: review-comment edit is now `E`)]
key-files:
  created:
    - packages/tui/src/review/edit.ts
    - packages/tui/src/app/hunkEdit.tsx
    - packages/tui/test/review-edit.test.ts
  modified:
    - packages/tui/src/review/source.ts (comment only)
    - packages/tui/src/app/context.ts
    - packages/tui/src/app/App.tsx
    - packages/tui/src/app/diff.tsx
    - packages/tui/test/review.test.tsx
    - docs/src/content/docs/architecture.md
decisions:
  - "A count-0 range (pure-deletion hunk, `+N,0`) is an insertion point after line N, following git's convention. An empty buffer means zero lines."
  - "The guard realpaths the nearest existing ancestor, or the file itself when it exists. That also refuses a file symlink pointing outside the root, not only a symlinked dir."
  - "The buffer title is ` ✎ edit <path>:<start>-<end> `, and the `ctrl+s save · esc cancel` hint is a dim line inside the box. The full one-line title was wider than the diff column, so opentui dropped it."
requirements-completed: [REV-03]
metrics:
  tasks: 2
  completed: 2026-11-10
---

# Phase 04 Plan 02: In-view hunk edit — Summary

In the diff view, `j` then `e` opens an inline buffer under the diff body, holding the selected hunk's new-side lines read from the worktree file. `ctrl+s` writes the lines back over that range and re-derives the diff in place. `esc` cancels and stays in the diff view. Every write is guarded to stay inside the worktree root, and a write is refused when the region changed on disk after the buffer opened.

## What was built

- **`review/edit.ts`** imports only `node:fs/promises`, `node:path`, and the `HunkDiffFile` type. It never imports `@tasks/web`.
  - `hunkEditRange` reads `metadata.hunks[i].additionStart/additionCount`. It returns null for binary files, deleted files, files with no path, and hunk indexes out of range.
  - `guardWorktreePath` is async. It refuses empty, absolute, and NUL paths, checks the prefix against `realpath(root)`, then realpaths the nearest existing ancestor and checks the prefix again.
  - `readHunkRegion` detects LF or CRLF line endings.
  - `applyHunkEdit` re-reads the file, refuses with `stale` when the region no longer matches the original, splices the edit in, keeps the eol and trailing-newline state, and never throws.
- **App.tsx**:
  - `openHunkEdit` toasts `select a hunk (j) to edit` or `this hunk has no editable lines` when it cannot open, and does nothing in the compact modal.
  - `saveHunkEdit` toasts `file changed under the edit — reopen with e` on a stale region and keeps the buffer open. On success it clears `edit` and re-resolves the source through the 04-01 `mergeLiveSource`.
  - `cancelHunkEdit` closes the buffer.
  - `ShellKeys` returns early while `review.edit` is open, so esc and the number keys never switch views.
- **diff.tsx**:
  - `<HunkEditBuffer />` renders inline under the diff box in the full diff view only, never in the compact modal.
  - `useReviewKeys` returns early while the buffer is open.
  - `e` opens the hunk edit and `E` opens the review-comment edit composer. `keysLine` was updated.

## Verification (all run)

| Command | Result |
|---|---|
| `bun test packages/tui/test/review-edit.test.ts` | 20 pass / 0 fail |
| `bun test --timeout 30000 packages/tui/test/review.test.tsx packages/tui/test/review-edit.test.ts` | 30 pass / 0 fail (4 new frame-level edit cases) |
| `bun test --timeout 15000 packages/tui/test` | 69 pass / 0 fail (6 files) |
| `cd packages/tui && bun run check` | exit 0 |
| `grep -rn "@tasks/web" packages/tui/src` | 0 lines |
| `cd docs && bun run build` | Complete |

No transient failures from concurrent executors were seen.

## Deviations from Plan

- **[Rule 1] Unified layout bug fixed in diff.tsx:**
  - **Bug:** `Workbench` passed `layout={review.layout === "split" ? "split" : undefined}`. `HunkDiffBody` defaults `layout` to `"split"`, so the default "unified" session (and the `u` key) actually rendered split. The new-side column was then clipped behind the thread rail, and added lines, including `// edited`, never appeared in the frame.
  - **Fix:** it now passes `canonicalLayout={review.layout}`.
  - **Effect on 04-01 tests:** their asserts still pass. They only matched the left-hand or context lines.
- **Title format:** the hint moved inside the box (see decisions). The behaviour is the same.
- **E test:** the thread is created through `taskStoreCommentStore` before render, because threads reload on board changes and not on direct store writes.
- **[Rule 2] Docs:** a fourth step, "In-view edit", was added to the "TUI Review Path" section in `architecture.md`, as AGENTS.md requires.

## Found, not fixed (out of scope; 04-03 territory)

- `Workbench` filters the thread rail with `fileThreads(review.threads, file?.id ?? null)`. `file.id` is `<sourceId>:<index>:<name>`, not the path, so the rail never lists threads. `useReviewKeys` and `openReviewComposer` filter by `file.path`, so `r`, `E`, `x`, and `J`/`K` still target the right threads.

## Notes

- Commits were withheld per AGENTS.md (conservative profile). The work was done in the main tree. STATE.md and ROADMAP.md were not touched.

## Self-Check: PASSED
