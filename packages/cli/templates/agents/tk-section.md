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
