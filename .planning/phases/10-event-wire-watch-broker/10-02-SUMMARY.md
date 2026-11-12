---
phase: 10-event-wire-watch-broker
plan: 02
subsystem: surface
tags: [events, jsonl, watch, wire, query, cursors, rpc, luau, daemon]

requires:
  - phase: 10-event-wire-watch-broker
    provides: "10-01 write side: `.tasks/events.jsonl`, `readEvents`/`lastEventSeq`/`withEventsLock`, derive.ts type table"
provides:
  - "`runWatchLoop` reads the event log (no board diff); `seq` = log seq; `after` replay; fs.watch wake-up"
  - "`tailEvents` / `waitForAppend` read primitive (events/tail.ts) for TUI/web/pi (10-04..10-06)"
  - "`KIND_ALIASES` / `normalizeKinds` / `toWatchEvent` + spec query grammar `parseEventQuery` / `matchesEvent` / `withTasks` (events/query.ts)"
  - "per-subscriber, per-host cursors in `.tasks/cursors.json` (`readCursor` / `writeCursor` / `seedCursor`, events/cursors.ts)"
  - "VERBS_VERSION 5 in TS and Luau; rpc.md + architecture.md describe the log wire"
affects: [10-03, 10-04, 10-05, 10-06, 11-04]

actuals:
  tokens: ~95000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Readers pin a start cursor (`after` ?? `lastEventSeq`) before the first tick, then read `seq > cursor`"
    - "`waitForAppend` = fs.watch(tasksDir) filtered to events.jsonl, timer fallback, plus an immediate `lastEventSeq > after` check that closes the read→arm race"

key-files:
  created:
    - packages/surface/src/events/tail.ts
    - packages/surface/src/events/query.ts
    - packages/surface/src/events/cursors.ts
    - packages/surface/test/events-read.test.ts
  modified:
    - packages/surface/src/watch/core.ts
    - packages/surface/src/watch/protocol.ts
    - packages/surface/src/index.ts
    - packages/surface/test/watch.test.ts
    - packages/surface/test/status-runs.test.ts
    - packages/daemon/src/events.ts
    - packages/daemon/src/server.ts
    - packages/daemon/test/daemon.test.ts
    - packages/rpc/src/protocol.ts
    - packages/lua/luau/tk/wire.luau
    - packages/lua/luau/tk/events.luau
    - packages/lua/luau/tk/tests/integration_tests.luau
    - packages/web/src/server.ts
    - packages/web/test/server.test.ts
    - packages/tui/src/store.ts
    - packages/pi-extention/src/watch-manager.ts
    - packages/pi-extention/src/index.ts
    - packages/pi-extention/test/entry.test.ts
    - docs/src/content/docs/rpc.md
    - docs/src/content/docs/architecture.md

key-decisions:
  - "`diffOnce` and `ReaderState` are gone. Every runWatchLoop consumer reads the log. 11-04 adds `task.pr` in events/derive.ts (and `pr` to `coveredMetadata()`), never as a watch watermark"
  - "Emitted kinds = log types; legacy names are subscription aliases only (TS `KIND_ALIASES`, mirrored in events.luau)"
  - "`owner=` matches `task.owner` lines on `data.to`, and any other line when the task's current owner is the value (via `ctx.ownerOf`), so `owner=me,type=task.comment` works as the spec example intends"
  - "Daemon `events.subscribe` pins its start cursor before replying, and a restarted loop resumes after the last delivered seq"

requirements-completed: [WIRE-01, WIRE-02]

coverage:
  - id: D1
    description: "surface.status → log → runWatchLoop delivers task.status within 1s at interval 2000 (fs.watch), no replay of the existing log, seq/at equal the log line's, counts attached; legacy alias, kinds, ids and label filters; after:0 replay; runtime row lifecycle"
    requirement: WIRE-02
    verification:
      - kind: integration
        ref: "packages/surface/test/watch.test.ts"
        status: pass
  - id: D2
    description: "run.changed delivered from the log with from/to, kinds+ids filters, and no event for a same-state save"
    requirement: WIRE-02
    verification:
      - kind: integration
        ref: "packages/surface/test/status-runs.test.ts"
        status: pass
  - id: D3
    description: "Query grammar (status/task/type/actor/owner/mine, errors, whitespace, empty), withTasks, aliases, toWatchEvent, cursors (null/unset, per subscriber+host, seed, 20 concurrent writers, malformed file), tailEvents (log-end start, append delivery, replaced file drops seen seqs)"
    requirement: WIRE-01
    verification:
      - kind: unit
        ref: "packages/surface/test/events-read.test.ts"
        status: pass
  - id: D4
    description: "Daemon events.subscribe emits task.created; a legacy `kinds: [\"issue.created\"]` subscription receives it too"
    requirement: WIRE-02
    verification:
      - kind: integration
        ref: "packages/daemon/test/daemon.test.ts"
        status: pass
  - id: D5
    description: "Luau client: hello matches VERBS 5; legacy `issue.created` subscription fires with `task.created` from a second client"
    requirement: WIRE-02
    verification:
      - kind: e2e
        ref: "packages/lua/luau/tk/tests/integration_tests.luau"
        status: pass

