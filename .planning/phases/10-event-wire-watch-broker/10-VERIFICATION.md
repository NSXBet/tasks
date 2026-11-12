---
phase: 10-event-wire-watch-broker
verified: 2026-11-11T16:20:00Z
status: passed
score: 3/3 must-haves verified
covered_files:
  - ".planning/phases/10-event-wire-watch-broker/10-01-PLAN.md"
  - ".planning/phases/10-event-wire-watch-broker/10-01-SUMMARY.md"
  - ".planning/phases/10-event-wire-watch-broker/10-02-PLAN.md"
  - ".planning/phases/10-event-wire-watch-broker/10-02-SUMMARY.md"
  - ".planning/phases/10-event-wire-watch-broker/10-03-PLAN.md"
  - ".planning/phases/10-event-wire-watch-broker/10-03-SUMMARY.md"
  - ".planning/phases/10-event-wire-watch-broker/10-04-PLAN.md"
  - ".planning/phases/10-event-wire-watch-broker/10-04-SUMMARY.md"
  - ".planning/phases/10-event-wire-watch-broker/10-05-PLAN.md"
  - ".planning/phases/10-event-wire-watch-broker/10-05-SUMMARY.md"
  - ".planning/phases/10-event-wire-watch-broker/10-06-PLAN.md"
  - ".planning/phases/10-event-wire-watch-broker/10-06-SUMMARY.md"
  - "packages/cli/src/args.ts"
  - "packages/cli/src/tk.ts"
  - "packages/daemon/src/events.ts"
  - "packages/daemon/src/server.ts"
  - "packages/lua/luau/tk/events.luau"
  - "packages/lua/luau/tk/wire.luau"
  - "packages/pi-extention/src/inbox.ts"
  - "packages/pi-extention/src/index.ts"
  - "packages/pi-extention/src/watch-manager.ts"
  - "packages/rpc/src/protocol.ts"
  - "packages/surface/src/events/cursors.ts"
  - "packages/surface/src/events/derive.ts"
  - "packages/surface/src/events/log.ts"
  - "packages/surface/src/events/query.ts"
  - "packages/surface/src/events/recorder.ts"
  - "packages/surface/src/events/tail.ts"
  - "packages/surface/src/events/watch.ts"
  - "packages/surface/src/index.ts"
  - "packages/surface/src/store.ts"
  - "packages/surface/src/watch/core.ts"
  - "packages/surface/src/watch/protocol.ts"
  - "packages/tui/src/app/App.tsx"
  - "packages/tui/src/events.ts"
  - "packages/tui/src/store.ts"
  - "packages/web/src/app.html"
  - "packages/web/src/server.ts"
covered_digest: "v3:sha256:cff4ee3d915ad531ecf8f340bb6da10bfb6e035ce668cbf63be2e99752dea2e1"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Live omp/pi session: open an omp session inside the task worktree (e.g. .worktrees/<repo>-<id>) with the built extension loaded and TK_SESSION unset; from another terminal run `tk comments send <id>` after adding a review card, then `tk update <id> --status approved`"
    expected: "Without any tool call, the agent receives one followUp listing the sent card(s) (📝 file:line — author: body, next: tk work <id>) and then one ✅ approved followUp (next: tk close <id>); restarting the session after an offline approval yields one '📬 while you were away' brief"
    why_human: "Needs a live omp/pi host (@earendil-works/pi-coding-agent is not installed here); inbox.test.ts drives createInbox with a stub notify, not the real followUp injection into a model turn"
  - test: "Same live session: let the agent itself post a comment through the `tasks` tool with TK_SESSION unset (session id from PI_SESSION_ID / pi-<pid>)"
    expected: "The agent's own comment is NOT echoed back as a followUp"
    why_human: "10-06 SUMMARY flags that own-session filtering relies on the envelope `session`, which in-process tool writes only carry when TK_SESSION is set in the host process; needs a real host to see whether the echo happens"
---

# Phase 10: Event Wire & Watch Broker — Verification Report

**Phase Goal:** One event stream drives TUI, web and agents — agents subscribe to tasks and pick up user messages automatically
**Mode:** mvp (goal phrased as an outcome, not a User Story — verified goal-backward against the 3 roadmap success criteria)
**Contract:** 10-CONTEXT.md user decision (spec §10: one `events.jsonl` log, **no daemon broker**). `superseded/` plans were not used as the contract.
**Verified:** 2026-11-11T16:20:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## User Flow Coverage (spec §10 loop, run end-to-end in a scratch workspace)

