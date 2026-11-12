# Phase 5: Web Review - Context

**Gathered:** 2026-11-10
**Status:** Ready for planning

<domain>
## Phase Boundary

The same review surface in the browser over the same task record: `/tasks/:id` renders the task view,
the artifact view and the diff view; the web diff is live via the existing `/events` SSE stream and
editable through the write endpoint; a web comment lands in the task store and shows in the TUI.
Fine-grained task-view parity (tabbed rail, diff modal, evidence-in-diff) is Phase 9.

</domain>

<decisions>
## Implementation Decisions

### Landing
- `GET /tasks/:id` lands on the **task view** (record first: description, evidence, comments, rail) with
  "open diff" as the primary action — spec VIEW 1. The diff view is reachable from it (and keeps its own
  deep link). Today `/tasks/:id` (added 2026-11-10) jumps straight into the diff review view — change it.

### Live + edit
- Server-side watcher on the task's worktree + branch ref pushes change notifications through the
  existing `/events` SSE stream; the island re-fetches `/api/review/:id` on notification. No client polling.
- Inline editing in the diff via `@pierre/diffs` `./edit`, writing through the existing
  `PUT /api/review/:id/file` (path-guarded `writeWorktreeFile`).

### Theme
- The diff follows the app theme (dark diff in the dark app, light in light) — today it renders light
  inside the dark app.

### Comments
- Web comments use the existing `/api/review/:id/threads…` endpoints over `taskStoreCommentStore`
  (`metadata.reviewThreads`, locations + status per Phase 3), so they show in `tk show` and the TUI.

### Claude's Discretion
- Watcher debounce; SSE event name/payload shape for review changes; artifact-view rendering details.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/web/src/client/review-island.tsx` — React island on `@pierre/diffs` (mount/unmount API).
- `packages/web/src/review.ts` — `reviewPayloadFor` (live + frozen fallback), `readWorktreeFile`/`writeWorktreeFile` guards.
- `packages/web/src/server.ts` — `/events` SSE, `/api/review/:id/{file,threads,comments/send}` routes, `/tasks/:id` shell route.
- `packages/web/src/app.html` — SPA shell; `/tasks/:id` deep-link handler; task modal with review doors (tasks-osxi).

### Established Patterns
- React/react-dom pinned to 19.2.8 in packages/web (mismatch fixed 2026-11-10).

### Integration Points
- Island bundle served at `/assets/review-island.js`; shell `app.html`.

</code_context>

<specifics>
## Specific Ideas

- Spec: docs/html/task-to-review.html §2 VIEW 1–3 and §3 diff; verify item 3 ("GET /tasks/:id renders the same record and review").

</specifics>

<deferred>
## Deferred Ideas

- Tabbed rail (sessions/changes/workspace/minimap), diff modal over the task view, evidence images in the diff flow — Phase 9.

</deferred>
