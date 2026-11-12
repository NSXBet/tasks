---
phase: 10-event-wire-watch-broker
plan: 04
subsystem: web
tags: [events, sse, web, live-board, toasts, repoint]
requires:
  - phase: 10-02
    provides: tailEvents / readEvents / toWatchEvent / normalizeKinds over .tasks/events.jsonl
  - phase: 09-08
    provides: last Phase 9 state of packages/web/src/server.ts + app.html (09-09/09-11 also landed)
provides:
  - "`GET /events` SSE `event: task` frames from one `tailEvents` per active workspace"
  - "`GET /api/events` read straight from the active log: `{ events, dropped: 0, workspace }`, 512/page"
  - "Event-driven web board (no 2s poll), 100ms debounced refresh, review toasts, reconnect reconcile"
affects: [10-05, 11-04]
actuals:
  tasks: 3
  commits: 0
key-files:
  created:
    - packages/web/test/events.test.ts
  modified:
    - packages/web/src/server.ts
    - packages/web/src/app.html
    - packages/web/test/server.test.ts
    - docs/src/content/docs/rpc.md
    - docs/src/content/docs/architecture.md
    - docs/src/content/docs/overview.md
key-decisions:
  - "The tail reads `surface.store.tasksDir` (not join(root, '.tasks')) so it always matches the store that writes the log"
  - "startEventTail pins `lastEventSeq` first, then stops the previous tail, so overlapping repoints never leave two tails"
  - "No own-actor toast skip: /api/status exposes no actor, and the page's actor equals $USER which also stamps the user's terminal tk writes"
  - "#conn stale mark now follows EventSource onerror/onopen only"
---

# 10-04 SUMMARY: web event wire

Commits withheld per AGENTS.md (conservative profile, orchestrator override). All changes are uncommitted in the main tree. STATE.md and ROADMAP.md were not touched. Nothing in packages/tui (10-05) was touched.

## Tasks

| Task | Name | Status | Files |
|---|---|---|---|
| 1 (tracer) | CLI status change → events.jsonl → web tail → SSE `event: task` | done | server.ts, events.test.ts |
| 2 | `/api/events` over the log; repoint moves both channels | done | server.ts, events.test.ts, server.test.ts, rpc.md |
| 3 | page: event-driven refresh, review toasts, no 2s poll | done | app.html (+ shell test in events.test.ts) |

## What changed

**server.ts**
- Removed the `runWatchLoop` + `createEventRing`/`EventRing` block (and the `runWatchLoop` import).
- `broadcastTask(event)` writes `event: task\ndata: <JSON>\n\n` to every `reloadWaiters` entry, the same list `broadcastReview` uses. The payload is JSON-encoded, so user text can't inject SSE lines.
- `startEventTail(tasksDir)` → `tailEvents(dir, { after: lastEventSeq(dir), onEvents })`, which maps each line with `toWatchEvent`. A `live` flag mutes a stopped tail's in-flight batch. It is started for the boot store before `Bun.serve`, and `stopEventTail` is in `stopWatches`, so it stops on `stopServer`, on the bind-failure path and on the ownership-probe failure path.
- `open()` awaits `startEventTail(newSurface.store.tasksDir)` (which stops the old tail) before `broadcastReload()`.
- `GET /api/events` = `readEvents(active.surface.store.tasksDir, { after })` → `normalizeKinds` filter → first `EVENTS_PAGE_LIMIT` (512, exported) → `toWatchEvent`. It returns `{ events, dropped: 0, workspace: active.root }`. A bad `after` still returns 400.
- **tasks-qliz:** `/api/rpc` now dispatches with `root: active.root`. **Finding:** the bug was not observable. The web's `provide()` lease ignores `request.root` and always returns `active.surface`, so RPC writes already reached the active workspace (a mutation back to `options.root` keeps the tests green). The change makes the envelope consistent, and the repoint test pins the behaviour. I added a note to the task and did not close it.

