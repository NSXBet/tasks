# Phase 8: Comment Lifecycle & Agent Delivery - Context

**Gathered:** 2026-11-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Review comments have a lifecycle and reach the agent only when sent. Data layer implemented 2026-11-10 under tasks-lxok (packages/surface/src/operations/review-comments.ts: locations, open|sent|resolved|dismissed, task.comment events, batched comments.send, counts; RPC verbs comments.list/send/status; web endpoints). This phase adds the CLI and the TUI/web controls.

</domain>

<decisions>
## Implementation Decisions

### CLI
- `tk comments <id>` lists comments (location, status, author, body); subcommands `send [<cid>…]`, `resolve <cid>`, `dismiss <cid>`, `reopen <cid>`; `--json` supported. Thin skin over the existing RPC verbs/surface ops.

### Views
- TUI and web show ✓ done / ✕ remove controls per comment, the `N open · K ✓` header and `All resolved` banner, and an explicit "send to agent" action that batches open comments as cards.

### Delivery
- Send produces cards `{file:line, author, body}`; pickup by the agent rides the event stream (Phase 10).

### Claude's Discretion
- Naming, file placement, and output formatting not fixed above.

</decisions>

<code_context>
## Existing Code Insights

- review-comments.ts, packages/rpc/src/verbs.ts (VERBS_VERSION 4), packages/web/src/server.ts comment routes, packages/review taskStoreCommentStore.

</code_context>

<specifics>
## Specific Ideas

- R62 R63 R73 R74.

</specifics>

<deferred>
## Deferred Ideas

Agent auto-pickup over the broker — Phase 10.

</deferred>
