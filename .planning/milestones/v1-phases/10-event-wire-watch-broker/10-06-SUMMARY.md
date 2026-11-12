---
phase: 10-event-wire-watch-broker
plan: 06
subsystem: pi-extention
tags: [events, inbox, pi, omp, watch, cursors, tasks_wait, docs]

requires:
  - phase: 10-event-wire-watch-broker
    provides: "10-01 write side (events.jsonl envelope with session); 10-02 tail/cursors/query; 10-03 waitUntil/drainEvents/followEvents"
provides:
  - "pi/omp inbox: auto-start on session_start, tails events.jsonl from cursor `pi:<session>`, followUps for sent review cards / plain comments / approved / rejected on followed tasks, with the next command"
  - "session-start drain brief (`📬 while you were away`); first-ever session seeds at log end"
  - "`tasks_wait` tool over the shared `waitUntil`"
  - "`formatEvent` on the log kinds with sanitised user text"
affects: [11-04]

actuals:
  tokens: ~60000
  tasks: 3
  commits: 0

key-files:
  created:
    - packages/pi-extention/src/inbox.ts
    - packages/pi-extention/test/inbox.test.ts
  modified:
    - packages/pi-extention/src/index.ts
    - packages/pi-extention/src/watch-manager.ts
    - packages/pi-extention/test/entry.test.ts
    - packages/pi-extention/skills/tasks/SKILL.md
    - docs/src/content/docs/integrations.md
    - docs/src/content/docs/testing.md

key-decisions:
  - "The inbox reads `type=task.comment|task.status|task.worktree`. Worktree lines (and finish status lines carrying this session) only grow the follow set and are never delivered."
  - "Only sent review cards, `kind: note` comments and status → approved/rejected are delivered. Resolve/dismiss/reopen and other status moves stay silent."
  - "The inbox store is opened readonly (cursor writes go through `.tasks/cursors.json`, not the store), the same choice 10-03 made."
  - "`tasks_wait` seeds `pi:<session>` at the log end when the cursor is absent (e.g. `TK_INBOX=off`), so a `type=task.comment` wait never matches history."

requirements-completed: [WIRE-01, WIRE-03]

coverage:
  - id: D1
    description: "session_start in a task worktree → reviewer `tk comments send` → exactly one followUp with both cards (cid, location, author, body; ANSI stripped); approval → followUp with `tk close`; agent-session comment → nothing; after session_shutdown → nothing; TK_INBOX=off → nothing"
    requirement: WIRE-03
    verification:
      - kind: e2e
        ref: "packages/pi-extention/test/inbox.test.ts (inbox (tracer))"
        status: pass
  - id: D2
    description: "drain brief lists an offline comment on cwd-followed T and an approval on agent_session-followed U, cursor at log end, a repeat start sends nothing; a first-ever session seeds at the log end with no brief"
    requirement: WIRE-03
    verification:
      - kind: e2e
        ref: "packages/pi-extention/test/inbox.test.ts (inbox drain brief)"
        status: pass
  - id: D3
    description: "`tasks` show(id) follows the task; tasks_wait: timeout result, two concurrent waits resolved independently by another process's reject/approve, invalid query → error with the parser message"
    requirement: WIRE-01
    verification:
      - kind: e2e
        ref: "packages/pi-extention/test/inbox.test.ts (follow on touch, tasks_wait)"
        status: pass
  - id: D4
    description: "formatEvent for every log kind + sanitisation + legacy kinds; tasks_watch_start accepts new and legacy kind names and delivers log lines"
    requirement: WIRE-01
    verification:
      - kind: unit
        ref: "packages/pi-extention/test/entry.test.ts"
        status: pass
      - kind: e2e
        ref: "packages/pi-extention/test/inbox.test.ts (tasks_watch_start)"
        status: pass

duration: ~40min
completed: 2026-11-11
---

# Phase 10 Plan 06: pi/omp inbox on the event log Summary

**A pi/omp session opened inside a tasks workspace now starts an inbox with no tool call. The inbox tails `.tasks/events.jsonl` from cursor `pi:<session>`. A reviewer's sent cards, plain comments, approvals and rejections on the session's tasks arrive as one followUp per task, each naming the next command. At session start the inbox sends a brief of anything missed. Agents can also block on the new `tasks_wait` tool.**

Commits were withheld per AGENTS.md (no git commit or push). STATE.md and ROADMAP.md were not updated, per the orchestrator override.

## Accomplishments

- **`packages/pi-extention/src/inbox.ts` (new):**
  - Exports `createInbox({ root, session, cwd, notify, coalesceMs? })` → `{ start, follow, stop, followed }`, along with `inboxMessage`, `inboxBrief`, `isInboxEvent`, `sanitize`, `inboxSubscriber`, `INBOX_TYPES` and `INBOX_COALESCE_MS = 250`.
  - **Seeding the follow set:** it pages through every issue once, matching on `metadata.worktree` containing cwd (compared after realpath) or `metadata.agent_session === session`.
  - **Growing the follow set:** it adds tasks from `task.worktree` lines whose path contains cwd and from `task.status` lines whose `data.session` is this session. `follow(ids)` adds tasks directly.
  - **Start:**
    - If no cursor exists, it calls `seedCursor` at `lastEventSeq`.
    - Otherwise it runs `drainEvents`, filters the result, and sends one `📬 while you were away` brief.
    - Then it calls `followEvents`. Messages are grouped per task, with a 250ms timer per task.
  - **Formats:** these match the plan exactly (📝 cards, 💬 notes, ✅ approved, ↩ rejected). `sanitize` strips ANSI CSI (7-bit and C1), OSC and 2-char ESC sequences plus C0/C1 controls, then collapses whitespace (T-10-28).
