---
phase: 03-review-component-review-storage
plan: 02
subsystem: cli
tags: [review, cli, docs, cleanup]
requires: []
provides:
  - "tk CLI with no `hunk` command; `tk review <id>` is the only review door"
affects: [packages/cli, docs]
key-files:
  created: []
  modified:
    - packages/cli/src/tk.ts
    - packages/cli/test/tk.test.ts
    - README.md
    - docs/src/content/docs/overview.md
    - docs/src/content/docs/architecture.md
    - docs/src/content/docs/structure.md
    - .agents/skills/tasks/SKILL.md
  deleted:
    - packages/cli/src/hunk.ts
decisions:
  - "Gate false positives in vendored packages/review left untouched (plan prohibits editing packages/review)"
requirements-completed: [REV-01]
duration: ~15min
completed: 2026-11-10
---

# Phase 03 Plan 02: Remove legacy `tk hunk` spawn path Summary

**Deleted `packages/cli/src/hunk.ts` and the `tk hunk` method/help/dispatch, so `tk hunk` now fails with `unknown command: hunk`. The docs now name `tk review <id>` as the only review door.**

## Accomplishments

- **Task 1:** removed `packages/cli/src/hunk.ts`. In `packages/cli/src/tk.ts`, removed:
  - the `./hunk.js` import
  - the `hunk(args)` method and its doc comment
  - `readHunkCommentIds`
  - the two `hunk <id>` help lines
  - the `command === "hunk"` dispatch branch

  Imports that became unused were also removed (`bunRunner` and `gitToplevel`). The other candidates (`gitCurrentBranch`, `gitWorktreeList`, `gitDefaultBranch`, `gitMergeBase`, `Metadata`, `changed`, `commentWire`, `cyan`) are still used elsewhere, so they stay. Only the hunk-related hunks were touched; the file's other uncommitted edits are preserved. The old `hunk --print` test was replaced by `tk hunk is gone; tk review is the only review door`. The new test checks the `unknown command: hunk` JSON error, and that help omits `hunk <id>` and includes `review`.
- **Task 2:** in `README.md` and `overview.md`, the command list swaps the two hunk lines for `tk review <id>`, and `### Hunk integration` is replaced by `### Review`. The new section covers:
  - `packages/review`, vendored from Hunk and rendered with OpenTUI
  - the `base...branch` diff, resolved through `@tasks/git`
  - `metadata.reviewThreads`, written by both the TUI and the web UI
  - no `hunk` binary and no sync step
  - automatic carry-over of comments the earlier sync command had imported

  Other doc edits:
  - `architecture.md`: "hunk review integration" becomes "review door (`tk review` -> TUI diff)".
  - `structure.md`: the `hunk.ts` clause is removed; the rest of the 01-04 text is kept.
  - `.agents/skills/tasks/SKILL.md`: rule 6 now points at `tk review <id>`.

## Verification

| Check | Result |
|---|---|
| `test ! -e packages/cli/src/hunk.ts` | pass |
| `bun test packages/cli/test/tk.test.ts` | 57 pass / 0 fail |
| `cd packages/cli && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| Legacy-symbol grep gate (`planHunk\|writeAgentContext\|…` over packages/*/src) | **2 hits, expected 0**: both are the substring `planHunkMove` in `packages/review/src/core/review/navigation.ts` (vendored Hunk navigation, unrelated). With word boundaries (`grep -w`) the result is 0. |
| Hunk-spawn grep gate (`\[\s*"hunk"\s*,\|"hunk",\s*"session"`) | **1 hit, expected 0**: `HOMEBREW_ARTIFACT_NAMES = ["hunk", "hunkdiff"]` in `packages/review/src/core/install/installSource.ts` is a list of file names used for matching, not a spawn argv. A grep for `spawn(["hunk"` / `run(["hunk"` / `"hunk","session"` returns 0. |
| `metadata.hunkComments` writers | none; the only `hunkComments` occurrence in source is `LEGACY_HUNK_COMMENTS_KEY` in `packages/surface/src/operations/review-comments.ts` (03-04's read-only importer) |
| Docs grep gate (`tk hunk\|hunk\.ts\|hunk review integration`) | 0 |
| `grep -q 'tk review' overview.md` | pass |
| `cd docs && bun run build` | Complete |

## Deviations from Plan

- **Grep gates as literally written do not return 0.** The plan's regexes also match unrelated code in vendored `packages/review` (see the table). The plan forbids editing `packages/review`, so those files were left alone. The intent of the gates holds: there are no legacy symbols and nothing spawns the external `hunk` binary. If the gates must pass literally, a follow-up should make them stricter (`grep -w`, or exclude `packages/review`).
- `packages/cli/dist/hunk.js` (stale build output) still exists. It is not source and is outside the plan's scope.

## Notes

- Commits withheld per AGENTS.md (conservative profile; no git commit/push). STATE.md and ROADMAP.md were not updated, per the orchestrator's instructions.
- Precondition for Task 2 met: `01-04-SUMMARY.md` exists.
