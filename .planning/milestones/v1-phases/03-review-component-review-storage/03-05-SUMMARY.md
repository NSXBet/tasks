---
phase: 03-review-component-review-storage
plan: 05
subsystem: review-record-presentation
tags: [review, tk-show, domain, web, docs]
status: complete
requires: [03-02, 03-04]
provides:
  - "@tasks/domain CommentSummary.dismissed / .allResolved; commentsLine renders `All resolved`"
  - "tk show REVIEW (N) section (per-comment ○/→/✓/– glyph, location, author, first body line)"
  - "tk show --json `review: { comments, counts }`"
affects: [packages/domain, packages/cli, packages/web, packages/tui (via domain), docs]
key-files:
  created:
    - packages/review/test/show-review.test.ts
  modified:
    - packages/domain/src/review-record.ts
    - packages/domain/test/review-record.test.ts
    - packages/cli/src/presentation.ts
    - packages/cli/src/tk.ts
    - packages/cli/test/presentation.test.ts
    - packages/web/src/app.html
    - docs/src/content/docs/overview.md
decisions:
  - "formatShow's comments row uses surface reviewComments counts when the record has review cards (so legacy-imported Hunk comments count); it falls back to domain commentSummary otherwise, which keeps id-less fixture threads and the empty `comments 0 · 0 open 0 ✓` row working"
  - "T-03-08 sanitizer strips C0 + DEL from location, author and the body's first line, not only the body"
  - "countReviewComments label text unchanged; `All resolved` is only a header/row decision on allResolved"
requirements-completed: [REV-02]
metrics:
  tasks: 3
  files: 8
  completed: 2026-11-10
actuals:
  tokens: 9000
  tasks: 3
  commits: 0
plan_head_before: 496745b6ad49570362ec3fc5d672b7da784b292f
plan_head_after: 496745b6ad49570362ec3fc5d672b7da784b292f
---

# Phase 03 Plan 05: Review state on the record Summary

`tk show` now lists every review comment stored in `metadata.reviewThreads`. Each row shows a status glyph, `file:line`, the author and the first line of the body. The section header shows `N open · K ✓`, or `All resolved` once nothing is open or sent. CLI, TUI and web all count comments the same way (rule D-09).

## What was built

**Task 1 (tracer): from the adapter write to `tk show`**
- `packages/domain/src/review-record.ts`:
  - `CommentSummary` gains `dismissed` and `allResolved`.
  - `commentSummary` takes each thread's stored `status` when it is one of open, sent, resolved or dismissed. Otherwise it uses `resolved === true` to mean resolved, and anything else is open.
  - open + sent count as open. dismissed settles the comment without counting as resolved.
  - `allResolved` is true when there is at least one thread and none are open.
  - `commentsLine` returns `comments N · All resolved · K ✓` when `allResolved` is true. In every other case the string is unchanged. The TUI task view picks this up through its existing import.
- `packages/cli/src/presentation.ts` `formatShow`:
  - Calls `reviewComments(issue)` from `@tasks/surface`.
  - The comments row uses its counts.
  - A new `REVIEW (N) · <label | All resolved>` section sits between the doors/comments block and DESCRIPTION. Glyphs: `✓` green, `○`, `→` cyan, `–` dim.
  - Location, author and the body's first line have C0 control characters and DEL removed (T-03-08).
- `packages/review/test/show-review.test.ts` (new, end to end):
  1. `tk init` and `tk create` run through the CLI.
  2. `openSurfaceStore` plus `taskStoreCommentStore.createThread` add a line comment (`src/a.ts:3`) and a file-level comment (`README.md`), then the store is closed.
  3. A fresh `tk show` process prints `REVIEW (2) · 2 open · 0 ✓` and `○ src/a.ts:3  …  tighten this`.
  4. `setThreadStatus(..., 'resolved')` is called on both comments.
  5. A fresh `tk show` prints `REVIEW (2) · All resolved`, `✓ src/a.ts:3`, and `comments 2 · All resolved · 2 ✓`.
  6. `tk show --json` returns `review.counts.allResolved === true`, and each card has the right location and status.

