---
phase: 04-terminal-review
plan: 03
subsystem: tui, review, docs
tags: [review-comments, thread-rail, mock-removal, tmux-probe, docs]
requires: [04-01, 04-02]
provides:
  - "Thread rail filtered by file path, with lifecycle status chips"
  - "ReviewKeybar (diff.tsx), the plain key-hint bar for the diff and artifact views"
  - "Review composer placeholders (`comment on <file>[:<line>]`, `reply…`, `edit comment`)"
  - "packages/tui/test/review-smoke.ts: tmux probe of the real `tk review` loop"
affects: [phase 7 (task view rail), phase 8 (comment send, deferred), phase 9 (rail tabs, deferred)]
key-files:
  created:
    - packages/tui/test/review-smoke.ts
  modified:
    - packages/tui/src/app/diff.tsx
    - packages/tui/src/app/composer.tsx
    - packages/tui/src/app/artifact.tsx
    - packages/tui/src/app/task.tsx
    - packages/tui/src/app/App.tsx
    - packages/tui/src/app/help.tsx
    - packages/tui/test/review.test.tsx
    - docs/src/content/docs/overview.md
    - docs/src/content/docs/testing.md
    - docs/src/content/docs/architecture.md
decisions:
  - "The rail has a fixed width (RAIL_WIDTH = 36, flexShrink 0) and the diff body's width subtracts it. At 30% the rail was squeezed to about 15 columns and wrapped every line."
  - "Comment bodies in the rail drop the stored `[review <loc>]` / `[review reply]` prefix on display only. The location is already on the thread line, and storage is unchanged, so `tk show` still prints the prefix."
  - "The stats line shortens a full hex base sha to 12 chars, so `tk/<id> ← <base> · +N −M` fits beside the fixed-width rail."
requirements-completed: [REV-03]
metrics:
  tasks: 3
  completed: 2026-11-10
---

# Phase 04 Plan 03: Terminal review comments, mock removal, real-terminal probe — Summary

A line comment typed in the TUI diff view (`j`, `c`, type, Enter) now shows in the TUI's own thread rail and lands on the task record. A fresh `tk show <id>` prints `REVIEW (1) · 1 open · 0 ✓` with `src/a.ts:<line>` and the body. `x` resolves it, and `tk show` then prints `All resolved`. The mock-shell plumbing is gone. A tmux probe drives the real `tk review` through SC-1..SC-4 and the branchless empty state, 5/5 green. The docs describe the live, editable, commentable, branch-scoped review.

## What was built

- **Task 1 (tracer), diff.tsx:**
  - `Workbench` filters threads by `file.path` instead of `file.id` (the bug 04-02 found).
  - `ThreadList` shows `thread.status` (`open` / `→ sent` / `✓ resolved` / `– dismissed`), falling back to `resolved`.
  - `]` clamps to `files.length - 1`.
- **Task 1, composer.tsx:** review-mode placeholders. `review-comment` shows `comment on <file>[:<line>]` from `state.composer.review`.
- **Task 1, review.test.tsx:** two new cases.
  - The comment round trip: TUI rail → fresh `tk show` → reopen, `x` → `All resolved`, and `--json` `review.counts.allResolved === true`.
  - `]` ×3 with 2 files leaves the second file selected.
- **Task 2:**
  - Deleted `ComposerRow` and its WIP chip.
  - Added `ReviewKeybar` (height-1, dim, no border or chip). `DiffView` and `ArtifactView` use it, with the artifact keys `c comment · r reply · E edit comment · e edit hunk · x resolve · esc back to task`.
  - Removed the dangling import from task.tsx. That was the only task.tsx change; the doors lines are untouched.
  - Reworded the `ShellKeys` comment and the diff.tsx header doc.
- **Task 3:**
  - `packages/tui/test/review-smoke.ts`:
    - Setup: its own `-S` socket, `-f /dev/null`, session `tkrev-<pid>`, 140x40, repo root from `import.meta.dir`.
    - Teardown: `finally` kills the tmux server and removes the scratch repo. The worktree sits under `<scratch>/.worktrees`, so it goes too.
  - `help.tsx`: new `review (tk review <id> · 7)` section.
  - Docs: `overview.md` `### Review` (`tk work` in place of `tk update --branch`, plus the live / edit / comment / branchless points; the `metadata.reviewThreads` and legacy-import paragraph is kept), `testing.md` (inventory and a review-probe paragraph under Real-pty smoke), and `architecture.md` (TUI Review Path step 3: the clause on the git-free watch entry and tk supplying the plan and signature; new step 5: comments).

## Verification (all run)

| Command | Result |
|---|---|
| `bun test --timeout 30000 packages/tui/test/review.test.tsx` | 12 pass / 0 fail |
| `cd packages/tui && bun run check` | exit 0 |
| `grep -rn 'ComposerRow\|notify("WIP")' packages/tui/src \| wc -l` | 0 |
| `grep -rni mock packages/tui/src \| wc -l` | 0 |
| `bun test --timeout 15000 packages/tui/test` | 71 pass / 0 fail (6 files), run twice |
| `bun packages/tui/test/review-smoke.ts` | 5/5 ok, run twice |
| `cd docs && bun run build` | Complete |
| `bun packages/tui/test/smoke.ts` (regression, not in the plan) | 13/13 ok |

No `tkrev-*` tmux sessions or `tk-review-smoke-*` scratch dirs were left after the runs.

## Deviations from Plan

- **[Rule 1] Review keys fired while typing in the review composer.**
  - **Bug:** `useReviewKeys` only bailed while the hunk-edit buffer was open. Typing `tighten this` into the comment composer hit `e` and opened the hunk editor. `c`, `x`, `r`, `u`, `p`, `j`, `k`, `[` and `]` in comment text would also have fired.
  - **Fix:** the hook now returns early while the composer, help or palette is open, the same guard `list.tsx` uses.
  - **How it was found:** the new round-trip test.
- **[Rule 1] The thread rail was unreadable at 140 columns.**
  - **Bug:** the rail's 30% width collapsed to about 15 columns, so `open src/a.ts:1` wrapped across lines.
  - **Fix:** a fixed 36-column rail. The diff width subtracts it, and rail lines are truncated to the rail width.
  - **Follow-on bug:** the narrower body then pushed the stats line `· +N −M` off-frame, which broke the 04-01 live test. The base sha is now shortened to 12 chars when it is a full hex id.
- **[Rule 1] Stored comment bodies showed `[review src/a.ts:1] …` in the rail.** The prefix is stripped on display only. The plan's `tester: tighten this` assert now matches; storage and `tk show` are unchanged.
- **Probe step 2:** the diff nav renders a tree (`src/` over `a.ts`), not a `src/a.ts` string. The check accepts either form, plus `tk/<id>`.
- **Probe step 4:** `End`, `Enter`, the literal text and `C-s` all reached the OpenTUI textarea through tmux as planned. No alternative key was needed.
- **Stray `packages/tui/test/tmpdbg/`:** it no longer existed when this plan started, so nothing was deleted.

## Notes

- Commits were withheld per AGENTS.md (conservative profile). The work was done in the main tree. STATE.md and ROADMAP.md were not touched.
- Prohibitions held: no send-to-agent controls, no rail tabs, diff modal or evidence images, and task.tsx changed only by one import line.

## Self-Check: PASSED
