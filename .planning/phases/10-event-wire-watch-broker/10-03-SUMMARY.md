---
phase: 10-event-wire-watch-broker
plan: 03
subsystem: cli
tags: [events, watch, cursors, wire, cli, skills, docs]

requires:
  - phase: 10-event-wire-watch-broker
    provides: "10-01 write side (events.jsonl); 10-02 read side (readEvents/lastEventSeq, waitForAppend/tailEvents, parseEventQuery/matchesEvent/withTasks, readCursor/writeCursor/seedCursor)"
provides:
  - "`tk watch [<id>…] --until \"<query>\" | --drain | --follow \"<query>\"` with per-subscriber cursors (`--as` › `session:$TK_SESSION` › `cli:<actor>`), `--from`, `--peek`, `--timeout`, `--json`"
  - "@tasks/surface events/watch.ts: `waitUntil`, `drainEvents`, `followEvents`, `defaultSubscriber`, `parseDuration`, `formatEventLine` (for the pi extension in 10-06)"
  - "`tk finish --session <sid>` seeds cursor `session:<sid>` at its own finish line"
affects: [10-06]

actuals:
  tokens: ~70000
  tasks: 3
  commits: 0

key-files:
  created:
    - packages/surface/src/events/watch.ts
    - packages/cli/test/watch.test.ts
  modified:
    - packages/surface/src/index.ts
    - packages/cli/src/args.ts
    - packages/cli/src/tk.ts
    - packages/cli/skills/tasks/SKILL.md
    - .agents/skills/tasks/SKILL.md
    - docs/src/content/docs/overview.md

key-decisions:
  - "Status precheck applies when the query has a `status=` clause and task ids. A named task already in a listed status yields a synthesized `task.status` line (`data.current: true`, seq = log end, cursor moved there). When it applies and nothing matches now, the history is skipped and only new lines count, so an earlier round's approval never matches."
  - "`--follow` ends on stdin EOF only when stdin is a pipe or socket. A TTY or /dev/null stdin does not end it; otherwise a harness that runs it with /dev/null stdin would return at once."
  - "Mode commands open the store readonly. The cursors live in .tasks/ and the store is never written."

requirements-completed: [WIRE-01, WIRE-03]

coverage:
  - id: D1
    description: "--until released by another process's approval (<2.5s), cursor stored; timeout exit 124 with message; unknown id / invalid query / two modes exit 1"
    requirement: WIRE-01
    verification:
      - kind: e2e
        ref: "packages/cli/test/watch.test.ts"
        status: pass
  - id: D2
    description: "--drain from 0, empty repeat, offline gap of exactly 2, --peek keeps the cursor, human line format with ANSI stripped, positional ids filter"
    requirement: WIRE-01
    verification:
      - kind: e2e
        ref: "packages/cli/test/watch.test.ts"
        status: pass
  - id: D3
    description: "two concurrent --follow watchers see the same 3 seqs; SIGTERM → exit 0 with cursors at the last seq; stdin-pipe EOF ends follow"
    requirement: WIRE-01
    verification:
      - kind: e2e
        ref: "packages/cli/test/watch.test.ts"
        status: pass
  - id: D4
    description: "precheck returns data.current at once; stale earlier-round approval does not match (124); finish seeds session:s9 and a later comment is picked up by TK_SESSION=s9 --until type=task.comment"
    requirement: WIRE-03
    verification:
      - kind: e2e
        ref: "packages/cli/test/watch.test.ts"
        status: pass
  - id: D5
    description: "frame mode (no mode flag) still emits ready then task.* event frames; runtime-inbox.test.ts unchanged and passing"
    requirement: WIRE-01
    verification:
      - kind: e2e
        ref: "packages/cli/test/watch.test.ts, packages/cli/test/runtime-inbox.test.ts"
        status: pass

duration: ~50min
completed: 2026-11-11
---

# Phase 10 Plan 03: `tk watch --until / --drain / --follow` Summary

**An agent can now block on `tk watch <id> --until "status=approved|rejected"`, drain whatever it missed with `--drain`, or stream with `--follow`. Each subscriber keeps its own cursor in `.tasks/cursors.json`, and `tk finish` seeds the session's cursor so a verdict that lands before the first watch is still delivered.**

Commits were withheld per AGENTS.md (no git commit or push). STATE.md and ROADMAP.md were not updated, per the orchestrator override.

## Accomplishments

