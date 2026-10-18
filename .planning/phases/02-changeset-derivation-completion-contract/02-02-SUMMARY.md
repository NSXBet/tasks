---
phase: 2-changeset-derivation-completion-contract
plan: 02-02
subsystem: cli
tags: [git, changeset, finish, status-transitions, metadata-freeze, vitest]

requires:
  - phase: 1-git-adapter-worktree-entry
    provides: `tk work` branch/worktree creation with changeset base pinned at creation; `@tasks/git` enumerated commands
  - phase: 2-changeset-derivation-completion-contract (02-01)
    provides: lazy `deriveChangeset` + `readChangesetBase` + `tk show` live changeset rendering
provides:
  - `tk finish <id> --session <sid>` — single write path into `ready-to-review` (FIN-01)
  - `finishIssueUow` store operation: D-10 work-record requirement, D-11 idempotent re-finish, run finalization to `in_review`
  - Close-time changeset freeze (CHG-02): every close path (CLI mutate, `changeStatus`, `closeMany`) freezes `{base, head, commits, files, counts}` into metadata exactly once
  - `readChangesetSnapshot` narrowing read; closed `tk show` renders the frozen snapshot with zero git calls (D-05)
  - `gitBranchHead` enumerated command in `@tasks/git`
  - CR-01 fixed: `work`/`finish` added to the CLI writers set (readonly gate enforced)
affects: [phase-3-review-component, hunk-review, prune, ui-status-rendering]

actuals:
  tokens: ~6000
  tasks: 2
  commits: 1

tech-stack:
  added: []
  patterns: [status-transition-policy (finishPolicy), uow-scoped side-effect operation, exactly-once freeze guard]

key-files:
  created:
    - packages/surface/src/operations/finish.ts
    - packages/surface/test/finish.test.ts
    - packages/surface/test/changeset-freeze.test.ts
    - packages/cli/test/finish.test.ts
  modified:
    - packages/cli/src/tk.ts
    - packages/cli/src/presentation.ts
    - packages/cli/src/args.ts
    - packages/surface/src/operations/changeset.ts
    - packages/surface/src/operations/mutate.ts
    - packages/surface/src/index.ts
    - packages/surface/src/surface.ts
    - packages/git/src/commands.ts
    - packages/git/test/changeset.test.ts
    - packages/cli/test/show-changeset.test.ts

key-decisions:
  - "finishPolicy transition target pinned to `ready-to-review` only — closed/done unreachable from finish by construction (D-09)"
  - "Freeze fires only on transitions TO `closed`, inside the caller's open transaction; finish never freezes (D-09 guard in freezeChangesetUow)"
  - "Closed `tk show` reads the frozen snapshot and performs NO git calls; non-closed stays live-derived (D-05)"
  - "Base keeps `tk work`'s pinned commit SHA; CLI tests assert base presence, not the literal branch name"

patterns-established:
  - "StatusTransitionPolicy: per-transition allowed-from/target validation shared with the status-runs harness"
  - "Freeze-once guard: freezeChangesetUow returns null for any non-closed target or already-frozen record"

requirements-completed: [CHG-02, FIN-01]

coverage:
  - id: D1
    description: "`tk finish <id> --session <sid>` moves the task into ready-to-review, records agent_session + finished_at, and prints live-derived counts"
    requirement: FIN-01
    verification:
      - kind: integration
        ref: "packages/cli/test/finish.test.ts#moves the task into ready-to-review and prints live-derived counts"
        status: pass
    human_judgment: false
  - id: D2
    description: "finish refuses without a work record (branch + pinned base) and without --session (D-10)"
    requirement: FIN-01
    verification:
      - kind: unit
        ref: "packages/surface/test/finish.test.ts#refuses without a branch or pinned changeset base (D-10)"
        status: pass
      - kind: integration
        ref: "packages/cli/test/finish.test.ts#requires --session (or TK_SESSION env)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Repeat finish is idempotent on status; session/finished_at re-recorded (D-11)"
    requirement: FIN-01
    verification:
      - kind: unit
        ref: "packages/surface/test/finish.test.ts#re-finish is idempotent on status and re-records the session (D-11)"
        status: pass
      - kind: integration
        ref: "packages/cli/test/finish.test.ts#repeat finish is idempotent (D-11)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Close freezes the changeset tuple exactly once; later closes never re-freeze; non-closed transitions refuse to freeze"
    requirement: CHG-02
    verification:
      - kind: unit
        ref: "packages/surface/test/changeset-freeze.test.ts#freezes the full tuple from live git output exactly once"
        status: pass
      - kind: unit
        ref: "packages/surface/test/changeset-freeze.test.ts#refuses to freeze for any non-closed next status"
        status: pass
    human_judgment: false
  - id: D5
    description: "Closed `tk show` renders the frozen snapshot with no git calls (survives branch deletion); finish never freezes"
    requirement: CHG-02
    verification:
      - kind: integration
        ref: "packages/cli/test/show-changeset.test.ts#closed show renders the frozen snapshot with no git"
        status: pass
      - kind: integration
        ref: "packages/cli/test/finish.test.ts#finish never freezes the changeset snapshot (FIN-01/D-09)"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-10-18
