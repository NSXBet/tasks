---
title: "Integrations"
order: 7
---
# External Integrations

**Analysis Date:** 2026-10-17

## APIs & External Services

**GitHub Releases API (self-update):**
- Used for `tk update` / `tk update --latest`: lists releases, resolves stable vs rolling `nightly` channel, downloads the binary asset, verifies sha256 against the release's `checksums.txt`, then atomically swaps the executable.
  - Client: plain `fetch` with `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` headers — `packages/cli/src/update.ts` (`RELEASES_API = https://api.github.com/repos/NSXBet/tasks/releases`).
  - Auth: unauthenticated (public repo).
  - Homebrew installs route around this: shells out to `brew upgrade nsxbet/tap/tasks` (legacy tap rejected with migration instructions).

**S3-compatible object storage (attachments):**
- Blob backend for issue attachments; any S3-compatible endpoint explicitly supported (e.g. Cloudflare R2 `<account-id>.r2.cloudflarestorage.com`).
  - Client: `Bun.S3Client` (Bun built-in — no AWS SDK dependency). Implementation: `packages/s3/src/index.ts`.
  - Auth: explicit keys/endpoint/sessionToken via `.tasks/config.json` `attachments.s3`, OR shared-credentials profile via the **AWS CLI**: `aws configure get <key> --profile <p>` spawned synchronously (`Bun.spawnSync`). No env-var credentials in code.
  - Object prefix defaults to `tk-attachments` (`packages/s3/src/index.ts`).

**beads task tracker (migration source):**
- One-time import from beads workspaces. The `bd` CLI is spawned (`Bun.spawn` with piped stdout/stderr) or its `issues.jsonl` is read directly from disk; output is converted to tk issues via wire converters in `packages/domain/src/issue.ts` (`issueFromBdWire`, `agentFromBdWire`, `runFromBdWire`).
  - Implementation: `packages/beads/src/export.ts` (`ProcessRunner` interface injected for testability); JSONL resolution + CLI fallback in `packages/beads/src/workspace.ts`; invoked from CLI via `resolveBeadsJsonl` in `packages/cli/src/tk.ts`.

**GitHub CLI (`gh`, PR sidecar):**
- Used only by the explicit `tk pr create|sync|close|merge` verbs (Phase 11): `gh pr create --head <branch> --base <default> --title=… --body=…`, `gh pr list --head <branch> --state open --json number,url,state --limit 1`, `gh pr view <n|url> --json number,url,state`, `gh pr close <n>` and `gh pr merge <n> --merge|--squash|--rebase` (never `--admin`, never `--delete-branch`). No background or timed calls; `tk finish`, `tk changes` and `tk pr <id>` read the recorded mirror only. gh is the remote truth: tk records what `gh pr view` returns.
  - Implementation: `packages/surface/src/gh.ts` is the single gh module, over the `@tasks/git` `ProcessRunner` (argv arrays, never a shell). `TK_GH` overrides the binary (default `gh` on PATH).
  - Auth: run `gh auth login` once; tk uses gh's own login and never reads `GH_TOKEN`/`GITHUB_TOKEN`.
  - Errors: a missing binary (exit 127, or a `TK_GH` path that does not exist) prints `gh not found — install GitHub CLI (https://cli.github.com) or set TK_GH`; a non-zero exit prints `gh <subcommand> failed: <first stderr line>` (control characters stripped); an unparseable or invalid payload prints `gh returned an unexpected PR payload`. Nothing is written on failure.

**git CLI:**
- Used for worktree-based issue workspaces, changeset derivation, branch detection, and git hooks: `git worktree add/remove/list`, `merge-base`, `diff`/`log`, `config` (get/set/unset), `check-ignore`, `ls-files`, `add`.
  - Implementation: all git access goes through `@tasks/git` (`packages/git`). `packages/git/src/runner.ts` is the single spawn module: the async `bunRunner` (Bun.spawn under Bun; falls back to `nodeRunner`/`child_process` under node, so workspace discovery works in the pi host) and the synchronous `spawnSyncRunner` used by git hooks. `commands.ts` (async) and `sync.ts` (hook-context sync) hold the enumerated git commands; `porcelain.ts` parses git output; `resolver.ts` decides worktree placement. Every command takes an injectable runner and passes argv arrays (never a shell).
  - Auth: inherited from ambient git credentials; tk never handles them.

