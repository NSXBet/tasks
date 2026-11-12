---
phase: 09-task-view-parity
plan: 09
subsystem: git
tags: [git, review, task-view, untracked, gap-closure]
status: complete
gap_closure: true
requires: [05-01, 09-02, 09-06]
provides:
  - "`gitUntrackedFiles(cwd, runner?)`: `git ls-files --others --exclude-standard -z` (raw), sorted, directory rows (nested repos) dropped; null on non-zero exit"
  - "`gitDiffNewFile(cwd, path, { fullIndex?, contextLines? }, runner?)`: `git diff --no-index --patch [...] -- /dev/null <path>` (raw); exit 0/1 = success; empty/absolute/NUL/`..` paths rejected with no spawn"
  - "`UNTRACKED_PATCH_LIMIT` (200) and `UNTRACKED_MAX_BYTES` (1 MiB) exported from @tasks/git"
  - "`gitDiffPatch(cwd, from, null, …)` appends untracked, non-ignored files as `/dev/null` new-file diffs; range form unchanged"
affects: [packages/tui/src/review/source.ts, packages/tui/src/review/live.ts, packages/web/src/review.ts (all pick it up with no code change)]
key-files:
  created: []
  modified:
    - packages/git/src/commands.ts
    - packages/git/test/adapter.test.ts
    - packages/tui/test/review.test.tsx
    - packages/web/test/live.test.ts
    - docs/src/content/docs/architecture.md
decisions:
  - "Read-only approach (`ls-files --others` + `diff --no-index`) instead of a temp-index `add -N`: the user's index can't be touched, and ProcessRunner needs no env support."
  - "Untracked paths are relative to `cwd`; every caller passes the worktree root (source.ts uses `gitToplevel`, web passes the recorded worktree)."
  - "Symlinks are kept (git renders the link target text). Non-regular files and files over 1 MiB are skipped. A file that vanishes between ls-files and lstat is skipped silently."
  - "Each per-file patch has one trailing `\\n` stripped and parts are joined with `\\n`, which matches the trimmed tracked output. An unchanged tree is still `\"\"`."
  - "`packages/git/src/index.ts` needed no edit: it already does `export * from \"./commands.js\"`."
requirements-completed: [VIEW-02]
metrics:
  tasks: 2
  completed: 2026-11-11
actuals:
  tasks: 2
  commits: 0
---

# Phase 9 Plan 09: Untracked files in the live changeset — Summary

A file the agent creates in the task worktree and never `git add`s now shows in the TUI and web CHANGES tree, the diff, the minimap and the stats/counts, live and with no reload (gap 3 in 09-VERIFICATION.md, tk task `tasks-n5xi`). The whole fix is in `gitDiffPatch` in `packages/git/src/commands.ts`. When `to === null` it:

1. runs the unchanged tracked `git diff --patch … <from>`;
2. lists untracked, non-ignored paths with `gitUntrackedFiles`;
3. keeps the first 200 by name, lstats each one, and keeps regular files up to 1 MiB plus symlinks;
4. renders each kept file through `gitDiffNewFile`, at most 8 at a time.

The output reads `diff --git a/<p> b/<p>`, `new file mode`, `--- /dev/null`, `+++ b/<p>`. `patchFileStats` therefore reports status `A`, and the TUI hunk parser accepts it. `source.ts`, `live.ts` and `review.ts` were not changed.

## Commits

None. Commits were withheld per AGENTS.md (conservative profile, no git commit/push). All changes are in the main working tree.

## Tasks

**Task 1: adapter (TDD).** These tests were added to `describe("gitDiffPatch")` in `packages/git/test/adapter.test.ts`:

| Test | What it checks |
|---|---|
| never-added files | A never-added file shows as a new file (`index 0{40}..` under `fullIndex`). With a tracked edit, the tracked part comes first, separated by a newline. |
| ignored files | `.gitignore`d files, `node_modules/` and a nested repo are excluded. `.gitignore` itself is untracked, so it shows. |
| index untouched | `.git/index` bytes are identical after the call, `?? new.txt` is still in status, and nothing is staged. |
| range form | The range form is byte-identical with untracked files present. |
| size cap / odd names | A file over 1 MiB is skipped. `with space.txt` and `-dash.txt` render. |
| count cap | With 205 files, exactly 200 `--no-index` calls run, and `f0200` is absent. |
| argv | The exact per-file argv is `git diff --no-index --patch --full-index --unified=5 -- /dev/null -dash.txt`. No `add`, `update-index`, `read-tree` or `-N` appears. |
| `gitDiffNewFile` | Unsafe paths spawn nothing. Exit 1 counts as success, and 128 gives null. |

