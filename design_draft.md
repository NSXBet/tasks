# Task → Review (tk v1)

*   **Author:** yuri
*   **Status:** Draft
*   **Date:** 2026-10-25
*   **Sources:** `.agents/plans/2026-10-08-task-to-review.md` (the contract) + `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` (GSD set, converted). Status claims in this doc follow git evidence on `main`, not the stale GSD checkboxes.

--------------------------------------------------------------------------------

## Overview

tk is an agent-native issue tracker — a single-binary Bun CLI with a terminal UI, a local web server, and an agent extension, used by humans and agents together. This design covers its v1 milestone: the **task → review loop**. A task's git branch is the evidence of its work. The agent claims a task with `tk work <id>` (a worktree on branch `tk/<id>`), finishes with `tk finish <id> --session <sid>` (status moves to `ready-to-review`), and a human reviews with `tk review <id>` or the web page — comments and edits landing on the task record itself. The record behaves like a GitHub PR: branch, derived commits, derived diff, the session that produced it, two doors into review. Unlike a PR host, it renders from one local store in three surfaces (CLI text, TUI, web) and never asks the agent for a file list.

## The Problem

Before this design, a task could be closed without anyone seeing the work. The evidence lived in chat scrolls and hand-built file lists. Concretely, three failures:

1.  **Evidence is supplied, not derived.** The agent hands over a list of changed files. Lists can be incomplete, stale, or gamed; nothing on the task record proves what the branch actually contains.
2.  **Worktree management lives in a foreign tool.** nsxbet/gw (Go) owns naming, safety checks, and cleanup for worktrees. It knows nothing about tasks; the task record knows nothing about worktrees. Two sources of truth for the same directory.
3.  **Review has no surface.** Diffs get viewed in hunk (a separate TUI) with its own comment storage. Reviewer comments never reach the task record, resolve state does not exist, and a closed task carries no trace of the review.

The solution in one line: derive the PR-shaped record from the task's own branch, make completion a single enforceable contract, and make review comments and edits first-class task-record state — with tk absorbing gw's worktree lifecycle and hunk's diff component so neither external tool is needed in a tk-using repo.

## Goals

*   **G1 — The branch is the only evidence.** Commits and diff derive live from the task's worktree branch against a base SHA pinned once at `tk work` creation. No agent-supplied file lists anywhere in the flow.
*   **G2 — One completion contract.** `tk finish <id> --session <sid>` records the harness session id and moves the task to `ready-to-review` — that exact status and nothing else. The command cannot close or mark done; the limit is enforced in code, not docs.
*   **G3 — tk owns its review component.** A vendored hunk slice (`packages/review`) accepts tk-derived diffs as input and writes reviewer comments and in-diff edits straight to the task record, with per-comment resolve state and an "All resolved" header when the thread is clear.
*   **G4 — One record, three surfaces.** `tk show` (PR-shaped text record), the TUI review views, and web `/tasks/:id` render the same store. TUI and web are one review surface in two shapes: a web comment shows in the TUI, a web edit re-renders the TUI diff, both live.
*   **G5 — tk replaces gw.** One worktree path resolver serves `tk work` and `tk worktree create`; removal is merge-aware; closing a task prunes its worktree and freezes a terminal changeset snapshot into the record; bulk clean and lifecycle hooks complete the port.
*   **G6 — The harness learns the contract.** The ONBOARD snippet, `tk prime` context, `skills/tasks/SKILL.md`, and the root AGENTS.md all state the same rules: work in `tk work <id>`, finish with `tk finish <id> --session <sid>`, never mark done, review with `tk review <id>`.

## Non-Goals

*   **Post-review automation.** Accept/merge/close on approval, rejection flow, PR commenting back to a host — the loop stops at review. Merge machinery is a later milestone.
*   **Interactive keybindings inside `tk show`.** Show renders records; interactivity belongs to `tk review` and the TUI.
*   **Tier-b product epics.** Draft tasks, team/cloud, daemon, views & navigation, and six more — tracked as tk issues (`tasks-34rm`, `-k5kp`, `-lx7a`, `-d0rq`, `-zshv`, `-nzg0`, `-xcov`, `-6zif`, `-gt6y`), parked until the review loop ships.
*   **Rewriting hunk's rendering stack.** tk's TUI already runs `@opentui/react`, the same stack hunk uses. Only inputs, outputs, and storage change.
*   **The event fabric ("the wire") and the `tk next` oracle.** Designed on the plan page §10; a separate project.

## Open Questions

*   **Q1 — Stale PATH binary vs source.** The `tk` on PATH (`~/.local/bin/tk`, symlinked via DotFiles) predates the `finish` and `review` commands — unknown subcommands print generic help — so any CLI smoke test run against it produces false negatives. Which binary is the verification target: repo-built `bun packages/cli/src/tk.ts` or a rebuilt/installed release? This decides how landed steps get smoke-verified.
*   **Q2 — Tracker and requirements drift.** `FIN-01`, `REV-01/02`, `WEB-01/02`, `LC-01/02` have source and commits on `main`, but `REQUIREMENTS.md` checkboxes and the tk issues for steps 7–11 remain open (they cannot move via `tk finish` on the stale binary — see Q1). Should landing this design doc include syncing the tracker/checkboxes to git evidence, or does the doc stay status-neutral?
*   **Q3 — Mock shell cutover.** The phase-0 mock web shell was restored to the working tree (uncommitted) after the real review island replaced it (`664bc22`). The plan says mock-only plumbing is deleted at cutover. Keep the restored mock as a viewing aid, or discard it to complete the cutover?

--------------------------------------------------------------------------------

*Drafted with EGM — sections pending: Critical User Journeys, Technical Plan, Alternatives Considered, Non-Functional Requirements, Detailed Implementation Plan, Verification Plan.*