**Homebrew:**
- Update/install channel when the binary lives under a `Cellar/` path. `brewFormulaFromExecPath` extracts the formula; `brewUpgradeCommand` builds `brew upgrade <formula>` — `packages/cli/src/update.ts`.

**Agent hosts (pi / omp) — extension embedding:**
- `tk` ships as an agent extension loaded by two hosts: pi (`@earendil-works/pi-coding-agent`, types imported as a virtual host-provided module — not an npm dep) and omp (Bun). Registered via `pi.extensions` / `omp.extensions` in root and `packages/pi-extention/package.json`.
  - Implementation: `packages/pi-extention/src/index.ts` exposes the full tk surface as typed LLM tools (schemas via `typebox`), plus a workspace watcher that notifies the live session (`packages/pi-extention/src/watch-manager.ts`) and a status widget (`packages/pi-extention/src/widget.ts`).
- **The extension reads the event log.** Everything below tails `.tasks/events.jsonl` in-process; no daemon is required. `TK_EVENTS=daemon` remains an optional transport for `tasks_watch_start` only (the daemon tails the same log). The extension never appends to the log; it only writes its own cursor in `.tasks/cursors.json`.
- **Inbox (automatic, no tool call)** — `packages/pi-extention/src/inbox.ts`. On `session_start` inside a tasks workspace the extension starts an inbox for the session. The session id is `TK_SESSION`, else `PI_SESSION_ID`, else `pi-<pid>`, and the inbox's cursor is `pi:<session>`.
  - Followed tasks: ids touched through the `tasks` tool (`id` / `ids`), `tasks_watch_start` `ids` and `tasks_wait` `ids`; tasks whose `metadata.worktree` contains the session cwd (also picked up from new `task.worktree` lines); tasks whose `metadata.agent_session` is the session id (also from new finish `task.status` lines).
  - Own-session filtering: a line whose envelope `session` equals the session id is never echoed back.
  - What arrives, as one `followUp` message per task (bursts coalesced per task within 250 ms), with the next command:

    | event | message |
    |---|---|
    | review batch sent (`task.comment`, `to: sent`) | `📝 <n> review comment(s) sent on <id>`, one line per card `[<cid>] <location> — <author>: <body>`, then `next: address them, then tk comments resolve <id> <cid>` |
    | plain comment from someone else | `💬 <author> on <id>: <body>` + `next: tk work <id>` |
    | status → `approved` | `✅ <id> approved — next: tk close <id>` |
    | status → `rejected` | `↩ <id> rejected — next: tk work <id>` |
    | PR change (`task.pr`, from another session) | `🔀 PR #<n> on <id> — <state> (<url>)`, plus `next: tk close <id>` when merged |

    PR and verdict messages end with the task's stat card line (`Changes · <id>  N commits · +A −D · F files  → <web>/tasks/<id>/diff · tk review <id>`) from `TasksSurface.changes(id)` — the `resolveChanges` ladder, so a worktree out of reach shows the report/snapshot counts with the stale pill. A failed or empty card leaves the message unchanged; the drain brief stays card-free. Never a diff.

    Other review moves (resolve, dismiss, reopen) and other status moves stay silent. Every user-authored field has ANSI escapes and C0/C1 control characters stripped.
  - Session-start drain brief: when the session already has a cursor, the gap past it is drained and, if anything matched, one message headed `📬 while you were away` lists it (same formats), then the cursor sits at the log end. A first-ever session seeds its cursor at the log end and sends no brief (no full-history dump).
  - `TK_INBOX=off` disables the inbox.
