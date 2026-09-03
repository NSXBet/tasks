# Tasks

Local-first issue tracker with dependency chains. Inspired by [beads](https://github.com/steveyegge/beads), redesigned as a TypeScript library with pluggable storage adapters (SQLite, PostgreSQL, file-based).

## What's different from the original

- **Library-first**: clean hexagonal architecture — domain, application ports, and swappable adapters
- **Multiple backends**: file-based (default, git-committable JSON per issue), SQLite, and PostgreSQL
- **Bun-native**: runs directly from TypeScript source via `bun`, no build step required for CLI
- **Beads migration**: `tk migrate` imports a `.beads/` workspace issue-by-issue, non-destructively

## Requirements

- [Bun](https://bun.sh) 1.3+

## Quick start

```bash
bun install

# Run CLI directly from source
bun packages/cli/src/tk.ts init
bun packages/cli/src/tk.ts create "Fix login bug"
bun packages/cli/src/tk.ts ready --claim --json
```

## Packages

| Package | Description |
|---------|-------------|
| `@tasks/domain` | Pure issue model: branded types, Zod schemas, invariant validation |
| `@tasks/application` | Use-case contracts, inbound/outbound ports |
| `@tasks/sqlite` | SQLite adapter (Bun built-in `bun:sqlite`) |
| `@tasks/postgres` | PostgreSQL adapter with migrations |
| `@tasks/file` | File-based adapter — one JSON per issue, git-friendly |
| `@tasks/workspace` | `.tasks/config.json` schema, backend resolution/inference, adapter lifecycle |
| `@tasks/beads` | Beads migration: record decoding, parent ordering, transactional import |
| `@tasks/cli` | `tk` CLI executable |
| `@tasks/surface` | Host-agnostic typed command surface: JSON-in/JSON-out operations shared by the CLI and the pi/omp extension |
| `@tasks/extension` | Installable pi/omp extension: `tasks`/`tasks_watch_*` tools, skill injection, and the tk-watch child process |

## Architecture

```
CLI / adapters (file, sqlite, postgres)
              ↓
      @tasks/application    ← ports define the contract
              ↓
        @tasks/domain       ← pure types, no IO
```

Domain never imports application or adapters. Application coordinates domain types without choosing persistence. Adapters implement application ports (`UnitOfWork`, `IssueUnitOfWork`, `MigrationPort`).

## CLI usage

```bash
tk init [--prefix <p>] [--backend ...]  # Initialize .tasks/ workspace (default prefix: tk, backend: file)
tk create <title> [opts]      # Create issue
tk list [--status <s>]        # List issues; shorthands: --open --closed --all --ready-to-review --approved --rejected
tk ready [--claim]            # List unblocked issues
tk show <id>                  # Show issue details
tk close <id>                 # Close issue
tk update <id> [--branch <name>]  # Update fields; link the issue branch
tk dep <id> add <target>      # Add dependency
tk watch [--kinds a,b] [--ids x,y]   # Stream issue-change events as NDJSON (foreground)
tk tree [--all] [--depth N]  # Tree view: epics, subtasks, dependency fan-out
tk search <text>              # Full-text search
tk hunk <id> [--print]        # Open a Hunk review of the issue's branch/WIP
tk hunk <id> sync             # Import live Hunk review comments into the issue
tk export                     # Export all as JSONL
tk switch-backend <name>       # Move data to file/sqlite/postgres, then update config.json
tk --help                     # Full command list
```

`tk` discovers `.tasks/` by walking upward from cwd. Use `-C DIR` to override. `--json` for structured output. `--readonly` rejects mutations.

### Hunk integration

[Hunk](https://github.com/modem-dev/hunk) is a review-first terminal diff viewer. Link the
issue branch and review it in one command:

```bash
tk update tk-abc --branch feature/auth     # link the issue branch
tk hunk tk-abc                            # opens Hunk in that branch's worktree, diffed from its merge base
tk hunk tk-abc --print                    # print the underlying Hunk command instead of launching it
tk hunk tk-abc -- --mode split            # forward extra flags to Hunk after `--`
```

The issue's title and description are injected as a Hunk `--agent-context` sidecar, so they render beside
the diff. With a live Hunk session open on the repo, `tk hunk tk-abc sync` imports the review comments as
task comments (`[hunk file:line] summary`); a `hunkComments` list in the issue's metadata keeps repeated
syncs idempotent.

### Storage backend

The backend is a `.tasks/config.json` property, resolved once per workspace — no command reads a runtime `--backend` flag; the only place `--backend` exists is `tk init`, as a convenience for writing the config instead of hand-editing it:

```bash
tk init                                          # storage.backend: "file" (default)
tk init --backend sqlite [--filename <name>]     # storage.backend: "sqlite"
tk init --backend postgres [--url-env <VAR>]     # storage.backend: "postgres"
tk init --help                                   # full flag reference and examples
```

Each of those writes into `.tasks/config.json`:

```json
{ "prefix": "tk", "storage": { "backend": "file" } }
```

`storage.backend` is one of:

| Backend | Config | Notes |
|---|---|---|
| `file` | `{ "backend": "file" }` | Default. One JSON file per issue under `.tasks/issues/`, see below. |
| `sqlite` | `{ "backend": "sqlite", "filename"?: string }` | `filename` is relative to `.tasks/`, defaults to `tasks.db`. |
| `postgres` | `{ "backend": "postgres", "urlEnv"?: string, "url"?: string }` | Connects via env var indirection by default (`urlEnv`, default name `TASKS_DATABASE_URL`) so connection strings never need to live in committed config. `url` is a literal fallback, discouraged for anything with credentials — `tk init` has no `--url` flag on purpose, to avoid connection strings landing in shell history. |

Switching backends on an existing workspace: use `tk switch-backend <file|sqlite|postgres>` (see `tk switch-backend --help`). It reads every issue from the current backend, writes them all into the target, and only then flips `storage.backend` in `.tasks/config.json` — the old backend's data is never deleted automatically, so verify with `tk doctor`/`tk list` before cleaning it up by hand. `--dry-run` reports what would move without writing anything. A workspace with an existing `.tasks/tasks.db` but no `storage` key is treated as `sqlite` (inferred from disk, not silently defaulted to `file`), so upgrading `tk` never orphans pre-existing data; every workspace `tk init` creates from here on writes an explicit `storage.backend`.

`tk export`/`tk import` also move data between backends manually (and between two entirely separate workspaces) using the same beads-compatible JSONL format: `tk -C <source> export | tk -C <target> import`. `switch-backend` is exactly that sequence, wrapped into one step that also updates the target workspace's own config.

`tk where` reports the resolved backend and location without opening a connection; `tk doctor` opens it and reports health.

### Migration from beads

`tk migrate` imports a beads workspace into `.tasks/`:

```bash
tk migrate                       # import via `bd export --all` (default)
tk migrate --dry-run --json      # report what would be imported, write nothing
tk migrate --source jsonl        # read .beads/issues.jsonl instead of invoking bd
tk migrate --on-conflict skip    # skip (default) | overwrite | fail
tk migrate --bd /path/to/bd      # pin the beads executable
```

The source workspace is never renamed, moved, or modified, so `bd` keeps
working against `.beads/` after migration. Beads stores issues in an embedded
Dolt database that only `bd` can read — `.beads/issues.jsonl` is a passive
export that is usually empty — so `bd export` is the default source and an
empty JSONL is reported as an error rather than a successful empty migration.

Migration runs in a single transaction: either every issue lands or none does.
Issues are ordered parent-first so parent links resolve regardless of export
order, and non-issue beads records (memories, infra beads, templates, gates)
are *carried* — reported rather than rejected, so one memory cannot abort the
run. `tk migrate` is idempotent; re-running skips issues already present.

The JSON report accounts for every record read:

| Field | Meaning |
| `imported` / `skipped` / `overwritten` | issue outcomes |
| `carried` | non-issue records, by line and type |
| `rejected` | undecodable records, with line and field |
| `detached_parents` | parent links dropped because the parent is absent |
| `cycles` | parent cycles broken to stay persistable |

If an older `tk` already renamed `.beads/` to `.tasks/`, `tk` detects the
moved beads database and tells you how to restore it before migrating.

## Agent extension (pi / omp)

The repo ships as an installable extension for [pi](https://github.com/earendil-works/pi-coding-agent) and omp, exposing the full tk surface as LLM tools plus live change notifications.

### Install

```bash
omp install github:NSXBet/tasks
```

omp (and pi) resolve the repo, read the `pi`/`omp` manifest keys in the root
`package.json` — pointing at `packages/extension/src/index.ts` and the
`packages/extension/skills/*/SKILL.md` skill — and copy the plugin into
`~/.omp/plugins/`. `#ref` pins a branch, tag, or commit
(`github:NSXBet/tasks#v1.2.0`).

To install from a local checkout instead (symlinked, live for edits):

```bash
omp install /path/to/tasks/packages/extension
```

Both hosts run TypeScript directly (omp is a Bun binary; pi loads `.ts`
extensions via jiti under node), so there is no build step and no committed
bundles. The extension sources `@tasks/surface` as a workspace dep; the watch
child entry ships inside the surface package.

To install from a local checkout instead (symlinked, live for edits):

```bash
omp install /path/to/tasks/packages/extension
```


### Tools

| Tool | Purpose |
|---|---|
| `tasks` | Full tk surface through one `op`-parameterized tool: `create`, `quick`, `show`, `list`, `ready`, `blocked`, `update`, `close`, `reopen`, `defer`, `claim`, `comment`, `dep-add`, `dep-remove`, `rename`, `delete`, `todo`, `todo-done`, `search`, `query`, `counts`, `stats`, `tree`, `graph`, `duplicates`, `lint`, `children`, `epic`. Returns JSON. |
| `tasks_ready` | The unblocked backlog — call when about to run out of work. |
| `tasks_watch_start` | Spawn a watcher child that notifies the session when issues change. Filter with `kinds` (`issue.created`, `issue.updated`, `issue.status_changed`, `issue.deleted`, `comment.created`, `ready.changed`), `ids`, `label`, `interval` (ms). |
| `tasks_watch_status` | Active watchers with seq watermark and last event. |
| `tasks_watch_stop` | Stop one watcher (by id) or all. |

### Watching for changes

The principal feature: a background process polls the workspace and steers a
notification into the session when a subscribed event fires — the agent gets a
follow-up turn without being prompted.

```
tasks_watch_start { "kinds": ["issue.created", "issue.status_changed"], "ids": ["tk-abc"] }
```

- Notifications arrive via `sendUserMessage(text, { deliverAs: "followUp" })` — identical primitive on pi and omp.
- Keep subscriptions narrow (`kinds` + optional `ids`/`label`); a watcher on every update is noise.
- Watchers die with the session; stop them explicitly with `tasks_watch_stop` when done.
- The same stream is available in a terminal: `tk watch --kinds issue.created`.

A widget bubble above the editor lists active watchers, their uptime, and the
last event per watcher (hidden while no watchers run).

### Commands

| Command | Purpose |
|---|---|
| `/tasks` | Print current tasks — open issues in this workspace (id, title, assignee). |
| `/tasks watch` | Show active task watchers — count, name, last event, seq watermark. |

Agents drive everything through the tools; the commands are human-facing
health checks in the composer.

### Skill

Installing the extension injects the `tasks` skill, which teaches agents the
workflow above (tools-over-shell, claim/comment/close conventions, watcher
etiquette). It loads through the same manifest mechanism as the extension
bundle; no separate configuration.

## File backend

The file adapter (the default backend) stores each issue as an individual JSON file:

```
.tasks/
├── meta.json                 # { "backend": "file", "version": null, "prefix": "tk" }
├── issues/
│   ├── tk-a3f2dd.json        # one file per issue (wire format)
│   └── tk-c7e1ab.json
└── history/
    ├── tk-a3f2dd.jsonl       # append-only audit log
    └── tk-c7e1ab.jsonl
```

Git-friendly: per-issue diffs, no binary DB files, merge conflicts scoped to individual issues.

## Testing

```bash
# All tests (vitest + bun test)
bun test packages/sqlite/test/sqlite.test.ts
bun test packages/workspace/test/workspace.test.ts
bun test packages/beads/test/beads.test.ts
bun test packages/cli/test/tk.test.ts
npx vitest run packages/file/test/file.test.ts
npx vitest run packages/domain/test/issue.test.ts
```

## Credits

Inspired by [beads](https://github.com/steveyegge/beads) by Steve Yegge. Restructured as a multi-adapter TypeScript library with pluggable storage.
