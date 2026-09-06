---
name: tasks
description: Use when this session should create, update, or track project tasks via the tasks tools (tasks, tasks_ready, tasks_watch_*), or when the user asks to find ready work, claim or close tasks, file follow-ups, inspect blockers, or get notified about task changes. Covers the full tk CLI flag surface including file attachments and plan files. Tasks is the durable source of truth for project work; local plans and scratch notes are not.
---

# Tasks

Tasks is the shared project tracker. Everything durable goes through it; local plans and memories do not count as tracking.

## Tools over shell

Prefer the `tasks` tool over shelling out to `tk`. The tool returns structured JSON and never needs the CLI on PATH.

- `tasks` — one tool for the full surface. Pass `op` plus parameters.
- `tasks_ready` — the unblocked backlog. Call it when you are about to run out of work.
- `tasks_watch_start` — spawn a watcher that notifies this session when issues change. `tasks_watch_stop` / `tasks_watch_status` manage watchers.

## Core workflow

1. Find work: `tasks_ready` (or `tasks { "op": "ready", "claim": false }`).
2. Claim: `tasks { "op": "claim", "id": "tk-x" }` — sets assignee and status atomically.
3. Work. Log meaningful progress: `tasks { "op": "comment", "id": "tk-x", "body": "..." }`.
4. Finish: `tasks { "op": "close", "id": "tk-x", "reason": "..." }` — closed issues carry a reason note.

## Ops

| op | parameters → result |
|---|---|
| `create` | `title` (required), `description?`, `type?` (task\|bug\|feature\|epic\|chore), `priority?` (0-4, default 2), `parent?`, `labels?[]`, `deps?[]`, `assignee?`, `owner?`, `dueAt?` (ISO), `estimate?`, `acceptanceCriteria?`, `design?`, `specId?`, `externalRef?`, `branch?`, `notes?`, `plan?` (path), `attachments?[]` → issue |
| `quick` | `title` → `{ id }` |
| `show` | `id?` (omit = current pointer) → issue |
| `list` | `status?`, `parent?`, `assignee?`, `label?`, `limit?` → issues |
| `ready` | `limit?`, `claim?` → unblocked issues |
| `blocked` | — → issues with unclosed blockers |
| `update` | `id`, any create field, `status?`, `reason?` (close), `plan?`, `attachments?[]` → issue |
| `close` / `reopen` | `id`, `reason?` (close — appended to notes) → issue |
| `defer` / `undefer` | `id`, `until?` (ISO or blank = +24h) → issue |
| `claim` | `id` → issue (assignee + in_progress, CAS) |
| `assign` / `priority` | `id`, `user` / `priority` (0-4) → issue |
| `label-add` / `label-rm` | `id`, `label` → issue |
| `note` / `comment` / `comments` | `id`, `body` → issue |
| `dep-add` / `dep-rm` / `dep-list` | `id`, `target`, `depType?` (blocks\|relates-to) → issue/rows |
| `link` | `id`, `target` — shorthand: target blocks id |
| `rename` | `id`, `newId` → `{ from, to }` (retargets deps/parents) |
| `delete` | `ids[]` → `{ deleted }` |
| `duplicate` | `id`, `canonical` → issue |
| `supersede` | `id`, `replacement` → issue |
| `todo` / `todo-done` | `title` / `ids[]` — task-type shortcuts |
| `search` | `text` → issues |
| `query` | `expression` (`status=open`, `title~bug`) → issues |
| `history` | `id` → audit entries |
| `counts` / `stats` | — → board counters |
| `tree` | `all?`, `depth?` → epics + dependency fan-out |
| `graph` | — → nodes + edges |
| `duplicates` / `lint` | `ids?` → findings |
| `children` / `epic` | `id` → child list / `{ epic, children, done, eligible }` |
| `attach` | `id`, `path` (required), `attachmentMetadata?` → issue |
| `detach` | `id`, `path` (required) → issue |

## File attachments and plans

Attachments are **references, not copies** — they store a path plus optional metadata. Path resolution: a bare name (`foo.yaml`) means the repo root's `foo.yaml`; relative paths resolve against the current working directory and are stored workspace-relative; absolute paths are stored as-is. Reference files that already exist.

- One-off file: `tasks { "op": "attach", "id": "tk-x", "path": "docs/spec.md", "attachmentMetadata": { "kind": "spec" } }`.
- **Plan files**: when the user says "plan", "plan file", or hands you a markdown plan, use `plan` on create/update instead of `attach`:
  `tasks { "op": "create", "title": "auth rework", "plan": ".agents/plans/auth.md" }`.
  This attaches the file with `kind: "plan"` metadata; setting a new plan **replaces the prior plan attachment** and leaves other attachments untouched. One plan per issue.
- Full-list replace: `attachments: [{ path, metadata? }]` on create/update replaces the entire list (empty array clears). Prefer `plan`/`attach` for single files.
- Remove: `tasks { "op": "detach", "id": "tk-x", "path": "docs/spec.md" }` (no-op if absent).

## CLI equivalents

`tk` remains available for humans and scripts; both drive the same workspace.

```bash
tk attach <id> <path>                       # attach (--attach-metadata k=v,k2=v2 applies to this path)
tk detach <id> <path>                       # remove attachment
tk create "title" --plan docs/plan.md       # plan via attachment system
tk create "title" --attach foo.yaml --attach 'docs/plan.md={"kind":"plan"}'  # repeatable; inline JSON = metadata
tk update <id> --plan new-plan.md           # replaces prior plan, keeps other attachments
tk update <id> --attach <path>              # add; re-attach replaces metadata
tk update <id> --detach <path>              # remove
```

## Conventions

- One issue per deliverable; use `parent` for subtasks of an epic and `dep-add` for blockers.
- Never close an issue whose acceptance criteria are not visibly met — say what you did in the close reason.
- Prefer `--json` when parsing `tk` output programmatically; `--markdown` renders `## id — title` sections.
- `tk skill path` prints this skill's installed location; `tk skill --install <dir>` symlinks it into an agent skills directory. Re-run after upgrades so guidance stays aligned.
