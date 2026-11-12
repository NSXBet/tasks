---
phase: 11-pr-sidecar-chat-stat-card
plan: 04
subsystem: event wire (task.pr / task.report), pi/omp extension stat + PR cards, VERBS 6
tags: [event-wire, stat-card, pr, extension, inbox, rpc, luau, docs]

requires: [11-03, 10-01, 10-02, 10-03, 10-06]
provides:
  - "packages/surface/src/events/derive.ts: prEvents / reportEvents in deriveIssueEvents (order … worktree, pr, report, update); `pr` and `report` covered metadata keys"
  - "TaskEventType / WatchEventKind gain `task.pr` and `task.report`; WatchEvent.data documents op/number/url/state/head and changes/at"
  - "KIND_ALIASES `issue.updated` (TS + Luau mirror) covers task.pr and task.report; `tk watch` human summaries for both"
  - "packages/surface/src/operations/changes.ts: changesOf(store, id) + re-exports statCardLine, statSummary, readReportStat, changesLinks, readPrRecord, DEFAULT_WEB_BASE, ChangesView/ChangesStat/PrRecord/PrState"
  - "TasksSurface.changes(id) → Result<ChangesView | null, SurfaceError>"
  - "pi-extention: formatEvent(event, counts?, webBase?) cases task.pr / task.report; WatchManagerOptions.webBase; inbox task.pr delivery + optional async `card`; `tasks` op `changes`; Kinds task.pr / task.report"
  - "VERBS_VERSION 6 (packages/rpc/src/protocol.ts + packages/lua/luau/tk/wire.luau)"
affects: [tk watch, tk pr, tk finish (wire), web /events, TUI board refresh, daemon events.subscribe, pi/omp extension, Luau client, rpc.md, architecture.md, integrations.md]

actuals:
  tasks: 3
  commits: 0

key-files:
  modified:
    - packages/surface/src/events/log.ts
    - packages/surface/src/events/derive.ts
    - packages/surface/src/events/query.ts
    - packages/surface/src/events/watch.ts
    - packages/surface/src/watch/protocol.ts
    - packages/surface/src/surface.ts
    - packages/surface/src/operations/changes.ts
    - packages/surface/test/events-derive.test.ts
    - packages/surface/test/events-read.test.ts
    - packages/surface/test/surface.test.ts
    - packages/cli/test/pr.test.ts
    - packages/lua/luau/tk/events.luau
    - packages/lua/luau/tk/wire.luau
    - packages/rpc/src/protocol.ts
    - packages/pi-extention/src/watch-manager.ts
    - packages/pi-extention/src/inbox.ts
    - packages/pi-extention/src/index.ts
    - packages/pi-extention/test/entry.test.ts
    - packages/pi-extention/test/inbox.test.ts
    - docs/src/content/docs/rpc.md
    - docs/src/content/docs/architecture.md
    - docs/src/content/docs/integrations.md

key-decisions:
  - "`task.report` data is the normalized `readReportStat` result `{changes, head, at}` (equal to a well-formed stamp). A malformed stamp emits nothing, and an identical stamp (same counts/head/at) emits nothing."
  - "`task.pr`: a record that goes from valid to absent or invalid emits nothing (there is no `remove` op; D-01 has no delete verb). Closed → open is op `state`."
  - "`changesOf` lives in operations/changes.ts (not surface.ts), so surface.ts only gains one import, one interface line and one factory line. packages/surface/src/index.ts was NOT edited: it already does `export * from './operations/changes.js'`, so the re-exports reach pi-extention for free (no conflict with 11-05)."
  - "The inbox card line is stripped of ANSI/controls but not whitespace-collapsed, so the card's double-space layout survives. `inboxBrief` stays synchronous and card-free."
  - "The `card` callback opens a short-lived surface per call (`withSurface(workspace, …)`, the same pattern as the tool ops). It is called only for batches that contain a verdict or a PR event."
  - "`webBase` is resolved once at session_start into a closure variable that `ensureManager` passes to the WatchManager (managers are created lazily on the first `tasks_watch_start`, after session_start)."
  - "formatEvent task.pr: the number must be an integer (else `?`) and the url must start with http(s) (else it is omitted). task.report: `readReportStat({report: data})`, and on null falls back to `📊 tasks: <id> report (<hh:mm:ss>)`."

requirements-completed: [PR-01, PR-02, PR-03]