Scratch repo: `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/e2e10`, `tk` = source CLI (`packages/cli/src/tk.ts`). Driver script: `.../scratchpad/e2e10.sh`, output: `.../scratchpad/e2e10.out`.

| Step | Expected | Evidence | Status |
|------|----------|----------|--------|
| `tk q` / `tk update --claim` / `tk work` | task.created; task.status + task.owner; task.worktree | seq 1–5 in events.jsonl (`task.created`, `task.status open→in_progress`, `task.owner assignee null→yuri`, `task.worktree`, `task.update [metadata.changeset]`) | ✓ |
| Two concurrent `tk watch tk-p79 --follow "" --as a` (json) / `--as b` (human) + `tk watch tk-p79 --until "status=approved\|rejected" --timeout 30s --as u` | both followers see every line; until blocks then returns | a and b both printed seq 6–10 identically; until returned seq 10 (`ready-to-review → approved`), exit 0 after 7s; SIGTERM → a/b exit 0 | ✓ |
| `TK_SESSION=s1 tk finish tk-p79 --session s1` | task.status → ready-to-review with session/finishedAt; cursor `session:s1` seeded | seq 6 `{"session":"s1",…,"data":{"from":"in_progress","to":"ready-to-review","session":"s1","finishedAt":…}}`; cursors.json `session:s1 = 6` | ✓ |
| Review card via web `POST /api/review/<id>/threads` | `task.comment kind=review to=open` with location/author/body | seq 7 `{"kind":"review","from":null,"to":"open","file":"style.css","line":1,"location":"style.css:1","author":"yuri","body":"use navy not blue"}` | ✓ |
| `tk comment` | `task.comment kind=note` | seq 8 | ✓ |
| `tk comments send` | one `to: sent` card line per card | seq 9 `from open to sent` | ✓ |
| `tk update --status approved` | `task.status to approved`; releases `--until` | seq 10; until returned it | ✓ |
| Offline subscriber drains gap | `--drain --as a` replays 11..18, repeat empty | printed #11–#18, then empty, exit 0 both | ✓ |
| Status precheck | `TK_SESSION=s1 --until status=approved\|rejected` returns at once for a task already approved | returned synthesized seq 18 line, exit 0 | ✓ |
| Timeout | `--until type=task.comment --timeout 2s --from 18` | `no matching event within 2s`, exit 124 | ✓ |
| Cursors | per-subscriber `{host: seq}` in `.tasks/cursors.json` | `{"version":1,"subscribers":{"session:s1":{"<host>":6},"a":{…:10},"b":{…:10},"u":{…:10}}}` | ✓ |
| TUI (tmux `-L verify10`, session v10) tails same log | board repaints + toasts | row went `in_pr…` → `appro… 💬3` → `rejec…`; status-bar toasts observed in order: `tk-p79 rejected`, `tk-p79 · yuri: see this` (ESC sequence stripped, 0 escape bytes in capture), `tk-p79 · yuri: second note`, `tk-p79 · review comment at style.css:1`, `tk-p79 · review comment sent`, `tk-p79 approved` (captures `.../scratchpad/v10-tui-*.txt`) | ✓ |
| Web (agent-browser session verify10, port 21611) `/events` SSE from same log | board refresh + toasts | MutationObserver on `#toast` recorded `["tk-p79 · yuri: second note","tk-p79 · review comment at style.css:1","tk-p79 · 1 review comment sent","tk-p79 approved"]` for writes made by terminal `tk` and the web RPC; `#conn` not stale; screenshot `.../scratchpad/v10-web.png` | ✓ |