- **`tasks_wait` tool** — blocks like `tk watch --until` through the shared `waitUntil` (@tasks/surface). Parameters: `query` (the `tk watch` grammar, e.g. `status=approved|rejected` or `type=task.comment`), optional `ids` (ANDed as `task=`), optional `timeoutMs` (default 30 min, max 2 h). It reads from the session cursor `pi:<session>` (seeded at the log end on first use, so history never matches) and returns `{"matched":true,"event":…}` or `{"matched":false,"timedOut":true}`; an invalid query returns an error result carrying the parser message. Many agents can wait at once, each on its own cursor; a status query on named tasks returns at once when a task is already in that status.
- **`tasks_watch_start`** tails the log for arbitrary kinds (`task.created`, `task.status`, `task.comment`, `task.owner`, `task.update`, `task.evidence`, `task.worktree`, `task.pr`, `task.report`, `task.deleted`, `run.changed`; legacy `issue.*` / `ready.changed` / `counts.changed` names are accepted as aliases) and posts one formatted line per event. `task.pr` posts `🔀 tasks: PR #<n> for <id> — <state> (<url>)`; `task.report` posts the stat card `📊 tasks: Changes · <id>  N commits · +A −D · F files  → <web>/tasks/<id>/diff · tk review <id>`, built from the event data alone (no git, no store read; the web base is resolved once at `session_start`).
- **`tasks` tool `changes` op** — `changes(id)` returns the counts-only `ChangesView` (`{id, source, stale, at, stat{commits,files,additions,deletions}, links{tui,web}}`, or null when no changes are recorded) via `TasksSurface.changes` — never a diff.

**Harness detection at `tk finish`:**
- `tk finish` records which agent harness finished the task as `metadata.agent_harness`. Precedence: `--harness` > `TK_HARNESS` > detected from the session env below > `omp` (registry default). Detection is data: each entry in `HARNESS_REGISTRY` (`packages/domain/src/review-record.ts`) lists its env vars, and `detectHarness` checks them in registry order (a non-default match beats omp in nested shells; empty values do not count).

| harness | detected by env var(s) |
|---|---|
| omp | `PI_SESSION_ID` |
| codex | `CODEX_THREAD_ID` |
| cursor | `CURSOR_CONVERSATION_ID` / `CURSOR_AGENT` |

