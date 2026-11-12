---
phase: 08-comment-lifecycle-agent-delivery
verified: 2026-11-10T19:12:52Z
status: passed
score: 4/4 must-haves verified
covered_files:
  - ".agents/skills/tasks/SKILL.md"
  - ".planning/phases/08-comment-lifecycle-agent-delivery/08-01-PLAN.md"
  - ".planning/phases/08-comment-lifecycle-agent-delivery/08-01-SUMMARY.md"
  - ".planning/phases/08-comment-lifecycle-agent-delivery/08-02-PLAN.md"
  - ".planning/phases/08-comment-lifecycle-agent-delivery/08-02-SUMMARY.md"
  - ".planning/phases/08-comment-lifecycle-agent-delivery/08-03-PLAN.md"
  - ".planning/phases/08-comment-lifecycle-agent-delivery/08-03-SUMMARY.md"
  - "docs/src/content/docs/architecture.md"
  - "docs/src/content/docs/overview.md"
  - "packages/cli/skills/tasks/SKILL.md"
  - "packages/cli/src/presentation.ts"
  - "packages/cli/src/tk.ts"
  - "packages/cli/test/comments.test.ts"
  - "packages/cli/test/tk.test.ts"
  - "packages/review/package.json"
  - "packages/review/src/core/review/lifecycle.test.ts"
  - "packages/review/src/core/review/lifecycle.ts"
  - "packages/surface/src/operations/review-comments.ts"
  - "packages/surface/test/review-comments.test.ts"
  - "packages/tui/src/app/App.tsx"
  - "packages/tui/src/app/artifact.tsx"
  - "packages/tui/src/app/context.ts"
  - "packages/tui/src/app/diff.tsx"
  - "packages/tui/src/app/help.tsx"
  - "packages/tui/test/review.test.tsx"
  - "packages/web/src/app.html"
  - "packages/web/src/client/review-island.tsx"
  - "packages/web/test/server.test.ts"
covered_digest: "v3:sha256:bd464f59ca72395f3084c536ea6b733583c5aa536e2376192f71eb11919d8901"
behavior_unverified: 0
overrides_applied: 0
deferred:
  - truth: "Sent comment cards are picked up by the agent automatically"
    addressed_in: "Phase 10"
    evidence: "08-CONTEXT deferred: 'Agent auto-pickup over the broker — Phase 10'"
  - truth: "Evidence images are comment targets inside the diff/task views (R74 view half)"
    addressed_in: "Phase 9"
    evidence: "Orchestrator scope note: evidence-image comment targets in views are Phase 9; CMT-01 evidence:<id> checked at data/CLI level only"
---

# Phase 8: Comment Lifecycle & Agent Delivery Verification Report

**Phase Goal:** Review comments have a lifecycle and reach the agent only when sent — one store per task, each comment tagged with where it was made
**Verified:** 2026-11-10T19:12:52Z
**Status:** passed
**Re-verification:** No — initial verification
**Mode:** mvp (roadmap). The goal is not in User Story form; verified goal-backward against the 4 roadmap success criteria.

## Goal Achievement

### Observable Truths (roadmap contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every comment carries its location as data — file, line range, or `evidence:<id>` — in the task's single comment store | ✓ VERIFIED | `review-comments.ts` `locationOf` (l.129-135) derives `file` / `file:line` / `file:line-end` / `evidence:<id>` from the thread record in `metadata.reviewThreads` of the task. CLI probe: `tk comments --json` gave `[c1,"src/a.ts:4"],[c2,"src/a.ts:10-12"],[c3,"evidence:shot1","shot1"],[c4,"README.md"]`. Production creation path for evidence targets: `taskStoreCommentStore.createThread` (l.178) stores `filePath: evidence:<id>` + `evidenceId`; covered by `review-comment-store.test.ts:180` and `server.test.ts:360` (pass). |
| 2 | Status open/sent/resolved/dismissed with ✓ done / ✕ remove controls in TUI and web; each transition emits a `task.comment` event | ✓ VERIFIED | `transitionReviewComment` appends `reviewCommentLog`; `watch/core.ts:73-90` emits one `task.comment` per log entry. Live `tk watch` probe: 4 CLI transitions (resolve, reopen, send, dismiss) → exactly 4 `task.comment` frames, in order, with from/to/actor/file. TUI tmux: `x` → `✓ resolved`, `D` → `✕ dismissed`, `D` again → `open` (reopen); record log shows each move. Web (agent-browser): `✕ remove` → `✕ dismissed`, `↺ reopen` → `open`. Tests: `watch.test.ts` task.comment block, `review.test.tsx` lifecycle block, `server.test.ts` lifecycle test. |
| 3 | Explicit send batches open comments as cards `{file:line, author, body}` — never per-comment — from CLI, TUI and web | ✓ VERIFIED | `reviewCommentSendUow` moves all open (or named) comments in one transaction and writes one `[review sent] N comments` summary. CLI: `send c1 c2` and `send --json` returned cards `[location, author, body]`; repeat send → `{"sent":[]}`; unknown cid → `comment not found: nope`, exit 1, nothing written. TUI `S` → `sent 2 comments to the agent`, rows `→ sent`; `S` again → `nothing open to send`; record has exactly 1 `[review sent]` summary. Web `send to agent (1)` → `SENT TO AGENT · 1 / a.txt:5 · alice · new line ok?`, button `send to agent (0)` disabled. |
| 4 | Views render `N open · K ✓` and an `All resolved` header from stored state | ✓ VERIFIED | CLI `REVIEW (4) · 3 open · 1 ✓` → `REVIEW (4) · All resolved`. TUI rail `COMMENTS · 2 open · 0 ✓` → `1 open · 1 ✓` → `COMMENTS · All resolved`. Web `#reviewHeader` `COMMENTS · 1 open · 1 ✓` → `All resolved` banner. Shared rules in `@tasks/review/lifecycle` (`reviewHeaderLabel`), imported by both `diff.tsx:9` and `review-island.tsx:28`. |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

