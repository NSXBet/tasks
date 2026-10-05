# Tasks as a pi/omp Extension — Architecture Plan

Status: draft for approval. Blocks on: user checkpoint (see end).

## 0. Goal

Two new ways to drive Tasks, one codebase:

1. **`@tasks/surface`** — host-agnostic, typed command surface (plain JSON in/out) extracted from the tk CLI monolith. Consumed by the CLI *and* the extension. DRY: one implementation of every operation.
2. **`packages/extension`** — a self-contained installable plugin that works under **both `pi` and `omp`**, exposing all surface features as LLM tools, injecting a skill, and shipping the principal feature: a **spawned watcher process** that polls the workspace and notifies the main agent session when subscribed events occur.

Non-goals: web UI, changes to storage backends' data formats, replacing the CLI human output.

## 1. Verified host facts (evidence)

| Fact | pi | omp |
|---|---|---|
| Manifest keys | `pi.extensions/skills/prompts/themes` (`pi-manifest.js`) | `omp.extensions` with `?? pi` fallback (binary + docs) |
| Legacy specifier rewrite | virtual modules: `@sinclair/typebox`, `@earendil-works/*`, `@mariozechner/*` (`loader.js:33-56`) | same scopes × packages + `@sinclair/typebox` (binary strings) |
| `resources_discover` | **fires** (`agent-session.js:1852-1855`) | defined, **no callsite** → never rely on it alone |
| Skills from plugin dir | manifest `skills` + `collectSkillEntries` | plugin-root skill discovery (proven: match-day `pi.skills` works installed under omp) |
| Notify main thread | `sendUserMessage(content, {deliverAs: "steer"|"followUp"})` — always triggers a turn (`types.d.ts:298-307, 963`) | `sendUserMessage` steer/followUp/nextTurn + `sendMessage(msg, {deliverAs, triggerTurn})` |
| Timers | **none on ExtensionAPI** (raw timers crash the session) | `ctx.setInterval` managed + contained |
| Install by local dir | `pi install ./local/path` | plugin link / plugin root copy (proven: `@NSXBet/pi-fbr-match-day`) |

Design consequences:

- **No in-process polling** in the extension. The watcher is a spawned child process (`tk-watch`), read via Bun's stdout async stream. Works identically on both hosts, needs no timers, and a crash in the child cannot take down the session (in-process callbacks can).
- **Notification**: one call shape — `pi.sendUserMessage(text, {deliverAs: "followUp"})`. Busy → queued after current run; idle → starts a turn. Same semantics both hosts (verified signatures). No custom-message renderers (asymmetric between hosts).
- **Skill injection**: manifest `skills` entry (both hosts) + `resources_discover` handler as a pi-only bonus. Never the only path.
- **Entry imports**: type-only `ExtensionAPI` from `@earendil-works/pi-coding-agent`, runtime schemas from `@sinclair/typebox`. Both are rewritten by both hosts. Zero host-conditional code in the entry.

## 2. Target architecture

```
                    ┌──────────────────────────────┐
                    │ packages/extension (plugin)  │
                    │  pi.extensions → dist/index  │
                    │  pi.skills → skills/tasks/   │
                    │  spawns dist/tk-watch (child)│
                    └──────────────┬───────────────┘
                                   │ imports (bundled at build)
┌──────────────┐          ┌────────▼─────────┐
│ packages/cli │  uses    │ @tasks/surface   │
│ tk (thin)    │─────────►│  operations/     │  ← moved CommandService logic,
└──────────────┘          │  watch/          │    de-argified (JSON inputs)
                          └────────┬─────────┘
                                   │ (unchanged hexagonal core)
              ┌────────────────────┼─────────────────────┐
        @tasks/workspace   @tasks/application   @tasks/domain
              └──── file / sqlite / postgres / beads ────┘
```

### 2.1 `packages/surface` — `@tasks/surface` (new)

