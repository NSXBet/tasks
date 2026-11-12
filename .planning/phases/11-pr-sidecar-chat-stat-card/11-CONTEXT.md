# Phase 11: PR Sidecar & Chat Stat Card - Context

**Gathered:** 2026-11-10
**Status:** Ready for planning

<domain>
## Phase Boundary

A task has at most one PR managed by explicit verbs via gh; chat carries a stat card, never a raw diff.

</domain>

<decisions>
## Implementation Decisions

### PR
- One PR per task stored on the record as `metadata.pr = {number, url, state}`; `tk pr create|sync|close|merge <id>` call `gh`; gh is the remote truth; sync runs only when invoked (never a poller).

### Stat card
- Agent/chat-facing output (e.g. `tk finish`, extension notifications) carries a stat card `commits · +adds −dels · files` linking to the task's changes view; diffs are never printed into chat.
- When the worktree is out of reach, changes fall back to the frozen snapshot / task.commit / task.report stats.

### Claude's Discretion
- Naming, file placement, and output formatting not fixed above.

</decisions>

<code_context>
## Existing Code Insights

- packages/git adapter (add gh-free git bits only); gh via a small runner; packages/cli/src/presentation.ts; packages/surface changeset frozen snapshot.

</code_context>

<specifics>
## Specific Ideas

- R28 R60 R61 R65; spec §12 CHANGES, §13 PULL REQUESTS.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
