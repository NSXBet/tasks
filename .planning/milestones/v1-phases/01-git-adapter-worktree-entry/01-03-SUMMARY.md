---
phase: 01-git-adapter-worktree-entry
plan: 03
subsystem: git-worktree
tags: [git, worktree, cli, info-exclude, gap-closure]

requires:
  - phase: 01-git-adapter-worktree-entry
    provides: "resolveWorktreePath, tk work <id>, tk worktree create (01-01, 01-02)"
provides:
  - "tk worktree create resolves against the main repo root (no nesting from linked worktrees)"
  - "tk worktree create hook args fixed (runShellHook(command, cwd))"
  - "ensureWorktreePoolIgnored: default .worktrees/ pool appended once to info/exclude, never .gitignore"
  - "gitCurrentBranch returns null on detached HEAD (WR-01)"
  - "resolver {name} expansion is literal for $-patterns (WR-02)"
  - "tk work rolls back a branch it created when git worktree add fails (WR-04); gitDeleteBranch"
affects: [phase-01-verification, worktree, tk-work]

actuals:
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Ignore-state writes live in one adapter command (ensureWorktreePoolIgnored); resolver stays pure"
    - "Rollback errors are appended to, never substituted for, the original git failure"

key-files:
  created: []
  modified:
    - packages/git/src/commands.ts
    - packages/git/src/resolver.ts
    - packages/git/test/adapter.test.ts
    - packages/git/test/resolver.test.ts
    - packages/cli/src/tk.ts
    - packages/cli/test/tk.test.ts
    - packages/cli/test/work.test.ts
    - docs/src/content/docs/overview.md

key-decisions:
  - "Exclude-file failure is non-fatal: surfaced as a hook note ('could not exclude .worktrees/: ...') on both tk work and tk worktree create"
  - "Exclude is skipped when git check-ignore --no-index already ignores .worktrees/probe (e.g. committed .gitignore)"
  - "Branch rollback uses `git branch -d` (not -D) so it can never delete unmerged work"

requirements-completed: [GIT-02, GIT-03]

coverage:
  - id: D1
    description: "tk worktree create from inside a linked worktree places the new worktree at <mainRoot>/.worktrees/<name>"
    requirement: GIT-02
    verification:
      - kind: integration
        ref: "packages/cli/test/tk.test.ts#resolves worktree create against the main root even from inside a linked worktree"
        status: pass
      - kind: manual_procedural
        ref: "scratch probe -> OK no-nest"
        status: pass
    human_judgment: false
  - id: D2
    description: "tk worktree create runs postStart/postCheckout inside the new worktree without ENOENT"
    requirement: GIT-03
    verification:
      - kind: integration
        ref: "packages/cli/test/tk.test.ts#runs postStart/postCheckout hooks inside the worktree created by tk worktree create"
        status: pass
      - kind: manual_procedural
        ref: "scratch probe -> OK hook"
        status: pass
    human_judgment: false
  - id: D3
    description: "Default .worktrees/ pool auto-excluded via info/exclude (once), never .gitignore; skipped when already ignored"
    requirement: GIT-02
    verification:
      - kind: integration
        ref: "packages/cli/test/tk.test.ts#dispatches worktree commands in a workspaceless repo and guards writes; packages/cli/test/work.test.ts (happy path + committed .gitignore case); packages/git/test/adapter.test.ts#ensureWorktreePoolIgnored"
        status: pass
      - kind: manual_procedural
        ref: "scratch probe -> OK excluded"
        status: pass
    human_judgment: false
  - id: D4
    description: "WR-01 detached HEAD -> null; WR-02 literal {name}; WR-04 branch rollback"
    verification:
      - kind: unit
        ref: "packages/git/test/adapter.test.ts, packages/git/test/resolver.test.ts, packages/cli/test/work.test.ts"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-11-10
status: complete
---

# Phase 01 Plan 03: Worktree placement consistency + review leftovers Summary

