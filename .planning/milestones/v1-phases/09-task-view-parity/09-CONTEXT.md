# Phase 9: Task View Parity - Context

**Gathered:** 2026-11-10
**Status:** Ready for planning

<domain>
## Phase Boundary

The task view matches the spec mocks in TUI and web: work front and center, tabbed rail, diff modal over the task view, distinct artifact view, evidence images in the diff flow.

</domain>

<decisions>
## Implementation Decisions

### Layout
- Task view: description front and center, artifacts = `tk evidence` grouped on the task as the main column, comments preview; never leads with a sessions table.
- Tabbed rail: sessions / changes / workspace / minimap (TUI: tab-key cycling; web: tabs as in the mock).
- No start-work on ready-to-review; open diff primary; worktree chips visible on narrow views (path only).
- Changes tab or a changed file opens the diff modal over the task view; modal expands to the full diff view.
- Artifact view is distinct from the diff view (docs render as docs, code as code; line or whole-file comments).

### Evidence images
- TUI: render evidence images inline in the diff flow via `packages/terminal-image`, falling back to a commentable `evidence:<id>` row; web: inline `<img>` rows. Both are comment targets with location `evidence:<id>`.

### Claude's Discretion
- Naming, file placement, and output formatting not fixed above.

</decisions>

<code_context>
## Existing Code Insights

- packages/tui/src/app/{task,artifact,diff,modal}.tsx; packages/terminal-image; packages/web/src/app.html + client/review-island.tsx; evidence blobs via /api/issue/:id/blob/:blob.

</code_context>

<specifics>
## Specific Ideas

- Spec §2 VIEW 1–3 mocks are the UI design contract; R33–R39 R64 R67–R72 R74.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
