# Plan: What tk can steal from Multica — agent registry + status-driven execution

**Date:** 2026-09-22
**Goal:** Gap/ideas/steal/explore analysis. Multica (Electron app, `ai.multica.desktop` v0.5.1, daemon on 127.0.0.1:19681, cloud `api.multica.ai`) is a Linear-style tracker where **statuses drive agent execution**. This plan maps every Multica surface against tk's current reality and proposes what tk should become: the same model, terminal-first, local-first.
**This is a plan. No code changed.**

---

## 1. What Multica actually is (verified)

Two-part system: an Electron UI (`file://…/app.asar/out/renderer/index.html`) + a local daemon (`multica daemon start --foreground --profile desktop-api.multica.ai`, server URL `https://api.multica.ai`) + a Go-style CLI in `~/Library/Application Support/Multica/bin/multica`. Workspaces sync to the cloud; the daemon runs agent runtimes on the local machine.

### 1.1 The core inversion (the thing to steal)

Multica's Issue Statuses are **behavioral**, not cosmetic (from Settings → Issue Statuses):

| Status | Category | Multica description (verbatim) |
|---|---|---|
| Backlog | Unstarted | "Parked. **Assigning an issue here never starts an agent run.**" |
| Todo | Unstarted | "Queued. **Moving an issue here starts the assigned agent.**" |
| In Progress | Started | "Actively being worked on." |
| In Review | Started | "Delivered, waiting on human review. **Finalizes the autopilot run.**" |
| Blocked | Started | "Stalled on an external dependency." |
| Done / Cancelled | Completed | (collapsed by default) |

The status model *is* the agent orchestration API. Dragging an issue to Todo = enqueueing work on the assigned agent. In Review = run finalization. The board shows "0 agents working" as a live indicator; issues have Member/Agent assignee split (All \| Members \| Agents tabs).

### 1.2 Agent registry (Agents page)

- Table: **Agent | Status | Owner | Access | Runtime | Last active | Runs**
- Status is live presence: `● Online`. Mika ("Your workspace Chief of Staff…") is Online, Runtime `Oh-My-Pi (Yuris-MacBook-Pro-Local)` — **agents run on OMP runtimes**.
- Filters: Mine / All / **Archived** (archive, not delete).
- Agent detail page (Mika):
  - Header: name, `● Online · Idle`, description, chips: Default (mode), Runtime, Access, Updated.
  - Buttons: **DM**, **+ Assign work**.
  - Tabs: **Overview** (Now: "No active work"; Timeline: "how long it has been stuck", "completed work", etc.), **Work** (kanban of assigned issues by status), **Capabilities** (Instructions / **Skills** / **MCP** / Integrations), **Settings** (model, runtime, access, concurrency).
  - Run stats over 30 days.

### 1.3 Execution layer

- **Runs**: every assignment/trigger produces a run with status (failed/retry buttons on the FBR-1 issue detail: "Run failed — Retry run").
- **Runtimes** page: "Machines and cloud workers running CLI sessions for your agents." Row: `Yuris-MacBook-Pro-2.local — daemon 01a0169b0… · This device — ● Online — 7 runtimes — All live — just now`. Add-a-computer button.
- **Autopilot** page: tabs **Autopilot | Issue wakeups** — scheduled agent runs + event/webhook triggers.
- **Inbox**: notification feed; run failures surface as inbox items ("Admin starter page — Run failed — 1h"); **Archived** section.
- **Chat**: DM conversations with agents ("Getting started with Mika").
- **Analytics**: Usage/Errors tabs, COST/TOKENS/Input-Output/Run time per agent (leaderboard).
- **Squads** (groups of agents) and **Skills** (shared instruction packs) exist as first-class pages (empty in this workspace).

### 1.4 Multica CLI surface (`multica --help`)

Core: `agent`, `autopilot`, `chat`, `issue`, `label`, `project`, `property`, `repo`, `squad`, `skill`, `runtime`, `workspace`, `daemon`, `user`, `env: MULTICA_SERVER_URL/MULTICA_WORKSPACE_ID`.