Plan-level truths (08-01 ×5, 08-02 ×5, 08-03 ×5) were also checked and hold; they restate or refine the 4 SCs above. Detail: `<id> <op>` and `<op> <id>` argument orders both work; `resolve` with two cids fails `comments resolve takes one comment id`; keybar and help list `x ✓ done · D ✕ remove · S send to agent`; the island no longer uses `/resolve` (bundle test).

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Agent auto-pickup of sent cards | Phase 10 | 08-CONTEXT deferred section |
| 2 | Evidence images as comment targets in views (R74 view half) | Phase 9 | Orchestrator scope; data/CLI half verified in SC-1 |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/surface/src/operations/review-comments.ts` | uow-level list/setStatus/send | ✓ VERIFIED | Substantive (314 lines). Store-level wrappers delegate; used by `tk.ts:512-521` |
| `packages/cli/src/tk.ts` | `tk comments` dispatch | ✓ VERIFIED | `commentsArgs` l.358, dispatch l.1477-1484 |
| `packages/cli/src/presentation.ts` | formatReviewComments/Send/Status | ✓ VERIFIED | Exercised by the probe output |
| `packages/cli/test/comments.test.ts` | CLI e2e | ✓ VERIFIED | Passes |
| `packages/review/src/core/review/lifecycle.ts` | shared view rules | ✓ VERIFIED | Type-only imports; used by TUI and web |
| `packages/review/package.json` | `./lifecycle` export | ✓ VERIFIED | Resolved at runtime by TUI and the web bundle |
| `packages/tui/src/app/diff.tsx`, `App.tsx` | header, badges, x/D/S → setThreadStatus/sendOpen | ✓ VERIFIED | diff.tsx:274-276 → App.tsx:391,402 |
| `packages/web/src/client/review-island.tsx`, `app.html` | pills, controls, header, send, sent panel | ✓ VERIFIED | Live DOM probe |
| `packages/web/test/server.test.ts` | bundle + lifecycle assertions | ✓ VERIFIED | Passes |

`verify.artifacts`: 4/4, 4/4 and 3/3 passed.

### Key Link Verification

`verify.key-links` could not parse the plans' prose `from:` fields (0/2 for each plan: "from: must be a relative file path"). I verified each link by hand:

| From | To | Via | Status |
|------|----|-----|--------|
| tk.ts comments dispatch | reviewComment*Uow | `transaction(this.database, …)` with `this.actor` | WIRED (tk.ts:512-521; probe log entries carry actor `probe`) |
| reviewCommentSetStatusUow / SendUow | `metadata.reviewCommentLog` → `task.comment` | transitionReviewComment → appendReviewCommentLog → watch/core.ts | WIRED (live watch frames) |
| diff.tsx x/D/S | reviewStore().setThreadStatus / sendOpen | taskStoreCommentStore → @tasks/surface | WIRED (tmux probe + record log) |
| diff.tsx and review-island.tsx | @tasks/review/lifecycle | import | WIRED |
| island controls | POST /api/review/:id/threads/:tid/status | `commentControls(status).to` | WIRED (review-island.tsx:310; DOM probe) |
| island send button | POST /api/review/:id/comments/send | server.ts:524 `threads().sendOpen` → `reviewCommentSend` | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| CLI list | comments/counts | task metadata through the surface uow | yes | ✓ FLOWING |
| TUI rail | review.threads | taskStoreCommentStore list | yes (the seeded record was rendered) | ✓ FLOWING |
| Web header and cards | `/threads` list | taskStoreCommentStore | yes (curl showed the stored threads) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase test suites | `bun test --timeout 30000 packages/surface/test packages/cli/test packages/review/src/core/review packages/tui/test packages/web/test` | Run 1: 500 pass / 0 fail, 46 files, 242s. No transient failures, so there was no second run. | ✓ PASS |
| Store and watch | `bun test packages/review/test/review-comment-store.test.ts packages/surface/test/watch.test.ts` | 17 pass / 0 fail | ✓ PASS |
| Typecheck | `bunx tsc --noEmit -p tsconfig.json` in cli, tui, web, review; `cd packages/tui && bun run check` | all exit 0 | ✓ PASS |
| CLI lifecycle probe | scratch `tk init` workspace + seeded threads; `tk comments list/send/resolve/dismiss/reopen` (+`--json`) | as SC-1, SC-3 and SC-4; log has 9 entries for 9 moves | ✓ PASS |
| task.comment events | `sleep 25 \| tk watch --kinds task.comment` during 4 transitions | 4 `task.comment` frames, in order | ✓ PASS |
| TUI keys | tmux session `gsdv08tui<pid>` (killed afterwards), `tk tui tk://diff/<id>`; keys S, S, x, J+D, D | as SC-2, SC-3 and SC-4 | ✓ PASS |
| Web island | `tk web --dev --port 59281` (stopped afterwards) + agent-browser session `gsdv08` (closed afterwards) | send, remove and reopen; header, banner and sent panel | ✓ PASS |