coverage:
  - id: D1
    description: "derive: first PR → one task.pr op create with head=branch and no task.update; open→merged op state; open→closed op close; new number op create; url-only/unchanged/invalid/removed → nothing"
    requirement: PR-01
    verification:
      - kind: unit
        ref: "packages/surface/test/events-derive.test.ts#task.pr (metadata.pr)"
        status: pass
  - id: D2
    description: "derive: new report → one task.report with the stamp as data; identical → nothing; malformed → nothing; finish-shaped save → [task.status, task.report]; full order test … worktree < pr < report < update"
    requirement: PR-03
    verification:
      - kind: unit
        ref: "packages/surface/test/events-derive.test.ts"
        status: pass
  - id: D3
    description: "CLI e2e (fake gh, bare origin): tk pr create → one task.pr (create, 7, head=branch) + one task.report, pr before report; tk pr merge → task.pr op state merged; tk watch --drain --from 0 lists both; human `task.pr #7 create open` / `task.report 1 commits +1 −0 1 files`; no task.update ever lists metadata.pr/metadata.report"
    requirement: PR-01
    verification:
      - kind: e2e
        ref: "packages/cli/test/pr.test.ts#tk pr on the event wire"
        status: pass
  - id: D4
    description: "tk watch <id> --until type=task.pr returns once another process's `tk pr sync` moves the state (op close)"
    requirement: PR-01
    verification:
      - kind: e2e
        ref: "packages/cli/test/pr.test.ts#tk watch --until type=task.pr…"
        status: pass
  - id: D5
    description: "surface.changes: never worked → ok null; missing → not_found; only metadata.report → {source report, stale true, at, stat}, web link …/tasks/<id>/diff"
    requirement: PR-03
    verification:
      - kind: integration
        ref: "packages/surface/test/surface.test.ts#changes(id)…"
        status: pass
  - id: D6
    description: "formatEvent task.pr / task.report (custom webBase, singular counts, no stale pill, no diff), malformed fallback, non-http url dropped; tasks tool lists changes(id); watch Kinds include task.pr/task.report"
    requirement: PR-02
    verification:
      - kind: unit
        ref: "packages/pi-extention/test/entry.test.ts"
        status: pass
  - id: D7
    description: "inbox: PR merged by another actor → exactly one followUp (PR line, next: tk close, stale report card); approval ends with card; own-session PR save silent; throwing card still delivers the PR message; inboxMessage last-PR-wins and invalid number → empty"
    requirement: PR-02, PR-03
    verification:
      - kind: e2e
        ref: "packages/pi-extention/test/inbox.test.ts#inbox PR cards and the trailing stat card (11-04)"
        status: pass
  - id: D8
    description: "VERBS 6 agrees in TS and Luau; the Luau integration hello against a real server matches the wire constants"
    requirement: PR-01
    verification:
      - kind: integration
        ref: "bun run --filter @tasks/lua test (integration_tests: hello)"
        status: pass

completed: 2026-11-12
---

# Phase 11 Plan 04: `task.pr` / `task.report` on the event wire + extension cards (PR-01..03) Summary

**A committed save that changes `metadata.pr` now appends one `task.pr {op, number, url, state, head}` line to `.tasks/events.jsonl`. A save that changes the counts-only `metadata.report` appends one `task.report {changes, head, at}` line. Both come from `deriveIssueEvents`, and gh is never polled. The pi/omp extension renders them as a PR card and a stat card from the event data alone. The inbox delivers PR changes from other sessions, and PR and verdict messages now end with the ladder-backed stat card. Agents can fetch the card data with the `tasks` op `changes`. VERBS_VERSION is 6 in TS and Luau, and rpc.md, architecture.md and integrations.md are updated.**

**Commits withheld per AGENTS.md** (conservative profile: no git commit or push). All changes are uncommitted in the main tree. STATE.md and ROADMAP.md were not updated, per the orchestrator override.

## What changed

### Task 1 (tracer): record → log lines → `tk watch`
- `log.ts` / `watch/protocol.ts`: the new types, plus the documented `WatchEvent.data` fields (`op`, `number`, `url`, `state`, `head`, `changes`, `at`).
- `derive.ts`: imports `readPrRecord` / `readReportStat` from `@tasks/domain`. `pr` is added to `coveredMetadata()`. `prEvents` and `reportEvents` are inserted after `worktreeEvents` and before `task.update`, and the header documents the new per-issue order.
- `query.ts` `KIND_ALIASES['issue.updated']` and the `events.luau` mirror both gain `task.pr` and `task.report`. The luau comment now says VERBS 6.
- `events/watch.ts` `summaryOf`: `#<n> <op> <state>` and `<c> commits +A −D <f> files`.
- No watch-loop changes: `runWatchLoop` / `tailEvents` / the TUI / web SSE / the daemon pass every type through.

### Task 2: extension cards, `TasksSurface.changes`, `tasks` op `changes`
- `operations/changes.ts`: re-exports the card helpers and types from `@tasks/domain`, and adds `changesOf(store, id)` (show-style not-found, then `resolveChanges({cwd: store.root}, issue, await resolveWebBase(store.tasksDir))`). It is read-only.
- `surface.ts`: `changes(id)` on the interface and in the factory.
- `watch-manager.ts`: the `webBase` option, plus `formatEvent(event, counts?, webBase?)` cases `task.pr` (`🔀 tasks: PR #7 for <id> — merged (<url>)`) and `task.report` (`📊 tasks: Changes · <id>  1 commit · +1 −0 · 1 file  → <web>/tasks/<id>/diff · tk review <id>`).
- `inbox.ts`:
  - `INBOX_TYPES` gains `task.pr`, so `INBOX_QUERY` picks it up.
  - `isPr` validates a positive integer number and a known state.
  - `inboxMessage` adds the PR section after verdicts (the last PR wins; `next: tk close <id>` when merged).
  - `wantsCard` is new, and `flush` is now async: it awaits the optional `card`, swallows failures and re-checks `stopped`.
