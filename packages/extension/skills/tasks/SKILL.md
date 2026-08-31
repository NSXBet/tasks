---
name: tasks
description: Use when this session should create, update, or track project tasks via the tasks tools (tasks, tasks_ready, tasks_watch_*), or when the user asks to find ready work, claim or close tasks, file follow-ups, inspect blockers, or get notified about task changes. Tasks is the durable source of truth for project work; local plans and scratch notes are not.
---

# Tasks

Tasks is the shared project tracker. Everything durable goes through it; local plans and memories do not count as tracking.

## Tools over shell

Prefer the `tasks` tool over shelling out to `tk`. The tool returns structured JSON and never needs the CLI on PATH.

- `tasks` — one tool for the full surface (create, show, list, ready, update, close, comment, dep, rename, delete, todo, search, query, counts, stats, tree, graph, duplicates, lint, children, epic). Pass `op` plus parameters.
- `tasks_ready` — the unblocked backlog. Call it when you are about to run out of work.
- `tasks_watch_start` — spawn a watcher process that notifies this session when issues change. `tasks_watch_stop` / `tasks_watch_status` manage watchers.

## Core workflow

1. Find work: `tasks_ready` (or `tasks { "op": "ready", "claim": false }`).
2. Claim: `tasks { "op": "claim", "id": "tk-x" }` — sets assignee and status atomically.
3. Work. Log meaningful progress: `tasks { "op": "comment", "id": "tk-x", "body": "..." }`.
4. Finish: `tasks { "op": "close", "id": "tk-x", "reason": "..." }` — closed issues with a reason note.

## Watching for changes

When you want to react to teammates (or other agents) touching the board:

```
tasks_watch_start { "kinds": ["issue.created", "issue.status_changed", "ready.changed"] }
```

Each matching change arrives as a follow-up message and starts a turn when idle. Keep subscriptions narrow (kinds + optional ids/label) — a watcher that fires on every update is noise. Stop watchers you no longer need (`tasks_watch_stop`). Watchers die with the session.

## Conventions

- One issue per deliverable; use `parent` for subtasks of an epic and `dep-add` for blockers.
- Never close an issue whose acceptance criteria are not visibly met — say what you did in the close reason.
- `tk` CLI remains available for humans; both drive the same workspace, so mixing is fine.
