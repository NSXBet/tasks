# Tasks

Local-first issue tracker with dependency chains. Inspired by [beads](https://github.com/steveyegge/beads), redesigned as a TypeScript library with pluggable storage adapters (SQLite, PostgreSQL, file-based).

## What's different from the original

- **Library-first**: clean hexagonal architecture — domain, application ports, and swappable adapters
- **Multiple backends**: SQLite (default), PostgreSQL, and file-based (git-committable JSON per issue)
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

Or install the fish alias:
```fish
function tk --description 'Run Tasks CLI from source via bun'
    bun /path/to/tasks/packages/cli/src/tk.ts $argv
end
```

## Packages

| Package | Description |
|---------|-------------|
| `@tasks/domain` | Pure issue model: branded types, Zod schemas, invariant validation |
| `@tasks/application` | Use-case contracts, inbound/outbound ports |
| `@tasks/sqlite` | SQLite adapter (Bun built-in `bun:sqlite`) |
| `@tasks/postgres` | PostgreSQL adapter with migrations |
| `@tasks/file` | File-based adapter — one JSON per issue, git-friendly |
| `@tasks/beads` | Beads migration: record decoding, parent ordering, transactional import |
| `@tasks/cli` | `tk` CLI executable |

## Architecture

```
CLI / adapters (sqlite, postgres, file)
              ↓
      @tasks/application    ← ports define the contract
              ↓
        @tasks/domain       ← pure types, no IO
```

Domain never imports application or adapters. Application coordinates domain types without choosing persistence. Adapters implement application ports (`UnitOfWork`, `IssueUnitOfWork`, `MigrationPort`).

## CLI usage

```bash
tk init [--prefix <p>]        # Initialize .tasks/ workspace (default prefix: tk)
tk create <title> [opts]      # Create issue
tk list [--status <s>]        # List issues
tk ready [--claim]            # List unblocked issues
tk show <id>                  # Show issue details
tk update <id> [--field val]  # Update fields
tk close <id>                 # Close issue
tk dep <id> add <target>      # Add dependency
tk search <text>              # Full-text search
tk export                     # Export all as JSONL
tk --help                     # Full command list
```

`tk` discovers `.tasks/` by walking upward from cwd. Use `-C DIR` to override. `--json` for structured output. `--readonly` rejects mutations.

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

## File backend

The file adapter stores each issue as an individual JSON file:

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
bun test packages/beads/test/beads.test.ts
bun test packages/cli/test/tk.test.ts
npx vitest run packages/file/test/file.test.ts
npx vitest run packages/domain/test/issue.test.ts
```

## Credits

Inspired by [beads](https://github.com/steveyegge/beads) by Steve Yegge. Restructured as a multi-adapter TypeScript library with pluggable storage.
