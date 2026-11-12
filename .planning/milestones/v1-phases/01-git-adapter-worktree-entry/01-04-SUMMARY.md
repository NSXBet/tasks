---
phase: 01-git-adapter-worktree-entry
plan: "04"
subsystem: git-adapter
tags: [git, runner, hooks, gap-closure, GIT-01]
status: complete
requires: []
provides:
  - "@tasks/git nodeRunner (execFile, abortable, never throws)"
  - "@tasks/git bunRunner runtime-portable (falls back to nodeRunner under node) and non-throwing on spawn failure"
  - "@tasks/git SyncProcessRunner + spawnSyncRunner"
  - "@tasks/git sync.ts: gitConfigGetSync / gitConfigSetSync / gitConfigUnsetSync / gitIsTrackedSync / gitDiffCachedNamesSync / gitAddSync"
affects:
  - packages/surface/src/discover.ts (rootFrom now on @tasks/git)
  - packages/cli/src/hooks.ts (all git plumbing via @tasks/git sync commands)
tech-stack:
  added: []
  patterns: ["one runner module, two call shapes (async ProcessRunner / SyncProcessRunner)"]
key-files:
  created:
    - packages/git/src/sync.ts
    - packages/git/test/runner.test.ts
    - packages/git/test/sync.test.ts
  modified:
    - packages/git/src/runner.ts
    - packages/git/src/index.ts
    - packages/surface/src/discover.ts
    - packages/cli/src/hooks.ts
    - docs/src/content/docs/integrations.md
    - docs/src/content/docs/structure.md
  deleted:
    - packages/surface/src/git.ts
decisions:
  - "bunRunner keeps its name (consumed across packages) but detects missing globalThis.Bun and delegates to nodeRunner."
  - "bunRunner now catches synchronous Bun.spawn failures (ENOENT for missing binary or missing cwd) and returns code 127, matching nodeRunner — required so rootFrom on a non-existent dir returns null instead of throwing (old surface nodeRunner contract)."
  - "spawnSyncRunner returns code 127 when spawnSync reports an error with null status (missing binary); otherwise status ?? -1. Hook semantics only check ok = code === 0, so behavior is unchanged."
  - "GitOutput alias in hooks.ts dropped; its single remaining use (gitAddFile) now returns GitSyncResult directly."
metrics:
  completed: 2026-11-10
  tasks: 3
actuals:
  tasks: 3
  commits: 0
plan_head_before: 496745b
plan_head_after: 496745b
---

# Phase 1 Plan 04: One git runner — surface/git.ts and hooks.ts spawnSync folded into @tasks/git Summary

The second git adapter (`packages/surface/src/git.ts`) is deleted. `rootFrom` now uses `@tasks/git`, whose default runner works under both Bun and node. Every git call in `packages/cli/src/hooks.ts` now goes through enumerated sync commands in `@tasks/git/src/sync.ts`, which run on a new `spawnSyncRunner` in `runner.ts`. That file is still the only module that spawns git.

## Commits withheld

**No commits were made.** Per repo AGENTS.md and the orchestrator override, every change is left uncommitted in the main working tree, so `commits: 0` and `plan_head_before == plan_head_after == 496745b`. The orchestrator or user should commit these files:

- `packages/git/src/runner.ts`, `packages/git/src/sync.ts` (new), `packages/git/src/index.ts` (one added export line: `export * from "./sync.js";`)
- `packages/git/test/runner.test.ts` (new), `packages/git/test/sync.test.ts` (new)
- `packages/surface/src/discover.ts`, `packages/surface/src/git.ts` (deleted)
- `packages/cli/src/hooks.ts`
- `docs/src/content/docs/integrations.md`, `docs/src/content/docs/structure.md`

Plan 01-03 ran at the same time and changed `packages/git/src/commands.ts`, `resolver.ts`, `test/adapter.test.ts`, `test/resolver.test.ts`, `packages/cli/src/tk.ts` and `overview.md`. This plan did not touch any of them.

## Tasks

### Task 1 (tracer): portable runner, rootFrom on the adapter, surface/git.ts deleted
- `runner.ts`: added `nodeRunner`, ported from surface (`execFile` + `promisify`, 16 MiB `maxBuffer`, `signal` passed through). A numeric exit returns that code; abort returns -1; ENOENT and other failures return 127. It never throws.
- `bunRunner` now falls back to `nodeRunner` when `globalThis.Bun` is undefined, and catches spawn throws (see Deviations).
- `discover.ts` imports `gitCommonDir` and `mainWorktreeRoot` from `@tasks/git`. `packages/surface/src/git.ts` is deleted.
- `runner.test.ts` covers:
  - nodeRunner: success, a git failure (non-zero code plus stderr), a missing binary (127), and an already-aborted signal (non-zero, no throw).
  - bunRunner and nodeRunner give the same result.
  - spawnSyncRunner: untrimmed stdout, and a missing binary returns non-zero.
- Tracer gate: `<verify>` was re-run end-to-end after the fix and all checks passed before expansion.

