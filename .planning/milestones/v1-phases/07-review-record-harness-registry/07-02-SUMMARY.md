---
phase: 07-review-record-harness-registry
plan: 02
subsystem: tui, surface
tags: [review-doors, runtime-registry, tui]
requires: []
provides:
  - "@tasks/surface resolveWebBase(tasksDir)"
  - "Board.webBase (TUI)"
  - "DoorsLine TUI component (list, kanban, detail)"
affects: [07-03 (CLI switches its private webBase to resolveWebBase)]
key-files:
  created:
    - packages/tui/src/app/doors.tsx
  modified:
    - packages/surface/src/runtime.ts
    - packages/surface/test/runtime.test.ts
    - packages/tui/src/store.ts
    - packages/tui/src/app/App.tsx
    - packages/tui/src/app/task.tsx
    - packages/tui/src/app/list.tsx
    - packages/tui/src/app/kanban.tsx
    - packages/tui/src/app/detail.tsx
    - packages/tui/test/app.test.tsx
    - docs/src/content/docs/overview.md
decisions:
  - "resolveWebBase lives in runtime.ts beside readRuntimeRegistry; already re-exported via `export * from './runtime.js'` — no edit to packages/surface/src/index.ts needed."
  - "DoorsLine truncates to terminal width only (height-1 text); in the 50% list pane a long URL is clipped by the pane — tests run list/detail at 200 cols."
requirements-completed: [REC-02]
metrics:
  tasks: 3
  completed: 2026-11-10
---

# Phase 07 Plan 02: TUI review doors with the registered web base — Summary

Every TUI task surface (task view, list, kanban, detail pane) now shows both review doors, `tk review <id>` and `<web base>/tasks/<id>`. The web base comes from the registered web runtime in `<tasksDir>/runtime.json` via the new `resolveWebBase` in `@tasks/surface`. When no web runtime is registered, it falls back to `http://localhost:21579`. The stale `:4747` no longer shows up anywhere in the TUI.

## What was built

- **Task 1 (tracer):** `resolveWebBase(tasksDir)` in `packages/surface/src/runtime.ts`. It returns the `kind === "web"` row's url with trailing slashes stripped, but only when `new URL` parses it as `http:`/`https:`. In every other case, including read or parse errors, it returns `http://localhost:${WEB_DEFAULT_PORT}`. It never probes the network. The TUI `Board` gains `webBase`: `buildBoard` takes it as a third parameter that defaults to the default base, `loadBoard` resolves it on every poll, and `boardSignature` includes it so the board refreshes when a web server starts later. `App.tsx` `emptyBoard` carries the default, and `task.tsx` passes `state.board.webBase` to `reviewDoors`. New test: task view at 160 cols shows `http://127.0.0.1:5999/tasks/<id>` and not `:4747`.
- **Task 2:** a `describe("resolveWebBase")` block with 6 cases: empty registry, trailing slash stripped, `javascript:alert(1)`, `not a url`, malformed `runtime.json` (`{`), and a watch-only registry.
- **Task 3:** `packages/tui/src/app/doors.tsx` `DoorsLine` renders one dim line, `review tk review <id> · <base>/tasks/<id>`. The list shows it under the scrollbox for the highlighted row, and only when a row exists. In kanban, the board is wrapped in a column and the line goes under the columns for the selected card. In the detail pane (`IssueDetail`), the agent line (`agentLine`, only when not null) and the doors line sit under the meta header. Four new tests: list doors with the registered base, empty list without a doors line, kanban doors, and the detail pane showing `agent codex · session s9` plus `tk review <id>`. For the detail test, metadata was set through `store.surface.store.transact` + `getOrThrow` + `uow.save`, because `UpdatePatch` has no metadata field.
- **Docs:** in `overview.md`, the review-doors paragraph now names the TUI list/kanban/detail footer and the no-probe `resolveWebBase` rule. `cd docs && bun run build` passes.

## Verification (all run)

| Command | Result |
|---|---|
| `bun run --filter @tasks/surface build` | First run failed in `@tasks/git` `src/prune.ts(68,66): Cannot find name 'mergedIntoBaseLine'`. That code is concurrent 06-01 work in progress, not this plan's. The rerun inside `tui check` built clean. |
| `bun test --timeout 15000 packages/tui/test/app.test.tsx` (Task 1) | 15 pass / 0 fail |
| `bun test packages/surface/test/runtime.test.ts` | 7 pass / 0 fail |
| `bun test --timeout 15000 packages/tui/test` | 39 pass / 0 fail |
| `cd packages/tui && bun run check` | exit 0 |
| `cd packages/surface && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `bun test --timeout 15000 packages/surface/test` | 71 pass / 0 fail |
| `grep -rn "4747\|21579" packages/tui/src` | no matches |
| `cd docs && bun run build` | Complete |

## Deviations from Plan

- **[Rule 2] Docs update:** AGENTS.md requires doc edits to land with behavior changes, so `docs/src/content/docs/overview.md` was edited, although the plan did not list it. 07-01 may also touch overview.md; my edit is limited to the review-doors sentence at ~line 522.
- In the detail-pane test, the agent metadata goes in through a unit-of-work save instead of `surface.update`, because `UpdatePatch` has no metadata field. The plan expected this check.

## Notes

- Commits were withheld per AGENTS.md (conservative profile). Everything was done in the main tree, and STATE.md/ROADMAP.md were not touched.
- I did not edit `packages/domain/src/review-record.ts`; 07-01 owns `DEFAULT_WEB_BASE`. The TUI no longer depends on that constant, because the base always comes from `Board.webBase`.
- Prohibited files were not touched: tui/src/review/source.ts, git/src/commands.ts, web/src/review.ts.

## Self-Check: PASSED