Agent subcommands: `archive`, `avatar`, `copy` (clone to a *different runtime*), `create`, `env` (audited custom env vars), `get`, `list`, update, …
Issue subcommands include: `assign` (member/agent/squad), `cancel-task` (interrupt in-flight run), `children`, `runs`, `run-messages`, `rerun`, `timeline`, `usage`, `wakeup`, `metadata`, `subscriber`.
Runtime subcommands include `activity`, `list`, `profile`, `usage`. Autopilot subcommands include `runs`, `trigger`/`trigger-add`/`trigger-rotate-url` (webhook with rotatable URL), `list`.

---

## 2. tk today (verified)

- **Statuses** (policy-driven vocabulary, `tk statuses`): `open`, `in_progress`, `ready-to-review`, `approved`, `rejected`, `blocked`, `deferred` (frozen), `archived` (icebox), `closed`. Domain: *"Vocabulary belongs to configured policy, never domain hard-coding."*
- **The seam already exists**: `packages/domain/src/issue.ts` defines `StatusTransitionPolicy` + `transitionStatus()` — an adapter/config supplies lifecycle vocabulary and timestamp effects (`startedAt`/`closedAt`). Statuses can already carry behavior; nothing enforces that behavior is agent-execution yet.
- **Sprints** built exactly as requested (named focus buckets, single-active invariant): `tk sprint start <name> [--carry]`, `tk list --sprint active|backlog|<slug>`, list shows active first + completed archive. `tk sprint start` closes the active sprint and moves its issues to backlog unless `carry`.
- **Icebox**: `tk archive` / `tk unarchive`, plus time-based `tk defer <id> [until]` / `undefer`, `defer_until` field.
- **Assignee field** exists (`owner`/`assignee`), `--assignee` filters, `tk assign`. But assignee is a *string* — no registry, no presence, no runtime binding, no runs.
- **Event stream**: `tk watch --kinds --ids --label` emits NDJSON; the omp/pi extension (`packages/extension/src`: `index.ts`, `widget.ts`, `watch-manager.ts`, `watch/child-entry.ts`) already hosts a watch child and surfaces widget/statusline.
- **Agent lifecycle hooks**: `tk setup cursor|codex` installs hooks; `tk hooks install|list|run`; `tk hunk` for review import.
- **Per-issue KV**: `metadata` (`--set-metadata k=v`), attachments, plans (`--plan <path>`), `spec_id`, `external_ref`, `branch`.
- **Surfaces**: CLI (`--json`, `--markdown`), TUI (board/kanban/graph/insights), Web (`tk web`), sync (dolt refs), worktrees.
- Missing from Multica's world: **agent registry**, **runs**, **runtime registry**, **status→run trigger semantics**, **wakeups/autopilot**, **inbox**, **agent DM/chat**, **usage ledger**. Issue status model has no "moving here starts an agent" effect anywhere.

---

## 3. Gap table — Multica concept → tk state → verdict

| # | Multica concept | tk today | Verdict |
|---|---|---|---|
| 1 | Status transitions *execute* agents (Todo starts, Backlog never, In Review finalizes) | `StatusTransitionPolicy` seam exists; no execution effect | **STEAL — the whole model** |
| 2 | Agent registry (presence, owner, access, runtime, last active, runs, archive filter) | `assignee` string only | **STEAL — biggest gap** |
| 3 | Runs per assignment: state, messages, retry, cancel-task, rerun | nothing | **STEAL** |
| 4 | Runtime registry (machine/daemon, activity, "7 runtimes live") | extension watch child + `tk hooks` are half of it | **ADAPT** |
| 5 | Inbox notifications ("Run failed"), Archived section | `tk watch` events exist; no inbox view | **ADAPT** |
| 6 | Agent DM / Chat per agent | `tk comment` on issues only | **EXPLORE** |
| 7 | Capabilities per agent: Instructions / Skills / MCP | managed skills exist in omp; nothing per-agent in tk | **ADAPT** |
| 8 | Wakeups: time (defer_until fires) + event/webhook triggers | `defer_until` is a date; watch NDJSON exists; no triggers | **ADAPT** |
| 9 | Analytics: cost/tokens/run-time per agent/issue | nothing (could ride issue metadata) | **ADAPT (later)** |
| 10 | Squads (agent groups) | nothing | **SKIP (YAGNI)** |
| 11 | Cloud sync of agents/runs (api.multica.ai) | dolt refs sync, local-first | **KEEP tk's model** |
| 12 | Archived statuses for both agents & issues | `tk archive` exists for issues; agents would need it from day one | **STEAL (cheap)** |
| 13 | Timeline per agent ("how long it has been stuck") | `tk history <id>`, `stale` | **HAVE IT — surface it** |

