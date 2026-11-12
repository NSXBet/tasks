# Phase 3: Review Component & Review Storage - Context

**Gathered:** 2026-11-10
**Status:** Ready for planning

<domain>
## Phase Boundary

tk owns its diff component: the vendored hunk slice in `packages/review` takes tk-derived input
(the changeset/patch derived through `@tasks/git` + `@tasks/surface`) and writes review state
straight to the task record. Much of this already exists in the working tree; this phase closes
the remaining deltas against REV-01 / REV-02 and the roadmap success criteria, and deletes the
legacy `tk hunk` spawn path.

</domain>

<decisions>
## Implementation Decisions

### Legacy hunk path
- Delete `tk hunk` and `packages/cli/src/hunk.ts` (incl. `planHunk`, `writeAgentContext`, hunk session comment parsing); `tk review <id>` is the only review door (spec verify 4: "planHunk deleted").
- Comments previously synced under the old hunk metadata key (`hunkCommentMetaKey`) are imported once into the task's review threads on first read; tk stops writing the old key.
- No dependency on the external `hunk` binary remains — nothing spawns it.

### Diff source
- `packages/review` stays git-free: callers (TUI, web, smoke) pass the tk-derived patch/changeset; review never shells out to git itself. "hunk-vcs / hunk-git fold into packages/git" is satisfied by review having no git code and all git access going through `@tasks/git`.
- Keep only the provider-neutral vcs types in `packages/review`; drop vendored non-git adapters (jj, sl, etc.) and their tests.
- The `pi-extention` workspace-dep fix (declare `@tasks/daemon`, `@tasks/surface`) already landed 2026-11-10 — record it as done in this phase, no new work.

### Proof & storage
- Headless smoke = a `packages/review/test` smoke test plus a node script that loads a real repo's tk-derived diff into the review model without a TTY (proves "opens a diff of any repo from node").
- Review state lives in `metadata.reviewThreads` (built 2026-11-10 under tk task tasks-lxok): location-tagged comments (file / line range / `evidence:<id>`), status open | sent | resolved | dismissed, `task.comment` events, counts `{open, sent, resolved, dismissed, label}`.
- "All resolved" = at least one comment exists and none is open or sent; dismissed counts as settled.

### Claude's Discretion
- Exact location of the one-time legacy-comment import (surface read path vs review store adapter).
- Naming/placement of the smoke script and test fixtures.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/review/src/app/taskStoreCommentStore.ts`, `packages/review/src/core/review/commentStore.ts` — task-store-backed comment seam (extended 2026-11-10 with locations/status/counts).
- `packages/surface/src/operations/review-comments.ts` — comment lifecycle rules, batched send, counts (new 2026-11-10).
- `packages/surface/src/operations/changeset.ts` — `deriveChangeset`, frozen snapshot read; `packages/web/src/review.ts` — patch derivation incl. frozen fallback.
- `packages/review/src/opentui/*` — HunkDiffView etc. used by the TUI diff view.

### Established Patterns
- All git through `@tasks/git` (typed adapter, one runner; made node-compatible by plan 01-04).
- Review package tests run with `bun test packages/review/src` (1066 pass after dep declarations 2026-11-10).

### Integration Points
- `packages/cli/src/tk.ts`: `tk hunk` command (to delete), `tk review` → `runTui` with `tk://diff/<id>`.
- `packages/tui/src/review/*` consumes the review component; `packages/web/src/server.ts` `/api/review/:id/threads…`.

</code_context>

<specifics>
## Specific Ideas

- Spec: docs/html/task-to-review.html §3–§4 (diff view copied from hunk; one reusable diff module) and verify items 2 and 4.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope (comment UI rendering and evidence targets belong to Phases 8–9).

</deferred>
