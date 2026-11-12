---
title: "The task-to-review HTML spec is the contract: when the build and the spec differ, change the build to match the spec"
author: Yuri
date: 2026-11-11
branch: main
cost: { minutes: 25, tokens: 31558 }
id: l-08e02796
scope: repo
status: active
src: agent
touches:
  - docs/html/task-to-review.html
  - ".planning/ROADMAP.md"
---

## Decided
The user treats the task-to-review spec page as the source of truth for the review feature. Every time the build drifted from it, the user chose to match the spec:
- Event wire: one append-only events log per workspace, read with per-subscriber cursors (`tk watch --until/--drain/--follow`). No daemon-hosted broker.
- TUI diff keys are hunk's own: `]`/`[` hunks, `.`/`,` files, `1`/`2` layout, plus s/l/z/search/select/copy, and the "watching worktree" indicator. Old keys stay only as non-colliding aliases.
- The task view has a working-tasks column (spec R34) next to the views nav, in both TUI and web. The nav was not accepted as a substitute.
- Untracked new files must show up in the live changeset.

## Tried and ruled out
- Daemon broker for events (5 plans written, then superseded): the spec says "There is no daemon".
- Accepting the shipped TUI keys (`[`/`]` files, `j`/`k` hunks, `u`/`p` layout) as-is.
- Treating the existing views nav as "the task list".

## Watch out
- Before proposing a design shortcut, read the matching spec section. Several earlier proposals contradicted it and had to be re-planned.
- Deliberate, documented deviations the user accepted: no `r` refresh key (live re-render replaces it); `z`/`v`/`y` act on whole diff/hunks.

In the code:
- spec: docs/html/task-to-review.html (sections 1-14) + docs/html/data/task-to-review-data.js (requests R01-R74)
- GSD tracking: .planning/ROADMAP.md phases 7-11 cover spec requests outside the original v1 roadmap
- superseded daemon plans: .planning/phases/10-event-wire-watch-broker/superseded/