duration: ~60min
completed: 2026-11-11
---

# Phase 10 Plan 02: Event wire (read side) Summary

**Every stream consumer now reads `.tasks/events.jsonl`. `runWatchLoop` tails the log with the log's own `seq`, wakes on `fs.watch`, accepts legacy kind names as aliases, and has query and cursor support for `tk watch` (10-03) and the pi extension (10-06). VERBS is 5 in TS and Luau.**

Commits withheld per AGENTS.md (no git commit/push in this session). STATE.md / ROADMAP.md not updated per orchestrator override.

## Emitted kinds

`task.created`, `task.status`, `task.owner`, `task.comment`, `task.update`, `task.evidence`, `task.worktree`, `task.deleted`, `run.changed`. These are exactly the 10-01 log types; `data` per the 10-01 table.

`WatchEvent` mapping (`toWatchEvent`): `kind` = type, `at` = ts, `issueId` = task, `seq` = log seq, `data` = `{ actor, session?, ...line.data }`. Review `task.comment` also gets the deprecated `commentId` (= `comment`). `counts` is computed once per delivering tick and attached to every event.

## Alias table (`KIND_ALIASES`, packages/surface/src/events/query.ts; mirrored in packages/lua/luau/tk/events.luau)

| legacy | → |
|---|---|
| `issue.created` | `task.created` |
| `issue.status_changed` | `task.status` |
| `issue.commented` | `task.comment` |
| `issue.deleted` | `task.deleted` |
| `issue.updated` | `task.update`, `task.owner`, `task.evidence`, `task.worktree` |
| `ready.changed`, `counts.changed` | `task.created`, `task.status`, `task.deleted`, `task.update` |

Unknown names pass through and match nothing. `ready.changed`/`counts.changed` are no longer emitted.

**`diffOnce` is gone** (and `ReaderState`, the ready-hash and the per-issue `updatedAt` watermarks with it). Phase 11-04 must add `task.pr` in `packages/surface/src/events/derive.ts`, not as a watch watermark.

## Accomplishments

- **tail.ts:** `waitForAppend(tasksDir, ms, { after?, signal? })` returns on an `fs.watch` change to `events.jsonl`, on timeout, or on abort, whichever comes first. With `after`, it also returns at once if the log already holds a newer seq. `tailEvents(tasksDir, { after, onEvents, pollMs = 250 }) → { stop, done }`.
- **query.ts:** `KIND_ALIASES`, `normalizeKinds`, `toWatchEvent`, `parseEventQuery`, `matchesEvent(event, query, { me, ownerOf? })` (lookup cached per call), `withTasks`. Unknown keys, empty values and bare words other than `mine` throw `invalid watch query: <clause>`. `me` in `owner=`/`actor=` resolves to `ctx.me`.
- **cursors.ts:** `.tasks/cursors.json` = `{ version: 1, subscribers: { <name>: { <host>: seq } } }`. Reads tolerate a malformed file. Writes are atomic `writeJson` under `withEventsLock`. Also exports `readCursors` and `CURSORS_FILE`.
- **protocol.ts:** `WatchEventKind` holds the spec kinds, plus a new `LegacyWatchEventKind`. `WatchSubscription.kinds` accepts both, and `WatchSubscription` has a new `after?`. `WatchEvent.data` gains the 10-01 fields (from/to are now nullable). `parseWatchArgs` takes `--after <n>` (negative or non-integer values are ignored).
- **core.ts:** `runWatchLoop` keeps its signature, runtime registry rows and 3-strike budget. Per tick it runs `processWakeups` (unchanged), then `readEvents(after: lastSeq, limit: MAX_EVENTS_PER_TICK)` and filters by kinds and ids. Labels are looked up via `findById` once per distinct task, inside one transaction. Counts are computed once with the old open/blocked/readyToReview rules, then delivered. A full batch skips the wait so a backlog drains promptly. `spawnWatchChild` forwards `--after`.
- **index.ts:** three additive `export *` lines (tail, query, cursors).

## Deviations from Plan