**app.html**
- `setInterval(refresh, 2000)` is deleted. `refresh()` no longer toggles `#conn`. `#conn` title is now `live · event stream`. Two code comments that mentioned the 2s poll were reworded.
- New `task` listener → `onTaskEvent`. It ignores JSON parse failures and non-object payloads.
  - The first frame of a burst schedules `flushTaskBurst` at 100ms. The flush runs one `refresh()`, which re-renders board/list and re-opens a shown modal with fresh data (existing logic). It also calls `loadTaskView(selected)` when the burst carried a `task.comment` for the task on screen, and sends one `<id> · N review comment(s) sent` toast per task.
  - `task.comment` and `task.update` call `window.ReviewIsland?.refresh?.(id)`. The island already filters by id.
  - Toasts via `toast()` (textContent): `<id> ready for review` / `approved` / `rejected`; note `<id> · <author>: <body clipped to 80>`; review `to: open` (from ≠ open) `<id> · review comment at <location | file:line>`.
  - Note: `loadThreads` named in the plan no longer exists (09-06 replaced it with `loadTaskView`).
- `events.onopen` clears stale and, after an `onerror`, calls `refresh()` once. `onerror` marks stale. The `onmessage` reload handler and the `review` listener are byte-identical.

**Tests**
- `events.test.ts` (new, 5 cases), with spawned `tk` on a clean env (no `TK_SESSION`/`TK_EVENTS`) and servers closed in `afterEach`:
  1. A CLI `update --status in-progress` gives a `task` frame within 2s, with `task.status`, `data.to`, and `seq` equal to the log line seq. An `/api/rpc issue.update` gives a `task.update` frame.
  2. Shell gates: the `task` listener, the 100ms debounce, the toast strings, the reconnect line, no `setInterval(refresh`, and the 05-01 `onmessage`/`review` lines unchanged.
  3. `/api/events` over 3 real log lines: order, `after=<2nd seq>`, `kinds=task.status` and legacy `issue.status_changed`, `dropped: 0`, `workspace`, 400 on `after=-1`.
  4. A 600-line log (via `appendEvents`) gives a page of exactly seqs 1..512, then `after=512` gives 513..600.
  5. Repoint A→B: `data: reload`, reconnect, a write in A produces no frame and no `/api/events` entry, a write in B produces both, `workspace: B`, and an `/api/rpc` write after the repoint lands in B.
- `server.test.ts`: dropped the `createEventRing` import and the ring eviction test. The `/api/events` test now covers the server's own RPC create showing up immediately (`task.created`), `after`, legacy kinds, `dropped: 0`, `workspace` and `EVENTS_PAGE_LIMIT === 512`.

**Docs**
- `rpc.md` `/api/events` paragraph rewritten: the source is events.jsonl, `seq` = log seq, 512 cap with paging, the alias table, `dropped` always 0 (kept for compatibility), and `workspace` changes on repoint so clients restart from `after=0` or reconcile. It also has a new note on `/events` `task` frames next to `reload`/`review`.
- `architecture.md`: the consumer sentence now describes the web tail and `/api/events` (the TUI still polls, plan 05). "the 2s poll does not re-render…" now reads "board refreshes…". Both were exact-string edits.
- `overview.md`: a new "Live web board" paragraph after the web task view section (no poll, debounce, reconnect, stale dot, toast list, repoint). The TUI line at ~292 belongs to 10-05 and is untouched.
- No verb or protocol change, so `VERBS_VERSION`/`PROTOCOL_VERSION` are not bumped.

## Deviations from Plan

