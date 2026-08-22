# Tasks

Local-first issue tracker with dependency chains. A TypeScript port of [beads](https://github.com/steveyegge/beads) redesigned as a library with pluggable storage adapters (SQLite, PostgreSQL, file-based).

## What's different from beads

- **Library-first**: clean hexagonal architecture — domain, application ports, and swappable adapters
- **Multiple backends**: SQLite (default), PostgreSQL, and file-based (git-committable JSON per issue)
- **Bun-native**: runs directly from TypeScript source via `bun`, no build step required for CLI
- **Auto-migration**: transparently migrates `.beads/` workspaces to `.tasks/` on first run

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

`tk` automatically detects `.beads/` directories and migrates them to `.tasks/` (renames directory and `beads.db` → `tasks.db`). Existing data is preserved.

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
bun test packages/cli/test/tk.test.ts
npx vitest run packages/file/test/file.test.ts
npx vitest run packages/domain/test/issue.test.ts
```

## Credits

Port of [beads](https://github.com/steveyegge/beads) by Steve Yegge. Restructured as a multi-adapter library for use in different storage contexts.
