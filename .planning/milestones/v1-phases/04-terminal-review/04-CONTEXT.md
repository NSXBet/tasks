# Phase 4: Terminal Review - Context

**Gathered:** 2026-11-10
**Status:** Ready for planning

<domain>
## Phase Boundary

The full review loop works in the terminal: `tk review <id>` opens the vendored review TUI over the
tk-derived diff; commits from another terminal re-render it live; an in-view edit writes the worktree
file; comments composed in the TUI land on the task record. Task-view layout parity (rail tabs,
diff modal, artifact view distinct from diff) is Phase 9, not here.

</domain>

<decisions>
## Implementation Decisions

### Branchless tasks
- A task with no branch shows an empty state — "no branch yet — run `tk work <id>`" — instead of the
  current working-tree `git diff HEAD` fallback in `packages/tui/src/review/source.ts`. TUI becomes
  branch-scoped like the web (closes v1 divergence 1).

### Live re-render
- Use the vendored review watch controller (`packages/review/src/core/watch`) on the task's worktree and
  branch ref, debounced, re-deriving the tk changeset/patch. No refresh key, no restart.

### In-view edit
- `e` opens an inline edit buffer for the selected hunk's lines inside the diff view; saving writes the
  worktree file (guarded to stay inside the worktree) and the diff re-renders around the change.

### Comments
- TUI comments go through the task-store comment seam (`taskStoreCommentStore`, `metadata.reviewThreads`
  with locations/status — Phase 3 decisions); `tk show` reads the same store.
- Any remaining mock-shell plumbing in the TUI is deleted at this step.

### Claude's Discretion
- Debounce interval; edit-buffer keybindings beyond `e`/save/cancel; how the empty state is styled.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/tui/src/review/source.ts` — derives the diff from the issue's worktree/branch/pinned base (has the working-tree fallback to remove).
- `packages/tui/src/app/diff.tsx`, `artifact.tsx`, `task.tsx`, `composer.tsx` — live views (diff keybar already lists c/r/e/x/u/p).
- `packages/review/src/core/watch/*` — vendored watch controller (chokidar).
- `packages/web/src/review.ts` `guardWorktreePath` / `writeWorktreeFile` — path-guard pattern to mirror for TUI writes.

### Established Patterns
- TUI is OpenTUI React; routes in `packages/tui/src/app/routes.ts` (`tk://diff/<id>` deep link used by `tk review`).

### Integration Points
- `packages/cli/src/tk.ts` `review` command → `runTui` with `tk://diff/<id>`.

</code_context>

<specifics>
## Specific Ideas

- Spec: docs/html/task-to-review.html §3 (DIFF · FULL PAGE / MODAL, hunk keybindings), verify item 2.
- The spec mock pages are the UI design contract for this phase (no separate UI-SPEC).

</specifics>

<deferred>
## Deferred Ideas

- Tabbed task rail, diff modal over task view, distinct artifact view, evidence images in the diff — Phase 9.
- Comment send-to-agent controls — Phase 8.

</deferred>
