# Phase 10: Event Wire & Watch Broker - Context

**Gathered:** 2026-11-10
**Status:** Ready for planning

<domain>
## Phase Boundary

One event stream drives TUI, web and agents; agents subscribe to tasks and pick up user messages automatically.

</domain>

<decisions>
## Implementation Decisions

### Wire (user decision 2026-11-10: follow spec §10 — supersedes the earlier daemon-broker answer)
- **No daemon.** One append-only `events.jsonl` log per workspace is the wire (spec §10 "The script and the wire"). Every mutation that matters (status changes, `task.comment` transitions, `comments.send` batches, approvals = status → approved/rejected, finish) appends one event line.
- `tk watch <id…>` reads the log with per-subscriber cursors and supports `--until <event>`, `--drain` and `--follow` exactly as the spec's loop table describes; many agents/clients can watch simultaneously because each keeps its own cursor.
- TUI and web live views and notifications read the same log (web `/events` SSE tails it; TUI tails it) — one stream, no second mechanism.
- The pi/omp agent extension tails the log and surfaces comments/approvals/sent review batches to the agent automatically.
- The superseded daemon-broker plans are kept in `superseded/` for reference only; do not execute them.

### Claude's Discretion
- Naming, file placement, and output formatting not fixed above.

</decisions>

<code_context>
## Existing Code Insights

- packages/surface/src/watch/* (existing poll-based watch to replace/feed from the log), packages/daemon (NOT the broker), packages/pi-extention watch-manager, packages/web /events + /api/events ring buffer.

</code_context>

<specifics>
## Specific Ideas

- R56 R57 R58; spec §10 THE LOOP.

</specifics>

<deferred>
## Deferred Ideas

`tk next` oracle stays v2.

</deferred>