- `index.ts`:
  - `webBase` is resolved at session_start.
  - The inbox `card` calls `s.changes(task)` and then `statCardLine`.
  - `Op` gains `changes`, with a description line and a switch case.
  - `Kinds` and the `tasks_watch_start` description gain `task.pr` and `task.report`.
  - The header comment is updated.
- `grep -rn gitDiffPatch packages/pi-extention/src` returns nothing.

### Task 3: VERBS 5 → 6 + docs
- `protocol.ts` (with the doc comment "6: event kinds `task.pr` and `task.report`") and `wire.luau`. PROTOCOL_VERSION is unchanged.
- `rpc.md`: two kind-table rows, the `issue.updated` alias row, and the `VERBS 6 (from 5)` note.
- `architecture.md`:
  - The derive type list now includes both kinds and the per-issue order.
  - It notes that pr/report are covered keys.
  - It replaces the stale "a stamp alone appends no task.update" and "Until 11-04 derives task.pr … task.update" sentences.
- `integrations.md`: an inbox PR row and a trailing-card paragraph; `tasks_watch_start` kinds, the PR line and the stat card line; the `tasks` tool `changes` op.

## Deviations
- **[Rule 1, test drift] `packages/surface/test/events-read.test.ts`.** The `normalizeKinds(["issue.updated"])` expectation now includes `task.pr` and `task.report`. This file was not in the plan's files list.
- **[Test fix] `--until type=task.pr`.** A fresh `--until` subscriber replays from the log start, so it matched the earlier `create` line. The test first runs `tk watch --drain --as t2` so that only the sync's line counts (the same pattern as cli watch.test.ts).
- **[Scope] `packages/surface/src/index.ts` not edited.** The plan listed it under 11-05 coordination, but the existing `export * from './operations/changes.js'` already exposes everything.
- **[Placement] The tool-description test lives in entry.test.ts** and loads the extension with a minimal fake host, because entry.test.ts had no tool-registration harness.
- **[Extra coverage]** Tests for a non-http PR url being dropped, a malformed report stamp being silent, closed → new number being op create, and inboxMessage invalid-number → empty.

## Verification (all run)
- Task 1: `bun run --filter @tasks/surface build` → 0. Then `bun test packages/surface/test/events-derive.test.ts packages/surface/test/events-read.test.ts packages/surface/test/watch.test.ts packages/cli/test/pr.test.ts packages/cli/test/events.test.ts packages/cli/test/watch.test.ts` → **66 pass / 0 fail**. Surface and cli `tsc --noEmit` → 0 (re-run after Task 2, still 0).
- Task 2: surface build 0, `bun test packages/surface/test/surface.test.ts` → 6 pass / 0 fail, `cd packages/pi-extention && bun test ./test/` → **20 pass / 0 fail**, `bun run build` → bundled OK.
- Task 3:
  - The four greps hit.
  - `bun run --filter @tasks/rpc check` → 0.
  - `bun run --filter @tasks/daemon build` → 0.
  - `bun test packages/daemon/test/daemon.test.ts` → 8 pass / 0 fail.
  - `cd docs && bun run build` → Complete.
- Plan-level:
  - `bun test packages/surface/test packages/cli/test/pr.test.ts packages/cli/test/events.test.ts packages/cli/test/watch.test.ts packages/daemon/test` → **173 pass / 0 fail** (21 files).
  - `bun run --filter @tasks/lua test` (lune is installed) → all suites passed, including the real-server `hello` against wire constants (VERBS 6 agrees).
  - `grep -rn gitDiffPatch packages/pi-extention/src` → no match.
  - `grep -rn setInterval packages/surface/src/events/derive.ts packages/surface/src/gh.ts` → no match.
- Adjacent: `bun test packages/cli/test/finish.test.ts packages/cli/test/changes.test.ts packages/web/test/events.test.ts packages/tui/test/events.test.ts packages/cli/test/contract.test.ts` → 39 pass / 0 fail.
- The pi-extention `tsc --noEmit` has pre-existing errors only (host types missing, `.ts` import extensions, old index.ts/entry.test.ts lines). None are on lines this plan touched. The package's gate is `bun run build`, which passes.
- Only the fake gh was used. The real `gh` was never invoked.

## Threat model
- T-11-15: cards carry only integers, the id, an http(s) url (validated by `readPrRecord` at derive time and re-checked in `formatEvent` and `inboxMessage`), fixed strings and statCardLine links. The PR state is a closed enum and is sanitized.
- T-11-16: `task.pr` is emitted only on create/number/state change, and `task.report` only on a changed stamp. The inbox keeps its 250 ms coalescing and own-session skip (tested).
- T-11-17: there is no patch reader in pi-extention (grep). `changes(id)` returns counts and links only.
- T-11-18: readers validate through `readReportStat` / the PR checks before rendering. A malformed `task.report` falls back to the no-numbers line (tested).
