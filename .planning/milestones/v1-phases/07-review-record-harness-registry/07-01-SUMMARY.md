---
phase: 07-review-record-harness-registry
plan: 01
subsystem: review-record
status: complete
tags: [harness, tk-finish, review-record, domain, docs]
requires: []
provides:
  - "HarnessEntry.env + detectHarness(env, registry) in @tasks/domain"
  - "tk finish always records metadata.agent_harness (flag > TK_HARNESS > env detection > omp)"
  - "DEFAULT_WEB_BASE = http://localhost:21579"
affects: [07-02 (TUI web base default), 07-04 (verification pins DEFAULT_WEB_BASE == WEB_DEFAULT_PORT)]
tech-stack:
  added: []
  patterns: ["registry-as-data detection: env var names live on HARNESS_REGISTRY entries"]
key-files:
  created: []
  modified:
    - packages/domain/src/review-record.ts
    - packages/domain/src/index.ts
    - packages/domain/test/review-record.test.ts
    - packages/cli/src/tk.ts
    - packages/cli/test/finish.test.ts
    - docs/src/content/docs/overview.md
    - docs/src/content/docs/integrations.md
decisions:
  - "Empty --harness / TK_HARNESS values count as absent and fall through to env detection (lets the hermetic test helper blank TK_HARNESS)."
  - "A non-default registry match beats the default (omp) in nested shells; default is also the fallback."
metrics:
  completed: 2026-11-10
actuals:
  tokens: 4500
  tasks: 2
  commits: 0
plan_head_before: 496745b6ad49570362ec3fc5d672b7da784b292f
plan_head_after: 496745b6ad49570362ec3fc5d672b7da784b292f
---

# Phase 7 Plan 01: Harness Detection at tk finish Summary

Registry-driven `detectHarness` (env var names on each `HARNESS_REGISTRY` entry) wired into `tk finish`, so the record's agent line reads `codex` / `cursor` / `omp` with no `--harness`; plus `DEFAULT_WEB_BASE` corrected to `:21579`.

**Commits withheld per AGENTS.md** (conservative profile: no git commit/push). `commits: 0` reflects that; all changes are uncommitted in the main working tree. STATE.md / ROADMAP.md / REQUIREMENTS.md not updated per orchestrator override.

## What changed

- `packages/domain/src/review-record.ts`: `HarnessEntry.env: readonly string[]`; registry filled (omp `PI_SESSION_ID`, codex `CODEX_THREAD_ID`, cursor `CURSOR_CONVERSATION_ID` / `CURSOR_AGENT`), notes name the detecting var. New pure `detectHarness(env, registry = HARNESS_REGISTRY)`: first non-default entry (registry order) with a non-empty listed var wins, else `registry[0].id`. `DEFAULT_WEB_BASE` → `http://localhost:21579` with a comment pointing at `WEB_DEFAULT_PORT` in `packages/surface/src/runtime.ts`. Exported from `packages/domain/src/index.ts`; domain dist rebuilt.
- `packages/cli/src/tk.ts` `finish()` only (plus `detectHarness` added to the `@tasks/domain` import): harness = first non-blank of `--harness`, `TK_HARNESS`, else `detectHarness(process.env)` — never null, so `metadata.agent_harness` is always stored. `finishIssueUow` and session check untouched.
- `packages/cli/test/finish.test.ts`: `run` helper env is hermetic (`HERMETIC_ENV` blanks `TK_SESSION`, `TK_HARNESS`, `PI_SESSION_ID`, `CODEX_THREAD_ID`, `CURSOR_AGENT`, `CURSOR_CONVERSATION_ID`). New e2e cases: codex env → record + `tk show` agent line; `CURSOR_AGENT=1` → cursor; no env → `omp` stored and shown; precedence `TK_HARNESS` over env, `--harness` over `TK_HARNESS`.
- `packages/domain/test/review-record.test.ts`: detection cases (each harness, empty values ignored, nested shells, new registry entry `zed` detected with no code change), `DEFAULT_WEB_BASE` / `reviewDoors` default.
- Docs: `overview.md` review-record bullet now states the precedence chain and registry-`env` detection; web-base default `:4747` → `:21579`. `integrations.md` gains a "Harness detection at `tk finish`" table under the agent-hosts section.

## Verification (all run)

- Task 1: `bun test packages/domain/test/review-record.test.ts packages/cli/test/finish.test.ts` → 17 pass, 0 fail (after RED: domain test failed on missing `detectHarness` export); `bunx tsc --noEmit` clean in packages/domain and packages/cli.
- Task 2: `bun test packages/cli/test/finish.test.ts` → 10 pass, 0 fail; grep `CODEX_THREAD_ID` in integrations.md and `TK_HARNESS` in overview.md both hit; `cd docs && bun run build` → Complete.
- Extra regression: `bun test packages/domain/test packages/surface/test/finish*` 32 pass; `packages/cli/test/presentation.test.ts` + `packages/tui/test/app.test.tsx` 26 pass (TUI test already asserts no `:4747`).

## TDD Gate Compliance

RED: domain test file errored on missing `detectHarness` / new default before implementation. GREEN: implementation added; all cases pass. No refactor step needed. (Gates not committed separately — commits withheld.)

## Deviations from Plan

**1. [Rule 1 - Bug] Blank harness values treated as absent**
- **Found during:** Task 1
- **Issue:** Plan's `stringFlag ?? TK_HARNESS ?? detectHarness` would record `""` when `TK_HARNESS` is set but empty (which the plan's own hermetic helper does), skipping detection.
- **Fix:** take the first non-blank of flag / `TK_HARNESS`, else detect.
- **Files modified:** packages/cli/src/tk.ts

**2. [Rule 2] overview.md stale `:4747` web-base default updated to `:21579`** alongside the D-02 constant change (docs must land with the code).

## Follow-ups (not filed — no tk writes from this executor)

- `tk.ts` `leaseHolder` reads `OMP_SESSION_ID`, which omp does not set (it exports `PI_SESSION_ID`). Out of scope here, flagged by the plan.

## Threat Flags

None beyond the plan's register (T-07-02: detected ids come only from registry `id` strings).

## Self-Check: PASSED

- All modified files exist and contain the changes (verified via test runs and greps above).
- No commits to check (withheld per AGENTS.md).
