---
phase: 06-worktree-lifecycle-injection
plan: 02
subsystem: workspace config / git hooks / cli worktree lifecycle
tags: [worktree, hooks, config, package-manager, cli]

requires: [06-01]
provides:
  - "WorktreeConfigSchema: snake_case + camelCase hook keys, `install` (legacy `pmSetup` alias), strict, normalized camelCase output"
  - "detectPackageManager locked precedence bun → pnpm → yarn → npm; SetupOutcome.pm"
  - "provisionHooks (tk.ts): post_start on new branch, post_checkout on existing branch, install unless install:false"
  - "tk worktree create --branch <existing> checks the branch out"
affects: [tk work, tk worktree create, .tasks/config.json worktree block]

actuals:
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Config aliases normalized inside the Zod schema so every readWorkspaceConfig consumer sees one shape"

key-files:
  created:
    - packages/git/test/hooks.test.ts
  modified:
    - packages/workspace/src/config.ts
    - packages/workspace/src/index.ts
    - packages/workspace/test/workspace.test.ts
    - packages/git/src/hooks.ts
    - packages/cli/src/tk.ts
    - packages/cli/test/work.test.ts
    - packages/cli/test/tk.test.ts
    - docs/src/content/docs/overview.md

key-decisions:
  - "post_checkout semantics per planner, accepted by user 2026-11-10: post_start on new-branch create, post_checkout on existing-branch create, re-entry runs neither"
  - "Duplicate spellings with the SAME value are accepted; only differing values are rejected (`worktree.<snake> and worktree.<camel> both set`)"
  - "Install-failure note is `package install failed (<pm>)`; `pm` falls back to `unknown` only defensively (ran=true always carries pm)"
  - "provisionHooks typed via `WorkspaceConfig[\"worktree\"]` so the shared tk.ts import line was not touched"

requirements-completed: [LC-04]

coverage:
  - id: D1
    description: "snake_case/camelCase hook keys + install/pmSetup normalize to one shape; strict; conflicting spellings rejected; camelCase round-trip"
    requirement: LC-04
    verification:
      - kind: unit
        ref: "packages/workspace/test/workspace.test.ts#@tasks/workspace config"
        status: pass
  - id: D2
    description: "lockfile precedence bun → pnpm → yarn → npm; setup outcome carries pm; never throws; install=false skips"
    requirement: LC-04
    verification:
      - kind: unit
        ref: "packages/git/test/hooks.test.ts"
        status: pass
  - id: D3
    description: "tk work: post_start on new tk/<id>, post_checkout on surviving branch, neither on re-entry; snake_case key fires end-to-end"
    requirement: LC-04
    verification:
      - kind: e2e
        ref: "packages/cli/test/work.test.ts#worktree lifecycle (gw port)"
        status: pass
  - id: D4
    description: "tk worktree create: post_start on new branch; --branch <existing> checks out + post_checkout only"
    requirement: LC-04
    verification:
      - kind: e2e
        ref: "packages/cli/test/tk.test.ts#runs post_start on a new branch and post_checkout on an existing branch for tk worktree create"
        status: pass
  - id: D5
    description: "default-on install failure is a note naming bun (stub on PATH); install:false never invokes the stub"
    requirement: LC-04
    verification:
      - kind: e2e
        ref: "packages/cli/test/work.test.ts#installs by default naming the manager on failure, and never installs with install: false"
        status: pass
  - id: D6
    description: "Scratch-repo probe of hooks + real bun install + install:false"
    verification:
      - kind: manual_procedural
        ref: "scratchpad probe0602 (see Verification)"
        status: pass

duration: ~35min
completed: 2026-11-10
---

# Phase 6 Plan 02: Worktree lifecycle hooks and dependency setup (LC-04) Summary

**Configs written with the spec key names now load. Each hook fires at its own lifecycle point. Dependency install uses the locked bun → pnpm → yarn → npm order and can be turned off with `worktree.install: false`.**

## What changed

### Task 1: config keys (`packages/workspace/src/config.ts`)
- Added a new exported `WorktreeConfigSchema` (with a `WorktreeConfig` type). It is a strict object that takes `dir`, both the snake_case and camelCase spelling of each hook (`post_start`/`postStart`, `post_checkout`/`postCheckout`, `pre_end`/`preEnd`), `install`, and `pmSetup`, which is a legacy alias for `install`.
- A `superRefine` check rejects a hook spelled both ways with different values. A `transform` then turns the input into `{ dir?, postStart?, postCheckout?, preEnd?, install? }`, where `install = install ?? pmSetup`.
- `WorkspaceConfig.worktree` now exposes `install` instead of `pmSetup`. The two `pmSetup !== false` reads in tk.ts were switched to `install`.
- Added 5 schema tests to workspace.test.ts and 1 end-to-end snake_case test to work.test.ts.

