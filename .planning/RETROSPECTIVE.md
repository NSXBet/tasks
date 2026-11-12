# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1 — Task → Review

**Shipped:** 2026-11-12
**Phases:** 11 | **Plans:** 52 | **Sessions:** not tracked

### What Was Built
- `@tasks/git` typed adapter and `tk work <id>` worktrees on `tk/<id>` with a pinned base; lazy changeset derivation and a close+prune snapshot that every surface renders from.
- `tk finish --session` as the single path into `ready-to-review`; vendored hunk slice `@tasks/review` behind `tk review <id>` (hunk keymap, live re-render, in-view edit) and the web review on @pierre/diffs.
- Comment lifecycle (open / sent / resolved / dismissed) with location tags and batched send-as-cards; harness-registry agent line and review doors on every surface.
- Task view parity in TUI and web: work-first center column, tabbed sessions/changes/workspace/minimap rail, diff modal, artifact view, TASKS column.
- Append-only `.tasks/events.jsonl` wire behind `tk watch`, TUI and web live views, and the pi/omp inbox plus `tasks_wait`.
- Worktree lifecycle (merge-aware prune, `tk worktree clean`, hooks, dependency install), injected workflow contract, one PR per task via `gh`, counts-only stat card.

### What Worked
- Treating the spec (`docs/html/task-to-review.html`) as the contract: gap-closure plans ("match the spec") had an unambiguous target, and the milestone audit could check every spec request R01–R74 and verify item.
- Mock shells first (plan steps 1–3): the real layer filled approved layouts, so UI churn stayed low.
- A live scratch-repo E2E in the milestone audit (fake `gh` on PATH, local bare origin) found the one real blocker (TUI `tk review` on a closed, pruned task) that 1897 unit tests missed.
- One adapter rule (all git through `@tasks/git`, all gh through `surface/gh.ts`) kept the review, web, prune and PR paths consistent and easy to test.
- Choosing a log over a daemon broker for the event wire: no new process, cursors per subscriber, and every consumer (CLI, TUI, web, pi) reads the same file.

### What Was Inefficient
- Phases 3–5 were first executed straight from the master plan outside the GSD loop, then re-planned and verified after the fact. That doubled the bookkeeping.
- The milestone stayed uncommitted until the end (HEAD was `pre claude`), so it landed as 13 large squashed commits rather than per-plan history.
- Headless TUI frame tests gave false confidence: a fully input-dead modal and a blank split layout only showed up in live-pane runs.
- SUMMARY frontmatter drift (missing `requirements_completed`, a `requirements:` key, unparseable frontmatter) made `summary-extract` return blanks and forced manual traceability.
- Scope grew by five phases (7–11) once the spec was read in full; the original roadmap covered plan steps 4–12 only.
- tk bookkeeping lagged: delivered step and epic tasks were still open at close.

### Patterns Established
- The branch is the evidence: derive, never accept lists; freeze once at close.
- Spec-first gap closure: when verification and the spec disagree, the spec wins and a gap-closure plan follows.
- Every TUI change gets a live-pane pass (tmux probe or VHS), not only headless frames.
- External tools (gh) are verbs, not pollers; tests put a fake binary first on PATH.
- Injected contract text is guarded by one drift test across AGENTS.md, `tk prime` and every SKILL.md copy.

### Key Lessons
1. Run a real end-to-end flow in a scratch repo before declaring a milestone done; integration seams (snapshot → TUI) break where unit tests do not reach.
2. Read the whole spec before writing the roadmap; late spec reading added five phases.
3. Commit per plan as you go; an uncommitted milestone loses history and blocks review.
4. Keep SUMMARY frontmatter schema-valid; tooling depends on it for traceability.
5. When a decision changes behavior (branch is `tk/<id>`), update the injected contract text in the same change.

### Cost Observations
- Model mix: not tracked
- Sessions: not tracked
- Notable: the audit-time live E2E was the cheapest high-value check of the milestone.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1 | — | 11 | Spec-as-contract with gap-closure plans; live E2E in the milestone audit |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1 | 1897 pass / 0 fail | — | 2 packages (`@tasks/git`, `@tasks/review`) |

### Top Lessons (Verified Across Milestones)

1. (Pending a second milestone.)