**Envelope vs spec §10:** lines carry `seq, host, ts, task, type, actor, data` (+ `session` when set), exactly the spec envelope shape. Differences from the spec *example* only: `actor` is the bare actor (`yuri`), not `user:yuri`; review/note comment data is richer than the example's `{ "comment": "c-07" }`. Info only.

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP success criterion) | Status | Evidence |
|---|-------|--------|----------|
| 1 | One append-only `events.jsonl` log is the wire (no daemon); `tk watch <id…>` reads it with per-subscriber cursors and `--until/--drain/--follow`, so many agents watch simultaneously via tool calling and CLI | ✓ VERIFIED | `withEventLog` wraps the CLI main open (`packages/cli/src/tk.ts:1518`) and every `openSurfaceStore` (`packages/surface/src/store.ts:83`); gap-free lock-serialized append in `events/log.ts`; `waitUntil/drainEvents/followEvents` in `events/watch.ts`; cursors in `events/cursors.ts`. No broker: daemon `events.subscribe` rides `runWatchLoop` over the log. E2E above (2 followers + until concurrently) plus `packages/cli/test/watch.test.ts` (two concurrent followers, offline gap, precheck, finish-seeded cursor) pass. Tool-calling path: pi `tasks_wait` over `waitUntil` (inbox.test.ts "resolves on another process's approval… runs concurrently") |
| 2 | The same event stream drives live visualization and notifications in TUI and web | ✓ VERIFIED | TUI: `TuiStore.watch` = `tailEvents(surface.store.tasksDir)` (`packages/tui/src/store.ts:423`), `eventToast` + 100ms debounce in `App.tsx:125-135`; 1s poll removed. Web: one `tailEvents` per active workspace → `event: task` SSE frames (`packages/web/src/server.ts:318-350`), `/api/events` reads the log, page listens `addEventListener("task")` (`app.html:1728`) with debounced refresh + toasts; 2s poll removed. E2E: TUI and web both updated from the same writes. Tests: `packages/tui/test/events.test.ts`, `packages/web/test/events.test.ts` pass |
| 3 | Comments, approvals and sent review batches ride the stream and are picked up by the agent automatically | ✓ VERIFIED (live omp delivery → human item) | derive.ts emits `task.comment` note / review (one `to: sent` per card) and `task.status to approved|rejected` — observed in E2E seq 7–10. CLI agents pick them up via `tk watch --until`/`--follow` (E2E). pi/omp: `createInbox` starts on `session_start` (`packages/pi-extention/src/index.ts:125-134`), tails from cursor `pi:<session>`, one followUp per task, drain brief on start; `inbox.test.ts` "delivers a reviewer's sent cards, then the verdict, never the agent's own writes" passes. Injection into a real omp turn is not runnable here — see Human Verification |