### Task 2: package-manager detection (`packages/git/src/hooks.ts`)
- Lockfile order is now `bun.lock`, `bun.lockb`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`.
- The third parameter of `runPackageManagerSetup` was renamed to `install`. `SetupOutcome` gained `pm?`, which is set whenever a manager is detected.
- New file `packages/git/test/hooks.test.ts` covers precedence, the exact `["bun","install"]` argv and its cwd, a failing exit code, a runner that throws, `install=false`, a missing lockfile, and `runShellHook` with blank and failing commands.

### Task 3: which hook fires when (`packages/cli/src/tk.ts`)
- New local helper `provisionHooks(path, mainRoot, worktreeConfig, branchIsNew)`.
- `work()` calls it with `!branchExists`, the value read before `gitCreateBranch`. Re-entering an existing worktree runs no hooks.
- `runWorktree create` computes `branchIsNew = !(await gitBranchExists(mainRoot, branch))` and passes it to `gitWorktreeAdd` as `createBranch`, so an existing branch is checked out instead of failing. `commands.ts` was not modified.
- Updated the two old "both hooks fire on create" tests to the new rules. Added tests for re-provisioning a surviving branch, re-entry, `--branch <existing>`, and install (stub `bun` on PATH plus `install:false`). `run()`/`json()` in work.test.ts gained an optional `env` parameter.
- In `docs/src/content/docs/overview.md`, the old hooks bullet under `### Task worktrees` is replaced by a new `#### Lifecycle hooks and dependency setup` subsection: config example, alias rules, when each hook fires, the `pre_end` veto-vs-note difference, lockfile precedence, and default-on install. A sentence about `--branch <existing>` was added. The old `worktree.preEnd` bullet was folded into the new subsection.

## Verification (all run, all green)
- `bun test packages/workspace/test/workspace.test.ts packages/cli/test/work.test.ts`: 40 pass.
- `bun test packages/git/test/hooks.test.ts packages/git/test/prune.test.ts`: 20 pass.
- `bun test packages/cli/test/work.test.ts packages/cli/test/tk.test.ts packages/surface/test/prune.test.ts`: 83 pass, 0 fail.
- `bunx tsc --noEmit -p tsconfig.json` is clean in packages/workspace, git, cli and surface.
- `cd docs && bun run build`: Complete.
- **Scratch-repo probe** (in the session scratchpad: a git repo with `package.json` and an empty `bun.lock`, snake_case hooks in config.json):
  - first `tk work`: `ps` created, no `pc`, `created: true`, no `hooks` note, and a real `bun install` ran in the worktree (`node_modules` present).
  - `git worktree remove --force` (branch `tk/<id>` kept), then `tk work`: `pc` created, no `ps`, `created: true`.
  - re-entry: no sentinels, `created: false`.
  - stub `bun` on PATH that exits 1: `"hooks":"package install failed (bun)"`, and the stub ran.
  - `"install": false`: no `hooks` note, and the stub was not invoked.

## Deviations
- **[Rule 3: blocking] Stale dist types.** packages/cli typechecks against `@tasks/workspace`'s `dist/*.d.ts`, so after the schema change tsc reported `install` as missing. I rebuilt the dist for `packages/workspace` and `packages/git` with `bunx tsc -p tsconfig.json`. No source change was needed.
- **Extra export.** `packages/workspace/src/index.ts` now also exports `WorktreeConfigSchema` and `WorktreeConfig`. This file was not in `files_modified`, but the export is additive.
- **Probe observation, not a bug.** After `bun install` ran on the empty `bun.lock`, `bun.lock` did not appear in the worktree listing. bun rewrites or drops a lockfile with no dependencies. This is bun's own behaviour and does not affect tk.

## Notes
- Commits withheld per AGENTS.md (conservative profile). The changes are in the main working tree, uncommitted.
- STATE.md and ROADMAP.md were not updated, per the orchestrator's instruction.
- Concurrent executors: in tk.ts I edited only the `runWorktree` create block, the `work()` hook block, and the new `provisionHooks` helper placed just above `runWorktree`. I re-read each region before editing. In overview.md I touched only the `### Task worktrees` section.