**`tk worktree create` now uses the same main-root resolver as `tk work`, runs its hooks correctly, and both commands auto-exclude the default `.worktrees/` pool via `info/exclude`; WR-01/02/04 closed with tests.**

## Accomplishments

- `packages/git/src/commands.ts`: added `gitInfoExcludePath`, `gitIsIgnored`, `ensureWorktreePoolIgnored` (single place tk writes ignore state; appends constant `# tk: in-repo worktree pool\n/.worktrees/\n`; idempotent; never throws; never touches `.gitignore`), `gitDeleteBranch`; `gitCurrentBranch` returns null on detached HEAD.
- `packages/git/src/resolver.ts`: function-replacement `expand()` for `{name}` in override and config paths; header doc updated. Still zero I/O.
- `packages/cli/src/tk.ts`:
  - `runWorktree create`: `resolveWorktreePath({ repoRoot: mainRoot, ... })`, `gitWorktreeAdd(mainRoot, ...)`, `ensureWorktreePoolIgnored(mainRoot)` when `source === "default"`, hooks fixed to `runShellHook(postStart, path)` / `runShellHook(postCheckout, path)`.
  - `work()`: pool exclude before `gitWorktreeAdd` (default placement only); tracks `createdBranchHere` and on add failure runs `gitDeleteBranch(mainRoot, branch, false)`, failing with the original stderr plus `; also failed to remove branch ...` only if the rollback failed. Pre-existing branches are never deleted.
  - Import line extended with `gitDeleteBranch, ensureWorktreePoolIgnored`. No other hunks in tk.ts touched.
- `docs/src/content/docs/overview.md`: new "Task worktrees" section (placement, main-root resolution, precedence, info/exclude behavior, hooks, branch rollback).

## Verification

| Command | Result |
|---|---|
| `bun test packages/cli/test/tk.test.ts packages/cli/test/work.test.ts` | 70 pass, 0 fail |
| `bun test packages/git` | 37 pass, 0 fail |
| `cd packages/git && bun run check` | exit 0 |
| `tsc --noEmit -p packages/cli/tsconfig.json` | no errors |
| `bun test packages/git packages/cli/test` | 185 pass, 0 fail |
| Scratch probe (Task 1 manual) | `OK no-nest`, `OK hook`, `OK excluded` |
| `cd docs && bun run build` | Complete |
| `grep -n "repoRoot: start" packages/cli/src/tk.ts` | no match |
| `grep -n "runShellHook(path" packages/cli/src/tk.ts` | no match |

## Tests added

- tk.test.ts: default-pool test now asserts `<realpath(repo)>/.worktrees/demo`, `.gitignore` absent, `/.worktrees/` exactly once in `.git/info/exclude` after two creates, clean `git status`; new no-nest test; new hook test (sentinels, no ENOENT, no hook notes).
- work.test.ts: happy path asserts exclude + clean status; committed-`.gitignore` case leaves exclude untouched; failed placement leaves no `tk/<id>`; pre-existing `tk/<id>` survives a failed add.
- adapter.test.ts: detached HEAD -> null; `gitDeleteBranch`; `ensureWorktreePoolIgnored` idempotence.
- resolver.test.ts: `foo$&bar`, `a$'b`, ``a$`b``, `x$1y` expand verbatim for config and override.

## Deviations from Plan

- Added two extra adapter tests (`gitDeleteBranch`, `ensureWorktreePoolIgnored`) beyond the plan's list; additive only.
- In `work()`, `hookNotes` was hoisted above branch creation so the exclude note lands in the same `hookNote` output.

## Commits

Withheld per repo AGENTS.md (conservative profile) and orchestrator instruction: all changes left uncommitted in the working tree. `commits: 0`.

## State updates

STATE.md / ROADMAP.md were not updated by this executor, to avoid racing the concurrent 01-04 executor on shared planning files; the orchestrator should record plan progress.

## Threat surface

No new surface beyond the plan's threat model: all git calls are argv arrays; the exclude line is a constant; only repo-local `info/exclude` is written.

## Known Stubs

None.

## Self-Check: PASSED
