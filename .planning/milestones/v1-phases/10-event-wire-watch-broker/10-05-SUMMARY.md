---
phase: 10-event-wire-watch-broker
plan: 05
subsystem: tui
tags: [events, jsonl, watch, tui, notifications, debounce, wire]

requires:
  - phase: 10-event-wire-watch-broker
    provides: "10-02 read side: `tailEvents`, `lastEventSeq`, `toWatchEvent`"
  - phase: 09-task-view-parity
    provides: "09-05/09-10 App.tsx (task view, TASKS column, openTask, refs)"
provides:
  - "`TuiStore.watch(onEvent)` tails `.tasks/events.jsonl` from its current end and delivers real `WatchEvent`s; the 1s board-signature poll and `boardSignature` are gone"
  - "`eventToast(event)`, `sanitize`, `collapseToasts` (packages/tui/src/events.ts)"
  - "App: 100ms trailing-debounced `refresh()` per event burst, status-bar toast per window (last + ` (+N)`)"
affects: [10-VERIFICATION SC-2 (TUI half), SC-3]

actuals:
  tokens: ~70000
  tasks: 2
  commits: 0

key-files:
  created:
    - packages/tui/src/events.ts
    - packages/tui/test/events.test.ts
  modified:
    - packages/tui/src/store.ts
    - packages/tui/src/app/App.tsx
    - packages/tui/test/wait.ts
    - docs/src/content/docs/architecture.md
    - docs/src/content/docs/concerns.md

key-decisions:
  - "`watch` uses `tailEvents`' default start cursor (`lastEventSeq` at loop start), so no replay; stop() sets a local flag as well as aborting the tail, so it works before the tail's first read and drops lines from an in-flight batch"
  - "A throwing consumer callback is swallowed inside the tail so it never kills the subscription"
  - "Toasts from the TUI's own writes also arrive via the log; they replace the local action toast ~100-350ms later (e.g. `tk-1 → ready-to-review` then `tk-1 ready for review`). Accepted: one stream for every writer is the point of D-03"
  - "Body truncation is 60 cells including the `…`"

requirements-completed: [WIRE-02, WIRE-03]

coverage:
  - id: D1
    description: "CLI write (clean env) → events.jsonl → TuiStore.watch delivers task.status with real seq/from/to/actor; no replay in 500ms; stop ends the tail; in-process store.surface writes arrive; stop before start delivers nothing"
    requirement: WIRE-02
    verification:
      - kind: integration
        ref: "packages/tui/test/events.test.ts"
        status: pass
  - id: D2
    description: "Real App + real store: CLI `update --status ready-to-review` shows `<id> ready for review` in the frame; a CLI comment with an ESC sequence shows `<id> · <author>: please look` without ESC"
    requirement: WIRE-03
    verification:
      - kind: e2e
        ref: "packages/tui/test/events.test.ts"
        status: pass
  - id: D3
    description: "eventToast unit table: status targets, note comments (ANSI/C0/C1/OSC stripped, 60-cell truncation, actor fallback), review open/sent/resolved/dismissed, every other kind null, missing issueId null; sanitize; collapseToasts"
    requirement: WIRE-03
    verification:
      - kind: unit
        ref: "packages/tui/test/events.test.ts"
        status: pass

duration: ~45min
completed: 2026-11-11
---

# Phase 10 Plan 05: TUI on the event log Summary

**The TUI board now repaints from `.tasks/events.jsonl` instead of a 1s full-board poll, and the status bar shows a toast when a task goes to ready-to-review / approved / rejected, gains a note comment, or has a review comment opened or sent.**

Commits withheld per AGENTS.md (no git commit/push in this session). STATE.md / ROADMAP.md not updated per orchestrator override. Worked in the main tree; nothing in packages/git, packages/review, packages/pi-extention (concurrent 09-09 / 10-06) was touched.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (tracer) | CLI write → log → `TuiStore.watch` → onEvent | withheld | store.ts, events.test.ts |
| 2 | `eventToast` + App wiring (debounce, toasts) | withheld | events.ts, App.tsx, events.test.ts |

## What was built

