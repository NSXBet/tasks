---
phase: 04-terminal-review
plan: 01
subsystem: tui, review
tags: [live-review, watch-controller, branchless-empty-state, tui]
requires: []
provides:
  - "@tasks/review/watch entry (createWatchController, createWatchEventSource, WatchPlan/WatchTarget, WatchController/WatchControllerOptions)"
  - "packages/tui/src/review/live.ts: reviewWatchPlan, reviewSignature, startReviewWatch"
  - "ReviewSource.empty: 'no-branch' | null (no working-tree fallback)"
affects: [04-02 (in-view edit rides the same live session), 04-03 (comments)]
key-files:
  created:
    - packages/review/src/watch.ts
    - packages/tui/src/review/live.ts
    - packages/tui/test/review.test.tsx
  modified:
    - packages/review/package.json
    - packages/tui/src/review/source.ts
    - packages/tui/src/app/App.tsx
    - packages/tui/src/app/diff.tsx
    - packages/tui/src/app/task.tsx
    - packages/tui/test/app.test.tsx
    - docs/src/content/docs/architecture.md
decisions:
  - "The re-resolve trigger is a derived key (`branch|pinned base`, or `pending` while the board is unfetched / `missing`), not a useRef. The initial board is empty, so an effect keyed on reviewId alone would resolve `unknown issue` before the first load."
  - "The live-watch effect is keyed on a joined string of the source identity fields (issueId, cwd, branch, base, error, empty). A live merge with the same identity does not restart the watcher."
  - "The branchless task rail keeps the `THREADS N open` line under the hint, so the existing app.test assert holds."
requirements-completed: [REV-03]
metrics:
  tasks: 2
  completed: 2026-11-10
---

# Phase 04 Plan 01: Live, branch-scoped terminal review — Summary

`tk review <id>` after `tk work <id>` opens the diff over the tk-derived patch: the worktree's working tree against the pinned base. A commit or edit made in the worktree by another process re-renders the diff within about a second, with no key press, through the vendored debounced watch controller. The selected file is kept by path. A task with no branch shows `no branch yet — run tk work <id>` and never diffs the workspace.

## What was built

- **`@tasks/review/watch`** (`packages/review/src/watch.ts`, plus an additive `"./watch"` export in package.json): a git-free re-export of `createWatchController`, `createWatchEventSource`, and the plan and controller types.
- **`packages/tui/src/review/live.ts`**:
  - `reviewWatchPlan` builds a hybrid plan: the worktree `directory-tree` (ignoring `node_modules` and `.git`), the loose branch ref file under `<commonDir>/refs/heads/...`, and `<commonDir>/packed-refs`.
  - `reviewSignature` returns `<branch head>:<Bun.hash(patch)>`, where the patch comes from `gitDiffPatch(cwd, base, null)`.
  - `startReviewWatch` uses quiet 250 ms and max 1000 ms, keeps the default safety polls, and returns `controller.close`. Errored, empty, or branch-null sources get a no-op stop.
  - All git calls go through `@tasks/git`.
- **App.tsx**: the single board-keyed review effect is split three ways:
  1. Initial resolve, keyed on `reviewId` plus the issue's `branch|base` key. While the board is unfetched it stays in `loading`.
  2. A board-keyed effect that only reloads threads.
  3. The live-watch effect. Its `onChange` re-resolves and merges through `mergeLiveSource`: the file is matched by path (else the same index if in range, else 0), the hunk index is clamped, `layout` and `threadIndex` are kept, and `loading` stays false. `onError` sends one `review watch: …` toast per watch.

  `AppActions` signatures are unchanged.
- **source.ts**: a branchless issue now returns early with `{ empty: "no-branch", error: null, base: pinned }` and makes no git call. Every other return carries `empty: null`, and the doc comment is updated.
- **Views**:
  - `Workbench` (diff and artifact views) renders a dim `no branch yet — run tk work <id>` line plus an accent `tk work <id>` line.
  - The task-view review rail shows the hint plus `THREADS N open`. Only the rail conditional was edited; the 07-02 doors lines were not touched.
- **Tests** (`packages/tui/test/review.test.tsx`, 6 cases), built on a scratch git repo with `tk init` / `tk create` / `tk work` through the CLI:
  - boot shows `tk/<id>` with `a.ts` selected
  - a live commit from `Bun.spawnSync(git …)` shows `live.ts`, the `+N` goes up, `a.ts` stays selected, and `resolving review source` never appears
  - after `]`, the selection by path survives `z.ts` moving from index 1 to 2
  - the branchless diff view shows the hint, with no `HEAD` and no file list
  - the branchless task rail shows the hint, with no `branch —` or `base HEAD`
  - `resolveReviewSource` with a recording runner makes no `diff` call
- **app.test.tsx**: the two branchless asserts were replaced with `no branch yet`.
- **Docs**: new "TUI Review Path" subsection in `architecture.md`, covering source resolution, the branchless empty state, and live re-render.

## Verification (all run)

| Command | Result |
|---|---|
| `bun test --timeout 30000 packages/tui/test/review.test.tsx` | 6 pass / 0 fail |
| Sanity: live test with `startReviewWatch` forced to a no-op | fails as expected (restored afterwards) |
| `bun test packages/review/src/core/watch` | 97 tests, 0 fail (4 skip) |
| `cd packages/tui && bun run check` | exit 0 (the deps build clean, then tsc --noEmit) |
| `cd packages/review && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `bun test --timeout 15000 packages/tui/test` | 45 pass / 0 fail |
| `grep -n '"HEAD", null' packages/tui/src/review/source.ts` | 0 lines |
| `cd docs && bun run build` | Complete |

One transient failure: a run partway through hit `ReferenceError: WorktreeConfigSchema is not defined` in `packages/workspace/src/config.ts`. That file was in the middle of an edit by the concurrent 06-01 executor. It resolved on its own, and every later run was green.

## Deviations from Plan

- **Re-resolve keying:** the plan's useRef `branch|base` key became a derived `reviewKey` dependency, for the reason given in decisions. The intent is the same: board changes only reload threads unless the branch or base changes.
- **Selection assertions:** the frame-based tests use the nav's selected marker (`▌ M a.ts`). The nav renders a directory tree (`src/` over `a.ts`), so the literal `src/a.ts` never appears in the frame. A third live test (selection survives an index shift) was added, because with `a.ts`/`live.ts` alone, keeping the index and keeping the path are indistinguishable.
- **[Rule 2] Docs:** AGENTS.md requires docs in the same change, so `architecture.md` was edited. The plan did not list it.
- The task rail keeps the `THREADS N open` line in the branchless state, so the unchanged `THREADS 0 open` assert in app.test still holds.

## Notes

- Commits were withheld per AGENTS.md (conservative profile). The work was done in the main tree. STATE.md and ROADMAP.md were not touched.
- The `packages/review/package.json` change is additive only (one export line).

## Self-Check: PASSED