### Task 2: hooks.ts git plumbing through sync commands
- `runner.ts`: added `SyncProcessRunner` and `spawnSyncRunner` (`spawnSync`, `encoding: "utf8"`, `env ?? process.env`, output not trimmed).
- `sync.ts`: added six enumerated commands that return `GitSyncResult`. They pass arguments as argv arrays (no shell) and put `--` before pathspecs.
- `hooks.ts`: deleted the local `git()` helper and the direct `spawnSync("git", ...)` in `gitAddFile`. Each call site was replaced 1:1:
  - `gitHooksDir` and uninstall: config get/unset for `core.hooksPath`, `tasks.role` and `beads.role`.
  - `isGitTrackedFile` now uses `gitIsTrackedSync`.
  - Hook install now uses `gitConfigSetSync`.
  - The staged-deletion check uses `gitDiffCachedNamesSync(..., { diffFilter: "D" })` and still inherits the hook env, including GIT_INDEX_FILE.
  - The `.tasks` staged check still passes `env: scrubGitHookEnv(process.env)`.
  - `gitAddFile` uses `gitAddSync` with the scrubbed env.
  - The non-git `spawnSync` uses (chained hook, runTk) stay as they were. `scrubGitHookEnv` stays in hooks.ts.
- `sync.test.ts` uses a scratch repo to test:
  - config set/get/unset round-trip
  - tracked vs untracked files
  - add, then the staged-names diff lists the file (and the `D` filter lists nothing)
  - a bogus `GIT_DIR` in `env` makes `gitConfigGetSync` fail, which shows the env is honored

### Task 3: docs
- `integrations.md` "git CLI": the stale line naming two adapters is replaced with the one-adapter layout:
  - `runner.ts` as the single spawn module: `bunRunner` with its node fallback, plus `spawnSyncRunner`
  - `commands.ts` and `sync.ts`, `porcelain.ts`, `resolver.ts`
  - the command list: worktree add/remove/list, merge-base, diff/log, config, check-ignore, ls-files, add
- `structure.md`: removed "`git.ts` = git helpers" from the cli line. Added `git/` to the directory tree and a `packages/git` section (runner, commands, sync, porcelain, resolver, hooks, prune).

## Verification results (all run, all passing)

| Command | Result |
|---|---|
| `bun test packages/git packages/surface/test` | 102 pass, 0 fail (after the Rule 1 fix; it first failed 1 test, see Deviations) |
| `test ! -e packages/surface/src/git.ts && ! grep -rn "from './git.js'" packages/surface/src` | OK |
| `cd packages/git && bun run build && node --input-type=module -e "...gitCommonDir..."` | `node ok /Users/yuri/Workdir/Nsx/tasks/.git` |
| `cd packages/surface && bun run check` | exit 0 (no unrelated failures to report) |
| `bun test packages/git packages/cli/test/hooks.test.ts` | 62 pass, 0 fail (hooks.test.ts unmodified) |
| `! grep -n 'spawnSync("git"' packages/cli/src/hooks.ts && ! grep -rnE '\["git"\|"git",' packages/cli/src packages/surface/src` | OK, no matches |
| `bun test packages/cli/test` | 148 pass, 0 fail |
| `cd packages/git && bun run check` | exit 0 |
| `cd docs && bun run build` | Complete |
| `! grep -n "surface/src/git.ts\|cli/src/git.ts" integrations.md structure.md` | OK |
| Plan-level: `bun test packages/git packages/surface/test packages/cli/test` | 254 pass, 0 fail |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] bunRunner threw on a missing cwd, which broke `rootFrom` for non-existent paths**
- **Found during:** Task 1 verify. `packages/surface/test/watch.test.ts > watch child > exits 2 when no workspace exists` got exit 1 instead of 2.
- **Cause:** under Bun, `Bun.spawn` throws ENOENT synchronously when `cwd` does not exist. The deleted surface `nodeRunner` caught that and returned 127, so `gitCommonDir` returned null. `bunRunner` let the error escape.
- **Fix:** `Bun.spawn` is now wrapped in try/catch, through a small `spawnPiped` helper that keeps the subprocess type. A throw returns `{ code: 127, stderr: message }`, the same contract as `nodeRunner`. The doc comment now says it never throws.
- **Files:** `packages/git/src/runner.ts`
- **Verified:** the watch child exits 2, and both suites are green.

**2. [Rule 2 - Robustness] spawnSyncRunner maps a spawn error (null status) to 127**
- The plan specified `code: status ?? -1`. Code 127 is used when `result.error` is set and status is null, so a missing binary reads the same way as in the async runners. Hooks only check `ok` (`code === 0`), so hook behavior does not change.

No Rule 4 (architectural) issues.

## Threat model check
- T-01-05: every sync command uses argv arrays through `spawnSync` with no `shell`, and `--` comes before pathspecs.
- T-01-06: env is preserved per call site (scrubbed or inherited, exactly as before). `sync.test.ts` shows `env` is honored, and `hooks.test.ts` is unchanged and green.
- T-01-07: `nodeRunner` was ported from the working surface runner, and the node probe against the built dist passed.

## Self-Check: PASSED
- `packages/git/src/sync.ts`, `packages/git/test/runner.test.ts` and `packages/git/test/sync.test.ts` exist. `packages/surface/src/git.ts` is gone.
- There are no commit hashes to check, because commits were withheld per AGENTS.md.
