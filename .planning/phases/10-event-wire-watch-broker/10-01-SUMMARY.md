---
phase: 10-event-wire-watch-broker
plan: 01
subsystem: surface
tags: [events, jsonl, event-log, wire, recorder, storage-adapter]

requires:
  - phase: 05-web-review
    provides: review-comment surface used by the review web island (05-04)
  - phase: 08-comment-lifecycle
    provides: reviewCommentLog / reviewComments cards / batched send (08-03)
provides:
  - "`.tasks/events.jsonl` append-only event wire with the spec §10 envelope, gap-free cross-process seq"
  - "`deriveIssueEvents` / `deriveRunEvent` — the single place event types are decided"
  - "`withEventLog` StorageAdapter decorator wired into `openSurfaceStore` and the CLI main storage open"
affects: [10-02, 10-03, 10-04, 10-05, 10-06, 11-04]

actuals:
  tokens: 10750
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "StorageAdapter decorator: snapshot before on first mutator per id, read after inside the tx, append only after commit"
    - "Two-layer append lock: withStateLock chain + mkdir(events.lock) with pid file and stale takeover"

key-files:
  created:
    - packages/surface/src/events/log.ts
    - packages/surface/src/events/derive.ts
    - packages/surface/src/events/recorder.ts
    - packages/surface/test/events-log.test.ts
    - packages/surface/test/events-derive.test.ts
    - packages/cli/test/events.test.ts
  modified:
    - packages/surface/src/store.ts
    - packages/surface/src/index.ts
    - packages/cli/src/tk.ts
    - docs/src/content/docs/architecture.md

key-decisions:
  - "Event types are decided only in packages/surface/src/events/derive.ts; Phase 11-04 adds `task.pr` there (and adds `pr` to coveredMetadata())"
  - "Non-dedicated metadata changes are reported in task.update.fields as `metadata.<key>`"
  - "`tk import` is also left unwrapped (bulk copy), alongside init/migrate/switch-backend/ephemeral"
  - "Emission is advisory: derivation/append errors are swallowed after commit"

requirements-completed: [WIRE-01, WIRE-03]

coverage:
  - id: D1
    description: "Real `tk update --status` appends a task.status line with gap-free seq, host, actor, ISO ts; TK_SESSION stamps session; init writes no log; failed commands append nothing"
    requirement: WIRE-01
    verification:
      - kind: e2e
        ref: "packages/cli/test/events.test.ts"
        status: pass
  - id: D2
    description: "Full derivation table (created/status+finish/owner/comment note+review/evidence/worktree/update/deleted/run.changed) with ordering"
    requirement: WIRE-03
    verification:
      - kind: unit
        ref: "packages/surface/test/events-derive.test.ts"
        status: pass
  - id: D3
    description: "Recorder through createSurface for every mutator; review send = one sent event per card; rollback appends nothing; saveRun → run.changed; two processes → seqs 1..100; stale lock takeover; torn trailing line ignored"
    requirement: WIRE-01
    verification:
      - kind: integration
        ref: "packages/surface/test/events-log.test.ts"
        status: pass

duration: ~45min
completed: 2026-11-11
---

# Phase 10 Plan 01: Event wire (write side) Summary

**Every committed write — CLI or any SurfaceStore — now appends spec §10 envelope lines to `.tasks/events.jsonl`, with event types decided in one pure module and a gap-free cross-process `seq`.**

Commits withheld per AGENTS.md (no git commit/push in this session). STATE.md / ROADMAP.md not updated per orchestrator override.

## Envelope

One JSON object per line in `<root>/.tasks/events.jsonl`:

```json
{ "seq": 412, "host": "<os.hostname()>", "ts": "<ISO>", "task": "<issue id>", "type": "task.status",
  "actor": "<store/CLI actor>", "session": "<TK_SESSION, only when set>", "data": { } }
```

- `seq` strictly increasing, gap-free across concurrent writer processes on one host (in-process `withStateLock` chain keyed `<tasksDir>#events` + cross-process `mkdir(.tasks/events.lock)` with `pid`, 5ms retry, 5s deadline, 10s stale takeover; a lock ≥1s old whose pid is dead is also taken over).
- `lastEventSeq` scans the final 64 KiB backwards (full-read fallback); `readEvents(dir, { after, limit })` skips torn/malformed lines; `appendEvents` re-terminates a torn trailing line before writing.

## Event type table (`packages/surface/src/events/derive.ts`)

**`packages/surface/src/events/derive.ts` is the single place event types are decided. Phase 11-04 adds `task.pr` there** (and should add `pr` to `coveredMetadata()` so `metadata.pr` stops appearing in `task.update.fields`).

Per-issue order: created, status, owner, comment(s), evidence, worktree, update, deleted.