- **store.ts.** `watch(onEvent)` = `tailEvents(surface.store.tasksDir, { onEvents })` mapping each line through `toWatchEvent`. The `intervalMs` parameter is gone (the only caller, App.tsx, never passed it). `boardSignature` was used only by the poll and is deleted. Header comments now say the board refreshes from the log.
- **events.ts.** Pure `eventToast(event)`:
  - `task.status` to `ready-to-review` / `approved` / `rejected` → `<id> ready for review` / `<id> approved` / `<id> rejected`; any other target → null.
  - `task.comment` `kind: note` → `<id> · <author>: <body>` (author falls back to actor), body cut to 60 cells with `…`.
  - `task.comment` `kind: review`, `to: open` → `<id> · review comment at <file>:<line>` (falls back to `location`, then plain `review comment`); `to: sent` → `<id> · review comment sent`; resolved / dismissed → null.
  - Everything else, or no issueId → null.
  - `sanitize` strips ANSI CSI (7-bit and C1 `\x9b`), OSC, lone ESC sequences, then C0/DEL/C1; tab/newline become one space.
- **App.tsx.** The watch effect now sits after `notify`. Each event: `setLastEvent`, queue its toast, restart a 100ms timer. On fire: one `refresh()` and `notify(collapseToasts(queue))`. Timer cleared on unmount. No key handling, TASKS column, `openTask` or refs from 09-10 were touched.

## Verification (all run, results as observed)

| Command | Result |
|---------|--------|
| Task 1 verify: `bun run --filter @tasks/tui build && bun test --timeout 15000 packages/tui/test/events.test.ts packages/tui/test/boot.test.tsx packages/tui/test/app.test.tsx` | build exit 0; first run 29 pass / 1 fail (a bug in my test helper: `undefined` hit the default `issueId`; fixed to `null`), then 30 pass / 0 fail |
| `bun test --timeout 15000 packages/tui/test/events.test.ts` (after adding the App e2e test) | 9 pass / 0 fail |
| Plan verification: `bun run --filter @tasks/tui build && bun test --timeout 15000 packages/tui/test && bun run --filter @tasks/tui check` | build exit 0; 123 pass / 0 fail across 9 files (113s); check exit 0 |
| `bun packages/tui/test/taskview-smoke.ts` | run 1: `12 passed, 0 failed`; run 2: `12 passed, 0 failed` (no flakes observed in 2 runs) |
| `bun packages/tui/test/review-smoke.ts` | `review-smoke: all green (9 checks)` |
| `bun packages/tui/test/smoke.ts` | `smoke: all green (13 checks)` |
| `cd docs && bun run build` | Complete |

**Mutation checks (the tests bite):**
- `notify(toast)` removed from the App debounce → the App e2e test fails (toast never appears).
- `ESCAPE_SEQUENCE` replace disabled in `sanitize` → 3 eventToast tests fail.

**tmux look-check (human-check from the plan, real binary).** Scratch repo under the session scratchpad, tmux `-L p1005-<pid>`, 120x24; server killed and repo removed afterwards (`tmux ls` → no server). One in-progress task; then from outside the TUI:
- `tk update <id> --status ready-to-review` → within 1.2s the row shows `👀 P2 ready…`, counts `rev 1`, status bar `· tk-179 ready for review`.
- `tk comment <id> "see \e[31mthis"` → row gains `💬1`, status bar `· tk-179 · yuri: see this` (no escape reached the terminal).
- Captures: `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/10-05-before.txt`, `.../10-05-after.txt`, `.../10-05-comment.txt`.

## Deviations from Plan

1. **[Rule 2] App-level e2e test added** to events.test.ts (via `createElement`, so the file stays `.ts` as planned). It covers the debounce → refresh → notify wiring end to end, which the plan's store/unit tests did not.
2. **[Rule 2] Docs (AGENTS.md: docs land with the code).** architecture.md: TUI Board Path step 3 now describes the log tail, debounce and toast table; the consumer list no longer says the TUI still polls; "each board poll" → "each board refresh"; the TUI-resilience line describes the tail. concerns.md: two lines that described `boardSignature` / the 1s poll. Neither file was in `files_modified`.
3. **[Rule 1] Stale comment** in packages/tui/test/wait.ts ("the watch poll drives the renderer's own loop timeouts") reworded; comment only.

## Observed, not fixed (out of scope)

- In the look-check the board counter showed `wip 0` while the only task was listed as `in-pr…`. `buildBoard` tallies `status === "in_progress"`; the CLI-written status may be spelled `in-progress`. This is pre-existing (store.ts counts were not touched by this plan) and worth a follow-up check.

## Threat model

- **T-10-26** mitigated: `sanitize` on author, body, file, location and id; unit tests and the e2e test pin it.
- **T-10-27** mitigated: 100ms trailing debounce, one `loadBoard()` per burst.

## Self-Check: PASSED

- Created files exist: packages/tui/src/events.ts, packages/tui/test/events.test.ts.
- Every verify command was run; the results above are the observed output.
- No commits to check (withheld per AGENTS.md).
