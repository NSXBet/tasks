---
phase: 09-task-view-parity
plan: 01
subsystem: review
tags: [taskview, tui, web, model, tdd]
status: complete
requires: [04-03, 05-04, 07-04, 08-03]
provides:
  - "@tasks/review/taskview: patchFileStats, changesTree, minimapBars, needsReview, threadLocation, artifactGroups, docBlocks, isDocPath"
affects: [09-03, 09-04, 09-05, 09-06, 09-07, 09-08]
tech-stack:
  added: []
  patterns: ["type-import-only browser-safe subpath module (mirrors @tasks/review/lifecycle)"]
key-files:
  created:
    - packages/review/src/core/taskview/model.ts
    - packages/review/src/core/taskview/model.test.ts
  modified:
    - packages/review/package.json
    - docs/src/content/docs/architecture.md
decisions:
  - "needsReview: a location needs review when it has no thread or any open/sent thread; ≥1 thread all resolved/dismissed clears it (store has no per-file reviewed flag)."
  - "artifactGroups: blob → other (UNREFERENCED, key evidence:<id>); path in changes → new (A) or edit (M/R/D) in IN CHANGES; other path → src (UNREFERENCED). Rows keep attachment order; empty groups omitted."
  - "Path resolution in patchFileStats: rename to → else +++ side → else --- side (deletes) → else diff --git b/ header (binary)."
  - "minimapBars: zero-line hunks get a 0.5-line floor so size stays in (0,1]."
  - "docBlocks treats ``` and ~~~ as fences; an unterminated fence closes at EOF with trailing blank lines trimmed."
metrics:
  duration: "~15m"
  completed: 2026-11-10
actuals:
  tokens: 6800
  tasks: 2
  commits: 0
plan_head_before: 496745b6ad49570362ec3fc5d672b7da784b292f
plan_head_after: 496745b6ad49570362ec3fc5d672b7da784b292f
---

# Phase 9 Plan 01: Shared task-view model Summary

A pure, type-import-only `@tasks/review/taskview` module turns a real `git diff --patch` into per-file/per-hunk stats, the changes tree with review dots, minimap bars, typed/grouped artifact rows with live comment counts, and commentable markdown doc blocks. The TUI and web task views both read it.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (tracer) | patchFileStats → changesTree + minimapBars, `./taskview` export | withheld | model.ts, model.test.ts, package.json |
| 2 | artifactGroups + docBlocks + isDocPath | withheld | model.ts, model.test.ts |

Commits withheld per AGENTS.md (conservative profile: no git commit/push without explicit request). `commits: 0` reflects that. All changes sit uncommitted in the main tree.

## TDD Gate Compliance

- RED: `model.test.ts` written first (tmp git repo: commit `src/a.ts` + `src/middleware/auth.ts`, edit both, add `src/new.ts` with `git add -N`, `git diff --patch HEAD`). The run failed with `Cannot find module './model'`.
- GREEN: `model.ts` implemented. 20 pass / 0 fail.
- REFACTOR: none needed.
- The RED/GREEN steps were not split into commits because commits are withheld.
- Tasks 1 and 2 were written as one test file up front. Task 2's cases (artifactGroups/docBlocks) were in the same RED run.

## Verification

- `bun test packages/review/src/core/taskview/model.test.ts`: 20 pass, 0 fail, 58 expects.
- `cd packages/review && bunx tsc --noEmit -p tsconfig.json`: exit 0.
- Regression: `bun test packages/review/src` passed (1116 tests, 0 fail, 5 skip).
- `cd docs && bun run build`: Complete.
- Tracer gate: re-ran the verify commands after Task 1; they were green before expanding.
- The test file also asserts the module has no runtime imports, and that `await import("@tasks/review/taskview")` resolves.

## Deviations from Plan

**1. [Rule 1 - Bug] Test fixture miscount (test-only).** The first fixture rewrote `auth.ts` to `a = 10`, which gave −5/+1 instead of the intended −4/+1. I changed the fixture to keep line `a` and add `z`. The parser was correct.

**2. [AGENTS.md doc rule] Added a section to architecture.md.** I added item 6 "Task-view model" under the review path in `docs/src/content/docs/architecture.md`, because the new public subpath needs a doc home. The file had concurrent edits from others; my edit applied cleanly and is additive.

**3. Adaptation to landed code.** The plan was written before 04-04/04-05/08-02 landed. This plan does not touch any of their code. The `./lifecycle` export from 08-02 was present, and `./taskview` was added after it (additive only). Evidence threads in the current store carry `filePath: "evidence:<id>"` plus `evidenceId`, and `threadLocation` handles both.

## Threat Model

- T-09-01: `patchFileStats` is a single `split("\n")` pass with per-line `startsWith` checks. No whole-text regex.
- T-09-02 (accepted): the model only labels rows and reads no files.
- T-09-SC: no package installs.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: packages/review/src/core/taskview/model.ts
- FOUND: packages/review/src/core/taskview/model.test.ts
- FOUND: `./taskview` export in packages/review/package.json
- Commits: none, withheld per AGENTS.md
