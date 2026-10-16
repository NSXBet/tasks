---
name: tasks
description: Use when working in a repository that uses tk or Tasks for durable project task tracking, issue dependencies, blocker management, evidence, or review handoff. Trigger when the user asks to find ready work, claim or close tasks, create follow-up work, attach proof of work, hand work over for review, inspect blockers, recover project context, or choose between local planning and persistent project tracking.
---

# Tasks

Tasks is the project's durable tracker: one record per deliverable, every handoff on the record. Local plans, chat, and memory do not count as tracking.

## Reaching the tracker

Every verb below is one action. Shell forms are shown because they work in any editor. If your environment exposes Tasks as first-class actions instead of shell, take those — the verbs match by name and return structured results. Don't ask which form is right; act.

## The loop — task → review

Work runs as one loop over the issue's status. Each action emits an event (`task.created`, `task.status`, `task.commit`, `task.evidence`, `task.comment`, `task.report`) that watchers pick up — nobody waits on chat, nobody polls.

| status | who moves it | how |
|---|---|---|
| open | creator | `tk create "Change bg to blue"` — the title seeds the branch name |
| in-progress | agent | `tk update <id> --claim` — assigns you and starts the clock atomically |
| ready-to-review | agent | status + owner + comment: hand over to the reviewer |
| approved → closed | reviewer | `tk close <id> --reason "<report>"` |
| rejected | reviewer | comments land on the record; the loop restarts at claim |

1. **Find or receive work.** `tk ready --json` lists unblocked claimable work. When the user hands you a change, create the task first — the title seeds the branch name. Clarify only if ambiguity is material: one round, asked in a comment so the question stays on the record, then commit to a reading.
2. **Claim, then isolate.** `tk update <id> --claim`. Work on a branch — a worktree keeps the main checkout clean (`git worktree add`, or `tk worktree create <name>`, which shares the `.tasks/` workspace). `tk note <id> "…"` posts progress while you work.
3. **Prove the before state.** Capture current behavior — screenshot, log, output — and attach it: `tk attach <id> --evidence shot.png`. The record carries the proof, not your memory.
4. **Implement.** Commits are the evidence of the work. Attach after-shots of the new state as you go (`task.evidence`).
5. **Hand over.** Set the issue ready for review, return it to the user, and say so in a comment:
   `tk update <id> --status ready-to-review --owner <user> && tk comment <id> "ready for you to review"`.
   Handover is a state change on the record, not a chat message. You're back at step 1 — `tk ready`.
6. **Review rides the record.** Reviewer comments and verdicts land on the task: `tk comments <id>` reads them; `tk hunk <id>` opens a branch review of the issue's work, `tk hunk <id> sync` imports review comments into the issue (deduped). TUI and web show the same record.
7. **Report on close.** Approved → `tk close <id> --reason "<what changed, where, evidence ids>"`. Rejected → read the comments, claim again, fix, re-hand over. "Done" is a report on the record, not a chat message.

## Verbs

| verb | shell form | notes |
|---|---|---|
| ready | `tk ready [--json] [--claim]` | unblocked, claimable |
| blocked | `tk blocked` | open issues with unclosed blockers |
| create / q | `tk create "title" [-t type] [-p 0-4] [--parent --labels --assignee]` / `tk q "title"` | `q` prints only the new id |
| show | `tk show <id>` | full record |
| list | `tk list --status s` | shorthands: `--open --closed --all --ready-to-review --approved --rejected` |
| update / claim | `tk update <id> [--status --branch --title --priority --assignee --owner]` / `--claim` | `--claim` = assignee + in-progress, atomic |
| comment | `tk comment <id> "body"` | `--stdin` for pipes |
| note | `tk note <id> "text"` | appends to the issue notes |
| attach / detach | `tk attach <id> <path>` / `tk detach <id> <path\|name\|id>` | see below |
| close / reopen | `tk close <id> [--reason text]` | reason is appended to the record |
| defer | `tk defer <id> [until]` | default +24h; `undefer` restores |
| structure | `tk dep <id> add\|rm <t>` · `tk link <a> <b>` · `tk label add\|rm <id> <l>` · `tk assign <id> <u>` · `tk priority <id> <0-4>` · `tk tag <id> <l>` | blocks, labels, ownership |
| lifecycle | `tk rename <old> <new>` · `tk duplicate <id> --of <c>` · `tk supersede <id> --with <n>` · `tk delete <id>...` | retargets deps/parents |
| read | `tk query "status=open"` · `tk search text` · `tk history <id>` · `tk tree` · `tk graph [id]` · `tk epic <id>` · `tk children <id>` · `tk stale` · `tk orphans` · `tk duplicates` | query surface |

## Attachments, plans, evidence

Attachments are **references, not copies** — they store a path plus optional metadata. Path resolution: a bare name (`foo.yaml`) means the repo root's `foo.yaml`; relative paths resolve against the current working directory and are stored workspace-relative; absolute paths are stored as-is. Reference files that already exist.

- One-off file: `tk attach <id> docs/spec.md --attach-metadata kind=spec`.
- **Plan files**: when the user says "plan", "plan file", or hands you a markdown plan, use `--plan`:
  `tk create "auth rework" --plan .agents/plans/auth.md`.
  This attaches the file with `kind: plan` metadata; setting a new plan **replaces the prior plan attachment** and leaves other attachments untouched. One plan per issue.
- Repeatable: `tk create "t" --attach foo.yaml --attach 'docs/plan.md={"kind":"plan"}'` (inline JSON = metadata).

## Evidence blobs

`tk attach <id> --evidence <path>...` **copies bytes into the workspace** (`.tasks/attachments/`), replacing path references: entries become `{kind, id (ev-…), name, mime, size, sha256}`. Use it for proof of work — screenshots, logs, outputs — that must survive the file moving.

- Stored backend: `attachments.store` in `.tasks/config.json` (`fs` default; `s3`/`postgres` available); `attachments.lfs` tracks `fs` blobs with git-lfs.
- Re-attach with the same file name replaces the prior evidence entry in place (same id, new bytes).
- Reference evidence from comments as `evidence:<id>` (e.g. `see evidence:ev-a1b2c3`); `tk detach <id> <name-or-id>` removes the entry and its stored bytes.

## Rules

- One issue per deliverable; `parent` for subtasks of an epic, `dep` for blockers.
- Never close an issue whose acceptance criteria are not visibly met — say what you did in the close reason.
- Don't gate the loop on chat: status changes and comments are the handoff; the record is the memory.
- Prefer `--json` when parsing `tk` output programmatically; `--markdown` renders `## id — title` sections.
- `tk skill path` prints this skill's installed location; `tk skill install` symlinks the skill directory into `.agents/skills` (project default) or `~/.agents/skills` (`--global`); `--force` replaces an existing install. Symlinks track upgrades — re-install only when the link breaks.