---

## 4. The plan — tk becomes Multica, in the terminal

### Phase 1 — Agent registry (packages/domain + a new `packages/agents` or inside domain/application)

1. `Agent` domain record (mirroring `SprintSchema` pattern): `id` (slug), `name`, `description`, `owner` (actor), `runtime` (host/session ref), `access` (`workspace|project`), `mode` (`default|autopilot`), `status` (`online|idle|offline` — presence computed, not stored), `instructions` (text), `skills` (list), `env` (metadata, audited), `archivedAt`, timestamps, `wireUnknown` passthrough. Bd-style wire schema (`AgentWireSchema`) like `BdWireSprintSchema`.
2. CLI: `tk agent create|list|get|update|archive|restore|copy`. `tk list --assignee <agent>` resolves agents. Registry lives in the same `.tasks/` storage (new entity type next to sprints — reuse the BdWire envelope pattern).
3. Archive-first (per your standing preference): agents archive/restore, never delete.

### Phase 2 — Runs + status-driven execution

4. `Run` record: `id`, `issueId`, `agentId`, `trigger` (`status-move|wakeup|manual`), `state` (`queued|running|in_review|failed|done|cancelled`), `startedAt/closedAt`, `messages` (NDJSON log, like run-messages), `usage` (tokens/cost). Persisted as a third entity type.
5. Wire `StatusTransitionPolicy`: status vocabulary gains **effects** — `to: Todo ⇒ enqueue run on assignee`, `to: Backlog ⇒ never starts`, `to: ready-to-review ⇒ finalize run`. tk's built-in statuses already read like Multica's (`ready-to-review` ≈ In Review; `open` ≈ Todo/Backlog depending on assignee). The policy interface in domain takes the effect; the CLI/TUI show the consequence ("moving tk-x to open will start Mika" confirmation, or `--yes`).
6. CLI: `tk issue runs <id>`, `tk run messages <run>`, `tk run cancel`, `tk run rerun`. `tk watch` kinds gain `run.*` events — the extension widget then shows live run state for free.

### Phase 3 — Runtimes, wakeups, inbox

7. Runtime registry: a machine = host running the daemon/OMP sessions (`tk runtime list/activity`). The extension's watch child-entry is already the shape of a runtime worker.
8. Wakeups: `defer_until` becomes a wakeup source (defer fires a run), plus event wakeups from `tk watch` kinds and (later) a webhook trigger — autopilot-lite. `tk autopilot` only after wakeups work.
9. Inbox: notifications derived from runs (`tk inbox`, unread/read, archive). Failure events from `tk watch` → inbox entries. `tk hunk` already gives review flow for the human-in-loop gate (`ready-to-review` → approved/rejected).

### Deliberately not stolen

- Cloud-first sync (tk stays local-first, dolt sync), Electron UI (TUI + `tk web` is the surface), Squads (skip until agents exist in numbers), Analytics tables (ride `usage` on runs; report via CLI first).

---

## 5. Verification

- Multica surfaces: verified by driving the real app via CDP (screenshots: Agents registry, Mika detail w/ Work/Capabilities/Settings, Issue Statuses settings page, Issues board, Runtimes, Squads/Skills/Autopilot/Chat/Inbox/Analytics, Daemon settings) and by the daemon HTTP probe (`/health` 200; REST paths 404 — private protocol).
- Multica CLI: `multica --help`, `agent --help`, `issue --help`, `runtime --help`, `autopilot --help` captured verbatim.
- tk claims: `tk --help`, `tk statuses`, `tk status`, and source reads of `packages/domain/src/issue.ts` (StatusTransitionPolicy, SprintSchema, defer_until), `packages/cli/src/tk.ts` (sprint start/carry, `--sprint active|backlog|<slug>`, archive writers set), `packages/cli/src/presentation.ts` (HUMAN_HELP: `tk sprint start`, `tk archive`), `packages/extension/src` listing.

## 6. Out of Scope

- Any code change (plan only, per instruction).
- Sprint/archive redesign — already built as desired.
- Cloud sync, squads, analytics dashboards.