| type | trigger | `data` |
|---|---|---|
| `task.created` | before null | `{ title, status, owner, assignee }` |
| `task.status` | status changed (approvals = `to: approved|rejected`) | `{ from, to }`; finish → `+ session, finishedAt`; repeat finish (status unchanged, `finished_at` changed) → `{ from: to, to, session, finishedAt, refinish: true }` |
| `task.owner` | owner / assignee changed (separate events) | `{ field: "owner"|"assignee", from, to }` |
| `task.comment` (note) | new plain comment (not `wireUnknown.reviewThread`, not `[review…` text) | `{ kind: "note", comment, author, body }` |
| `task.comment` (review) | each new `reviewCommentLog` entry (n above before's top), log order | `{ kind: "review", comment, from, to, actor, file, line, location, author, body }` (card fields null when the card is gone); a send = one `to: "sent"` per card, summary comment emits no note |
| `task.evidence` | new `kind: "evidence"` blob attachment (inline ignored) | `{ id, name, mime }` |
| `task.worktree` | `metadata.worktree` or `branch` changed | `{ path, branch }` |
| `task.update` | any other change | `{ fields: [sorted] }` — title, description, priority, type, createdBy, notes, design, acceptanceCriteria, estimate, specId, externalRef, dueAt, deferUntil, parentId, sprintId, labels, dependencies, attachments (removals / path attachments), `metadata.<key>` for uncovered keys. Never: updatedAt/startedAt/closedAt/commentCount/dependency counts, covered metadata (`agent_session`, `finished_at`, `agent_harness`, `worktree`, `reviewThreads`, `reviewCommentLog`, `hunkComments`) |
| `task.deleted` | after null | `{ title }` |
| `run.changed` | `saveRun` of a new run or a state move | `{ runId, from, to }`, `task: run.issueId` |

`task.commit` / `task.report` are not emitted (no write path produces them).

## Accomplishments

- `log.ts`: `EVENTS_FILE`, `TaskEventType`, `TaskEvent`, `EventDraft`, `EventStamp`, `withEventsLock`, `appendEvents`, `lastEventSeq`, `readEvents` (node:fs/promises only).
- `recorder.ts`: `withEventLog(adapter, { tasksDir, actor, session? })` — Proxy over the tx's uow; mutators `save`, `addDependency`, `removeDependency`, `addComment`, `delete`, `claimReady` snapshot the first `before` per id; `saveRun` keeps first `before` via `findRun` and last saved run as `after`; `saveSprint`/`saveAgent` emit nothing; MigrationPort forwards unchanged.
- `store.ts`: `openSurfaceStore` wraps the handle adapter once (even when readonly); `store.adapter` returns the wrapped adapter.
- `tk.ts`: CLI main open passes `withEventLog(storage.adapter, …)` to `CommandService` (same actor; `TK_SESSION`); `migrate()`/`hasPendingMigrations()` stay on the raw adapter. Not wrapped: ephemeral scratch, `migrate`, `import`, plus `init` and `switch-backend` (separate opens, untouched).
- `index.ts`: three additive `export *` lines.
- Docs: new "Event wire (`events.jsonl`)" section + CLI-path step 7 in `docs/src/content/docs/architecture.md` (AGENTS.md doc rule). `rpc.md` kinds table left for 10-02 per its plan.

## Deviations from Plan

1. **[Rule 1 - Bug] Import cycle broke module init.** `store.ts → recorder → derive → review-comments → store.ts`: a module-level `Set` of `REVIEW_*` constants threw `ReferenceError: Cannot access 'REVIEW_REGISTRY_KEY' before initialization` when review-comments loaded first (11 surface test files failed as "unhandled error between tests"). Fix: the covered-metadata set is built lazily (`coveredMetadata()`). Found by `bun test packages/surface/test`.
2. **[Rule 2] `tk import` not wrapped.** The plan names init/migrate/ephemeral; `import` goes through the same main open and would bulk-flood the log with `task.created` lines, against the "bulk copies never flood the log" truth.
3. **Test adjustment:** the "CLI command that fails validation" case uses `tk update <id> --priority 9` (zod rejects inside the tx). `--status not-a-status` is accepted by the current CLI (custom statuses), so it is not a failure path. Also noted: `tk dep add <id> <id>` succeeds (self-dependency) — pre-existing, out of scope.
4. **Field naming choice (discretion):** uncovered metadata keys appear in `task.update.fields` as `metadata.<key>`; `attachments` is listed for removals / new path attachments.
5. **Stale-lock heuristic:** besides the 10s age rule, a lock ≥1s old whose recorded pid is dead is taken over (speeds recovery after a crashed writer).
6. **Docs edit** in architecture.md (not in `files_modified`) per AGENTS.md "update docs in the same change".

## Verification (all run, all green)

- `bun run --filter @tasks/surface build` — OK
- `bun test packages/cli/test/events.test.ts` — 4 pass
- `bun test packages/surface/test/events-derive.test.ts` — 11 pass
- `bun test packages/surface/test/events-log.test.ts packages/surface/test/events-derive.test.ts packages/cli/test/events.test.ts` — 21 pass
- `bun test packages/surface/test` — 93 pass, 0 fail (baseline before change: 76 pass)
- `bun run --filter @tasks/cli check` — exit 0; `bun run --filter @tasks/surface check` — exit 0
- Extra regression: `bun test packages/cli/test` — 188 pass, 0 fail
- `cd docs && bun run build` — Complete

## Notes for next plans

- 10-02 (`tk watch`) reads with `readEvents(tasksDir, { after: cursor })`; `lastEventSeq` gives the start cursor for `--follow`.
- `.tasks/events.jsonl` / `.tasks/events.lock` are git-ignored in this repo via `.tasks/`; `tk init` does not write a `.gitignore` for other repos (same as existing runtime files).
- Retention/trimming and cross-host sync remain open (single host v1).

## Self-Check: PASSED
