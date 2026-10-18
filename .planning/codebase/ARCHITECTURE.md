---
last_mapped_commit: fac7670c14c0ab1eb2bde4342d36fbbffc44167b
last_mapped_at: 2026-10-17
---
# Architecture

**Analysis Date:** 2026-10-17

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                          Presentation Layer                              │
├──────────────┬───────────────┬─────────────────┬────────────────────────┤
│   tk CLI     │   tk-tui      │    tk web       │  pi/omp extension      │
│  (Bun bin)   │ (OpenTUI+     │  (Bun HTTP +    │  (tool registration    │
│ `packages/   │  React 19)    │  JSON API +     │   for coding-agent     │
│  cli/src/    │ `packages/    │  SPA shell      │   hosts)               │
│  tk.ts`      │  tui/src/     │ `packages/web/  │ `packages/pi-extention │
│              │  main.tsx`    │  src/server.ts` │  /src/index.ts`        │
└──────┬───────┴───────┬───────┴────────┬────────┴──────────┬─────────────┘
       │               │                │                   │
       ▼               ▼                ▼                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     Service Facade Layer — TasksSurface                  │
│      `packages/surface/src/surface.ts` (`createSurface()` factory)       │
│   operations/{create,query,mutate,deps,comments,sprint,attachments,      │
│   views}.ts · discovery `discover.ts` · watch daemon `watch/`            │
│   runtime registry `runtime.ts` · wire envelope `envelope.ts`            │
└──────────────────────────────┬───────────────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    Backend Resolution Layer (workspace)                  │
│   `packages/workspace/src/storage.ts` `openStorage()` — reads            │
│   `.tasks/config.json`, lazily dynamic-imports the chosen adapter        │
└──────┬──────────────────┬──────────────────────┬────────────────────────┘
       ▼                  ▼                      ▼
┌──────────────┐  ┌───────────────┐  ┌───────────────────┐
│ file adapter │  │ sqlite adapter│  │ postgres adapter  │
│ JSONL files  │  │ bun:sqlite /  │  │ pg                │
│ `packages/   │  │ node:sqlite   │  │ `packages/        │
│  file/src/   │  │ `packages/    │  │  postgres/src/`   │
│  index.ts`   │  │  sqlite/src/  │  │                   │
└──────┬───────┘  └───────┬───────┘  └─────────┬─────────┘
       │                  │                    │
       └──────────────────┴────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────────────────┐
│              Ports + Result Layer (@tasks/application)                   │
│  `packages/application/src/ports/*.ts` (UnitOfWork, TransactionManager,  │
│  BlobStore, MigrationPort, Clock, IdGenerator, TimestampCodec)           │
│  `packages/application/src/result.ts` (ok/err) · `run-side-effects.ts`   │
└──────────────────────────────┬───────────────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        Domain Layer (@tasks/domain)                      │
│  `packages/domain/src/issue.ts` — zod schemas, branded IDs,              │
│  Issue/Sprint/Agent/Run, beads wire codecs, status transition policy     │
└──────────────────────────────────────────────────────────────────────────┘
```

Side actors:

- **Blobs/attachments** flow through `BlobStore` ports: fs (`packages/workspace/src/attachments.ts` `FsBlobStore`), S3 (`packages/s3/src/index.ts`), or in-postgres (`packages/postgres/src/blob.ts`).
- **beads interop** (`packages/beads/src/index.ts`) migrates legacy beads `.beads/*.jsonl` workspaces into tasks storage (`migrateBeadsJsonl`) and powers workspace discovery (`searchPath`).

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| `@tasks/domain` | Pure model: zod schemas, branded IDs (`IssueIdSchema`, `SprintIdSchema`), Issue/Sprint/Agent/Run shapes, beads (`BdWire*`) wire codecs, `StatusTransitionPolicy`, `WireTimestampCodec` | `packages/domain/src/issue.ts`, `packages/domain/src/index.ts` |
| `@tasks/application` | Hexagonal core: ports (UnitOfWork, TransactionManager, BlobStore, MigrationPort, Clock, IdGenerator, TimestampCodec, composition root), `Result` type, migration declarations, run side-effect codes | `packages/application/src/index.ts`, `packages/application/src/ports/`, `packages/application/src/result.ts` |
| `@tasks/workspace` | Workspace config (`.tasks/config.json`), backend resolution with lazy imports, blob-store opening (fs/s3/postgres), attachment ingest | `packages/workspace/src/config.ts`, `packages/workspace/src/storage.ts`, `packages/workspace/src/attachments.ts` |
| `@tasks/file` | File backend adapter: JSONL persistence, `FileAdapter` implementing `UnitOfWork & MigrationPort`, beads-wire round-trip | `packages/file/src/index.ts` |
| `@tasks/sqlite` | SQLite backend adapter: schema + checksummed migrations (`001-initial`), driver swap `bun:sqlite` ↔ `node:sqlite` | `packages/sqlite/src/index.ts` |
| `@tasks/postgres` | Postgres backend adapter + in-DB blob store | `packages/postgres/src/index.ts`, `packages/postgres/src/blob.ts` |
| `@tasks/s3` | S3-compatible blob store adapter | `packages/s3/src/index.ts` |
| `@tasks/beads` | Beads JSONL compat: resolve/migrate/plan/record decode, workspace discovery, prefix inference | `packages/beads/src/index.ts`, `packages/beads/src/migrate.ts` |
| `@tasks/surface` | The single application service facade `TasksSurface`; workspace discovery; error classification; watch daemon; runtime registry; web runtime probing | `packages/surface/src/surface.ts`, `packages/surface/src/store.ts`, `packages/surface/src/discover.ts` |
| `@tasks/cli` | `tk` command-line entry, arg parsing, output presentation, hooks (agent hooks, JSON hooks), hunk review integration, updater | `packages/cli/src/tk.ts`, `packages/cli/src/presentation.ts`, `packages/cli/src/hooks.ts` |
| `@tasks/tui` | `tk-tui` terminal UI on OpenTUI/React 19; pure board model + graph algorithms in `store.ts`; panels in `app/` | `packages/tui/src/main.tsx`, `packages/tui/src/store.ts`, `packages/tui/src/app/App.tsx` |
| `@tasks/web` | `tk web` local web UI: Bun HTTP server, JSON API over the same surface, SPA shell, single-instance guard | `packages/web/src/main.ts`, `packages/web/src/server.ts`, `packages/web/src/app.html` |
| `pi-extention` | pi AND omp host extension: registers `tasks` tool, `tasks_ready`, watch tools, `/tasks` command, watch widget | `packages/pi-extention/src/index.ts` |
| `@tasks/terminal-image` | Terminal image rendering helper used by the TUI | `packages/terminal-image/src/index.ts` |

## Pattern Overview

**Overall:** Hexagonal (ports & adapters) with a single service facade consumed by four frontends, inside a Bun-workspace monorepo with TypeScript project references.

**Key Characteristics:**
- **One facade, four frontends.** CLI, TUI, web server, and the pi/omp extension all call `createSurface()` (`packages/surface/src/surface.ts`); no frontend touches an adapter directly.
- **Backends are pluggable and lazily loaded.** `.tasks/config.json` is the sole source of backend truth (`packages/workspace/src/config.ts:20` `StorageConfigSchema` discriminated union); `openStorage()` (`packages/workspace/src/storage.ts:66`) dynamic-imports `@tasks/file` / `@tasks/sqlite` / `@tasks/postgres`, so the default `file` backend never loads `pg` or `bun:sqlite`.
- **Domain purity.** `packages/domain` depends only on `zod`; adapters depend inward on `@tasks/application` ports; nothing in `domain`/`application` imports an adapter (verified import counts: `application` imports 13× from `@tasks/domain`, 0× from adapters).
- **Wire compatibility as a first-class concern.** Beads JSONL envelopes round-trip through `issueFromBdWire`/`issueToBdWire` codecs (`packages/domain/src/issue.ts`) and unknown fields are preserved (`wire_unknown_json` columns in `packages/sqlite/src/index.ts:32`).

## Layers

**Domain (innermost):**
- Purpose: entity schemas, branded ID types, wire codecs, status-transition policy.
- Location: `packages/domain/src/`
- Contains: `issue.ts` (single ~90-line module defining everything), barrel `index.ts`.
- Depends on: `zod` only.
- Used by: `application`, all adapters, `surface`.

**Application / Ports:**
- Purpose: define the persistence contract (`IssueUnitOfWork`, `UnitOfWork.withinTransaction`, `TransactionManager`), side-effect ports (`Clock`, `IdGenerator`, `TimestampCodec`, `BlobStore`, `MigrationPort`), and the `Result`/error vocabulary (`ValidationError`, `ConflictError`, `LifecycleError`, `RepositoryError`, `NotFoundError`, `MigrationError`).
- Location: `packages/application/src/` (`ports/`, `result.ts`, `run-side-effects.ts`, `run-codes.ts`).
- Depends on: `@tasks/domain`.
- Used by: every adapter + `surface`.

**Adapter:**
- Purpose: implement `UnitOfWork & MigrationPort` per storage backend.
- Location: `packages/file/src/index.ts` (JSONL), `packages/sqlite/src/index.ts`, `packages/postgres/src/index.ts`; blobs: `packages/workspace/src/attachments.ts`, `packages/s3/src/index.ts`, `packages/postgres/src/blob.ts`.
- Depends on: `@tasks/application`, `@tasks/domain`.
- Used by: `packages/workspace/src/storage.ts` (only, via dynamic import).

**Service facade:**
- Purpose: all business operations as one typed interface; transaction wrapping + error classification; workspace discovery; watch daemon; runtime registry.
- Location: `packages/surface/src/`.
- Depends on: `@tasks/application`, `@tasks/workspace`, `@tasks/beads` (discovery), `@tasks/domain`.
- Used by: `cli`, `tui`, `web`, `pi-extention`.

**Presentation:**
- Purpose: user-facing I/O. CLI dispatch + formatting; OpenTUI React app; Bun HTTP server + JSON API; agent-host tool registration.
- Location: `packages/cli/src/`, `packages/tui/src/`, `packages/web/src/`, `packages/pi-extention/src/`.
- Depends on: `@tasks/surface` (never adapters directly).
- Used by: end users / agent hosts.

## Data Flow

### Primary Request Path (CLI mutation)

1. `tk status tk-abc in-progress` — shebang entry, arg parsing, command dispatch (`packages/cli/src/tk.ts:1`).
2. `rootFrom(cwd)` — upward walk for `.tasks/`, falling back to the main git worktree (`packages/surface/src/discover.ts:11`).
3. `createSurface({ root })` → `openSurfaceStore` reads `.tasks/config.json`, resolves backend config, calls `openStorage()` (`packages/surface/src/store.ts:70`, `packages/workspace/src/storage.ts:66`).
4. Operation runs inside `SurfaceStoreImpl.transact()` → `adapter.withinTransaction(uow => ...)`; thrown errors are classified into `SurfaceError` kinds (`packages/surface/src/store.ts:38-64`, `packages/surface/src/errors.ts` `classifyMessage`).
5. Adapter persists (file: JSONL rewrite `packages/file/src/index.ts`; sqlite: SQL + audit row `packages/sqlite/src/index.ts`).
6. `Result` returns up the stack; `packages/cli/src/presentation.ts` formats for stdout, `run-codes.ts` governs process exit codes.

### TUI Board Path

1. `tk-tui` — parse `--image-size`/workspace args, `rootFrom(cwd)`, `openTuiStore(root)` → `createSurface` (`packages/tui/src/main.tsx:26-45`).
2. `loadBoard()` — `surface.all()` full page + `surface.sprintList()` → `buildBoard()` derives counts/ready/blocked once per refresh (`packages/tui/src/store.ts:30`, `packages/tui/src/store.ts:389`).
3. Watch loop polls every 1000 ms, compares `boardSignature()` (counts + length + max updatedAt) and fires `issue.updated` events (`packages/tui/src/store.ts:396-416`).
4. `App` receives the event → `refresh()` → `setBoard()`; all panels re-render from context (`packages/tui/src/app/App.tsx:84-91`).

### Watch Daemon Path (surface-owned)

1. `watch/core.ts` spawns `watch/child-entry.ts` as a child process; keeps per-issue `updatedAt` watermarks, a ready-set fingerprint, and counts snapshots (`packages/surface/src/watch/core.ts:32-44`).
2. Events are emitted with a monotonically increasing `seq` — ordering authority is `seq`, never timestamps (`packages/surface/src/watch/protocol.ts`).
3. Consumers: CLI `tk watch`, web SSE, pi/omp watch widget (`packages/pi-extention/src/watch-manager.ts`).

### Web Path

1. `tk web` → `packages/web/src/main.ts` resolves port (`TK_WEB_PORT` > workspace `webPort` > default), probes for a live instance (single-instance guard, `PortBusyError`), optionally daemonizes.
2. `startWebServer()` (`packages/web/src/server.ts`) serves `app.html` + JSON API built on the same `TasksSurface`.
3. Dev mode adds SSE live-reload of the shell.

**State Management:**
- Server-side state lives entirely in the storage backend; the process holds no entity caches beyond one open `SurfaceStore`.
- TUI state: single React `App` component owns all `useState` (board, view, selection, modal, composer, toast) and exposes it via `AppContext`/`useApp()` (`packages/tui/src/app/context.ts`); no external state library, no panel touches the store directly.
- Refresh model: full-page refetch + pure derived model (`buildBoard`), never incremental patches in the TUI.

## Key Abstractions

**`Result<T, E>`:**
- Purpose: uniform ok/err return; all surface and adapter fallible paths return it instead of throwing across API boundaries.
- Examples: `packages/application/src/result.ts`, used by `packages/surface/src/operations/*.ts`.
- Pattern: `ok(value)` / `err(error)`; `err` carries typed `SurfaceError` kinds (`validation` | `conflict` | `lifecycle` | `not_found` | `repository` | `runtime`).

**`IssueUnitOfWork` / `StorageAdapter`:**
- Purpose: one transactional persistence port every backend implements.
- Examples: `packages/application/src/ports/issue-repository.ts`, `packages/application/src/ports/transaction-manager.ts`; adapter union `StorageAdapter = UnitOfWork & MigrationPort` at `packages/workspace/src/storage.ts:7`.

**Zod-branded IDs:**
- Purpose: type-safe human-readable ids (`tk-abc123`) with brand marks, never DB UUIDs.
- Examples: `IssueIdSchema`, `SprintIdSchema`, `AgentIdSchema` in `packages/domain/src/issue.ts:1-10`.
- Pattern: `z.string().regex(...).brand<'IssueId'>()` plus `issueId(value)` parse helpers.

**Beads wire codecs:**
- Purpose: bidirectional mapping between internal entities and beads JSONL envelopes, preserving unknown fields.
- Examples: `issueFromBdWire`/`issueToBdWire`, `sprintFromBdWire`/`sprintToBdWire`, `agentFromBdWire`/`agentToBdWire`, `runFromBdWire`/`runToBdWire` (`packages/domain/src/issue.ts`).

**`TasksSurface` facade:**
- Purpose: the complete typed API (~50 methods: create/show/list/ready/blocked/search/query/stale/orphans/children/epic/update/status/defer/claim/assign/priority/label*/note/duplicate/supersede/closeMany/rename/delete/dep*/sprint*/attach/detach).
- Examples: `packages/surface/src/surface.ts:68-112`; operation implementations in `packages/surface/src/operations/`.

**Checksummed migrations:**
- Purpose: adapters declare immutable `MigrationStep`s (id, order, sha256 checksum of SQL); SQL runs only inside the adapter's migration transaction.
- Examples: `packages/application/src/ports/composition-root.ts` (`MigrationPort`), `packages/sqlite/src/index.ts:32` (`001-initial`).

## Entry Points

**`tk` CLI:**
- Location: `packages/cli/src/tk.ts` (bin `tk`; also exported as `tasks/cli` from root `package.json`).
- Triggers: terminal invocation; `bun run tk` script.
- Responsibilities: arg parsing (`packages/cli/src/args.ts`), command dispatch into the surface, presentation (`presentation.ts`), hooks, update checks (`update.ts`).

**`tk-tui` TUI:**
- Location: `packages/tui/src/main.tsx` (bin `tk-tui`).
- Triggers: terminal invocation; `bun run tk:tui`.
- Responsibilities: renderer lifecycle (`createCliRenderer` alternate-screen), global quit keys, store lifetime, mounting `<App>`.

**`tk web` web UI:**
- Location: `packages/web/src/main.ts` → `packages/web/src/server.ts`.
- Triggers: `tk web` CLI subcommand; flags `--dev`, `--open`, `--port`, `--random-port`, `--daemon`.
- Responsibilities: HTTP server, JSON API, single-instance guard, optional daemonization.

**pi/omp extension:**
- Location: `packages/pi-extention/src/index.ts` (referenced by root `package.json` `pi.extensions` and `omp.extensions`).
- Triggers: host agent startup (pi or omp).
- Responsibilities: register the `tasks` mega-tool (typebox schemas), `tasks_ready`, watch start/stop/status tools, `/tasks` command, above-editor watch widget.

## Architectural Constraints

- **Bun-first runtime:** root `package.json` `exports` map uses the `bun` condition to resolve TS sources directly (`./packages/domain/src/index.ts`) while `types`/`default` point at `dist/`; `packageManager: bun@1.3.14`. Node compatibility exists only where adapters swap drivers (`packages/sqlite/src/index.ts:1-16` picks `node:sqlite` under node hosts).
- **Backend selection is config-file-only:** no runtime `--backend` flag; `.tasks/config.json` is the single authority (`packages/workspace/src/config.ts:4-9`). Postgres URLs come from env vars (`urlEnv`, default `TASKS_DATABASE_URL`) and are redacted in all display paths (`packages/workspace/src/storage.ts:19-27`).
- **Strict TypeScript everywhere:** `verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`-era strict flags, composite project references (`tsconfig.json`). All intra-package imports use `.js` extensions; the exception is `packages/pi-extention/src/` which imports `.ts` paths (host-rewritten by pi/omp loaders).
- **Transaction scope:** every mutating surface operation runs inside `adapter.withinTransaction`; cross-backend transactions do not exist.
- **Ordering:** watch events are sequenced by `seq`; per-issue `updatedAt` watermarks drive change detection (`packages/surface/src/watch/core.ts`).
- **Package boundary rule:** `domain` and `application` must never import from adapters, `surface`, or frontends. Frontends must never import adapters — everything goes through `@tasks/surface`.

## Anti-Patterns

### Giant dispatch file in the CLI

**What happens:** All ~1148 lines of command parsing, validation, and dispatch live in `packages/cli/src/tk.ts`; formatters in `packages/cli/src/presentation.ts` (839 lines).
**Why it's wrong:** Every new subcommand grows the same file; merge conflicts and regression risk concentrate on the hottest file in the repo.
**Do this instead:** When adding a command, keep the `tk.ts` switch arm minimal (parse args → call one surface method → call one presentation formatter) and push any logic into `args.ts`/`presentation.ts` or the surface operations — follow the existing split rather than inlining logic in `tk.ts`.

### Declared-but-unimplemented use-case interfaces

**What happens:** `packages/application/src/use-cases/issue-use-cases.ts` defines `CreateIssueUseCase`, `ChangeIssueStatusUseCase`, etc., but no class implements them; `packages/surface/src/operations/` implements the same operations directly against `IssueUnitOfWork`.
**Why it's wrong:** Two competing abstractions for the same operations; new contributors may waste time wiring the use-case layer or duplicating it.
**Do this instead:** Treat `TasksSurface` operations (`packages/surface/src/operations/`) as the canonical implementation path; do not build use-case implementations unless intentionally reviving that layer repo-wide.

### String-based error classification

**What happens:** `SurfaceStoreImpl.transact()` catches any thrown error and converts it to a `SurfaceError` kind by matching substrings of the error message (`packages/surface/src/store.ts:38-64` + `classifyMessage` in `packages/surface/src/errors.ts`).
**Why it's wrong:** Message text is unstable API; a reworded adapter error silently degrades to the wrong error kind.
**Do this instead:** Prefer typed errors from adapters (the `Result`/error vocabulary in `packages/application/src/result.ts`) and only fall back to message matching for legacy adapter throws.

### Build artifacts interleaved with sources

**What happens:** `packages/application/src/` (and other packages) contain generated `index.js`, `index.js.map`, `index.d.ts` next to `index.ts` — `tsc` emits into both `src/`-adjacent and `dist/` locations.
**Why it's wrong:** Easy to edit a generated file by mistake; `.d.ts` files are not covered by `.gitignore` patterns (`**/dist/`, `*.js`, `*.js.map` in `.gitignore`), so stale `.d.ts` can get committed.
**Do this instead:** Always edit `.ts` sources; if a `.d.ts` in `src/` looks stale, regenerate via `bun run build` rather than hand-editing.

## Error Handling

**Strategy:** Fallible operations return `Result` values; exceptions are contained at two boundaries — inside adapter transactions (converted by `transact()`) and at entry points (CLI `fail()`, TUI toast + stale flag, web JSON error envelope).

**Patterns:**
- Typed error unions: `SurfaceError` kinds in `packages/surface/src/errors.ts`; `appErrorMessage()` renders user-facing text.
- Validation happens at the domain boundary: zod schemas (`packages/domain/src/issue.ts`) throw `ValidationError` before persistence.
- Status transitions go through `StatusTransitionPolicy` (`packages/domain/src/issue.ts`) yielding `StatusTransitionResult`, so lifecycle violations are domain errors, not adapter ones.
- TUI resilience: the poll loop swallows transient storage errors and shows a stale mark (`packages/tui/src/store.ts:404-409`); `refresh()` failures set `stale` + toast (`packages/tui/src/app/App.tsx:76-83`).

## Cross-Cutting Concerns

**Logging:** No structured logging framework; adapters and surface are silent on success, CLI/TUI present outcomes via `presentation.ts` / toasts. Watch telemetry goes through the runtime registry (`packages/surface/src/runtime.ts`, `heartbeatRuntime`).

**Validation:** Zod at the domain edge (`IssueSchema`, `WorkspaceConfigSchema`, `StorageConfigSchema`); unknown wire fields preserved (`wire_unknown_json`) rather than rejected.

**Authentication:** None for local use by design — single-user local-first tool. Postgres/S3 credentials come from env vars / AWS credential chain and are redacted in outputs; secrets are never written to `.tasks/config.json` (use `urlEnv`, `packages/workspace/src/config.ts:24-38`).

**Actor identity:** `process.env.USER ?? 'unknown'` recorded on audits and claims (`packages/surface/src/store.ts:80`).

---

*Architecture analysis: 2026-10-17*
