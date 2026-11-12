---
phase: 08-comment-lifecycle-agent-delivery
plan: 01
subsystem: surface, cli, docs
status: complete
tags: [review-comments, cli, lifecycle, send]
requires:
  - phase: 07-03
    provides: "tk.ts / presentation.ts state this plan applies on top of"
  - phase: 03-05
    provides: "review-comments.ts lifecycle (cards, counts, transitionReviewComment, reviewCommentLog)"
provides:
  - "uow-level reviewCommentListUow / reviewCommentSetStatusUow / reviewCommentSendUow in @tasks/surface (store-level functions delegate)"
  - "`tk comments <id>` lists review comments; `send|resolve|dismiss|reopen` in either argument order"
  - "formatReviewComments / formatReviewSend / formatReviewStatus + shared reviewHeader in presentation.ts"
affects: [08-02 (views use the same counts/header rule), 08-03, Phase 10 (agent pickup of sent cards)]
actuals:
  tasks: 3
  commits: 0
key-files:
  created:
    - packages/cli/test/comments.test.ts
  modified:
    - packages/surface/src/operations/review-comments.ts
    - packages/surface/test/review-comments.test.ts
    - packages/cli/src/tk.ts
    - packages/cli/src/presentation.ts
    - packages/cli/test/tk.test.ts
    - packages/cli/skills/tasks/SKILL.md
    - .agents/skills/tasks/SKILL.md
    - docs/src/content/docs/overview.md
key-decisions:
  - "User-approved behavior change: `tk comments <id> --json` returns the review `{ comments, counts }` shape (same as `comments.list` and `tk show --json` `.review`); plain task comments stay in `tk show --json` `.comments`."
  - "`tk comments send <id> <cid…>` validates every named cid inside the same transaction as the send, so an unknown id fails before any write."
  - "`resolve|dismiss|reopen` take exactly one cid; extra positionals fail (`comments <op> takes one comment id`)."
  - "`commentWire` and `formatComments` removed from packages/cli/src/presentation.ts (no remaining callers); the `commentWire` in packages/surface/src/envelope.ts is untouched."
  - "No RPC verb, error code or protocol change: rpc.md, VERBS_VERSION and PROTOCOL_VERSION unchanged."
requirements-completed: [CMT-01, CMT-02, CMT-03]
completed: 2026-11-10
---

# Phase 08 Plan 01: `tk comments` over the review comment store — Summary

**`tk comments <id>` now lists the task's review comments (location, status, author, body, under a `REVIEW (n) · N open · K ✓` / `All resolved` header). `tk comments send` moves every open comment, or only the named ones, to `sent` in one transaction and prints them as cards. `resolve`, `dismiss` and `reopen` each move one comment and add one entry to `metadata.reviewCommentLog`.**

## What changed

- **Surface (`review-comments.ts`):** three exported uow-level functions take the caller's unit of work and an explicit `actor`:
  - `reviewCommentListUow(uow, id)`
  - `reviewCommentSetStatusUow(uow, actor, id, cid, status)`
  - `reviewCommentSendUow(uow, actor, id, only?)`

  The bodies moved over unchanged. The store-level `reviewCommentList`, `reviewCommentSetStatus` and `reviewCommentSend` are now one-line `store.transact` wrappers with the same signatures, return shapes and error texts, so the RPC verbs and `@tasks/review` need no changes. A local `type ReviewUow` names the unit-of-work type.
- **CLI (`tk.ts`, comments region):**
  - `commentsArgs` parses `comments <op> <id> …` and `comments <id> <op> …`.
  - `CommandService` gains `reviewList`, `reviewSend` and `reviewStatus`. Each runs inside `transaction(this.database, …)` with `this.actor`.
  - The dispatch builds the JSON values `{comments, counts}` and `{sent, counts}`, and the human formatters.
  - The HELP lines are updated. Outside the comments region the only other edits are import lines.
- **Presentation:** a `reviewHeader` helper is shared by the `tk show` REVIEW section and `formatReviewComments`. New `formatReviewSend` and `formatReviewStatus` (`✓ Resolved` / `✕ Dismissed` / `↺ Reopened`, followed by the refreshed list). All stored text goes through `safeFirstLine` (T-08-02).
- **Docs/skills:**
  - overview.md has a `tk comments` line in the CLI quick reference, plus a block and a paragraph in `### Review`.
  - Line 33 of both SKILL.md copies is updated.
  - The pi-extention copy was left alone, as the plan specifies.

## Verification (all run)

| Command | Result |
|---|---|
| `bun run --filter @tasks/surface build` | exit 0 |
| `bun test packages/surface/test/review-comments.test.ts packages/cli/test/comments.test.ts packages/cli/test/tk.test.ts` | 72 pass / 1 fail on the first run (the deviation below), then all pass |
| `bun test packages/surface/test packages/cli/test` | 257 pass, 0 fail |
| `cd packages/cli && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `cd packages/review && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `cd packages/surface && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `grep -n "tk comments send" …` (3 files) | all 3 match |
| `cd docs && bun run build` | Complete |

## Deviations

1. **Wrong expected count in the plan, Task 2.** The plan expected the header to read `1 open · 2 ✓` after `reopen t1` (with t2 dismissed and t3 resolved). `countReviewComments` counts only `resolved` under ✓, and dismissed comments count neither way, which overview.md also documents. So the correct label is `1 open · 1 ✓`. I fixed the test, not the counting rule.
2. **Test actor.** `comments.test.ts` sets `USER=reviewer` because the CLI takes its actor from `--actor` or `$USER`. The test then checks that this actor is stamped on every log entry (T-08-03).

## Notes

- **Commits withheld per AGENTS.md** (conservative profile): no git commit or push. STATE.md and ROADMAP.md were not updated, per orchestrator override.
- The stale comment in the `formatMarkdown` comment-bullets branch of presentation.ts still mentions `tk comments <id>`. The branch still applies to plain comment arrays and was left as is.
- Agent pickup of sent cards over the event stream is still deferred to Phase 10 (D-03).
