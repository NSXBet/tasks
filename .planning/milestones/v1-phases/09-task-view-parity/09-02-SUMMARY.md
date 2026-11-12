---
phase: 09-task-view-parity
plan: 02
subsystem: surface, git, terminal-image, docs
status: complete
tags: [task-view, sessions, workspace, evidence-image]
requires:
  - phase: 05-04
    provides: "packages/git/src/commands.ts typed adapter (`git()` helper, gitHasUncommittedChanges pattern)"
  - phase: 04-03
    provides: "`tk finish` record (agent_session / finished_at / agent_harness) + finishIssueUow"
  - phase: 07-04
    provides: "stored runs (uow.listRuns) driven by status moves"
provides:
  - "`surface.taskSessions(id)` → readonly SessionRow[] `{ id, state, label, updatedAt }`, newest first (stored runs + finish session record); `[]` for no data / unknown / malformed ids"
  - "`gitDirtyCount(cwd)` in @tasks/git → porcelain entry count, null when git fails"
  - "`inlineImageMode({ mime, isTTY, kittyGraphics })` + `InlineImageMode` in @tasks/terminal-image"
affects: [09-04 (TUI evidence image + rail tabs), 09-06 (web rail), 09-05/09-07 (consumers of taskSessions/gitDirtyCount)]
actuals:
  tasks: 3
  commits: 0
key-files:
  created:
    - packages/surface/src/operations/sessions.ts
    - packages/surface/test/sessions.test.ts
  modified:
    - packages/surface/src/surface.ts
    - packages/surface/src/index.ts
    - packages/git/src/commands.ts
    - packages/git/test/adapter.test.ts
    - packages/terminal-image/src/index.ts
    - packages/terminal-image/test/terminal-image.test.ts
    - docs/src/content/docs/architecture.md
    - docs/src/content/docs/testing.md
key-decisions:
  - "Finish session row: id `session:<sid>`, label `<harness> · session <sid>` (harness defaults via agentRecord to DEFAULT_HARNESS), state `done` when finished_at set else `running`, updatedAt = finished_at (falls back to issue.updatedAt)."
  - "Run row label: first non-empty message text, else agentId, else trigger; whitespace collapsed, capped at 80 chars (T-09-03)."
  - "Sort is stable descending by updatedAt with the finish row placed first on ties — finishIssueUow finalizes the active run with the same timestamp as finished_at."
  - "Ids are validated with IssueIdSchema.safeParse, so malformed ids return [] instead of throwing; unknown ids return [] via findById → null."
  - "inlineImageMode: any image/* (case-insensitive, mime params tolerated) → `kitty` when kittyGraphics, else `blocks`, on a TTY; non-image or non-TTY → null. Matches detail.tsx BlobImage (kitty for any image mime via protocol=auto)."
  - "No RPC verb added: rpc.md, VERBS_VERSION, PROTOCOL_VERSION unchanged."
requirements-completed: [VIEW-02, VIEW-04]
completed: 2026-11-10
---

# Phase 9 Plan 02: Task-view data seams Summary

**SESSIONS rail rows (`surface.taskSessions`), the WORKSPC dirty count (`gitDirtyCount`) and the TUI evidence-image paint decision (`inlineImageMode`), each tested.**

## Performance

- Tasks: 3/3
- Files: 2 created, 8 modified
- Commits: 0 — commits withheld per AGENTS.md (conservative profile; orchestrator override)

## Accomplishments

1. **Task 1 (tracer) — `surface.taskSessions`.** New `packages/surface/src/operations/sessions.ts` reads `uow.findById` + `uow.listRuns(issueId)` in one `store.transact` (error mapping mirrors the inbox read) and appends the `agentRecord(issue)` finish row. Wired into the `TasksSurface` interface/impl next to `inbox`; types exported from the package entry via `export * from './operations/sessions.js'` (additive). Tracer gate: verify re-run passed end-to-end before expansion.
2. **Task 2 — `gitDirtyCount`.** Added next to `gitHasUncommittedChanges` through the module's `git()` helper (typed adapter, no raw spawn). Re-exported by the existing `export * from "./commands.js"` — no second export added.
3. **Task 3 — `inlineImageMode`.** Pure decision function plus `InlineImageMode` type; existing escape functions unchanged.

## Verification (all run)

| Command | Result |
|---|---|
| `bun test packages/surface/test/sessions.test.ts` | 3 pass (RED first: `taskSessions is not a function`) |
| `cd packages/surface && bunx tsc --noEmit -p tsconfig.json` | clean |
| `bun test packages/git/test/adapter.test.ts` | 18 pass (RED first: missing export) |
| `bun test packages/terminal-image/test` | 20 pass (incl. 4 plan cases + mime-normalization case) |
| plan-level `bun test packages/surface/test/sessions.test.ts packages/git/test/adapter.test.ts packages/terminal-image/test` | 41 pass |
| regression `bun test packages/surface/test packages/git/test packages/terminal-image/test` | 164 pass, 0 fail |
| `cd packages/git && bunx tsc --noEmit`, `cd packages/terminal-image && bunx tsc --noEmit` | clean |
| `cd docs && bun run build` | Complete |

dist rebuilt (`tsc -p`) for @tasks/terminal-image, @tasks/git, @tasks/surface so downstream typechecks (09-04 TUI, web) see the new exports.

## Deviations from Plan

- **[Rule 2 - Docs] AGENTS.md "new public surface needs a doc home":** architecture.md gains a `taskSessions` / `gitDirtyCount` line under the `TasksSurface` facade and an updated `@tasks/terminal-image` package row; testing.md inventory lists `sessions.test.ts`.
- **[Adaptation] Test fixture:** the plan's `surface.finish(id, session)` takes no harness, so the test calls `finishIssueUow(uow, { cwd }, id, "s1", at, "codex")` inside `store.transact` to record `agent_harness: "codex"`.
- **[Adaptation] Tie-break:** finish finalizes the active run with the same `at`, so the stable sort puts the finish row first on equal timestamps (test uses a later explicit `at` anyway).
- Extra test cases beyond the plan: first-message label + 80-char cap + ordering; malformed id → `[]`; mime case/params tolerated.

## Notes

- `packages/surface/src/surface.ts` already carried uncommitted review-comments wiring from earlier phases; this plan's edits there are 4 additive lines (import, interface method, impl entry).
- STATE.md / ROADMAP.md not updated (orchestrator override).

## Self-Check: PASSED

- Created files exist: packages/surface/src/operations/sessions.ts, packages/surface/test/sessions.test.ts
- No commits to verify (withheld per AGENTS.md).
