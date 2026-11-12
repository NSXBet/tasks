---
phase: 03-review-component-review-storage
plan: 04
subsystem: review-storage
tags: [review, migration, legacy-hunk, surface]
requires: []
provides:
  - "@tasks/surface LEGACY_HUNK_COMMENTS_KEY, importLegacyHunkComments, withLegacyHunkImport"
  - "first-read import of legacy Hunk comments through surface verbs and the @tasks/review task-store adapter"
affects: [packages/surface, packages/review]
key-files:
  modified:
    - packages/surface/src/operations/review-comments.ts
    - packages/surface/test/review-comments.test.ts
    - packages/review/src/app/taskStoreCommentStore.ts
    - packages/review/test/review-comment-store.test.ts
decisions:
  - "Imported thread id = root comment id (`hunk-<id>`), so the existing comment is reused as the root and no comment is added"
  - "A legacy key that yields nothing to import is still deleted (dropped once), so the import stays idempotent"
  - "Non-matching legacy text -> file-level thread at filePath `(hunk)` with no side"
requirements-completed: [REV-02]
metrics:
  tasks: 2
  files: 4
completed: 2026-11-10
---

# Phase 03 Plan 04: Legacy Hunk comment import Summary

The first time a task is read, any comments the removed Hunk sync left under `metadata.hunkComments` are turned into `open` review threads. The import is saved in the same transaction as that read, and the legacy key is deleted. Reads go through both the surface verbs (RPC / `tk`) and the @tasks/review adapter (TUI / web), so both paths trigger the import.

## What was built

**Task 1: surface (`packages/surface/src/operations/review-comments.ts`)**
- `LEGACY_HUNK_COMMENTS_KEY = 'hunkComments'`. A doc comment says it is only read and then deleted, never written.
- `importLegacyHunkComments(issue)` is pure. For each id it finds the matching `hunk-<id>` comment and parses its text with one anchored regex, `^\[hunk (.+):(\d+|\?)( \(old\))?\] `. The greedy file group means a path that contains `:` keeps everything before the last `:<line>`. Each match becomes a registry record with exactly the field set that `parseReviewThreadRegistry` accepts. Existing threads and unknown registry fields are kept. Ids that are already a thread root, or that have no matching comment, are skipped. The registry is written with `version: 1`. No `reviewCommentLog` entries are added. It returns null when there is no legacy key.
- `withLegacyHunkImport(uow, issue)` saves the import inside the caller's transaction and returns the issue read back after the save. It throws `MessageError('legacy review comment import failed')` if the save fails.
- `reviewComments(issue)` applies the import in memory only, so pure readers such as `tk show` already see the legacy comments before anything is saved.
- `bodyOf` now strips both the `[review …] ` and the `[hunk …] ` prefix.
- `reviewCommentList`, `reviewCommentSetStatus` and `reviewCommentSend` run the import before any lifecycle logic.

**Task 2: adapter (`packages/review/src/app/taskStoreCommentStore.ts`)**
- `readIssue`, `withRegistry` (before `parseReviewThreadRegistry`) and `setThreadStatus` (before `requireRecord`) now call `withLegacyHunkImport` right after `getOrThrow`. That covers `listThreads`, `createThread`, `appendReply`, `editThreadComment` and `setThreadResolved`/`setThreadStatus`. `sendOpen` goes through the surface `reviewCommentSend`, which Task 1 already covers.
- Errors need no new mapping. A thrown `MessageError` already becomes `ReviewCommentStoreError` through the existing `if (!outcome.ok)` mapping.

## Verification

| Command | Result |
|---|---|
| `bun test packages/surface/test/review-comments.test.ts` | 10 pass / 0 fail (7 new) |
| `cd packages/surface && bunx tsc --noEmit -p tsconfig.json` | clean |
| `bun test packages/review/test/review-comment-store.test.ts packages/surface/test/review-comments.test.ts` | 20 pass / 0 fail (3 new adapter tests) |
| `bun test packages/review/src` | 1089 tests, 0 fail, 5 skip |
| `cd packages/review && bunx tsc --noEmit -p tsconfig.json` | clean (after rebuilding surface dist, see Deviations) |
| `hunkComments` grep in surface/review/web/tui src, excluding the surface importer | 0 hits |
| `bun test packages/surface/test` (extra) | 65 pass / 0 fail |

The tests cover:
- the two-record import shape (line, side and file parsed; `hunkComments` removed; no log entries)
- existing threads and registry fields kept
- already-rooted and missing comments skipped
- the `(hunk)` fallback for unparseable text
- colon-containing paths
- null when there is no key, and an empty key being dropped
- the in-memory card view (prefix stripped, `open: 2`)
- saving on first read, with the second read byte-identical
- resolving an imported comment (resolved 1 / open 1)
- adapter `listThreads`, `createThread` (no duplicate root) and `setThreadStatus` on a task that was never read

## Deviations from Plan

- **[Rule 3 - Blocking] Stale `@tasks/surface` dist types.** `packages/review`'s typecheck resolves `@tasks/surface` through `exports.types` → `dist/index.d.ts`, which did not include the new export (TS2305). I fixed it by running `bunx tsc -p tsconfig.json` in `packages/surface` to regenerate the gitignored `dist/`. No source change was needed. Anyone running the review typecheck in a fresh checkout needs the surface build first, which is the existing `check` script pattern.
- The surface test file's new imports sit together at the top of the file. No functional change.

## Notes

- No `reviewCommentLog` entries are written for imports (T-03-07, accepted). Legacy comments predate the event wire, so no stale `task.comment` events fire.
- No package installs.
- Edits stayed inside the four files the plan lists. `packages/review/src/index.ts` was not touched.
- **Commits withheld per AGENTS.md** (conservative profile, orchestrator override). STATE.md and ROADMAP.md were not updated, per the orchestrator.

## Self-Check: PASSED
- All four modified files exist with the changes described.
- Every verify command above was run in this session, with the results shown.
