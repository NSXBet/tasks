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

**git CLI:**
- Used for worktree-based issue workspaces and branch detection: `git worktree add/remove`, `merge-base`, branch listing.
  - Implementation: `packages/cli/src/git.ts` and `packages/surface/src/git.ts` (both inject a `ProcessRunner`; `nodeRunner` spawns real `git`).
  - Auth: inherited from ambient git credentials; tk never handles them.

**Homebrew:**
- Update/install channel when the binary lives under a `Cellar/` path. `brewFormulaFromExecPath` extracts the formula; `brewUpgradeCommand` builds `brew upgrade <formula>` — `packages/cli/src/update.ts`.

**Agent hosts (pi / omp) — extension embedding:**
- `tk` ships as an agent extension loaded by two hosts: pi (`@earendil-works/pi-coding-agent`, types imported as a virtual host-provided module — not an npm dep) and omp (Bun). Registered via `pi.extensions` / `omp.extensions` in root and `packages/pi-extention/package.json`.
  - Implementation: `packages/pi-extention/src/index.ts` exposes the full tk surface as typed LLM tools (schemas via `typebox`), plus a workspace watcher that notifies the live session (`packages/pi-extention/src/watch-manager.ts`) and a status widget (`packages/pi-extention/src/widget.ts`).

**tmux (test-only):**
- pty E2E harness for the TUI: `packages/tui/test/smoke.ts` launches the real `tk-tui` binary inside a tmux session (tmux answers OpenTUI's terminal-capability queries that a bare pty would not).

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

## Webhooks & Callbacks

**Incoming:**
- None.

**Outgoing:**
- None. Change notification is pull-based: `tk watch` emits `WatchEvent`s over NDJSON stdout (poll loop with per-watcher monotonic `seq`, 250 ms floor), and due `defer_until` issues fire queued agent runs inside the watch tick (`processWakeups` in `packages/surface/src/watch/wakeups.ts`).

---

*Integration audit: 2026-10-17*
