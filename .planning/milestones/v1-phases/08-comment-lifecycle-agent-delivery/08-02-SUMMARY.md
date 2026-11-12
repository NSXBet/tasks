---
phase: 08-comment-lifecycle-agent-delivery
plan: 02
subsystem: review, tui, docs
tags: [comment-lifecycle, tui, send-to-agent, shared-view-rules]
requires: [04-03, 04-04, 04-05, 07-02]
provides:
  - "@tasks/review/lifecycle: commentControls, commentStatusBadge, reviewHeaderLabel, sendableCount (type-import-only, browser-safe) — 08-03 web island reuses it"
  - "TUI diff view: x ✓ done / D ✕ remove (same key on a closed comment reopens), S batched send to agent"
  - "Notes rail header `COMMENTS · N open · K ✓` / `All resolved` over all of the task's threads, plus `S send N to agent` row"
  - "AppActions.setReviewThreadStatus(key) and AppActions.sendReviewComments() (toggleReviewResolved removed)"
affects: [08-03 (web imports @tasks/review/lifecycle)]
key-files:
  created:
    - packages/review/src/core/review/lifecycle.ts
    - packages/review/src/core/review/lifecycle.test.ts
  modified:
    - packages/review/package.json
    - packages/tui/src/app/context.ts
    - packages/tui/src/app/App.tsx
    - packages/tui/src/app/diff.tsx
    - packages/tui/src/app/artifact.tsx
    - packages/tui/src/app/help.tsx
    - packages/tui/test/review.test.tsx
    - docs/src/content/docs/overview.md
    - docs/src/content/docs/architecture.md
requirements-completed: [CMT-02, CMT-03]
metrics:
  tasks: 3
  completed: 2026-11-10
---

# Phase 08 Plan 02: TUI comment lifecycle and send to agent — Summary

The TUI diff view now runs the whole review-comment loop on the task record:

- `x` marks the selected comment ✓ done (resolved), and `D` ✕ removes it (dismissed). Pressing either key on a resolved or dismissed comment reopens it.
- `S` sends every open comment of the task to the agent in one batch. The rows flip to `→ sent`.

Every move goes through `ReviewCommentStore.setThreadStatus` / `sendOpen`, which route to `@tasks/surface`, so each one is logged in `metadata.reviewCommentLog`. The rail reads `COMMENTS · N open · K ✓`, or `COMMENTS · All resolved`, from stored state. The badges, controls, header and send count come from a new shared module, `@tasks/review/lifecycle`, so the 08-03 web view can't drift from the TUI.

## What was built

- **lifecycle.ts** imports types only from `./commentStore.js`. It exports:
  - `CommentControl`
  - `commentControls(status)`: open/sent → `✓ done`→resolved and `✕ remove`→dismissed; resolved/dismissed → `↺ reopen`→open. No control ever targets `sent`.
  - `commentStatusBadge`: `open`, `→ sent`, `✓ resolved`, `✕ dismissed`.
  - `reviewHeaderLabel`: `All resolved`, `no comments`, or `counts.label`.
  - `sendableCount`: `counts.open`.
- **package.json** gets one additive line: the `"./lifecycle"` export next to `./watch`.
- **context.ts / App.tsx:**
  - `toggleReviewResolved` is replaced by `setReviewThreadStatus("done" | "remove")`. It picks the same selected thread, computes the target (closed → open, done → resolved, remove → dismissed) and calls `setThreadStatus(..., actor)`. It then re-lists the threads and toasts `✓ done` / `✕ removed` / `reopened`. On error it toasts `comment status update failed`.
  - New `sendReviewComments()` calls `sendOpen(issueId)`, re-lists the threads, and toasts `sent N comment(s) to the agent` or `nothing open to send`. On error it toasts `send failed`. There is no confirm step and nothing is sent per comment.
- **diff.tsx:**
  - ThreadList shows rows with `commentStatusBadge`, coloured green when resolved, dim when dismissed, and `borderFocus` when selected.
  - New exported `commentsHeader(threads)` builds the header over ALL `review.threads`. The header turns green on All resolved.
  - Keys: `x` → `setReviewThreadStatus("done")`; `D` → `("remove")`; `S` → `sendReviewComments()`. All three work on the full page only, not in the compact modal.
  - The key-map comment block is updated.
  - Keybar line 2 is now `R reply  E edit note  e edit hunk  x ✓ done · D ✕ remove · S send to agent  J/K note  esc back`. This is the 04-04/04-05 line with `x resolve` replaced, as the orchestrator directed. Line 1 is unchanged.