One existing test needed a change. The `contextLines` spy test indexed `seen[1]`, which is now the `ls-files` call. It now filters for `argv[1] === "diff"`. Dist was rebuilt with `bun run --filter @tasks/git build`.

**Task 2: live proof and docs.**

- **TUI:** a new test in `packages/tui/test/review.test.tsx`, "an untracked new file (never git-added) appears live (tasks-n5xi)". It boots `tk://diff/<id>` and waits for `watching … ●`. It then writes `src/fresh.ts` without `git add`, and the frame shows `fresh.ts`. `resolveReviewSource` stats contain `{ path: "src/fresh.ts", status: "A" }`, and `git diff --cached` is empty. I checked RED by temporarily setting `UNTRACKED_PATCH_LIMIT = 0`: the test fails at 14s, then passes once the value is restored.
- **Web:** a new test in `packages/web/test/live.test.ts`. A `review` SSE frame arrives with `reason: "worktree"`. The `/api/review/:id` patch contains `+++ b/src/fresh.ts` and `--- /dev/null`. `/taskview` has a `changes` file row `fresh.ts` with status `A` and a minimap bar for `src/fresh.ts`. The index is empty.
- **Docs:** in `docs/src/content/docs/architecture.md`, review path item 1 now covers the untracked-file contract: the commands, that the index is never modified, the 200-file and 1 MiB caps, and that the range form excludes untracked files. The web live-diff paragraph points to that same contract.
- **tk:** I added a note to `tasks-n5xi`. I did **not** run `tk close tasks-n5xi`. The plan says to close it, but per the repo's task → review loop the reviewer closes it.

## Verification (all run)

| Command | Result |
|---|---|
| `bun test packages/git/test` | 76 pass, 0 fail |
| `cd packages/git && bunx tsc --noEmit -p tsconfig.json` | clean |
| `bun test --timeout 30000 packages/review/test/headless-smoke.test.ts packages/web/test/edit-loop.test.ts` | 3 pass |
| `bun test --timeout 30000 packages/tui/test/review.test.tsx` | 33 pass, 0 fail |
| `bun test --timeout 30000 packages/web/test` | 33 pass, 0 fail |
| `bunx tsc --noEmit` (tui, web) | both clean |
| `bun packages/tui/test/taskview-smoke.ts` | 12 passed, 0 failed |
| `bun packages/tui/test/review-smoke.ts` | all green (9 checks) |
| `cd docs && bun run build` | Complete |

**Browser probe.** I used the 09-06 probe_recipe with the scratch repo at `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0909`, task `tk-uzr`, port 54918 and `AGENT_BROWSER_SESSION=gsd0909`.

- **Before the write:** CHANGES showed `ALL (1)`, `src/ ● a.ts M ●`.
- **After the write:** I ran `printf 'export const fresh = 1;\n' > $WT/src/fresh.ts` with no `git add` and waited 3s. CHANGES then showed `ALL (2) TO REVIEW (2)` with `fresh.ts A ●`, and the page did not reload.
- **Diff modal:** clicking the row opened `#diffModal`, showing `tk-uzr / src/fresh.ts A +1 −0`, `@@ -0,0 +1 @@`, and line 1 `export const fresh = 1;`.
- **Index:** `git diff --cached --name-only` printed nothing, and `git status` showed `?? src/fresh.ts`.
- **Screenshot:** `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0909/09-09-untracked.png`
- **Teardown:** the browser is closed and the real bun pid 33017 was killed. `pgrep` finds nothing and the port answers 000.

## Deviations from Plan

1. **`tasks-n5xi` was noted, not closed.** This follows the orchestrator override and the repo AGENTS.md review loop. The reviewer closes it.
2. **I adjusted one existing adapter test** (the `contextLines` spy indexing) because the working-tree form now makes an extra `ls-files` call. The assertion it makes is the same.
3. **No edit to `packages/git/src/index.ts`.** It already re-exports `commands.js` with `export *`.

Nothing was touched in `packages/surface`, rpc, luau, cli watch (10-02), or tui tasklist/App/task.tsx/help/overview.md (09-10).

## Known limits

- Paths come from `ls-files` relative to `cwd`. A caller that passes a subdirectory instead of the worktree root would get untracked files under that subdirectory only, while the tracked diff covers the whole tree. All current callers pass the root.
- Untracked files past the 200 cap, or over 1 MiB, are silently left out of the patch. The UI shows no "N more untracked" hint. WORKSPC `dirty` still counts them.

## Self-Check: PASSED