**Task 2: `tk show --json` review payload and unit coverage**
- `packages/cli/src/tk.ts` show branch: added `wire["review"] = reviewComments(issue)` and the import. This is the same shape the `comments.list` RPC verb returns.
- `packages/cli/test/presentation.test.ts` has three new cases:
  - partial: `REVIEW (2) · 1 open · 1 ✓`, `✓ a.ts:2`, `○ b.ts`, with the second body line and the ESC byte stripped
  - all resolved: header and comments row both read `All resolved`
  - dismissed only: reads `All resolved`; sent counts as open and renders `→`
- The no-threads case also asserts that there is no REVIEW section.
- The existing id-less fixture cases are unchanged and still pass.

**Task 3: web and docs**
- `packages/web/src/app.html` `commentsLine` now uses the same status rule and renders `All resolved`. It is still inline JS, with a comment saying it mirrors `@tasks/domain`. The `esc()` wrapper at the call site is kept (T-03-09).
- `docs/src/content/docs/overview.md` "The review record" now covers:
  - the comments-row rule
  - the `REVIEW (N)` section
  - the `review` object in `tk show --json`
  rpc.md is unchanged, because `tk show --json` is not an RPC verb.

## Verification

| Command | Result |
|---|---|
| `bun test packages/domain/test/review-record.test.ts packages/review/test/show-review.test.ts packages/cli/test/presentation.test.ts` | 15 pass / 0 fail |
| `cd packages/domain && bunx tsc --noEmit -p tsconfig.json` | clean |
| `bun test packages/cli/test/presentation.test.ts packages/cli/test/show-changeset.test.ts packages/cli/test/finish.test.ts` | 24 pass / 0 fail (the first run had 3 failures: the new test fixture comments were missing `wireUnknown`, and one assertion was scoped too broadly; both were test fixes) |
| `cd packages/cli && bunx tsc --noEmit -p tsconfig.json` | clean |
| Task 3: greps for `All resolved` and `dismissed` in app.html; `bun test --timeout 15000 packages/web/test/server.test.ts`; `All resolved` grep in overview.md; `cd docs && bun run build` | 13 pass / 0 fail; docs build complete |
| Plan verification: the five test files together | 31 pass / 0 fail |
| `bun test --timeout 15000 packages/web/test packages/tui/test` | 49 pass / 0 fail |
| Extra: `packages/review` and `packages/tui` `tsc --noEmit` | clean |
| Extra: the web `commentsLine` was pulled out and run under node | `All resolved · 1 ✓`, `1 open 1 ✓` and `0 open 0 ✓` as expected |

## Deviations from Plan

- **[Rule 3] Rebuilt `packages/domain` dist.** Ran `bunx tsc -p tsconfig.json`. The `dist/` folder is gitignored and consumers resolve `@tasks/domain` types through it, and `CommentSummary` changed shape. No source change was needed.
- **[Rule 2] Wider T-03-08 sanitizing.** `location` and `author` are also stripped of control characters, because both come from stored data.
- **Comments-row fallback.** When there are no review cards (no threads, or only id-less ones), the row uses domain `commentSummary` instead of the surface counts. This keeps the existing fixtures and the empty case byte-identical. Both rules are the same for every record that has thread ids.
- **Not fixed (out of scope).** The existing `COMMENTS (N)` section still prints raw comment text, including any ESC bytes, which was already the case before this plan. Only the new REVIEW rows are sanitized.

## Known Stubs

None.

## Notes

- **Commits withheld per AGENTS.md** (conservative profile, orchestrator override). All changes are uncommitted in the main tree, so `commits: 0` is expected. STATE.md and ROADMAP.md were not updated, per the orchestrator.
- Files owned by 03-01 were not touched: `packages/git/src/commands.ts`, the `packages/review` headless entry and `package.json`, `packages/web/src/review.ts` and `packages/tui/src/review/source.ts`. `server.ts` was not touched either.
- No new resolve verb, and no package installs.

## Self-Check: PASSED
- All 8 listed files exist with the changes described, and `show-review.test.ts` was created.
- Every verify command was run in this session, with the results shown above.
