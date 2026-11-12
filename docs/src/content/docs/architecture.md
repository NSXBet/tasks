---
title: "Architecture"
order: 2
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
│   views}.ts · discovery `discover.ts` · watch loop `watch/`              │
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
| `@tasks/domain` | Pure model: zod schemas, branded IDs (`IssueIdSchema`, `SprintIdSchema`), Issue/Sprint/Agent/Run shapes, beads (`BdWire*`) wire codecs, `StatusTransitionPolicy`, `WireTimestampCodec`; review-record helpers (harness registry, review doors, agent/comments lines) | `packages/domain/src/review-record.ts`, `packages/domain/src/issue.ts`, `packages/domain/src/index.ts` |
| `@tasks/application` | Hexagonal core: ports (UnitOfWork, TransactionManager, BlobStore, MigrationPort, Clock, IdGenerator, TimestampCodec, composition root), `Result` type, migration declarations, run side-effect codes | `packages/application/src/index.ts`, `packages/application/src/ports/`, `packages/application/src/result.ts` |
| `@tasks/workspace` | Workspace config (`.tasks/config.json`), backend resolution with lazy imports, blob-store opening (fs/s3/postgres), attachment ingest | `packages/workspace/src/config.ts`, `packages/workspace/src/storage.ts`, `packages/workspace/src/attachments.ts` |
| `@tasks/file` | File backend adapter: JSONL persistence, `FileAdapter` implementing `UnitOfWork & MigrationPort`, beads-wire round-trip | `packages/file/src/index.ts` |
| `@tasks/sqlite` | SQLite backend adapter: schema + checksummed migrations (`001-initial`), driver swap `bun:sqlite` ↔ `node:sqlite` | `packages/sqlite/src/index.ts` |
| `@tasks/postgres` | Postgres backend adapter + in-DB blob store | `packages/postgres/src/index.ts`, `packages/postgres/src/blob.ts` |
| `@tasks/s3` | S3-compatible blob store adapter | `packages/s3/src/index.ts` |
| `@tasks/beads` | Beads JSONL compat: resolve/migrate/plan/record decode, workspace discovery, prefix inference | `packages/beads/src/index.ts`, `packages/beads/src/migrate.ts` |
| `@tasks/surface` | The single application service facade `TasksSurface`; workspace discovery; error classification; event wire (log + watch loop readers); runtime registry; web runtime probing | `packages/surface/src/surface.ts`, `packages/surface/src/store.ts`, `packages/surface/src/discover.ts` |
| `@tasks/cli` | `tk` command-line entry, arg parsing, output presentation, hooks (agent hooks, JSON hooks), review door (`tk review` -> TUI diff), updater | `packages/cli/src/tk.ts`, `packages/cli/src/presentation.ts`, `packages/cli/src/hooks.ts` |
| `@tasks/tui` | `tk-tui` terminal UI on OpenTUI/React 19; pure board model + graph algorithms in `store.ts`; panels in `app/` | `packages/tui/src/main.tsx`, `packages/tui/src/store.ts`, `packages/tui/src/app/App.tsx` |
| `@tasks/web` | `tk web` local web UI: Bun HTTP server, JSON API over the same surface, SPA shell, single-instance guard | `packages/web/src/main.ts`, `packages/web/src/server.ts`, `packages/web/src/app.html` |
| `pi-extention` | pi AND omp host extension: registers `tasks` tool, `tasks_ready`, watch tools, `/tasks` command, watch widget | `packages/pi-extention/src/index.ts` |
| `@tasks/terminal-image` | Terminal image helper: CLI escapes (`terminalImageEscape`) and the TUI paint decision (`inlineImageMode` → `kitty` / `blocks` / `null` = `evidence:<id>` row; the TUI's `EvidenceImage` gates every evidence paint on it — detail pane, diff-view EVIDENCE entries and the artifact view's EVIDENCE mode) | `packages/terminal-image/src/index.ts`, `packages/tui/src/app/evidence-image.tsx` |

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
7. Event wire: both production openers (`openSurfaceStore` and the CLI main storage open) wrap the adapter with `withEventLog` (`packages/surface/src/events/recorder.ts`). After a transaction commits, its events are appended to `.tasks/events.jsonl` — see [Event wire](#event-wire-eventsjsonl).

### Event wire (`events.jsonl`)

Every committed write appends its events to one append-only log per workspace, `<root>/.tasks/events.jsonl`, written in-process by the command that made the change (no daemon, no broker; spec §10).

- Envelope, one JSON object per line: `{ seq, host, ts, task?, type, actor, session?, data }`. `session` is present only when `TK_SESSION` is set. `seq` is strictly increasing and gap-free across concurrent writer processes on one host: appends take an in-process chain plus a cross-process `mkdir` lock (`.tasks/events.lock`, 5s acquire deadline, 10s stale takeover) and read the last seq under it (`packages/surface/src/events/log.ts`: `appendEvents`, `readEvents`, `lastEventSeq`).
- Emission: `withEventLog` decorates the `StorageAdapter`. Each mutator (`save`, `addComment`, `addDependency`/`removeDependency`, `delete`, `claimReady`, `saveRun`) snapshots the touched issue or run first; when the work returns ok, the after-state is read inside the transaction, and events are appended only after commit. A failed or rolled-back transaction appends nothing; an append failure is swallowed and never fails the committed write. `tk init`, `tk migrate`, `tk import`, `tk switch-backend` and the ephemeral scratch store are not wrapped, so bulk copies never flood the log.
- Event types are decided only in `packages/surface/src/events/derive.ts` (`deriveIssueEvents`, `deriveRunEvent`): `task.created {title,status,owner,assignee}`, `task.status {from,to}` (finish adds `session`, `finishedAt`, and `refinish: true` on a repeat finish; approvals are `to: approved|rejected`), `task.owner {field,from,to}`, `task.comment` (`kind: "note"` with `comment,author,body`, or `kind: "review"` with `comment,from,to,actor,file,line,location,author,body` per `reviewCommentLog` entry — a batched send is one `to: "sent"` event per card), `task.evidence {id,name,mime}`, `task.worktree {path,branch}`, `task.pr {op,number,url,state,head}` (`op`: `create` on a first PR or a new number, `close` when the state moves to closed, else `state`; a url-only change is silent), `task.report {changes,head,at}` (the counts-only stat card data when the `metadata.report` counts or head change; a restamp that only moves `at`, e.g. `tk pr sync`, is silent), `task.update {fields}`, `task.deleted {title}`, `run.changed {runId,from,to}`. Per issue they come in that order (created, status, owner, comment(s), evidence, worktree, pr, report, update, deleted), so a finish's `task.status` precedes its `task.report`. `metadata.pr` and `metadata.report` are covered keys: they never appear in `task.update.fields`.

### TUI Board Path

1. `tk-tui` — parse `--image-size`/workspace args, `rootFrom(cwd)`, `openTuiStore(root)` → `createSurface` (`packages/tui/src/main.tsx:26-45`).
2. `loadBoard()` — `surface.all()` full page + `surface.sprintList()` → `buildBoard()` derives counts/ready/blocked once per refresh (`packages/tui/src/store.ts:30`, `packages/tui/src/store.ts:389`).
3. Live refresh: `TuiStore.watch(onEvent)` tails `.tasks/events.jsonl` with `tailEvents` from the log's current end (no replay) and hands each line to `onEvent` as a `WatchEvent` (`toWatchEvent`: the log's own `seq`, `kind`, `data`), so a write from any process — CLI, web, agents, the TUI itself — reaches the board within about a second (`packages/tui/src/store.ts`). `App` coalesces a burst into one `loadBoard()` per 100 ms trailing window and shows a status-bar toast from `eventToast` (`packages/tui/src/events.ts`): `<id> ready for review` / `approved` / `rejected` on those `task.status` targets, `<id> · <author>: <body>` for a note comment (body cut to 60 cells), `<id> · review comment at <file>:<line>` when a review comment opens and `<id> · review comment sent` on send. Several toasts in one window collapse to the last plus ` (+N)`. Author, body and file pass through `sanitize` (ANSI CSI/OSC sequences and C0/C1 controls stripped) before they reach the terminal.
4. `App` receives the event → `refresh()` → `setBoard()`; all panels re-render from context (`packages/tui/src/app/App.tsx:84-91`).