- **artifact.tsx:** its keybar, which uses the same `useReviewKeys`, shows the same `x ✓ done · D ✕ remove · S send to agent` chunk.
- **help.tsx:** `x resolve` is removed from the notes line, and a new line is added: `x ✓ done · D ✕ remove (again: reopen) · S send open comments to the agent (one batch)`.
- **review.test.tsx:** new block `tui comment lifecycle (08-02)` with two tests. Both seed threads through `taskStoreCommentStore` on a separate store, then read the record back through a fresh store plus `tk show --json`.
  1. `D` → `✕ dismissed src/a.ts:2` and `COMMENTS · All resolved`. The record status is `dismissed` and the log ends `to: "dismissed"`. Pressing `D` again → `open` and `COMMENTS · 1 open · 0 ✓`, and the log ends `to: "open"`.
  2. Two open threads (`src/a.ts:2` and a file-level one) show the header `2 open · 0 ✓` and the keybar chunk.
     - `S` → toast `sent 2 comments to the agent`, both rows `→ sent`, and the header still `2 open · 0 ✓`. The record shows both `sent` and exactly one `[review sent] 2 comments` comment.
     - `S` again → `nothing open to send`, and no new `[review sent]` comment.
     - `x` → `✓ resolved` and `1 open · 1 ✓`. Then `J` and `D` → `✕ dismissed` and `All resolved`, and the record shows `[resolved, dismissed]`.
- **lifecycle.test.ts:** seven `bun:test` cases covering controls, the no-`sent`-target rule, badges, the header label, `sendableCount`, and a type-only import check.
- **Docs:**
  - overview.md: the Commentable bullet and the keys table rows for `x`, `D` and `S`.
  - architecture.md: data-flow step 5 now covers `setThreadStatus` / `sendOpen`, the header and `@tasks/review/lifecycle`.

## Verification

| command | result |
|---|---|
| `bun test --timeout 30000 packages/tui/test/review.test.tsx` | 32 pass / 0 fail |
| `bun test --timeout 15000 packages/tui/test` | 94 pass / 0 fail (7 files) |
| `cd packages/tui && bun run check` | exit 0 |
| `cd packages/review && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `bun test packages/review/src/core/review/lifecycle.test.ts` | 7 pass / 0 fail |
| `test "$(grep '^import' …/lifecycle.ts \| grep -vc 'import type')" = 0` | ok |
| `bun packages/tui/test/review-smoke.ts` (regression, not in plan; the probe file is unchanged) | all green (9 checks) |
| `cd docs && bun run build` | Complete |

## Deviations from Plan

- **[Rule 1] The send hint gets its own rail row.** The plan said to append ` · S send N to agent` to the header line. The rail is 36 columns wide, so `COMMENTS · 2 open · 0 ✓ · S send 2 to agent` (~43 chars) would always be truncated. The hint `S send N to agent` is therefore a second rail row, shown only while `sendableCount > 0`. The header line keeps the exact `COMMENTS · …` text.
- **Keybar anchor:** following the orchestrator's note, the plan's quoted one-line Phase-4 bar (`c comment · r reply · …`) was obsolete. The new chunk went into the 04-04/04-05 second line in place of `x resolve`. Its `·` separators keep the three controls together when the bar wraps at two-space separators.
- **Not in `files_modified`:**
  - `packages/tui/src/app/artifact.tsx`: the keybar text, because it shares `useReviewKeys` and would otherwise advertise `x resolve`.
  - `docs/src/content/docs/overview.md` and `architecture.md`: AGENTS.md requires same-change doc updates.
- **TDD order:** I wrote the implementation before the frame tests within each task, so RED wasn't shown separately. Neither `D`/`S` nor the header existed before, so the new cases couldn't have passed against the old code.

## Notes

- **Commits withheld per AGENTS.md** (conservative profile). The work was done in the main tree. STATE.md and ROADMAP.md were not touched.
- **Concurrency:**
  - The `packages/review/package.json` edit is additive (one export line).
  - The overview.md edit touches only the `tk review` Commentable bullet and the keys table, not the `tk comments` section that 08-01 owns.
  - No `packages/cli` or surface files were touched.
- **Threats:**
  - T-08-05: `S` is full-page only, and `sendOpen` is called with no id filter, so it moves only open → sent.
  - T-08-06: `setThreadStatus` receives the TUI `actor`.
- **For 08-03:** import `commentControls` / `commentStatusBadge` / `reviewHeaderLabel` / `sendableCount` from `@tasks/review/lifecycle`, not the root index.

## Self-Check: PASSED
