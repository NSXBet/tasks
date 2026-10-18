# Tasks (tk)

## What This Is

An agent-native issue tracker: a single-binary `tk` CLI (Bun, compiled per-platform) with a typed surface API, an OpenTUI terminal interface, a local web server, and a Pi/omp agent extension — used by humans and agents together to file, claim, and close tasks. This project chartered GSD around the **task → review** plan (`.agents/plans/2026-10-08-task-to-review.md`): one PR-shaped record from `tk work` to reviewed, like a GitHub PR but tracked in the issue store.

## Core Value

A task's branch **is** the evidence: tk derives commits and diff from the task's worktree branch (never agent-supplied lists), review comments land on the task record with resolve state, and nothing ships past `ready-to-review` without that record.

## Requirements

### Validated

<!-- Shipped and confirmed valuable — inferred from the codebase map (2026-10-17, commit fac7670). -->

- ✓ Issue tracking end-to-end — create/ready/show/update/close/attach with typed IDs (branded zod), status-runs lifecycle — packages/domain, surface
- ✓ Agent integration — hooks capture session ids on codex/cursor/claude, `tk prime` context, skills injection for pi and omp — packages/cli, pi-extention
- ✓ Storage adapters — file, sqlite (bun:sqlite w/ node fallback), postgres; blob stores fs/s3/postgres with env-indirected credentials — packages/sqlite, postgres, file, s3
- ✓ Workspace config — zod-strict `.tasks/config.json` (prefix, storage, attachments, webPort), centralized config module — packages/workspace
- ✓ Terminal UI — OpenTUI 0.5.11 board with task detail view incl. image support, centralized app state — packages/tui
- ✓ Web server — Bun-native HTTP SPA served by `tk web` with `/events` SSE stream — packages/web
- ✓ Distribution — `bun build --compile` single-binary for 4 targets, GitHub Release assets + install.sh + `tk update`
- ✓ Mock interfaces for the review loop — three views (task, artifact, diff) in TUI, web, and `tk show`/`work`/`review` CLI shapes from fixtures (plan steps 1–3; tasks-foo, tasks-tnc, tasks-xskm built, awaiting review)
- ✓ Git adapter & worktree entry — `@tasks/git` typed adapter (one abortable runner, enumerated commands, porcelain parsing), `resolveWorktreePath()` with config/metadata precedence, `tk work <id>` pinning base SHA + branch + path on `tk/<id>` — Phase 1

### Active

<!-- Current scope — plan steps 4–12 ("make it real" behind the approved shells). -->

- [ ] Lazy changeset derivation — commits + diff computed live from the branch per read; terminal `{base, head, files}` snapshot frozen only at close+prune
- [ ] `tk finish <id> --session` — records session id, moves to `ready-to-review`, can never close/done
- [ ] `packages/review` — vendored hunk slice (changeset, review types, watch controller; @pierre/diffs dep; broker + comment store stripped); hunk-vcs + hunk-git fold into packages/git; old spawn path deleted
- [ ] Review storage — component comments/edits persist to the task store with per-comment resolve state
- [ ] Real TUI review — three views wired to the live component; `tk review <id>` opens the derived diff
- [ ] Real web review — same layouts via @pierre/diffs `./react` + `./edit`; `/tasks/:id`, SSE live updates, edit write-endpoint
- [ ] Worktree lifecycle — gw ported to TS: `gitIsMergedToBase` safety, auto-prune in `tk close` with terminal snapshot, `tk worktree clean`, lifecycle hooks, package-manager setup on start
- [ ] Injection — ONBOARD snippet, `prime`, `SKILL.md`, root AGENTS.md teach the workflow contract

### Out of Scope

<!-- Explicit boundaries, with reasoning. -->

- Post-review automation (accept/merge/close, rejection flow) — the plan stops at review; merge machinery is a later milestone
- Interactive keybindings inside `tk show` — show stays a record renderer; interactive work belongs to `tk review` and the TUI
- Tier-b product epics (draft tasks, team/cloud, daemon, views & navigation, etc.) — tracked as tk issues (tasks-34rm, -k5kp, -lx7a, -d0rq, -zshv, -nzg0, -xcov, -6zif, -gt6y), parked until the review loop ships
- Rewriting hunk's rendering stack — tk's TUI already runs @opentui/react, the same stack; only inputs, outputs, and storage change
- The event fabric ("the wire") and `tk next` oracle — designed on the plan page (§10); its own project

## Context

- **Stack**: TypeScript 5.9.3 on Bun 1.3.14, Bun workspaces (14 packages), hexagonal layering `domain → application → adapters → workspace → surface → cli/tui/web/pi-extention`. Tests: vitest + bun test side by side (match the package's script). Strict tsconfig (exactOptionalPropertyTypes, verbatimModuleSyntax).
- **Origins to vendor**: hunk (https://github.com/modem-dev/hunk — diff TUI, Apache-2.0 deps incl. @pierre/diffs) and nsxbet/gw (yurifrl fork, Go — worktree management) are copied and reimplemented in TypeScript, then replaced: upstream hunk/gw stay code origins, never runtime dependencies.
- **Current position**: GSD Phase 1 complete (git adapter, resolver, `tk work` entry; 263 tests pass) — lazy changeset derivation is next (Phase 2). Mocks 1–3 remain built, three tasks ready-to-review.
- **Known debt**: `pi-extention` workspace-dep fix rides the review-vendoring step (trivially independent). The `tk hunk` spawn path is deleted at step 7. Code review of Phase 1 flagged `tk --readonly work` bypassing the readonly gate (CR-01, unfixed — advisory).

## Constraints

- **Tech stack**: Bun-first with node-compat only where it exists today; new packages follow workspace conventions (`@tasks/<pkg>` deps, never relative cross-package imports; packages never reach up a directory).
- **Architecture**: package-oriented, locality of behavior — every piece ships as a package module where it's used; enumerated-command git adapter only (no scattered `git` subprocess calls).
- **Compatibility**: PR-shaped record must render in all three surfaces (TUI, web, CLI text) from one task record; TUI and web are one review surface in two shapes.
- **Testing**: per-step end-to-end smoke in a scratch repo (plan §Verification) is the acceptance bar, not unit tests alone.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Derive commits/diff from the task's branch, never accept file lists | GitHub-PR semantics; the agent supplies nothing to game | — Pending |
| Copy hunk + gw and reimplement in TS rather than spawn/dep | Full control over inputs/outputs/storage; tk replaces both tools in tk-using repos | — Pending |
| Lazy changeset, snapshot frozen exactly once at close+prune | Live reads without per-read caching; record survives worktree deletion | — Pending |
| `tk finish` can set exactly `ready-to-review` — never close/done | Completion is review's entry, not the end; enforced in code | — Pending |
| GSD chartered around the task→review plan as first milestone | Live plan with tk-tagged steps exists; mocks prove the interaction | — Pending |
| Research skipped at init | Brownfield + 399-line plan + codebase map make domain research redundant | — Pending |
| Task's changeset base pinned at `tk work` creation, not derived later | Record is stable against upstream movement; diff is branch-vs-pinned-base, PR-shaped | ✓ Phase 1 |

---
*Last updated: 2026-10-18 after Phase 1*
