# Phase 7: Review Record & Harness Registry - Context

**Gathered:** 2026-11-10
**Status:** Ready for planning

<domain>
## Phase Boundary

The record carries provenance and both review doors on every task surface. Largely implemented 2026-11-10 under tk task tasks-osxi (packages/domain/src/review-record.ts registry + doors, tk show agent line/doors/comments row, web modal + board cards, TUI task view) — plan only the remaining deltas and verification.

</domain>

<decisions>
## Implementation Decisions

### Harness recording
- Auto-detect the harness at `tk finish` from environment (omp / codex / cursor session env vars); `--harness` / `TK_HARNESS` overrides; unknown env → registry default (omp). Stored as `metadata.agent_harness`.

### Doors
- Doors on every task surface; `tk list` / `tk ready` keep the footer template unless the planner finds per-row doors fit the column layout; TUI web base should read the registered web runtime (not hard-coded :4747).

### Comments row
- Counts follow Phase 3's rule (dismissed counts as settled), read from `metadata.reviewThreads`.

### Claude's Discretion
- Naming, file placement, and output formatting not fixed above.

</decisions>

<code_context>
## Existing Code Insights

- packages/domain/src/review-record.ts, packages/cli/src/presentation.ts, packages/web/src/app.html, packages/tui/src/app/task.tsx; tests packages/domain/test/review-record.test.ts.

</code_context>

<specifics>
## Specific Ideas

- Spec §1 THE RECORD; R17 R50 R51; verify items 1, 6, 7.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