1. **[Rule 1] Tail directory is `surface.store.tasksDir`,** not `join(root, ".tasks")`, so the tail always matches the store that writes the log. It is the same path in every tested setup.
2. **Doc edits beyond `rpc.md`** (architecture.md, overview.md). AGENTS.md requires the doc to change with the behaviour, and architecture.md said the web SSE "still polls".
3. **Own-actor toast skip not implemented.** The plan says to skip only if `/api/status` exposes an actor, and it does not. Skipping on the board `actor` ($USER) would also hide the user's own terminal `tk` writes, which the human check expects to toast. Side effect: the page's own status change shows both its existing `id → status` toast and then the stream toast.
4. **`task.comment` with `to: open` from `open`** is not toasted (it's an edit, not a new comment). A reopen (resolved → open) does toast.
5. **`loadThreads` → `loadTaskView`** (09-06 rename).

## Verification (all run, after the last edit)

| Command | Result |
|---|---|
| `bun run --filter @tasks/web build && bun test --timeout 15000 packages/web/test/events.test.ts packages/web/test/live.test.ts` | 10 pass, 0 fail |
| `bun test --timeout 15000 packages/web/test` | 40 pass, 0 fail (6 files) |
| `! grep -n "setInterval(refresh" app.html && grep -q 'addEventListener("task"' app.html` | GATE-OK |
| `cd packages/web && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `cd docs && bun run build` | Complete |
| RED first | events.test.ts: 4/4 failed against the pre-change server |
| Mutations | without `startEventTail` in `open()` the repoint test fails; `/api/events` reading `options.root` fails the repoint test; `/api/rpc` `options.root` stays green (see tasks-qliz finding) |

**Flake, not caused by this plan:** `live.test.ts` "worktree commit pushes a branch frame" failed in 2 of ~12 runs during the session. The load average was 5–27, from concurrent executors. I ran an A/B with the pre-change server.ts copied to a temporary module and an identical test (both temp files removed afterwards). Over 6 runs each it was baseline 1 fail and new 1 fail. Cause: the test's fixed 600ms `settle` races the async initial sync pass under load. The final full run passed.

### Browser probe (`AGENT_BROWSER_SESSION=gsd1004`, port 60446)

Scratch: `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p1004/` (repo A with tk-ulm and tk-btx, repoB with tb-g4b). The server was started from source via `serve.ts`.

| Step | Observed |
|---|---|
| Idle 6s after load | 0 `/api/board` fetches (no poll); `#conn` title `live · event stream` |
| terminal `tk update tk-ulm --status ready-to-review` | 1 board fetch; card moved to Review within 1.2s; toast `tk-ulm ready for review` |
| `tk comment` with `<img src=x onerror=alert(1)> …` | toast `tk-ulm · yuri: <img src=x onerror=alert(1)> looks good … th…` (literal text, clipped at 80, 0 `img` in #toast, no dialog) |
| review thread create ×2, then send | `review comment at a.txt:1`, `review comment at a.txt`, then one `tk-ulm · 2 review comments sent` |
| `--status approved` / `rejected` | `tk-ulm approved`, `tk-btx rejected` |
| task view `/tasks/tk-ulm`, new review thread via API | `COMMENTS · 2` → `COMMENTS · 3` with the body shown, no reload; TASKS column present |
| `POST /api/open` → repoB | page reloaded onto B; write in A gave no toast; write in B gave `tb-g4b ready for review`; `/api/events` `workspace` = repoB with only B events |
| kill server, `tk create` in B, restart on same port | `#conn` `stale` while down; after reconnect stale cleared and "made while down" on the board (reconcile) |

Screenshots: `…/p1004/10-04-taskview-toast.png`, `…/p1004/10-04-reconnect.png`. Teardown: browser closed, real bun pids 5370 and 8305 killed, `pgrep serve.ts` empty, port answers 000.

Human check from the plan (`tk web` + terminal tk): covered by the probe above against the source server. It was not run through the installed `tk web`/daemon path.

## Notes for next plans

- 10-05 (TUI): the architecture.md consumer sentence still says the TUI board refresh polls (plan 05). Update that clause, and overview.md ~292 ("watch-poll").
- 11-04: `task.pr` frames will ride `/events` automatically. Add a toast case in `taskToast` (app.html) if wanted.
- tasks-qliz: noted, not closed. The fix is cosmetic given the lease.

## Self-Check: PASSED