Why: today every tk operation exists exactly once — inside `CommandService`, bound to CLI arg parsing (`ParsedArgs` in). The extension cannot reuse that without shelling out to `tk`. Extracting the operation bodies into a typed surface keeps **one** implementation, keeps the CLI byte-identical, and gives the extension a real API. It also removes match-day's current hack of deep-importing `tasks/packages/file/src/index.ts`.

```
packages/surface/src/
  index.ts        public exports (createSurface, watch, types)
  surface.ts      createSurface({root?, actor?, readonly?}): discovery + openStorage + operations
  envelope.ts     Result<T, SurfaceError> → {ok,error:{kind,message}} wire mapping; issueWire moved here
  operations/     de-argified CommandService bodies, one module per family:
    create.ts       create, quick (id allocation, idLength policy)
    query.ts        show, list, ready(+claim), blocked, search, query, stale, orphans
    mutate.ts       update/close/reopen/defer/label/set-state patch building, claimReady
    deps.ts         dep add/remove/list/relate
    comments.ts     comment, comments, note
    views.ts        count, status, stats, tree, graph, epic, children, lint, duplicates
    admin.ts        init/where/doctor/backup/rename/rename-prefix/import/migrate wrappers
  watch/
    protocol.ts     WatchEvent envelope + subscription options types
    core.ts         polling engine: watermark state machine, diff → events, coalescing
    backends.ts     watermark readers per backend (see §3)
    child.ts        runWatchChild(argv): NDJSON-on-stdio loop (shared by `tk watch` + extension)
```

- Operations take **plain JSON-serializable inputs** (never `ParsedArgs`), return wire JSON identical to today's `tk --json` payloads (moved `issueWire`/`treeNodeWire` producers; presentation formatters stay in cli).
- Errors: reuse repo `Result`; `SurfaceError.kind ∈ validation|not_found|conflict|readonly|runtime` — same vocabulary as today's `JsonError`.
- Does **not** route through `application/use-cases` (they cover only 7 of ~40 ops and are unused by the CLI today). Surface *is* the relocated application service; consolidating use-cases is explicitly out of scope to avoid a second competing convention.

### 2.5 Interface integration — the widget bubble

Copied from pi-herdr-subagents (`pi-extension/subagents/index.ts:722-871`), whose component factory shape omp's own extensions also use (`setWidget("autoresearch", (tui, theme) => component)`):

- **Surface**: `ctx.ui.setWidget("tasks-watch", factory, { placement: "aboveEditor" })` where factory returns `{ invalidate() {}, render(width): string[] }` (pi-tui `Component`). Removed with `setWidget("tasks-watch", undefined)`. Guarded by `ctx.hasUI`; ctx captured into a `latestCtx` slot on `session_start`.
- **Rendering**: bordered box copied verbatim in shape — `╭─ Tasks Watch ── info ─╮` header, `│left          right│` per-watcher rows, `╰────────────╯` bottom. Width math via `truncateToWidth`/`visibleWidth` from pi-tui (both hosts bundle them). Accents: blue RGB (77;163;255) while watchers idle, amber RGB (214;158;46) when events are pending delivery, `\x1b[0m` resets.
- **Rows**: one per running watcher — left: ` 00:12  <root-basename> · <kind-summary> `, right: ` seq <N> · last <issueId> `; header info: `<n> watching · seq <N>`.
- **Refresh**: 1s tick re-renders only while ≥1 watcher exists; timer = `ctx.setInterval` when the host exposes managed timers (omp — crash-contained), raw `setInterval` fallback on pi (no managed timers on its API), both cleared when the last watcher stops and on `session_shutdown`.


### 2.2 `packages/cli` — slimmed

Why: after extraction, tk.ts keeps only what is CLI-specific; operation logic leaves.