- **`index.ts`:**
  - **`session_start`** (now async):
    - It resolves `rootFrom(ctx.cwd)` and sets the session id from `TK_SESSION` › `PI_SESSION_ID` › `pi-<pid>`.
    - It stops any previous inbox and starts a new one, unless no workspace is found or `TK_INBOX=off`.
    - A start failure is reported as a followUp.
  - **`session_shutdown`** stops the inbox.
  - **Following touched tasks:** the `tasks` tool follows `id`/`ids` after a successful op. `tasks_watch_start` and `tasks_wait` follow their `ids`. Ids touched before the inbox started are replayed into it.
  - **New `tasks_wait` tool:**
    - Parameters: `query`, optional `ids`, and `timeoutMs` (default 30 min, clamped to 2 h, T-10-31).
    - It calls `waitUntil` with subscriber `pi:<session>`, `withTasks(parseEventQuery(query), ids)`, `me` set to the store actor, and the tool's abort signal.
    - It returns `{matched:true,event}` or `{matched:false,timedOut:true}`. An invalid query returns an error result carrying the parser message.
  - **`Kinds` and the `tasks_watch_start` description** were updated: log tail, no polling of the board, and the inbox covers your own tasks.
- **`watch-manager.ts`:**
  - `formatEvent` was rewritten for the `task.*` kinds and `run.changed`, adding title, actor, from → to, author: body, location, fields, evidence name, and branch/path. All user text is sanitised and legacy kinds are kept.
  - The header comment now says both transports tail events.jsonl.
- **Docs:**
  - integrations.md (pi/omp section) covers: the extension reading the log, the inbox's follow rules, own-session filtering, a message table, the drain brief, the cursor, `TK_INBOX=off`, `tasks_wait`, and the `tasks_watch_start` kinds.
  - testing.md has a new "Tests that spawn `tk watch` or tail the log" section and an updated inventory.
  - The pi SKILL.md step 5 now covers `tasks_wait` and the inbox followUps.

## Deviations from Plan

1. **[Rule 1 - Bug] `WatchManager` was constructed without `root`.** `index.ts` never passed `root`, so the in-process `tasks_watch_start` loop called `openSurfaceStore(undefined)`. It now gets the resolved workspace root, and `session_start` sets `root = rootFrom(cwd) ?? cwd` instead of the raw cwd, so a session in a linked worktree subdirectory opens the main workspace. A new e2e test covers `tasks_watch_start`.
2. **Readonly store for the inbox, not a writable one.** The plan said "writable SurfaceStore lazily (cursor writes only)", but cursors are written to `.tasks/cursors.json` without going through the store, so readonly is enough and safer.
3. **The inbox query also includes `task.worktree`.** Without it, a worktree recorded while the session runs, or during the drained gap, could not grow the follow set. These lines are never delivered.
4. **`tasks_wait` seeds a missing cursor at the log end** (see key-decisions). Without this, `type=task.comment` with `TK_INBOX=off` would return the first comment in history.
5. **Extra tests:** `TK_INBOX=off`, the `tasks_watch_start` new/legacy kinds, invalid `tasks_wait` query, and a pure `inboxMessage`/`sanitize` test.

## Known nuances (not fixed)

- `tasks_wait` and the inbox share the `pi:<session>` cursor, as planned. A wait that matches seq N writes N even if the inbox tail had already stored a higher seq. The next session's drain brief can then repeat lines between N and the old position. Inside a running session nothing repeats, because the tail keeps its own in-memory position. A verdict can arrive both as the `tasks_wait` result and as an inbox followUp. This is inherent to running both at once.
- Own-session filtering relies on the envelope `session`. The extension's own writes through the `tasks` tool are stamped only when `TK_SESSION` is set in the host process (`openSurfaceStore` reads `TK_SESSION`). When the session id comes from `PI_SESSION_ID` or `pi-<pid>`, the extension's in-process writes carry no session and could be echoed if they are comments or verdicts on followed tasks. Writes through the `tk` bash tool under omp carry whatever `TK_SESSION` the shell has.
- The spec's "turn-end guard" is out of scope (see plan).
- pi-extention has no typecheck script, and `@earendil-works/pi-coding-agent` is not installed, so the package is verified by `bun build` and `bun test` only (as the plan states).

## Verification (all run)

- `bun run --filter @tasks/surface build && cd packages/pi-extention && bun test ./test/inbox.test.ts && bun run build`: exit 0. The first run had 8 pass; after the `tasks_watch_start` test was added, the file has 9 tests.
- `bun run --filter @tasks/surface build && cd packages/pi-extention && bun test ./test/ && bun run build`: 14 pass, 0 fail, 130 expects. Ran twice more back to back with 14 pass each time. The build bundles `dist/index.js` and `dist/watch-child.js`.
- Task 3 chain (`grep events.jsonl` / `tasks_wait` in integrations.md, `TK_SESSION` in testing.md, `tasks_wait` in SKILL.md, `cd docs && bun run build`): exit 0, `[build] Complete!`.
- Human check (not run, needs a live omp session): in an omp session inside a task worktree, `tk comments send <id>` from another terminal should produce one followUp listing the cards.

## Notes for next plans

- 11-04: `formatEvent` lives in `packages/pi-extention/src/watch-manager.ts`. Add a `task.pr` case next to `task.worktree`, using `val()`/`sanitize` for user text. If PR events should reach the agent automatically, extend `isInboxEvent`/`inboxMessage` in inbox.ts and add the type to `INBOX_QUERY`.

## Self-Check: PASSED