**tmux (test-only):**
- pty E2E harness for the TUI: `packages/tui/test/smoke.ts` launches the real `tk-tui` binary inside a tmux session (tmux answers OpenTUI's terminal-capability queries that a bare pty would not).

**MCP clients (Claude Code / Cursor / Codex):**
- `tk mcp [--root <path>]` is the stdio server MCP clients launch. It is a dumb bridge to the `tkd` daemon (which speaks MCP, see `rpc.md`, "MCP on the daemon"): it connects to or spawns the daemon, sends `transport.bind { root }`, then pipes stdin/stdout line for line. Stdout carries only MCP lines; diagnostics go to stderr; stdin EOF exits 0. The root resolves from `--root`, then `-C`, then `CLAUDE_PROJECT_DIR` (Claude Code sets it for stdio servers), then the workspace enclosing the cwd; no workspace exits 1.
- Claude Code: `claude mcp add tasks -- tk mcp`, or `.mcp.json`:

  ```json
  { "mcpServers": { "tasks": { "command": "tk", "args": ["mcp"] } } }
  ```

- Cursor (`.cursor/mcp.json`) uses the same shape: `{ "mcpServers": { "tasks": { "command": "tk", "args": ["mcp"] } } }`.
- Codex (`~/.codex/config.toml`): `[mcp_servers.tasks]` with `command = "tk"` and `args = ["mcp"]`.
- Claude Code caps MCP tool output at 25k tokens by default (`MAX_MCP_OUTPUT_TOKENS`); call list-style tools (`issue_list`, `issue_query`, ...) with limits.

## Data Storage

**Databases (pluggable storage backends, selected by `.tasks/config.json` `storage.backend`):**
- `file` (default) — git-committable JSON per issue under `.tasks/`; adapter `packages/file/src/index.ts`. Backend switching never deletes old data; `tk switch-backend` copies first, flips config second.
- `sqlite` — `bun:sqlite` preferred, `node:sqlite` (`DatabaseSync`) fallback for Node hosts; runtime-selected at load in `packages/sqlite/src/index.ts`. Schema managed by checksummed migration steps (`sha256` of SQL, `schema_migrations` table).
- `postgres` — `pg` `Pool`; adapter + checksummed migrations in `packages/postgres/src/index.ts`.
  - Connection: env-var indirection by default — `TASKS_DATABASE_URL` (overridable via `storage.urlEnv`), literal `storage.url` fallback is discouraged. Redaction applied before display (`redactUrl` in `packages/workspace/src/storage.ts`).
  - Lazy loading: `packages/workspace/src/storage.ts` imports backend packages dynamically, so `file` workspaces never pull `pg` or `bun:sqlite`.

**File Storage (blobs/attachments):**
- Selection in `packages/workspace/src/attachments.ts` (`openBlobStore`, `attachments.store` key, default `fs`):
  - `fs` (default) — `.tasks/attachments/<id>-<slug>.<ext>` + `<id>.json` sidecar (`FsBlobStore`); can idempotently mark the directory as Git LFS-tracked in the repo-root `.gitattributes` (`LFS_BLOCK`, opt-out via `lfs: false`).
  - `s3` — lazy `import('@tasks/s3')`.
  - `postgres` — lazy `import('@tasks/postgres/blob')`, shares the storage database.

**Caching:**
- None. Watch polling is diff-based per tick, not cached (`packages/surface/src/watch/core.ts`, `DEFAULT_POLL_INTERVAL_MS = 2000`).

## Authentication & Identity

**Auth Provider:**
- None (local-first tool). All access is local filesystem/process level; the web server binds a local port with single-instance enforcement via an on-disk runtime registry (`packages/surface/src/runtime.ts`: `registerRuntime`, `heartbeatRuntime`, `resolveWebPort`).

## Monitoring & Observability

**Error Tracking:**
- None.

**Logs:**
- Plain `process.stdout`/`process.stderr` writes; the watch channel is an NDJSON stdout protocol (`WatchFrame`: `ready` / `event` / `error` — `packages/surface/src/watch/protocol.ts`). Diagnostics via `tk doctor`, not telemetry.

## CI/CD & Deployment

**Hosting:**
- GitHub Releases (binary artifacts). No server hosting; `tk web` is run locally by users.

**CI Pipeline:**
- GitHub Actions, three workflows in `.github/workflows/`:
  - `build-binaries.yml` — reusable `workflow_call`: installs Bun 1.3.14 via `nsx-actions/oven-sh_setup-bun@v2` (org mirror of the official action), retries `bun install --frozen-lockfile` up to 8× (npm proxy `fbr.land` burst-limits), runs `bun run build` serially (concurrent per-package builds race on shared `dist/`), runs `bun test packages/*/test/*.test.ts`, compiles 4 single-file targets with `--define "TK_BUILD_REF=..."`, smoke-tests the linux-x64 binary, uploads a `dist` artifact with `checksums.txt`.
  - `release.yml` — on `v*.*.*` tags: builds, extracts the matching `CHANGELOG.md` section (refuses to publish without notes), creates the GitHub Release via `nsx-actions/softprops_action-gh-release@v2`.
  - `nightly.yml` — on pushes to `main`: rebuilds and force-replaces the rolling `nightly` pre-release via `gh release`.

## Environment Configuration

**Required env vars:**
- `TASKS_DATABASE_URL` — only for postgres backend (env-indirected; set per workspace via `storage.urlEnv` override). Never required for the default file backend.
- `TK_WEB_PORT` — optional web port override (`packages/web/src/main.ts`; precedence: `--port` flag > `TK_WEB_PORT` > `config.json` `webPort` > `WEB_DEFAULT_PORT`).
- `TK_BUILD_REF` — not set by users; baked at compile time by CI.

**Secrets location:**
- No committed secrets. Postgres URL stays in the environment (config indirection is deliberate — `tk init` has no `--url` flag by design). S3 credentials come from `attachments.s3` config keys or `aws configure` profiles. No `.env` files exist in the repo.

## Agent injection — the workflow contract

Every agent working in a tk repo gets the same contract, from whichever surface it loads:

> Work in `tk work <id>` and commit there; finish with `tk finish <id> --session <sid>`; never mark done — the recorded worktree, branch, and derived diff are the evidence; wait for the verdict with `tk watch <id> --until "status=approved|rejected"`; review with `tk review <id>` and `tk comments <id>`.

The surfaces also carry one lifecycle line: `tk close` prunes the task's worktree and `tk/<id>` branch when merged and clean (a refusal is a note; the close still succeeds), and `tk worktree clean` lists leftovers (`--yes` removes them).

| Surface | How it reaches the agent |
|---|---|
| Instruction file (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) | `tk onboard install` writes a managed block |
| Session context | `tk prime`, injected at SessionStart by the agent hooks |
| Skill | `tk skill` / `tk skill install`; the pi extension bundles its own copy |

**`tk onboard`.** Bare `tk onboard` prints the block. `tk onboard install` writes it into `AGENTS.md`; `--file <path>` targets another instruction file, and `--tool claude|gemini` picks that agent's default filename (`CLAUDE.md`, `GEMINI.md`). The block sits between versioned, hash-stamped markers, `<!-- BEGIN TK INTEGRATION v:1 hash:<8hex> -->` … `<!-- END TK INTEGRATION -->`. The hash is the first 8 hex characters of the sha256 of the body. Only that span is tk-owned; text outside the markers survives install and remove byte-for-byte. Install into a file that is already current is a byte-identical no-op. `tk onboard check` exits 0 only when the block is present and current, and reports `installed but stale` otherwise. `tk onboard remove` strips only the managed span. The body has one source, `packages/cli/templates/agents/tk-section.md`. Never hand-edit inside the markers, or the hash goes stale; edit the template and re-run `tk onboard install`.

**`tk prime` at SessionStart.** `tk setup codex|cursor` installs agent lifecycle hooks (`tk codex-hook`, `tk cursor-hook`). At SessionStart they run `tk prime` and inject its output as additional context. After a compaction, a one-shot marker makes the next prompt or tool call re-inject it.

**Skill.** `tk skill` prints `packages/cli/skills/tasks/SKILL.md`; `tk skill install [--tool claude|omp|pi|codex] [--global] [--force]` copies it into a skills root (`.agents/skills` by default). This repo's `.agents/skills/tasks/SKILL.md` is such a copy. The pi extension ships `packages/pi-extention/skills/tasks/SKILL.md`. It matches the CLI skill except for step 5's wait paragraph, which names the `tasks_wait` tool and the inbox instead of shell `tk watch`.

**Drift guard.** `packages/cli/test/contract.test.ts` checks every surface:

- `tk onboard install` in a fresh `git init` repo writes the block, and a second install leaves it unchanged.
- `tk prime` output, the template, all three SKILL.md copies, and the root `AGENTS.md` contain every contract clause, and share the bold contract line where they carry one.
- The project skill copy is byte-identical to the CLI skill, and the pi copy differs only in the wait paragraph.
- `tk onboard check` passes at the repo root.
- No surface mentions the removed `tk hunk` command.

If you change the contract text, update the template, `PRIME` in `packages/cli/src/presentation.ts`, and both shipped SKILL.md copies together. Then run `tk skill install --force` and `tk onboard install` at the repo root.

## Webhooks & Callbacks

**Incoming:**
- None.

**Outgoing:**
- None. Change notification is pull-based: `tk watch` emits `WatchEvent`s over NDJSON stdout (poll loop with per-watcher monotonic `seq`, 250 ms floor), and due `defer_until` issues fire queued agent runs inside the watch tick (`processWakeups` in `packages/surface/src/watch/wakeups.ts`).

---

*Integration audit: 2026-10-17*
