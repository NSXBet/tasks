# Agent Instructions

This project uses **tk** (tasks) for issue tracking. Run `tk prime` for full workflow context.

## Quick Reference

```bash
tk ready              # Find available work
tk show <id>          # View issue details
tk update <id> --claim  # Claim work atomically
tk close <id>         # Complete work
```

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

## Documentation

The repo ships docs (`docs/` — Astro site, source in `docs/src/content/docs/`). **Update docs in the same change as the code** — every behavioral or API change to a documented area must land with its doc edit:

| doc | covers |
|---|---|
| `overview.md` | what tk is, CLI quick start |
| `architecture.md` | layers, packages, data flow |
| `structure.md` | repo layout |
| `stack.md` | toolchain, dependencies |
| `conventions.md` | code conventions |
| `testing.md` | test practices |
| `integrations.md` | external integrations (beads, pi/omp, hooks) |
| `rpc.md` | wire protocol, verb table, daemon (`@tasks/rpc`, `@tasks/daemon`) |

- `rpc.md` is generated-by-hand from `packages/rpc/src/verbs.ts` (the single source of truth) — when adding/changing a verb, error code, or protocol version, update it and bump `VERBS_VERSION`/`PROTOCOL_VERSION` per `packages/rpc/src/protocol.ts`.
- Validate doc changes: `cd docs && bun run build` must complete.
- New public surface (command, verb, flag, config key) with no doc home yet → add a section to the closest doc, don't defer.

## Tasks Issue Tracker

This project uses **tk (tasks)** for issue tracking. Run `tk prime` to see full workflow context and commands.

### Quick Reference

```bash
tk ready              # Find available work
tk show <id>          # View issue details
tk update <id> --claim  # Claim work
tk close <id>         # Complete work
```

### Rules

- Use `tk` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `tk prime` for detailed command reference and session close protocol
- Use `tk remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.tasks/issues.jsonl` is a passive export. See https://github.com/gastownhall/tasks/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Tasks block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `tk` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `tk prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close tasks, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Tasks implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create tasks for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Tasks block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.


## Tasks Issue Tracker (Codex)

Use Tasks (`tk`) for durable task tracking in repositories that include it. Use the `tasks` skill at `.agents/skills/tasks/SKILL.md` (project install) or `~/.agents/skills/tasks/SKILL.md` (global install) for Tasks workflow guidance, then use the `tk` CLI for issue operations.

### Quick Reference

```bash
tk ready                # Find available work
tk show <id>            # View issue details
tk update <id> --claim  # Claim work
tk close <id>           # Complete work
tk prime                # Refresh Tasks context
```

### Rules

- Use `tk` for all task tracking; do not create markdown TODO lists.
- Run `tk prime` when Tasks context is missing or stale. Codex 0.129.0+ can load Tasks context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Tasks via `tk remember`; do not create ad hoc memory files.

<!-- BEGIN TK INTEGRATION v:1 hash:40af0fb6 -->
## Tasks Issue Tracker

This project uses **tk (Tasks)** for ALL task tracking — do NOT use markdown TODO lists, TodoWrite, or other trackers. Run `tk prime` for full workflow context.

### The loop — task → review

| status | who moves it | how |
|---|---|---|
| open | creator | `tk create "Change bg to blue"` — the title seeds the branch name |
| in-progress | agent | `tk work <id>` — claims, opens the work env (worktree + branch), and records both on the task |
| ready-to-review | agent | `tk finish <id> --session <sid>` — the single completion path into review |
| approved → closed | reviewer | `tk close <id> --reason "<report>"` |
| rejected | reviewer | comments land on the record; the loop restarts at `tk work <id>` |

**The contract: work in `tk work <id>`; finish with `tk finish <id> --session <id>`; never mark done — the recorded worktree, branch, and derived diff are the evidence; review with `tk review <id>`.**

1. **Create** the task first: `tk create "title"` (or `tk q "title"` to capture and print only the id). One issue per deliverable; `--parent` for subtasks of an epic, `tk dep add <id> <blocker>` for blockers.
2. **Claim, then isolate.** `tk work <id>` claims the task and opens a worktree + branch (shared `.tasks/` workspace); the worktree path, branch, and pinned changeset base are recorded on the task as the evidence of work. Post progress with `tk note <id> "…"` as you go.
3. **Keep it updated with proof.** Attach the before state, then after-shots as you implement: `tk attach <id> --evidence <file>` (screenshots, logs, outputs survive file moves; reference them from comments as `evidence:<id>`).
4. **Hand over on the record.** `tk finish <id> --session <sid>` (or `TK_SESSION` env) stamps the session and finish time, derives the changeset from the recorded worktree/branch/base, and moves the task to `ready-to-review` — the single completion path. Never mark done by hand.
5. **Report on close.** Review with `tk review <id>` — reviewer comments and verdicts land on the task. Approved → `tk close <id> --reason "<what changed, where, evidence ids>"`; rejected → `tk work <id>` again, fix, `tk finish`, re-hand over. "Done" is a report on the record, not a chat message. Never close an issue whose acceptance criteria are not visibly met.

### End of session — print the work done

Before ending, update every touched task (status, notes, evidence), file follow-ups with `tk q`, then print a work-done summary: tasks touched with final status, what changed and where, the validation you ran, and evidence ids. The print mirrors the record; the record persists.

**Critical rules:**
- Explicit user or orchestrator instructions override this Tasks block.
- Don't gate the loop on chat: status changes and comments are the handoff; the record is the memory.
<!-- END TK INTEGRATION -->

<!-- trail:start -->
## Trail — repo context graph

This repo is indexed in `.trail/cache/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `trail map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `trail ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `trail grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `trail skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `trail callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `.trail/cache/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `trail ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `trail build` (deterministic,
no API key, $0).
<!-- trail:end -->