**Score:** 3/3 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/surface/src/events/log.ts` | envelope, append, lock, read | ✓ VERIFIED | 210 lines; two-layer lock, torn-line tolerant |
| `packages/surface/src/events/derive.ts` | single place event types decided | ✓ VERIFIED | full table incl. review cards + verdicts |
| `packages/surface/src/events/recorder.ts` | adapter decorator, append after commit | ✓ VERIFIED | wired in store.ts + tk.ts |
| `packages/surface/src/events/{tail,query,cursors,watch}.ts` | read side, grammar, cursors, modes | ✓ VERIFIED | used by CLI, web, TUI, pi, runWatchLoop |
| `packages/cli/src/tk.ts` `runWatch` / `seedFinishCursor` | `tk watch` modes, finish seeding | ✓ VERIFIED | E2E exercised |
| `packages/web/src/server.ts` + `app.html` | SSE from log, event-driven page | ✓ VERIFIED | E2E exercised |
| `packages/tui/src/store.ts`, `events.ts`, `App.tsx` | tail + toasts | ✓ VERIFIED | E2E exercised |
| `packages/pi-extention/src/inbox.ts`, `index.ts` | automatic inbox, `tasks_wait` | ✓ VERIFIED (unit/integration) | live host = human item |
| `packages/rpc/src/protocol.ts`, `lua/luau/tk/wire.luau` | VERBS_VERSION 5 | ✓ VERIFIED | both `= 5` |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| CLI writes | events.jsonl | `withEventLog(storage.adapter, …)` tk.ts:1518 | ✓ WIRED |
| SurfaceStore writes (web RPC, TUI, pi tools) | events.jsonl | `openSurfaceStore` wraps adapter, store.ts:83 | ✓ WIRED (web review thread POST produced seq 7) |
| events.jsonl | web page | `tailEvents` → `broadcastTask` → SSE `task` → `onTaskEvent` | ✓ WIRED |
| events.jsonl | TUI | `tailEvents` → `toWatchEvent` → App debounce → `refresh`/`notify` | ✓ WIRED |
| events.jsonl | pi agent | `createInbox` → `followEvents` → `notify` followUp | ✓ WIRED |
| `tk finish` | `session:<sid>` cursor | `seedFinishCursor` → `seedCursor` | ✓ WIRED (cursors.json showed `session:s1: 6`) |
| daemon `events.subscribe` / Luau client | log | `runWatchLoop` over `readEvents`; legacy kind aliases | ✓ WIRED (lune integration test passes) |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| Web toasts/board | SSE `task` frames | tail of active workspace's events.jsonl | yes (observed) | ✓ FLOWING |
| TUI toasts/board | `WatchEvent` | tail of `surface.store.tasksDir/events.jsonl` | yes (observed) | ✓ FLOWING |
| `tk watch` output | log lines | `readEvents` past cursor | yes (observed) | ✓ FLOWING |

### Behavioral Spot-Checks / Test Runs

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full phase suite | `bun test --timeout 20000 packages/surface packages/daemon packages/cli/test packages/web/test packages/tui/test packages/pi-extention/test` | 485 pass / 1 fail (486 tests, 49 files, 348s). The fail was `cli/test/daemon.test.ts` "reports absence before anything is started" — caused by **my own concurrently running `tk web` e2e daemon** (shared tkd daemon reported up; the test suite's daemon stop also killed my web server mid-e2e). Re-run alone: 3 pass / 0 fail | ✓ PASS (environmental interference, not a code defect) |
| `live.test.ts` "branch frame" known flake | `bun test packages/web/test/live.test.ts` ×2, plus in full run | passed in full run and 5/5 pass in both isolated runs — flake not reproduced | ✓ PASS |
| Typechecks | `bun run --filter @tasks/{rpc,surface,daemon,cli,web,tui} check` | all exit 0 | ✓ PASS |
| Luau suites | `bun run --filter @tasks/lua test` (lune present) | all suites passed incl. "legacy issue.created subscription fires on_event with task.created from a second client" | ✓ PASS |
| pi extension bundle | `cd packages/pi-extention && bun run build` | dist/index.js + watch-child.js built | ✓ PASS |
| Docs | `cd docs && bun run build` | Complete | ✓ PASS |
| E2E loop | `scratchpad/e2e10.sh` + follow-ups | see User Flow Coverage | ✓ PASS |

### Probe Execution

No probes declared by the phase. Step 7c: SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| WIRE-01 (R56) | 10-01, 10-02, 10-03, 10-06 | Watch as broker — one/many tasks, many agents at once | ✓ SATISFIED | Truth 1; no daemon broker per CONTEXT decision — concurrency via per-subscriber cursors |
| WIRE-02 (R57) | 10-02, 10-04, 10-05 | One event stream drives TUI + web live views and notifications | ✓ SATISFIED | Truth 2 |
| WIRE-03 (R58) | 10-01, 10-03, 10-06 | Comments/approvals ride the stream; agents pick them up automatically | ✓ SATISFIED (live omp → human) | Truth 3 |

No orphaned requirements: REQUIREMENTS.md maps only WIRE-01..03 to Phase 10.

### Anti-Patterns Found

No TBD/FIXME/XXX/TODO/HACK/placeholder markers in the phase's implementation files.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| packages/surface/src/events/recorder.ts | 85, 90 | swallowed derivation/append errors | ℹ️ Info | Deliberate ("emission is advisory"); a log failure silently drops events — readers would miss them with no signal |
| packages/surface/src/events/watch.ts | `summaryOf` | review `task.comment` human line does not show open vs sent | ℹ️ Info | `#7` (open) and `#9` (sent) render identically in `tk watch` human mode; `--json` is unambiguous |
| CLI `tk comments send` human output | — | after send, footer still reads `1 open · 0 ✓` | ℹ️ Info | Pre-existing Phase 8 formatter; log line itself is correct (`to: sent`) |

### Spec §10 deltas (informational, outside the 3 success criteria)

- Spec decision "the CLI is the sole editor; web spawns the CLI via a stateless shim" — web/TUI/pi still write in-process through `SurfaceStore`; every such write is decorated by `withEventLog`, so the log stays complete. Not a Phase 10 SC; noted for the spec owner.
- `task.commit`, `task.report` not emitted (no write path); `task.pr` belongs to 11-04; `tk next` deferred to v2 (CONTEXT).
- pi "turn-end guard" not built (10-06 scoped it out); pi reads the log in-process rather than spawning `tk watch --drain` (same semantics, read-only).
- 10-06 nuance: `tasks_wait` and the inbox share cursor `pi:<session>`; a wait can move the cursor backwards, so a later session's drain brief may repeat lines.

