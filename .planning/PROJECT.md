# Tasks (tk)

## What This Is

An agent-native issue tracker: a single-binary `tk` CLI (Bun, compiled per-platform) with a typed surface API, an OpenTUI terminal interface, a local web server, and a Pi/omp agent extension — used by humans and agents together to file, claim, and close tasks. As of v1 every task is a **PR-shaped record**: `tk work` opens a worktree on `tk/<id>`, commits and diff derive from that branch, `tk finish` hands it to review, reviewers comment in the TUI or web over the same store, one append-only event log carries comments and verdicts back to agents, and a task can carry at most one GitHub PR via `gh`.

## Core Value

A task's branch **is** the evidence: tk derives commits and diff from the task's worktree branch (never agent-supplied lists), review comments land on the task record with resolve state, and nothing ships past `ready-to-review` without that record.

## Requirements

### Validated

<!-- Pre-v1 baseline — inferred from the codebase map (2026-10-17, commit fac7670). -->

- ✓ Issue tracking end-to-end — create/ready/show/update/close/attach with typed IDs (branded zod), status-runs lifecycle — packages/domain, surface
- ✓ Agent integration — hooks capture session ids on codex/cursor/claude, `tk prime` context, skills injection for pi and omp — packages/cli, pi-extention
- ✓ Storage adapters — file, sqlite (bun:sqlite w/ node fallback), postgres; blob stores fs/s3/postgres with env-indirected credentials — packages/sqlite, postgres, file, s3
- ✓ Workspace config — zod-strict `.tasks/config.json` (prefix, storage, attachments, webPort), centralized config module — packages/workspace
- ✓ Terminal UI — OpenTUI 0.5.11 board with task detail view incl. image support, centralized app state — packages/tui
- ✓ Web server — Bun-native HTTP SPA served by `tk web` with `/events` SSE stream — packages/web
- ✓ Distribution — `bun build --compile` single-binary for 4 targets, GitHub Release assets + install.sh + `tk update`
- ✓ Mock interfaces for the review loop — three views (task, artifact, diff) in TUI, web, and CLI shapes from fixtures (plan steps 1–3)

<!-- v1 "Task → Review" — shipped 2026-11-12. -->

- ✓ Typed git adapter `@tasks/git` — one abortable runner, enumerated commands, porcelain parsing; no scattered git calls (GIT-01) — v1
- ✓ `resolveWorktreePath()` — default `.worktrees/<repo>-<id>` pool, `worktree.dir`, per-task override; one resolver for `tk work` and `tk worktree create` (GIT-02) — v1
- ✓ `tk work <id>` — worktree on `tk/<id>` with pinned base SHA, path and branch on the record (GIT-03) — v1
- ✓ Lazy changeset — commits + diff derived live from the branch vs pinned base on every read (CHG-01) — v1
- ✓ Terminal changeset snapshot frozen once at close+prune; closed tasks render from it in show/changes/web/TUI (CHG-02) — v1
- ✓ `tk finish <id> --session` — the only path into `ready-to-review`; cannot close/done (FIN-01) — v1
- ✓ `packages/review` vendored hunk slice; `tk hunk` spawn path deleted; one git adapter (REV-01) — v1
- ✓ Review comments/edits persist to the task record with resolve state and "All resolved" (REV-02) — v1
- ✓ `tk review <id>` — live TUI review over the derived diff, in-view edit, hunk keymap (REV-03) — v1
- ✓ Web review — task/artifact/diff views on @pierre/diffs, live via SSE, editable via write endpoint (WEB-01, WEB-02) — v1
- ✓ Worktree lifecycle — `gitIsMergedToBase` safety, close auto-prune, `tk worktree clean`, `post_start`/`post_checkout`/`pre_end` hooks, package-manager install (LC-01..04) — v1
- ✓ Workflow contract injected into `tk onboard`, `tk prime`, SKILL.md and AGENTS.md (INJ-01) — v1
- ✓ Harness registry agent line, review doors on every surface, comments row (REC-01..03) — v1
- ✓ Comment lifecycle — location-tagged comments, open/sent/resolved/dismissed, explicit batched send as cards (CMT-01..03) — v1
- ✓ Task view parity — work-first center column, tabbed sessions/changes/workspace/minimap rail, diff modal, distinct artifact view, TASKS column (VIEW-01..04) — v1
- ✓ Event wire — append-only `.tasks/events.jsonl` drives `tk watch --until/--drain/--follow`, TUI, web and the pi/omp inbox (WIRE-01..03) — v1
- ✓ PR sidecar and stat card — one PR per task via `gh` (`tk pr create/sync/close/merge`), counts-only stat card in chat, report fallback when the worktree is gone (PR-01..03) — v1

### Active

<!-- Next milestone candidates — v1 tech debt is tracked as tk tasks (see Context). Define formally via /gsd:new-milestone. -->

- [ ] Reconcile the injected contract with `tk work` behavior — claim to in-progress (tasks-jlhs) and the "title seeds the branch" text vs `tk/<id>`
- [ ] `tk pr merge` → `tk close` prune needs a fetch step (prune refuses until origin is fetched)
- [ ] One comment-count rule — `sent` vs `open` disagree between `tk comments --json` and the human views
- [ ] `tk next` oracle and post-review accept/merge/close automation (R54/R55 deferred from v1)
- [ ] Live-harness UAT: omp inbox delivery (tasks-aucj), real gh run (tasks-omwa), primed session contract (tasks-llrt)

### Out of Scope

<!-- Explicit boundaries, with reasoning. -->