Probe artifacts are in `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/v08/` (`probe.sh`, `probe.log`, `web-allresolved.png`).

### Probe Execution

No `scripts/*/tests/probe-*.sh` declared by the phase; the ad-hoc probes are listed above.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CMT-01 | 08-01 | One store per task; location as file / line(s) / evidence id (R73, R74 data half) | ✓ SATISFIED | SC-1 |
| CMT-02 | 08-01, 08-02, 08-03 | Status lifecycle with done/remove controls; every transition is a `task.comment` event (R63) | ✓ SATISFIED | SC-2 |
| CMT-03 | 08-01, 08-02, 08-03 | Explicit batched send as cards, never a firehose (R62) | ✓ SATISFIED | SC-3 |

No orphaned requirements: REQUIREMENTS.md maps only CMT-01..03 to Phase 8.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (all covered files) | — | TBD/FIXME/XXX | — | None found |
| packages/cli/src/tk.ts (error path) | — | A human-mode error prints the raw envelope: `✗ {"kind":"repository","operation":"cli","cause":{…"message":"comment not found: nope"}}` | ℹ️ Info | The message and the non-zero exit are correct, but the output is not formatted for humans. Cosmetic. |
| packages/web/src/client/review-island.tsx | — | The artifact view shows both a per-file `COMMENTS · n` chip and the task-wide header | ℹ️ Info | The 08-03 summary already notes this. Cosmetic. |
| `tk watch --kinds task.comment` | — | Still emits `issue.created` / `issue.updated` frames | ℹ️ Info | Watch filtering predates this phase and is not part of the Phase 8 contract. Relevant to Phase 10 pickup. |

### Human Verification Required

None. I ran the 08-03 `<human-check>` items myself (web `✕ remove` → `✕ dismissed` + All resolved; `send to agent (N)` → sent panel, `→ sent` pills, button disabled at 0) through agent-browser and observed them directly. `tk comments` confirmed the record afterwards.

### Gaps Summary

No gaps. The phase goal is achieved across the data layer, CLI, TUI and web:

- Comments live in one store per task, and each carries its location as data.
- Every lifecycle move writes a log entry that becomes a `task.comment` event.
- Delivery to the agent happens only through an explicit, batched send.

Agent auto-pickup (Phase 10) and image comment targets in views (Phase 9) are deferred by design. Concurrent executors 09-01 and 09-02 caused no test failures during this run.

---

_Verified: 2026-11-10T19:12:52Z_
_Verifier: Claude (gsd-verifier)_

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
- Phase-specific recheck (4/4 truths). `locationOf` and `reviewCommentSendUow` are in `surface/operations/review-comments.ts`. `reviewHeaderLabel` from `@tasks/review/lifecycle` is shared by TUI (`diff.tsx:10`, `artifact.tsx:4`) and web (`review-island.tsx:31`). The lifecycle, watch task.comment and server lifecycle tests are green.
