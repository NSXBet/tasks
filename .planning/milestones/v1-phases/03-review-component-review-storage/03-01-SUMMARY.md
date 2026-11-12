---
phase: 03-review-component-review-storage
plan: "01"
subsystem: review-component
tags: [review, git-adapter, headless, smoke, REV-01]
status: complete
requires: [01-04]
provides:
  - "@tasks/git gitDiffPatch(cwd, from, to, { fullIndex }, runner) — the one enumerated unified-diff command (--end-of-options guarded)"
  - "@tasks/review/headless — git-free, OpenTUI-free, store-free entry (changesetFromPatch, createHunkDiffFilesFromPatch, countHunkDiffStats + types)"
  - "packages/review/scripts/headless-smoke.ts — node-runnable smoke: repo [--base] [--head] -> JSON diff summary"
affects:
  - packages/web/src/review.ts (patch via gitDiffPatch)
  - packages/tui/src/review/source.ts (patch via gitDiffPatch)
tech-stack:
  added: []
  patterns: ["review consumers pass a tk-derived patch; review never spawns git (D-04)"]
key-files:
  created:
    - packages/review/src/headless.ts
    - packages/review/scripts/headless-smoke.ts
    - packages/review/test/headless-smoke.test.ts
  modified:
    - packages/git/src/commands.ts
    - packages/git/test/adapter.test.ts
    - packages/review/package.json
    - packages/web/src/review.ts
    - packages/tui/src/review/source.ts
    - docs/src/content/docs/testing.md
    - bun.lock (bun install for the new workspace devDependency link)
decisions:
  - "gitDiffPatch returns the runner's stdout as-is; the shared runners trim output, so the trailing newline is dropped exactly as the previous web/TUI raw calls did — no behavior change."
  - "Every gitDiffPatch call now carries --patch and --end-of-options (the web live diffs and TUI diffs previously lacked --end-of-options); output is identical, option injection via metadata revs is closed (T-03-01)."
  - "@tasks/git added to packages/review as a devDependency (workspace:*) — only the test and scripts import it; src stays git-free. Required so the test and the bun build of the script resolve @tasks/git."
  - "TUI: runGitDiff deleted; call sites inline `(await gitDiffPatch(cwd, rev, null, {}, runner)) ?? \"\"`."
metrics:
  completed: 2026-11-10
  tasks: 3
---

# Phase 03 Plan 01: Headless review smoke + one diff adapter — Summary

tk now derives every review patch through one enumerated command (`gitDiffPatch` in `@tasks/git`), and the vendored
review component turns that patch into its diff model headlessly, from plain node, with no TTY and no git code of its own.

## Tasks

| # | Task | Result |
|---|------|--------|
| 1 | Tracer: `gitDiffPatch` + `@tasks/review/headless` + in-process smoke | done |
| 2 | Node smoke script (bundled `--target=node`, stdin ignored) + testing.md section | done |
| 3 | Web + TUI patch derivation via `gitDiffPatch`; git-free gate on packages/review | done |

## What changed

- `packages/git/src/commands.ts`: `gitDiffPatch` — argv `diff --patch [--full-index] --end-of-options <from | from...to>`;
  `to === null` = working tree vs `from`. Additive only; runner.ts/sync.ts/index.ts untouched.
- `packages/git/test/adapter.test.ts`: `describe("gitDiffPatch")` — three-dot range (+ full-index), working-tree form
  picks up an uncommitted edit, bogus ref -> null, `--output=<file>` ref -> null and no file written.
- `packages/review/src/headless.ts` + `"./headless"` export; `@tasks/git` devDependency.
- `packages/review/test/headless-smoke.test.ts`: scratch repo (main + `tk/smoke-1`: edit `src/a.ts`, add `src/b.ts`,
  delete `README.md`) -> 3 files, a.ts 1/1, b.ts 2/0, README 0/2; node describe bundles the script, runs `node` with
  `stdin: "ignore"`, asserts the same files/totals (skipIf node missing).
- `packages/review/scripts/headless-smoke.ts`: `headless-smoke <repo> [--base] [--head]`; base defaults to merge-base
  with the default branch, else `HEAD`; prints one JSON line from `DiffFile.stats`.
- `packages/web/src/review.ts`: local `run` removed; worktree, branch-ref and frozen-snapshot patches via
  `gitDiffPatch(..., { fullIndex: true }, runner)`; SHA guard and null/patchError behavior unchanged.
- `packages/tui/src/review/source.ts`: `runGitDiff` removed; single-rev working-tree diffs via `gitDiffPatch(…, null, …)`.
- `docs/src/content/docs/testing.md`: "Headless review smoke" section.

## Verification (all run 2026-11-10)

- `bun test packages/git/test/adapter.test.ts packages/review/test/headless-smoke.test.ts` — 16 pass, 0 fail (node describe ran, not skipped).
- `cd packages/review && bunx tsc --noEmit -p tsconfig.json` — rc 0 on final run. (An earlier run failed with
  `src/app/taskStoreCommentStore.ts: Module '@tasks/surface' has no exported member 'withLegacyHunkImport'` — concurrent
  03-04 work in progress, not this plan's files; it resolved once 03-04 landed.) New files (`headless.ts`, script, test)
  type-check clean under a temporary config including them.
- `bun run --filter @tasks/git build` — exit 0 (dist rebuilt with gitDiffPatch).
- `bun build packages/review/scripts/headless-smoke.ts --target=node --outfile /tmp/tk-review-smoke.mjs && node /tmp/tk-review-smoke.mjs <this repo> --base HEAD~1 --head HEAD </dev/null | …` — printed `files 4`.
- `cd docs && bun run build` — Complete.
- `bun test --timeout 15000 packages/web/test packages/tui/test` — 49 pass, 0 fail.
- Grep gates: raw `["git","diff"` in web/tui src = 0; spawn / git-argv sites in packages/review src+scripts (non-test) = 0.
- `bun test packages/review/src` — 1084 pass, 5 skip, 0 fail.
- D-06: `packages/pi-extention/package.json` declares `@tasks/surface` and `@tasks/daemon` as `workspace:*` — recorded as already landed 2026-11-10, no edit.

## Deviations

- [Rule 3 - Blocking] Added `"@tasks/git": "workspace:*"` to packages/review devDependencies and ran `bun install`
  (bun.lock re-saved, "no changes" to installs): `@tasks/git` was not resolvable from packages/review, so neither the
  test nor the script bundle could import it. Dev-only, so the review src stays git-free (D-04).

## Notes

- Commits withheld per AGENTS.md (conservative profile; orchestrator override). STATE.md/ROADMAP.md not touched.
- Worked in the main tree; unrelated uncommitted changes left alone.
