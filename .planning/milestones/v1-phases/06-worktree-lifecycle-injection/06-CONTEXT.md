# Phase 6: Worktree Lifecycle & Injection - Context

**Gathered:** 2026-11-10
**Status:** Ready for planning

<domain>
## Phase Boundary

tk replaces gw: merge-aware prune on close, `tk worktree clean`, lifecycle hooks, package-manager setup on start; and the harness learns the workflow contract via onboard/prime/SKILL.md/AGENTS.md. Much exists already (packages/git/src/prune.ts gitIsMergedToBase + pruneClosedWorktree, hooks.ts runShellHook, tk worktree subcommand, onboard.ts, PRIME) — plan only verified deltas.

</domain>

<decisions>
## Implementation Decisions

### Package-manager setup
- On `tk work` / `tk worktree create` post-start, detect the package manager from the lockfile (bun.lock/bun.lockb → bun, pnpm-lock.yaml → pnpm, yarn.lock → yarn, package-lock.json → npm) and install deps by default; `worktree.install: false` in workspace config disables it. Install failure is a non-fatal note.

### Lifecycle
- Prune stays non-fatal to close; unmerged → prune refused with reason, close succeeds; frozen snapshot written at close (Phase 2 CHG-02).
- `tk worktree clean` dry-run by default, `--yes` removes.
- Hooks `worktree.post_start` / `post_checkout` / `pre_end` run at their lifecycle points (hook arg order fixed in plan 01-03).

### Injection
- `tk onboard`, `tk prime`, `skills/tasks/SKILL.md` and root AGENTS.md all state the contract: work in `tk work <id>`, finish with `tk finish <id> --session <id>`, never mark done, review with `tk review <id>`; onboard writes an idempotent managed block.

### Claude's Discretion
- Naming, file placement, and output formatting not fixed above.

</decisions>

<code_context>
## Existing Code Insights

- packages/git/src/prune.ts, hooks.ts; packages/cli/src/onboard.ts, tk.ts PRIME, packages/cli/skills/tasks/SKILL.md; worktree default `<repoRoot>/.worktrees/` (auto-excluded, plan 01-03).

</code_context>

<specifics>
## Specific Ideas

- Spec §11 THE WORKTREE; verify items 8 and 9.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