- **New file `packages/surface/src/events/watch.ts`** (exported from index.ts):
  - `waitUntil(store, { query, subscriber, from?, peek?, me?, timeoutMs })` → `TaskEvent | null`. It runs the precheck first, then reads from the starting point and sleeps on `waitForAppend` (250ms ceiling) until the deadline.
  - `drainEvents` writes the cursor to the last line it read.
  - `followEvents` runs over `tailEvents` and writes the cursor after each batch.
  - `defaultSubscriber`, `parseDuration` (`90s`/`30m`/`2h`/`500ms`/ms), and `formatEventLine` (`#<seq> <hh:mm:ss> <task> <type> <summary>`; strips ANSI and control characters per T-10-21; bodies are truncated to 200 characters).
- **Changes to `runWatch` in `tk.ts`:**
  - The three mode flags are mutually exclusive (`choose one of --until, --drain, --follow`).
  - Positional ids are validated (`issue not found: <id>`) and turned into `task=` via `withTasks`.
  - `--until` exits 124 with `no matching event within <t>` when nothing matches.
  - `--follow` stops on SIGINT, SIGTERM, or EOF on a stdin pipe.
  - With no mode flag the old frame mode runs. Positional ids now merge into `--ids`, and `--after` is forwarded.
- **Finish seeding:** `seedFinishCursor` runs after a successful `service.finish`. It reads the last 50 log lines, takes the newest `task.status` line for the task, and calls `seedCursor(session:<sid>)`. It is best-effort and never fails the finish.
- **HELP:** the `watch` entry now lists the modes, query grammar and frame mode, the doc comment is rewritten, and ENVIRONMENT has a new `TK_SESSION` line.
- **overview.md:** the CLI usage line is updated, and a new "Waiting for review" section covers the log, event types, modes, query, cursors, exit 124, no daemon, and the pickup race. The two "comes with the watch broker" sentences in Review now point to `tk watch`.
- **Both SKILL.md files:** after hand-over, the agent waits with `tk watch <id> --until "status=approved|rejected,task=<id>"` or `--until "type=task.comment,task=<id>"`, and runs `--drain` at session start. The 08-01 comments send/resolve text is untouched.

## Deviations from Plan

1. **[Rule 3 - Blocking] `packages/cli/src/args.ts` (not in files_modified).** The arg parser treated `--interval 250`, `--kinds a,b`, `--ids …`, `--timeout 10s`, `--as x`, `--from n` and `--follow q` as boolean flags plus a positional. The existing runtime-inbox spawn `watch --interval 250` only worked because the value was silently dropped. With positional ids merging into the query, `250` would have become a task id. I added `kinds, ids, interval, after, follow, timeout, as, from` to `valueFlags`. No other command reads these names.
2. **Store opened readonly, not writable as the plan text says.** The store is never written and cursors go through `.tasks/` files, so readonly is the safer choice for concurrent watchers.
3. **Stdin EOF rule is restricted to a pipe or socket stdin** (see key-decisions). The plan's "mirror runWatchChild" would end `--follow` at once under a /dev/null stdin.
4. **[Rule 1 - Bug] Found during testing:** after SIGTERM, `process.stdin.destroy()` rejected the `for await` stdin drain (`ERR_STREAM_PREMATURE_CLOSE`), so follow exited 1. The drain loop now catches it.
5. **Extra test cases:** a stale-approval 124 case, stdin-EOF follow, and the human-format and ANSI check.
6. **`--drain` takes no query string,** because it is a boolean flag. Filter it with positional ids. `--until` and `--follow` take queries.

## Verification (all run)

- `bun run --filter @tasks/surface build && bun test packages/cli/test/watch.test.ts`: 11 pass. Ran 3 more times back to back with 11 pass each time.
- `bun test packages/cli/test/watch.test.ts packages/cli/test/runtime-inbox.test.ts packages/cli/test/finish.test.ts`: 24 pass, 0 fail
- `bun run --filter @tasks/cli check`: exit 0. `bun run --filter @tasks/surface check`: exit 0
- Task 3 verify chain: `tk help watch` contains `--until`, overview.md contains `events.jsonl`, both skills contain `watch … --until`, and `cd docs && bun run build` is Complete. All exit 0.
- Extra regression: `bun test packages/cli/test` gave 199 pass, 0 fail. `bun test packages/surface/test` gave 102 pass, 0 fail.

## Notes for next plans

- 10-06 (pi): reuse `followEvents` / `waitUntil` / `formatEventLine` from @tasks/surface. The subscriber name should be `session:<id>` so it lines up with the finish seeding.
- Concurrency note: tk.ts and overview.md were edited only in the watch, finish-cursor and HELP/ENV regions, plus the Review paragraph and the new subsection. Another plan (09-10) also edits overview.md.

## Self-Check: PASSED