### Human Verification Required

### 1. Live omp/pi automatic pickup

**Test:** In an omp session started inside the task worktree with the built extension, from another terminal create a review card and run `tk comments send <id>`, then `tk update <id> --status approved`. Then close the session, approve/comment another task offline, reopen.
**Expected:** One followUp with the sent card(s) and `next: tk work <id>`; one `✅ approved` followUp with `next: tk close <id>`; on reopen one "📬 while you were away" brief.
**Why human:** Requires a live omp host; tests use a stub `notify`.

### 2. Own-write echo with TK_SESSION unset

**Test:** In the same live session, with `TK_SESSION` unset, have the agent comment through the `tasks` tool on a followed task.
**Expected:** No followUp echoing the agent's own comment.
**Why human:** Filtering depends on the envelope `session`, which in-process writes carry only when `TK_SESSION` is set in the host; 10-06 flagged this as a possible echo.

### Gaps Summary

No gaps. All three roadmap success criteria hold in code, in the test suites, and in a real end-to-end run in which two `--follow` subscribers, a blocking `--until`, the TUI and the web page all consumed the same `.tasks/events.jsonl` while another shell ran finish → review card → `tk comments send` → approve. Status is `human_needed` only because the pi/omp extension's delivery into a live agent turn can't be run here.

Cleanup: web daemon (real bun pid 25175) stopped and confirmed gone, port 21611 closed, tmux server `-L verify10` killed, browser session verify10 closed.

---

_Verified: 2026-11-11T16:20:00Z_
_Verifier: Claude (gsd-verifier)_


## Human Verification Result (2026-11-12)

User accepted phase 10 on the automated evidence; the two live-omp checks (inbox delivery of sent batches/approvals + away brief; no self-echo without TK_SESSION) are tracked as a tk task for manual UAT.

## Regression sweep (2026-11-12)

This is a consolidated stale-phase regression sweep (user decision 2026-11-12). The fingerprint went stale because later phases edited covered files. No criterion regressed. I recomputed `covered_digest` over the same `covered_files` list (no files were deleted) and changed no source code.

Gate results, all on the current working tree:
- `bun test --timeout 15000` (full suite): 1897 pass, 5 skip, 0 fail. 1902 tests across 179 files in 465s.
- `bun run check` passes (rc 0) in domain, git, workspace, surface, rpc, review, cli, tui, web and daemon.
- `lune run luau/tk/tests/run_all.luau` (packages/lua): all 6 suites pass.
- `bun packages/tui/test/review-smoke.ts` is all green (9 checks). `bun packages/tui/test/smoke.ts` is all green (13 checks).
- `bun packages/tui/test/taskview-smoke.ts` ran 5 times: 11/12, 11/12, 12/12, 12/12, 12/12. The failing check was check 12 (the TASKS `]`/`[`/`]]` check), which is the known flake. In the failing frames the switching itself was correct relative to the task actually shown (u4i →`]` xdw →`[` u4i →`]]` zfd). The cause is the smoke's start-state assumption. The `5` task view has `detailId` null, so it shows `board.issues[0]`, and that changes when the probe creates two tasks. The `${id} · ` wait is also satisfied early by a phase-10 event toast (`· tk-xdw · review comment …`).
- `bun test packages/review/test/headless-smoke.test.ts`: 2 pass. `bun test packages/web/test/live.test.ts` ran 3 times: 5/5 pass each time, including 'branch frame'.
- `cd docs && bun run build`: Complete (rc 0).
- Phase-specific recheck (3/3 truths). `withEventLog` wraps the CLI main open (`tk.ts:1545`) and `openSurfaceStore` (`store.ts:83`). `surface/src/events/` has log, watch, cursors, tail, derive, recorder and query. TUI `tailEvents` is at `store.ts:423`, web `tailEvents` at `server.ts:340`. The page listens on `addEventListener("task")` (`app.html:1815`). pi `createInbox` is at `index.ts:139`. The watch, events and inbox tests are green, and the lune events and integration suites pass, including the event subscription from a second client.