### TUI Review Path

1. `tk review <id>` boots the TUI at `tk://diff/<id>`. `resolveReviewSource` (`packages/tui/src/review/source.ts`) finds the task branch's worktree and diffs its working tree against the pinned changeset base (else the merge-base with the default branch) through `gitDiffPatch` in `@tasks/git`. The working-tree patch also includes untracked, non-ignored files as `/dev/null` new-file diffs (`git ls-files --others --exclude-standard -z`, then `git diff --no-index -- /dev/null <path>` per file), so a file the agent created but never `git add`ed shows in CHANGES, the diff, the minimap and the counts. Both commands are read-only: the user's index is never modified (no `add -N`, no temp index). The extra files are bounded: the first 200 untracked paths by name (`UNTRACKED_PATCH_LIMIT`), and files over 1 MiB (`UNTRACKED_MAX_BYTES`) are left out (they still count dirty). The range form (`from...to`, used for frozen changesets) never includes untracked files. No branch linking step is needed after `tk work <id>`.
2. A task with no branch resolves to an empty source (`empty: "no-branch"`); the diff, artifact and task views show `no branch yet — run tk work <id>`. The workspace working tree is never diffed.
3. Live re-render: `startReviewWatch` (`packages/tui/src/review/live.ts`) runs the vendored debounced watch controller. The TUI subscribes through the git-free `@tasks/review/watch` entry, and tk supplies the plan and the signature (through `@tasks/git`). The plan is hybrid (the worktree tree minus `node_modules`/`.git`, the branch's loose ref file, and `packed-refs`). The signature is the branch head plus a hash of the tk patch. A change re-resolves the source and merges it into the session, keeping the selected file by path and clamping the hunk index; there is no refresh key. Task-store events only reload review threads, unless the task's branch or pinned base changed. `startReviewWatch` resolves to a `ReviewWatchHandle { stop, watching }`; `watching` is true only when a controller was created, and the diff view shows `watching worktree — re-derives as commits land ●` exactly while it is (never in the compact modal or the artifact view). With `z`, the source is re-derived with `--unified=25` (`gitDiffPatch` option `contextLines`), and live refreshes and edit saves keep that context.
4. In-view edit: in the diff view, `j` selects a hunk and `e` opens an inline buffer under the diff, prefilled with the hunk's new-side lines read from the worktree file (`packages/tui/src/review/edit.ts`). `ctrl+s` splices the buffer back over that line range, keeping the file's line endings and trailing newline, then re-derives the diff; `esc` cancels without leaving the view. `guardWorktreePath` refuses empty, absolute, NUL-containing, `..`-escaping and symlink-escaping paths (it realpaths the nearest existing ancestor). A save is refused as stale when the on-disk region changed after the buffer opened. Binary and deleted files have no edit range, and the compact diff modal never edits. Review-comment edit is `E`.
5. Comments: `c` / `R` / `E` / `x` / `D` / `S` go through `taskStoreCommentStore` (`@tasks/review`) into `metadata.reviewThreads` on the task record, the same store `tk show` reads through `reviewComments` in `@tasks/surface`. `x` / `D` call `setThreadStatus` (✓ done → resolved, ✕ remove → dismissed, either on a closed comment → open) and `S` calls `sendOpen` (one batch of every open comment); each move lands in `metadata.reviewCommentLog`. The thread rail lists the selected file's threads by path under a `COMMENTS · N open · K ✓` / `All resolved` header computed over all of the task's threads. Controls, badges (`open`, `→ sent`, `✓ resolved`, `✕ dismissed`), the header label and the send count come from `@tasks/review/lifecycle` (type-import-only, so the web island can share it). Review keys are inert while the composer, help or palette is open.
6. Task-view model: the task view's rail and artifact list in both the TUI and the web derive from `@tasks/review/taskview` (`packages/review/src/core/taskview/model.ts`, type-import-only). `patchFileStats` parses the tk patch once into per-file `{ path, status A|M|D|R, additions, deletions, hunks }`. `changesTree` builds directory and file rows (directories first at each level), where a row needs review while its location has no thread or any open/sent thread, and a directory needs review when any file under it does. `minimapBars` gives one bar per hunk, sized against the largest hunk and toned `add`/`del`. `artifactGroups` turns the task's attachments into typed counts `{ src, edit, new, other }` and the `IN CHANGES` / `UNREFERENCED` groups, each row carrying its open+sent comment count. `docBlocks` splits markdown into commentable blocks (1-based line ranges) without splitting inside fences. `threadLocation` (`evidence:<id>` or the file path) is the comment key every view uses. In the TUI, `ReviewSource` (`packages/tui/src/review/source.ts`) carries `stats` (`patchFileStats` of the same patch), the matched `worktree` path and `dirty` (`gitDirtyCount`), so every live re-derive refreshes the task view's CHANGES, MINIMAP and WORKSPC tabs; SESSIONS reads `surface.taskSessions(id)` on each board refresh. The TUI artifact view (`packages/tui/src/app/artifact.tsx`, `AppState.artifact`) reads one artifact through `readGuardedFile` (`packages/tui/src/review/edit.ts`, on the same `guardWorktreePath` as hunk edits, capped at 2 MB) from the source's worktree, else the workspace root, re-reading on each live re-derive. It renders `CODE` as numbered lines, `DOC` (`isDocPath`) as `docBlocks` shaped through the detail pane's `mdLines` (`packages/tui/src/app/markdown.ts`), and `EVIDENCE` through `EvidenceImage`; its comments go through `openReviewComposer` with an explicit placement (`line`, `endLine` for a block range, or `evidenceId`) into the same `createThread`.

### Changes stat card path

Chat-facing surfaces (`tk finish`, `tk changes`, `tk show`'s fallback) print a counts-only stat card built by `statCardLine` (`packages/domain/src/changes-card.ts`), never a patch. `resolveChanges` (`packages/surface/src/operations/changes.ts`) picks the counts by a fallback ladder: closed + frozen `metadata.changeset` snapshot (no git) → live `deriveChangeset` from the branch and pinned base → the `metadata.report` cache (stale) → a frozen snapshot on a reopened task (stale) → none. `metadata.report = { changes: { commits, files, additions, deletions }, head, at }` is a counts-only stamp written by `finishIssueUow` in the same save as `agent_session`/`finished_at` (via `reportStampFor`; non-fatal, never writes `changeset.head`, so finish still never freezes) and restamped by the PR verbs `tk pr create` / `tk pr sync` in their one save. On the event wire `report` is a covered metadata key: a changed stamp appends one `task.report` (the stat card data) and never a `task.update`.

### PR sidecar path

A task has at most one PR, mirrored on the record as `metadata.pr = { number, url, state }` (`state` is `open`, `closed` or `merged`; `PrRecord` / `readPrRecord` in `packages/domain/src/pr-record.ts` validate it: positive integer number, `http(s)://` url, known state). gh is the remote truth and is read only inside an explicit verb — no poller. `packages/surface/src/gh.ts` (not the git adapter) is the only place tk runs `gh` (`ghPrView`, `ghPrListOpenForHead`, `ghPrCreate`, `ghPrClose`, `ghPrMerge` — the merge method is a closed `merge | squash | rebase` enum, never `--admin` or `--delete-branch`), over the `@tasks/git` `ProcessRunner` with argv arrays (title/body as single `--title=` / `--body=` tokens). The push goes through `gitPushBranch` in `@tasks/git`. `prCreate` / `prSync` / `prShow` (`packages/surface/src/operations/pr.ts`) read the issue in one short transaction, run git/gh outside it, then save `pr` (plus a fresh `report` stamp) in a second short transaction that re-reads the issue. `prClose` / `prMerge` follow the same shape: a `ghPrView` precheck on the recorded number, the mutating call only when the remote state differs, one more `ghPrView`, one short save of `pr`; they never touch the branch, the worktree or the task status (pruning stays `tk close`'s job behind `gitIsMergedToBase`). `formatFinish` and `tk changes` read the PR line from the record (`readPrRecord` + `prLine`) and never call gh. The save reaches the wire as one `task.pr {op, number, url, state, head}` line (`pr` is a covered metadata key, so never a `task.update`), plus `task.report` when the restamp changed the counts.

### The wire (log readers)

The event wire has one writer path and one reader path; there is no daemon broker.

- **Writers** append through the recorder: `withEventLog` wraps every opened adapter (`openSurfaceStore` and the CLI main open), so any committed write — CLI, web, TUI, pi extension, daemon-hosted RPC — lands in `.tasks/events.jsonl` (see [Event wire](#event-wire-eventsjsonl)).
- **Readers** tail the same file. `runWatchLoop` (`packages/surface/src/watch/core.ts`) is the shared loop: it pins its start cursor (`subscription.after`, else `lastEventSeq` — no replay burst), then each tick runs deferred-issue wakeups (their writes reach the log as `task.status` / `run.changed` like any other write), reads lines past the cursor (`readEvents`), filters by kind (legacy names expand through `KIND_ALIASES`), ids and label (labels looked up once per task per tick), attaches board `counts`, and delivers each line as a `WatchEvent` whose `seq` is the log seq (`toWatchEvent`, `packages/surface/src/events/query.ts`). Between ticks it waits on `fs.watch` of the tasks dir (`waitForAppend`, `packages/surface/src/events/tail.ts`), so a reader wakes within ~100 ms of an append; the interval is only the fallback. `tailEvents` is the bare primitive (`{ after, onEvents }` → `{ stop, done }`) for consumers that need no wakeups or counts.
- **Consumers:** `tk watch` (frame mode via `runWatchChild` / `spawnWatchChild`), the daemon's `events.subscribe` (one `runWatchLoop` per socket subscription, cursor pinned before the reply), the web server (one `tailEvents` on the served workspace's log pushes each line down `GET /events` as an `event: task` SSE frame and is restarted on a `POST /api/open` repoint; `GET /api/events` pages read the log directly with `readEvents`, 512 per page — `packages/web/src/server.ts`), and the pi/omp extension (`packages/pi-extention/src/watch-manager.ts`). The TUI board (`TuiStore.watch` → `tailEvents`, debounced `loadBoard()` plus `eventToast` notifications — see [TUI Board Path](#tui-board-path)). Every log reader sees the same lines in the same order.
- **Queries and cursors:** `parseEventQuery` / `matchesEvent` implement the spec watch grammar (`task=`, `status=`, `owner=`, `type=`, `actor=`, `mine`; comma = AND, `|` = alternatives). Per-subscriber cursors live in `.tasks/cursors.json` as `{ version: 1, subscribers: { <name>: { <host>: <seq> } } }` (`readCursor` / `writeCursor` / `seedCursor`, `packages/surface/src/events/cursors.ts`), written atomically under the events lock.
- **Open:** single host for v1 (cursors are keyed by host so per-host sequences can merge later); log retention/trimming is not implemented.

### Web Path

1. `tk web` → `packages/cli/src/tk.ts` resolves the port (`--port` > `TK_WEB_PORT` > workspace `webPort` > default), probes for a live instance, and repoints it at the resolved workspace over the daemon (`web.start`); a fresh daemon bootstraps and hosts the server when none answers.
2. `startWebServer()` (`packages/web/src/server.ts`) serves `app.html` + JSON API built on the same `TasksSurface`. One shared interface: a later `tk web` from any workspace repoints the live instance via `POST /api/open` instead of starting a rival server.
   Review: `GET /tasks/:id` serves the shell and lands on the task view with `◧ open diff` as the primary action: the center column reads title → `worktree <path>` / `<branch> → <base>` chips → `◧ open diff` → description → `ARTIFACTS — evidence on the task` (typed `src · edit · new · other` counts, grouped rows with live `● N` comment pills, image thumbnails open the viewer) → `COMMENTS · N` preview with `→ location` → doors, and a tabbed rail (`SESSIONS · CHANGES · WORKSPC · MINIMAP`, CHANGES by default) holds the agent runs, the live changes tree, the worktree facts and the per-hunk minimap. All of it comes from one payload, `GET /api/review/:id/taskview` → `{ stats, changes, minimap, artifacts, sessions, workspace: { branch, base, worktree, worktreeLabel, host, dirty, pr }, comments: { counts, rows } }`, derived server-side through `@tasks/review/taskview` from the same working-tree patch as `/api/review/:id`, `surface.taskSessions` and `gitDirtyCount` (`pr` is `readPrRecord(metadata)` — the validated `{number, url, state}` mirror, http(s) url only — or null; the WORKSPC `commit` / `open pr` buttons post to `POST /api/review/:id/commit {message}` → `commitWorktree` and `POST /api/review/:id/pr` → `prCreate`, HTTP routes beside `PUT /api/review/:id/file`, not RPC verbs, with errors as `400 {error: {kind: "runtime", message}}`; `worktree` stays absolute; `worktreeLabel` from `worktreeLabel(root, worktree)` in `packages/web/src/review.ts` is the chip text — repo-relative under the workspace root like the TUI `displayPath`, else the `.worktrees/<name>` tail, else the absolute path); the left `TASKS` column (`<nav class="ttasks">`, before `.tmain`) is rendered client-side from the board issues and switches tasks through the router (`navigate(taskUrl(id))`); the page refetches it on `review` SSE frames for the task on screen and when the record's `updatedAt` moves, never on a timer. A ready-to-review task offers no start-work (the palette shows `open diff <id>` instead), and at ≤ 860px the rail stacks below the main column while the worktree path chip stays (the branch chip hides); `◧ open diff`, a CHANGES file row, clicking the already-selected CHANGES tab, or a MINIMAP bar opens the diff modal over the task view (URL unchanged; the island mounted with `mode: "modal"`, a bar passing `initialHunk` to scroll to its hunk): one file with `<id> / <path>`, its status and `+a −d`, line and `＋ comment on this file` comments into the same thread store, `⤢ full view` → `/tasks/:id/diff?file=<path>`, and `Esc` / `esc close` back to the task as it was (board refreshes do not re-render the task view while the modal is open); `/tasks/:id/file` is the artifact view (island `mode: "file"`), with a `CODE` / `DOC` / `EVIDENCE` mode tag, `N open · K ✓` and a comments panel over the same thread store (`POST /api/review/:id/threads` with `{filePath, line?, endLine?, side}` or `{evidenceId}`): `?path=<code file>` is `CODE` — the worktree file rendered in full through `@pierre/diffs` `File` with line and whole-file comments; `?path=<doc>.md` is `DOC` — the island fetches `GET /api/review/:id/file?path=<doc>&render=doc`, which adds `blocks: [{ line, endLine, html }]` after the guarded read (`renderDocBlocks` in `packages/web/src/review.ts`: `docBlocks` ranges rendered by `Bun.markdown.html` with `noHtmlBlocks`/`noHtmlSpans`, then every `href`/`src` outside `http(s):` / `mailto:` / `#` / relative paths is removed after entity decoding — the island's only raw-HTML sink), and each block's `＋` gutter posts a `line`–`endLine` range comment; `?evidence=<ev id>` is `EVIDENCE` — the image (name/mime from `/api/review/:id` `evidence`, `evidence not found: <id>` otherwise) with its cards and a composer posting `{ evidenceId, body }`. It is reached from the diff view's `view file`, from file-located comments in the task view, and from every ARTIFACTS row (file rows → `?path=`, evidence rows → `?evidence=`; the thumbnail still opens the image viewer); `/tasks/:id/diff` deep-links the diff view (`?file=<path>` preselects a file) and offers `← task` back; the diff follows the app theme (`<html data-theme>`), not the OS color scheme; the full diff view lists the task's blob evidence under `EVIDENCE` (`name · 💬 N`) and renders each one after the file diff as an inline `<img>` block (`/api/issue/:id/blob/:ref`) with its comment cards and a `comment on the evidence…` composer that posts `{ evidenceId, body }`, stored at location `evidence:<id>`; `GET /api/review/:id` returns the branch-scoped payload (plus `evidence: [{ id, name, mime }]`) — live from the branch, or, once the branch is pruned, from the changeset snapshot frozen at close (patch re-derived from the frozen head SHA).
   Live diff: a server watcher on each task's worktree and on the repo's branch refs pushes `event: review` `{id, reason: "worktree"|"branch"}` over `GET /events`, and the mounted review island re-fetches `/api/review/:id` (no page reload, no client polling); the live patch is the worktree's working tree vs the pinned base plus untracked, non-ignored files as new-file diffs, with the same index-untouched contract and 200-file / 1 MiB caps as the TUI review source (both come from `gitDiffPatch`). Unnamed `data: reload` frames remain for dev shell edits and workspace repoints.
   Editing: the diff edits in place — `edit` on a changed file rebuilds its diff from the full base and worktree contents and attaches the `@pierre/diffs` editor; `save` (or ⌘S / Ctrl+S) writes the file. `GET /api/review/:id/file?path=<p>` reads the worktree file and `&side=base` reads the exact blob at the pinned base through `@tasks/git` `gitShowFile` (`git cat-file blob`, untrimmed; 404 when the file is absent at base). `PUT /api/review/:id/file?path=<p> {contents}` writes the worktree file — path-guarded (`escape` → 400) and refused with `no_worktree` (400) when the task has no `tk work` worktree, so a web edit never touches the main checkout. The write is picked up by the worktree watcher and pushed as `event: review`; while the editor holds unsaved changes the island defers that refresh until save or discard. The diff view also offers `＋ comment on file` for file-level threads beside line comments.
   Review comments: one store per task (`metadata.reviewThreads`); each comment carries its location as data (`file`, `line`/`endLine`, or an evidence target `evidence:<id>`) and a status `open | sent | resolved | dismissed`. `GET /api/review/:id/threads` returns threads plus `counts` (`N open · K ✓`) and `allResolved`; `POST .../threads/:tid/status {status}` resolves, dismisses, or reopens; `POST /api/review/:id/comments/send` is the explicit batched send (open → sent, returned as `{location, author, body}` cards). Every transition is appended to `metadata.reviewCommentLog` and surfaces as a `task.comment` watch event. Lifecycle rules live in `@tasks/surface` `review-comments.ts` (transitions, batched send, log → `task.comment`), and the views' control/header rules in `@tasks/review/lifecycle` (type-only, shared by the TUI and the web bundle — the island's per-card `✓ done` / `✕ remove` / `↺ reopen` buttons post to `.../threads/:tid/status`, its header reads `counts` / `allResolved`, and `send to agent (N)` posts `.../comments/send`); the `@tasks/review` task-store adapter delegates to the surface rules.
3. Dev mode (`--dev`) keeps a foreground child and adds SSE live-reload of the shell.

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
- Task-view reads with no RPC verb (called in-process by the TUI and web server): `taskSessions(id)` — the SESSIONS rail rows `{ id, state, label, updatedAt }`, newest first, from stored runs plus the `tk finish` session record (`packages/surface/src/operations/sessions.ts`); `gitDirtyCount(cwd)` in `@tasks/git` gives the WORKSPC tab's dirty-entry count. WORKSPC actions (11-05), also no RPC verb: `commitWorktree(deps {cwd, transact, runner?}, id, message)` (`packages/surface/src/operations/commit.ts`) normalises the message (controls stripped, trimmed, capped at 4000 chars), checks the recorded worktree (exists, is not the main checkout, is on `issue.branch`), runs `gitCommitTracked(worktree, message)` in `@tasks/git` (`git commit --all --message=<msg>` as one argv token; never `--no-verify`, `--amend`, `--allow-empty` or a push) outside the DB transaction, then restamps `metadata.report` in one short transaction; `storeTransact(store)` (`operations/pr.ts`) adapts `SurfaceStore.transact` to the throwing `transact` dep that `commitWorktree` and `prCreate` take, so the web routes and the TUI `C` / `P` keys build `{cwd: store.root, transact: storeTransact(store)}`.

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
- Triggers: `tk web` CLI subcommand; flags `--dev`, `--open`, `--port`, `--daemon`.
- Responsibilities: HTTP server, JSON API, one shared instance (repoint via `POST /api/open`, workspace picker in the shell), optional daemonization.

**pi/omp extension:**
- Location: `packages/pi-extention/src/index.ts` (referenced by root `package.json` `pi.extensions` and `omp.extensions`).
- Triggers: host agent startup (pi or omp).
- Responsibilities: register the `tasks` mega-tool (typebox schemas), `tasks_ready`, watch start/stop/status tools, `/tasks` command, above-editor watch widget.

## Architectural Constraints

- **Bun-first runtime:** root `package.json` `exports` map uses the `bun` condition to resolve TS sources directly (`./packages/domain/src/index.ts`) while `types`/`default` point at `dist/`; `packageManager: bun@1.3.14`. Node compatibility exists only where adapters swap drivers (`packages/sqlite/src/index.ts:1-16` picks `node:sqlite` under node hosts).
- **Backend selection is config-file-only:** no runtime `--backend` flag; `.tasks/config.json` is the single authority (`packages/workspace/src/config.ts:4-9`). Postgres URLs come from env vars (`urlEnv`, default `TASKS_DATABASE_URL`) and are redacted in all display paths (`packages/workspace/src/storage.ts:19-27`).
- **Strict TypeScript everywhere:** `verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`-era strict flags, composite project references (`tsconfig.json`). All intra-package imports use `.js` extensions; the exception is `packages/pi-extention/src/` which imports `.ts` paths (host-rewritten by pi/omp loaders).
- **Transaction scope:** every mutating surface operation runs inside `adapter.withinTransaction`; cross-backend transactions do not exist.
- **Ordering:** watch events carry the event log's `seq` (`.tasks/events.jsonl`); readers never diff the board (`packages/surface/src/watch/core.ts`).
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
- TUI resilience: the event-log tail retries transient read failures on its next wake (`tailEvents`), and a consumer error never stops it (`packages/tui/src/store.ts`); `refresh()` failures set `stale` + toast (`packages/tui/src/app/App.tsx:76-83`).

## Cross-Cutting Concerns

**Logging:** No structured logging framework; adapters and surface are silent on success, CLI/TUI present outcomes via `presentation.ts` / toasts. Watch telemetry goes through the runtime registry (`packages/surface/src/runtime.ts`, `heartbeatRuntime`).

**Validation:** Zod at the domain edge (`IssueSchema`, `WorkspaceConfigSchema`, `StorageConfigSchema`); unknown wire fields preserved (`wire_unknown_json`) rather than rejected.

**Authentication:** None for local use by design — single-user local-first tool. Postgres/S3 credentials come from env vars / AWS credential chain and are redacted in outputs; secrets are never written to `.tasks/config.json` (use `urlEnv`, `packages/workspace/src/config.ts:24-38`).

**Actor identity:** `process.env.USER ?? 'unknown'` recorded on audits and claims (`packages/surface/src/store.ts:80`).

---

*Architecture analysis: 2026-10-17*