status: complete
---

# Phase 2 Plan 02-02 Summary

**Completion contract (FIN-01) + terminal snapshot freeze (CHG-02) shipped: `tk finish` is the only path into `ready-to-review`, and every close freezes the changeset exactly once.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-10-18T20:00Z
- **Completed:** 2026-10-18T20:35Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments
- FIN-01: new `finishIssueUow` — single write path into `ready-to-review`; requires a branch + pinned changeset base (D-10, refuses otherwise, message points to `tk work`); records `agent_session` + `finished_at`; repeat finish idempotent on status while re-recording the session (D-11); active run finalized to `in_review` with `closedAt` stamped and `startedAt` preserved.
- CHG-02: close freezes `{base, head, commits, files, counts}` into `metadata.changeset` exactly once — wired into every close path (CLI `mutate`, `changeStatus`, `closeMany`); `finishPolicy` makes closed/done unreachable from finish, so no freeze rides that path.
- Closed `tk show` renders the frozen snapshot with zero git calls (D-05 — record survives branch deletion/decay); non-closed stays live-derived. `formatFinish` prints commit/file/addition counts after finishing.
- CR-01 (readonly-gate bypass) auto-fixed: `work` + `finish` added to the CLI writers set; `--session` added to valueFlags so it parses as a value flag.

## Task Commits

1. **Tasks 1+2: finish contract + terminal freeze** — `97d891a` (feat; both slices landed in one atomic commit)

## Files Created/Modified
- `packages/surface/src/operations/finish.ts` — FIN-01 store operation (`finishIssueUow`, `finishPolicy`, `finishIssue`)
- `packages/surface/src/operations/changeset.ts` — `freezeChangesetUow` (exactly-once guard, finish-path refusal), `readChangesetSnapshot`
- `packages/surface/src/operations/mutate.ts` — close-path freeze in `changeStatus`/`closeMany`
- `packages/git/src/commands.ts` — `gitBranchHead`
- `packages/cli/src/tk.ts` — `finish` command/dispatch, close freeze, closed-show frozen rendering, writers set
- `packages/cli/src/presentation.ts`, `packages/cli/src/args.ts` — `formatFinish`, `--session` value flag
- Tests: `surface/test/finish.test.ts`, `surface/test/changeset-freeze.test.ts`, `cli/test/finish.test.ts`, extended `cli/test/show-changeset.test.ts` + `git/test/changeset.test.ts`

## Decisions Made
- Base assertion in CLI tests: `tk work` pins the base as a commit SHA, not the branch name — tests assert string presence, not `"main"`.
- Fixtures use `*` .gitignore plus explicit `git add -f` so the tk store db never leaks into seeded git history.

## Deviations from Plan

### Auto-fixed Issues

**1. [CR-01 - readonly gate] `tk --readonly work`/`finish` bypassed the writers gate**
- **Found during:** Task 2 (CLI wiring)
- **Issue:** `work` (and new `finish`) missing from the writers set in `tk.ts`
- **Fix:** added `"work", "finish"` to the writers set; also added `session` to `valueFlags` so `--session <sid>` parses as a value
- **Files modified:** `packages/cli/src/tk.ts`, `packages/cli/src/args.ts`
- **Verification:** full suite green
- **Committed in:** `97d891a`

---

**Total deviations:** 1 auto-fixed (advisory fix)
**Impact on plan:** Advisory CR-01 was explicitly scoped to be fixed by this plan; no scope creep.

## Issues Encountered
- `UpdatePatch` silently drops `metadata`, so test fixtures stamp branch + pinned base via `uow.save` inside a transaction instead of `surface.update`.
- Transact wraps callback results in a `Result`, so tests unwrap with an `{ok, value}` cast.

## Next Steps
- Phase 3 (review component) consumes `ready-to-review` status and the frozen changeset record.

---

*Completed: 2026-10-18*