- `tk.ts`: `CommandService` replaced by `createSurface()` calls; dispatch chain keeps producing `{value, human}`; `args.ts`, `presentation.ts`, `tree.ts`, `hunk.ts`, `git.ts` unchanged. `--json` bytes identical (surface returns the same wire objects).
- New: `tk watch` command (see §3) — parses flags, delegates to `watch/child.ts` runner.
- `tk.test.ts` survives by construction: tests exercise the CLI surface; behavior-preserving refactor, no test edits expected.

### 2.3 `packages/extension` — the plugin (new)

Why this shape: mirrors the proven match-day layout (manifest + skills sibling + shared lib) but kills its fragility: instead of `file:` deps that break on install-by-copy, the extension **bundles** `@tasks/surface` at build time into dependency-free artifacts.

```
packages/extension/
  package.json        pi + omp manifest keys; scripts.build; no runtime deps
  src/
    index.ts          default factory: registerTool × N, registerCommand, resources_discover (pi bonus)
    tools.ts          tool definitions (TypeBox schemas) → surface calls
    watch-tools.ts    tasks_watch_start/stop/status
    notify.ts         child-process mgmt + NDJSON parse + dedupe/coalesce + sendUserMessage
    host.ts           capability probe (hasUI, isIdle) — never host-sniffing by user agent
  skills/tasks/SKILL.md   tools-first guidance, CLI fallback (replaces shell-only usage)
  dist/               committed bundles: index.js, tk-watch.js (bun build --target bun,
                      external @earendil-works/*, @oh-my-pi/*, @sinclair/typebox)
```

Tools (complete surface coverage without 40-tool noise):

| Tool | Ops |
|---|---|
| `tasks` | one tool, `op` enum (create, quick, show, list, ready, update, close, comment, dep, …) + `params` object validated per-op by surface schemas |
| `tasks_watch_start` | spawn `tk-watch` child (kinds/ids/labels/interval filters); persists config via `appendEntry("tasks.watch.config", …)` for restore on `session_start` |
| `tasks_watch_stop` / `tasks_watch_status` | stop one/all watchers; report seq watermark + last events |

Watch notification flow: child stdout NDJSON → notify.ts parses → per-subscription filters → coalesce ≤1s window → `pi.sendUserMessage(text, {deliverAs: "followUp"})` → main agent gets a turn with the event summary. Dedupe by monotonic `seq` per watcher. On `session_shutdown` children are killed (they also self-exit when stdin closes — parent death = EOF = exit 0).

### 2.4 What does NOT change

`@tasks/domain`, `@tasks/application` ports, `@tasks/workspace`, all three storage adapters, `@tasks/beads`, `presentation.ts` formatters, repo `.agents/skills/tasks` (CLI-oriented, stays for tk-only repos).

## 3. Watcher design (principal feature)

### Event envelope (`watch/protocol.ts`)

```ts
interface WatchEvent {
  readonly seq: number;              // per-watcher monotonic
  readonly kind: "issue.created" | "issue.updated" | "issue.status_changed"
               | "issue.commented" | "issue.deleted" | "ready.changed";
  readonly at: string;               // ISO-8601
  readonly issueId?: string;
  readonly data?: { from?: string; to?: string; actor?: string | null };
}
```

Subscription options (spawn args + tool params): `--kinds <list>`, `--ids <list>`, `--label <l>`, `--interval <ms>` (default 2000), `--json` (NDJSON stdout, always on in child mode).

### Change detection per backend (watermark + diff, one poll loop)

| Backend | Primary mechanism | Evidence | Fallback |
|---|---|---|---|
| file | scan `.tasks/history/*.jsonl`: per-file line count + readdir for new ids; new lines → events (action field distinguishes created/updated/comment) | `FileAdapter.save` appends history on every mutation (`file/src/index.ts:308-322`) | issues-dir mtime scan |
| sqlite | `SELECT MAX(id) FROM issue_history` watermark; rows `WHERE id > ?` carry issue_id/action/at/actor/data | `issue_history` AUTOINCREMENT (`sqlite/src/index.ts:34`) | `updated_at` poll |
| postgres | audit is a stub (`history()` returns `[]`) → poll `SELECT id, updated_at FROM issues` and diff per-id timestamps; status/label diff via targeted re-read | `postgres/src/index.ts:44` | LISTEN/NOTIFY via new trigger — **future**, needs migration |