- Interactive keybindings inside `tk show` — show stays a record renderer; interactive work belongs to `tk review` and the TUI
- Tier-b product epics (draft tasks, team/cloud, views & navigation, etc.) — tracked as tk issues (tasks-34rm, -k5kp, -lx7a, -d0rq, -zshv, -nzg0, -xcov, -6zif, -gt6y), parked
- Rewriting hunk's rendering stack — tk's TUI already runs @opentui/react, the same stack; only inputs, outputs, and storage change
- A daemon-hosted event broker — v1 chose an append-only log with per-subscriber cursors; a broker adds a process without adding capability
- Polling gh for PR state — PR sync is an explicit verb; gh is the remote truth

## Context

- **Shipped v1 "Task → Review" (2026-11-12)**: 11 phases, 52 plans, 32/32 requirements; 13 code commits `496745b..a589e6e` (308 files, +38.8k/−1.9k). ~100k LOC TypeScript under `packages/`. Regression sweep at audit: full suite 1897 pass / 0 fail, `bun run check` rc 0, luau 6/6, docs build ok.
- **Stack**: TypeScript 5.9.3 on Bun 1.3.14, Bun workspaces, hexagonal layering `domain → application → adapters → workspace → surface → cli/tui/web/pi-extention`; new packages `@tasks/git` and `@tasks/review`. Tests: vitest + bun test side by side. Strict tsconfig. react/react-dom pinned to 19.2.8. RPC VERBS_VERSION 6 (TS + Luau).
- **The contract**: `docs/html/task-to-review.html` (+ `docs/html/data/task-to-review-data.js`) is the spec; Phases 7–11 were added to cover its requests beyond the original plan steps.
- **Origins vendored**: hunk (diff TUI, @pierre/diffs) and gw (worktree management) were copied and reimplemented in TypeScript; neither is a runtime dependency.
- **Known debt (tracked as tk tasks, from `.planning/milestones/v1-MILESTONE-AUDIT.md`)**: contract drift (tasks-jlhs), pr-merge→close fetch, comment-count rule, web polish (tasks-lsna, -xo2y, -lgjk, -yjx4, -qliz, -0elp), hooks config (tasks-iqlr, -iqkh), leaseHolder env (tasks-2fux), event echo/cursor sharing (tasks-kdpe, -uvvr, -mzsn), TUI smoke flake (tasks-syjq), cross-cutting validation (tasks-vzws, -rq1i, -sssi, -uhry, -lyhe). No phase has a Nyquist VALIDATION.md. tk bookkeeping for delivered step/epic tasks is still open.

## Constraints

- **Tech stack**: Bun-first with node-compat only where it exists today; new packages follow workspace conventions (`@tasks/<pkg>` deps, never relative cross-package imports; packages never reach up a directory).
- **Architecture**: package-oriented, locality of behavior — every piece ships as a package module where it's used; enumerated-command git adapter only (no scattered `git` subprocess calls); gh only through `packages/surface/src/gh.ts`.
- **Compatibility**: PR-shaped record must render in all three surfaces (TUI, web, CLI text) from one task record; TUI and web are one review surface in two shapes.
- **Testing**: per-step end-to-end smoke in a scratch repo is the acceptance bar, not unit tests alone; TUI changes also need a live-pane pass (headless frame tests missed a dead-input modal).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Derive commits/diff from the task's branch, never accept file lists | GitHub-PR semantics; the agent supplies nothing to game | ✓ Good — v1 |
| Copy hunk + gw and reimplement in TS rather than spawn/dep | Full control over inputs/outputs/storage; tk replaces both tools in tk-using repos | ✓ Good — v1 (`tk hunk` deleted, one git adapter) |
| Lazy changeset, snapshot frozen exactly once at close+prune | Live reads without per-read caching; record survives worktree deletion | ✓ Good — v1 (TUI fallback added at audit) |
| `tk finish` can set exactly `ready-to-review` — never close/done | Completion is review's entry, not the end; enforced in code | ✓ Good — v1 |
| GSD chartered around the task→review plan as first milestone | Live plan with tk-tagged steps exists; mocks prove the interaction | ✓ Good — v1 |
| Research skipped at init | Brownfield + 399-line plan + codebase map make domain research redundant | ✓ Good — v1 |
| Task's changeset base pinned at `tk work` creation, not derived later | Record is stable against upstream movement; diff is branch-vs-pinned-base, PR-shaped | ✓ Good — Phase 1 |
| The spec `docs/html/task-to-review.html` is the contract | User decision: one source of truth for UI and behavior; drove Phases 7–11 and gap closures ("match the spec") | ✓ Good — v1 |
| Event wire is an append-only `events.jsonl` log, not a daemon broker | User decision: no extra process; per-subscriber cursors give many concurrent watchers via CLI and tool calls | ✓ Good — v1 |
| Diff view uses hunk's own keymap (`]`/`[`, `.`/`,`, `1`/`2`, `g`/`G`, `R`, `q`) with non-colliding tk aliases | User decision 2026-11-10: match the spec; reviewers keep muscle memory | ✓ Good — v1 |
| Default worktree pool is `<repoRoot>/.worktrees/<repo>-<id>` (auto-excluded) | User decision (Phase 2 UAT): in-repo, discoverable, no sibling-dir sprawl | ✓ Good — v1 |
| One PR per task via `gh`; sync is an explicit verb, never polled | User decision: gh is the remote truth; 1-to-1 relation on the record | ✓ Good — v1 (merge→close fetch step ⚠️ Revisit) |
| `tk work` branch is `tk/<id>`, not title-seeded | Stable, collision-free branch names | ⚠️ Revisit — injected contract text still says the title seeds the branch |

---
*Last updated: 2026-11-12 after v1 milestone*
