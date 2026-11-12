# Milestones

## v1 Task → Review (Shipped: 2026-11-12)

**Delivered:** Every task is a PR-shaped record — `tk work` opens a worktree on `tk/<id>`, commits and diff derive from the branch, `tk finish` hands off to review in the TUI or web, and one event log carries comments and verdicts back to agents.

**Phases completed:** 11 phases (1–11), 52 plans, 30 tasks
**Closeout:** verified_closeout — all 11 phases verified, 32/32 requirements, audit `tech_debt` (no blockers)
**Known verification overrides:** 0 newly acknowledged, 0 carried forward
**Git range:** `496745b..a589e6e` (13 code commits; 308 files, +38,846 / −1,913)
**Code:** ~100k LOC TypeScript under `packages/`; full suite 1897 pass / 0 fail at audit

**Key accomplishments:**
- One typed git adapter (`@tasks/git`) and `tk work <id>` worktrees on `tk/<id>` with a pinned base; commits and diff derive live from the branch, and close+prune freezes a snapshot that every surface renders from.
- `tk finish --session` is the only path into `ready-to-review`; the vendored hunk slice (`@tasks/review`) powers `tk review <id>` and the web review on @pierre/diffs — live, editable, commentable, over one comment store.
- Comment lifecycle (open / sent / resolved / dismissed) with location tags and an explicit batched send to the agent as cards; harness-registry agent line and review doors on every surface.
- Task view parity in TUI and web: work-first center column, tabbed sessions/changes/workspace/minimap rail, diff modal, distinct artifact view, TASKS column.
- Append-only `.tasks/events.jsonl` wire drives `tk watch --until/--drain/--follow`, TUI and web live views, and an automatic pi/omp inbox with a `tasks_wait` tool.
- Worktree lifecycle (merge-aware prune, `tk worktree clean`, hooks, dependency install), injected workflow contract, one PR per task via `gh`, and a counts-only stat card in chat.

**Tech debt:** tracked as tk tasks — see `milestones/v1-MILESTONE-AUDIT.md`.

---