`ready.changed`: each tick recomputes the ready set from the same data and emits on set-difference. Cheap for file/sqlite; guarded by interval.

Why polling as the base: it is the only mechanism that works uniformly across all three backends through the existing `UnitOfWork` port without schema changes; per-backend watermark readers make it incremental, not list-the-world.

### Failure modes

| Failure | Handling |
|---|---|
| Watcher child crash | parent sees stdout close/exit≠0 → `tasks_watch_status` reports `crashed`; restart is explicit (tool call); child exit codes: 0 = clean EOF, 2 = workspace missing, 3 = backend error |
| Backend down | poll errors counted; 3 consecutive → child emits one `error` line and exits 3 (no silent spin) |
| Slow poll / large diff | diff capped at 200 events/tick; overflow collapses into one `issue.updated` summary event per issue |
| Notification storm | coalesce window (1s) + max 1 steer per 5s per watcher; overflow delivered as digest on next idle turn |
| Concurrent writers | watermarks are monotonic read-only queries; no locks taken; events may arrive slightly late, never duplicated (seq) |
| Clock skew | ordering by seq/watermark, never by timestamps; `at` is informational |

## 4. Implementation slices (each compiles + tests green independently)

1. **S1 — extract `@tasks/surface`**: new package; move `CommandService` bodies into `operations/*` (de-argified); move `issueWire`/`treeNodeWire` into `envelope.ts` (cli re-imports); `tk.ts` delegates to surface *without* behavior change. Files: `packages/surface/**` new; `packages/cli/src/tk.ts`, `packages/cli/src/presentation.ts` (export shims), root `package.json` (workspace glob already covers). Delete nothing yet.
2. **S2 — cutover + delete**: tk.ts dispatch calls surface directly; remove `CommandService`, unused imports; tk.test.ts green unchanged.
3. **S3 — watch core**: `watch/{protocol,backends,core,child}.ts` + `tk watch` CLI command + unit tests with temp workspaces (file + sqlite backends; postgres behind integration guard).
4. **S4 — extension package**: manifest, bundled entry, tools, notify, skills, build script, committed `dist/`.
5. **S5 — verification + docs**: omp smoke (`omp -e packages/extension` or plugin link), pi smoke (`pi install ./packages/extension`), watcher e2e (spawn watcher → `tk create` from another process → observe steered notification), README architecture table + extension install section.

## 5. Risks

- **tk --json byte drift**: mitigated — surface returns the same wire producers; tk.test.ts (33.8KB, CLI end-to-end) is the gate.
- **Untested surface ops regress in S1 move**: mechanical move of bodies; diff review per operation; no logic edits in S1/S2.
- **omp `sendUserMessage` idle+followUp semantics**: verified "queue after current run"; idle-start-turn verified for no-deliverAs. S5 smoke includes idle and busy notification cases; fallback shape (`triggerTurn` on `sendMessage`) documented in notify.ts.
- **Install-by-dir without network**: bundles committed, zero runtime deps — `pi install ./packages/extension` runs offline.
- **Repo has uncommitted WIP** (12 files incl. tk.ts): refactor lands on top; S1 must rebase on the WIP state as-is, no stashing.

## 6. Checkpoint questions

1. Approve architecture (surface extraction + extension package + watcher child)?
2. Extension package inside this repo (`packages/extension`) vs separate repo?
3. Handle uncommitted WIP: proceed on top as-is vs user commits first?
4. Watcher default: auto-start a watcher on session_start (restore persisted config) vs explicit start only?
