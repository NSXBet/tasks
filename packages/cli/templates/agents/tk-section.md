<!-- BEGIN TK INTEGRATION -->
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

**The contract: work in `tk work <id>` and commit there; finish with `tk finish <id> --session <sid>`; never mark done — the recorded worktree, branch, and derived diff are the evidence; wait for the verdict with `tk watch <id> --until "status=approved|rejected"`; review with `tk review <id>` and `tk comments <id>`.**

1. **Create** the task first: `tk create "title"` (or `tk q "title"` to capture and print only the id). One issue per deliverable; `--parent` for subtasks of an epic, `tk dep add <id> <blocker>` for blockers.
2. **Claim, then isolate.** `tk work <id>` claims the task and opens a worktree + branch (shared `.tasks/` workspace); the worktree path, branch, and pinned changeset base are recorded on the task as the evidence of work. Commit your work on that branch — commits are the evidence. Post progress with `tk note <id> "…"` as you go.
3. **Keep it updated with proof.** Attach the before state, then after-shots as you implement: `tk attach <id> --evidence <file>` (screenshots, logs, outputs survive file moves; reference them from comments as `evidence:<id>`).
4. **Hand over on the record.** `tk finish <id> --session <sid>` (or `TK_SESSION` env) stamps the session and finish time, derives the changeset from the recorded worktree/branch/base, and moves the task to `ready-to-review` — the single completion path. It prints a stat card (`N commits · +A −D · F files` plus the changes-view link) — relay that, never paste a diff into chat; `tk changes <id>` reprints it (stale counts from the finish report when the branch is out of reach). One PR per task: `tk pr create <id>` pushes the branch and opens it via gh (recorded on the task); `tk pr sync <id>` pulls its state — only when asked, never polled; `tk pr merge <id>` / `tk pr close <id>` act on it via gh and keep the branch (`tk close <id>` prunes). Never mark done by hand.
5. **Wait for the verdict, don't poll.** `tk watch <id> --until "status=approved|rejected"` blocks until the reviewer decides (`--until "type=task.comment"` for review comments; exit 124 = `--timeout`, default 30m, passed with nothing new); `tk watch <id> --drain` at session start prints what you missed.
6. **Report on close.** Review rides the record: `tk review <id>` reviews the recorded diff; `tk comments <id>` lists review comments (`tk comments resolve <id> <cid>` once addressed). Approved → `tk close <id> --reason "<what changed, where, evidence ids>"`; rejected → `tk work <id>` again, fix, `tk finish`, re-hand over. "Done" is a report on the record, not a chat message. Never close an issue whose acceptance criteria are not visibly met.

Lifecycle: `tk close` prunes the task's worktree and `tk/<id>` branch when merged and clean (a refusal is a note on the close line; the close still succeeds); `tk worktree clean` lists leftover worktrees of closed tasks, `--yes` removes them.

### End of session — print the work done

Before ending, update every touched task (status, notes, evidence), file follow-ups with `tk q`, then print a work-done summary: tasks touched with final status, what changed and where, the validation you ran, and evidence ids. The print mirrors the record; the record persists.

**Critical rules:**
- Explicit user or orchestrator instructions override this Tasks block.
- Don't gate the loop on chat: status changes and comments are the handoff; the record is the memory.
<!-- END TK INTEGRATION -->