1. **[Rule 1 – Bug] Lost first event on daemon subscribe.** The loop pins its cursor asynchronously, so an `issue.create` sent right after the `events.subscribe` reply could land before the pin. That event would be lost, where the old full-board first tick used to report it. Fix: `EventsHost.subscribe` now returns a promise that resolves once the cursor is pinned, and `server.ts` awaits it before replying. Restarts also lost or duplicated events (they re-subscribed at the log end, or at the original `after`). They now resume after the last delivered seq, and the restarted watch is re-registered in the socket map; before, it was untracked and could not be unsubscribed. `events.subscribe` validates `after` (a non-negative integer).
2. **[Rule 1] Web `/api/events` ring.** Same race at web server start, fixed by pinning `lastEventSeq` before `runWatchLoop`. The ring's `kinds` filter now uses `normalizeKinds`; without it the Luau client's legacy `kinds=issue.created` query would match nothing. web/test/server.test.ts now expects `task.created`. The `/api/events` doc paragraph is left to 10-04, except that its example kind now reads `task.update`.
3. **[Rule 1] Luau client-side kind filter.** `events.luau` re-filters by kind on the client, so a legacy `issue.created` subscription would drop `task.created` rows. It now has the alias table, keeping the original names as well so the existing unit tests still hold. Without this the plan's integration-test requirement (legacy subscription, `task.created` assertion) could not pass.
4. **[Rule 3] Typecheck fallout in consumers** of the narrowed `WatchEventKind`:
   - tui/src/store.ts: the synthetic board-refresh event kind changed from `issue.updated` to `task.update`.
   - pi-extention `formatEvent`: added spec-kind cases and kept the legacy ones.
   - pi `Kinds` tool schema: now lists the spec kinds; the legacy names are still accepted.
   - entry.test.ts: two new assertions.

   10-05/10-06 will rewrite these properly.
5. **status-runs.test.ts** had two `diffOnce` run tests. They are rewritten as one log-sourced `runWatchLoop` test.
6. **Doc extras:** the architecture.md TUI step and the surface table rows no longer say "watch daemon". The consumer list says plainly that web `/events` SSE and the TUI board refresh still poll until 10-04/10-05.

## Verification (all run, results as observed)

- `bun run --filter @tasks/surface build`: OK
- `bun test packages/surface/test/watch.test.ts packages/surface/test/status-runs.test.ts packages/cli/test/runtime-inbox.test.ts`: 15 pass
- `bun test packages/surface/test/events-read.test.ts`: 11 pass
- `bun run --filter @tasks/daemon build && bun test packages/daemon/test/daemon.test.ts`: 8 pass (3 consecutive runs)
- `bun run --filter @tasks/rpc check`: exit 0. `bun run --filter @tasks/daemon check`: exit 0
- grep checks: `VERBS_VERSION = 5` in protocol.ts and wire.luau; `events.jsonl` in rpc.md and architecture.md. All OK
- `cd docs && bun run build`: Complete
- `bun run --filter @tasks/lua test` (lune installed): all suites passed, including the integration test with a legacy subscription and a `task.created` assertion
- Plan-level: `bun test packages/surface/test packages/daemon/test packages/cli/test/runtime-inbox.test.ts`: 113 pass, 0 fail
- Consumers: `bun test --timeout 15000 packages/web/test` 32 pass; `bun test --timeout 15000 packages/tui/test` 109 pass; pi-extention `bun test ./test/` 4 pass, and `bun run build` OK
- Typechecks: web, tui, cli and surface `check` all exit 0
- Extra regression: `bun test packages/cli/test` 188 pass, 0 fail (`@tasks/rpc` has no test dir, so there is no rpc test suite to run)

## Notes for next plans

- 10-03 `tk watch`: use `parseEventQuery` + `withTasks(query, positionalIds)` + `matchesEvent`, with cursors from `readCursor`/`seedCursor`/`writeCursor` (subscriber name = session or `--name`) and `tailEvents`/`waitForAppend` for `--until`/`--follow`.
- 10-04 web `/events` SSE: `tailEvents(tasksDir, { onEvents })`. `/api/events` already carries log kinds through the ring.
- 10-05 TUI: replace the `boardSignature` poll in tui/src/store.ts with `tailEvents`.
- 10-06 pi: `WatchManager` already runs `runWatchLoop` over the log. `formatEvent` has interim spec-kind cases.
- Label filtering can't see deleted tasks (`findById` → null), so `task.deleted` never passes a `label` filter.
- `readEvents` re-reads the whole file each tick (fine for v1; a byte-offset tail is a later optimization alongside retention).

## Self-Check: PASSED
