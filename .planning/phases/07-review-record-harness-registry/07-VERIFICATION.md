---
phase: 07-review-record-harness-registry
verified: 2026-11-10T16:58:00Z
status: passed
score: 3/3 must-haves verified
covered_files:
  - ".planning/phases/07-review-record-harness-registry/07-01-PLAN.md"
  - ".planning/phases/07-review-record-harness-registry/07-01-SUMMARY.md"
  - ".planning/phases/07-review-record-harness-registry/07-02-PLAN.md"
  - ".planning/phases/07-review-record-harness-registry/07-02-SUMMARY.md"
  - ".planning/phases/07-review-record-harness-registry/07-03-PLAN.md"
  - ".planning/phases/07-review-record-harness-registry/07-03-SUMMARY.md"
  - ".planning/phases/07-review-record-harness-registry/07-04-PLAN.md"
  - ".planning/phases/07-review-record-harness-registry/07-04-SUMMARY.md"
  - "docs/src/content/docs/integrations.md"
  - "docs/src/content/docs/overview.md"
  - "packages/cli/src/presentation.ts"
  - "packages/cli/src/tk.ts"
  - "packages/cli/test/doors.test.ts"
  - "packages/cli/test/finish.test.ts"
  - "packages/cli/test/presentation.test.ts"
  - "packages/cli/test/review-record-verify.test.ts"
  - "packages/domain/src/index.ts"
  - "packages/domain/src/review-record.ts"
  - "packages/domain/test/review-record.test.ts"
  - "packages/surface/src/runtime.ts"
  - "packages/surface/test/runtime.test.ts"
  - "packages/tui/src/app/App.tsx"
  - "packages/tui/src/app/detail.tsx"
  - "packages/tui/src/app/doors.tsx"
  - "packages/tui/src/app/kanban.tsx"
  - "packages/tui/src/app/list.tsx"
  - "packages/tui/src/app/task.tsx"
  - "packages/tui/src/store.ts"
  - "packages/tui/test/app.test.tsx"
  - "packages/web/src/app.html"
  - "packages/web/test/server.test.ts"
covered_digest: "v3:sha256:1e058ef4c2602f93dcf4da7bccd555ead51d93c3eebcefbb5d0f37704ecf954a"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Run `tk web`, open the board, the list view and a task modal in a browser"
    expected: "Board cards show `tk review <id> · /tasks/<id>` (full URL in title); list rows show the `ldoors` span with `tk review <id>`; the task modal shows the agent chip (when finished), `review TUI tk review <id>`, the `<origin>/tasks/<id>` link, and the comments row"
    why_human: "Web doors are produced by client-side template code in app.html; tests only assert the served HTML text contains the templates — no test executes renderList / the modal in a DOM"
  - test: "Open the TUI list, kanban, detail pane and task view at a normal (~120 col) terminal width"
    expected: "One dim `review tk review <id> · <base>/tasks/<id>` line for the focused task; legible, not clipped into uselessness in the 50% list pane"
    why_human: "Automated TUI tests run at 160-200 cols; 07-02 notes the URL is clipped by the pane at narrower widths — visual acceptability is a judgment call"
---

# Phase 7: Review Record & Harness Registry Verification Report

**Phase Goal:** The record carries its own provenance and both review doors on every task surface — the agent line renders from a harness registry (data, not code)
**Verified:** 2026-11-10T16:58:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

Note on mode: ROADMAP marks Phase 7 `mode: mvp`, but the goal is not in User Story form (`user-story.validate` → `false`). The orchestrator requested verification anyway, so the standard goal-backward method was applied against the 3 ROADMAP success criteria. If MVP-mode user-flow coverage is required, the goal needs rewording via `/gsd-mvp-phase 7`.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1 / REC-01 / REC-03: `tk show` renders `agent <harness> · session <id> finished <time>` from a harness registry, omp first, codex/cursor entries; adding a harness is a data entry | ✓ VERIFIED | `packages/domain/src/review-record.ts`: `HARNESS_REGISTRY` (omp `first`, codex/cursor `planned`, each with `env`), pure `detectHarness(env, registry)`, `agentLine` from `metadata.agent_harness/agent_session/finished_at`. `tk.ts:559` finish: `--harness` > `TK_HARNESS` > `detectHarness(process.env)` → always recorded via `finishIssueUow`. `presentation.ts:217-223` renders it in `tk show`. Tests: review-record-verify "item 6 (Registry)" adds a `zed` entry with only `env` and gets `agent zed · session z1` with no code change. Own probe (below): no env → `agent omp · session sA finished 2026-11-10 16:53`; `CURSOR_CONVERSATION_ID` + `PI_SESSION_ID` → `cursor` (non-default wins); `--harness codex` beats `TK_HARNESS=zed` and `CODEX_THREAD_ID`. Metadata holds `agent_harness`, `agent_session`, `finished_at` (ISO). |
| 2 | SC2 / REC-02: every task surface — `tk show`, `tk list`, TUI task view, web modal and board cards — shows both doors `tk review <id>` and `<web base>/tasks/<id>` | ✓ VERIFIED (web visuals → human item) | CLI: `tk show` (`tk.ts:1423` + `formatDoors`), `--json` `review_doors`; list/ready/query/search/blocked/stale/children/agent issues footer via `webBase(root)` = `resolveWebBase(.tasks)` (`tk.ts:81`). TUI: `task.tsx:47`, `DoorsLine` in list/kanban/detail, base from `Board.webBase` resolved each poll (`store.ts:418`). Web: board card `app.html:496`, list row `:566`, modal `#mDoors` `:894`, all via `esc()`; web base = `location.origin`. `resolveWebBase` rejects non-http(s) urls and broken registries → `http://localhost:21579`; `DEFAULT_WEB_BASE` pinned equal to `WEB_DEFAULT_PORT`. Tests: doors.test.ts (8 list-family commands), review-record-verify item 7 CLI + web-template text, tui app.test.tsx (task view/list/kanban/detail with registered base), runtime.test.ts (6 resolveWebBase cases). Own probe: default base and registered `http://127.0.0.1:6111/` (trailing slash stripped) both appear on show/list/json. |
| 3 | SC3 / REC-03: `tk show` carries `comments N · M open K ✓` read from the task's review threads | ✓ VERIFIED | `commentSummary`/`commentsLine` in review-record.ts (open+sent open, dismissed settles, `All resolved` variant); `formatShow` prefers the Phase 3 `reviewComments` counts when thread comments exist. Tests: review-record-verify "comments row (D-03)". Own probe: threads open/resolved/dismissed/sent → `comments 0 · 2 open 1 ✓`; fresh task → `comments 0 · 0 open 0 ✓`. |

**Score:** 3/3 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/domain/src/review-record.ts` | registry + detection + doors + agent/comments lines | ✓ VERIFIED | substantive, exported from `domain/src/index.ts`, used by cli/tui |
| `packages/surface/src/runtime.ts` `resolveWebBase` | shared web-base rule | ✓ VERIFIED | used by `tk.ts:81` and `tui/src/store.ts:418` |
| `packages/tui/src/app/doors.tsx` | `DoorsLine` | ✓ VERIFIED | rendered in list.tsx:91, kanban.tsx:63, detail.tsx:157 |
| `packages/cli/src/presentation.ts` | doors footer / show record block | ✓ VERIFIED | `formatDoors`, `doorsFooter`, `formatShow` |
| `packages/web/src/app.html` | doors on cards, list rows, modal | ✓ VERIFIED (text) | `doorsFor` → `esc()`; rendering in DOM not tested (human item) |
| `packages/cli/test/review-record-verify.test.ts` | e2e for spec verify 1, 6, 7 | ✓ VERIFIED | 7 cases pass |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `tk finish` | `metadata.agent_harness` | `detectHarness(process.env)` → `finishIssueUow(..., harness)` | WIRED (probe confirmed stored values) |
| `tk show` | registry | `agentLine(issue)` → `agentRecord` | WIRED |
| CLI list family / `tk show` | runtime registry | `webBase` → `resolveWebBase` | WIRED (probe: registered url used) |
| TUI board | runtime registry | `loadBoard` → `resolveWebBase`; `boardSignature` includes webBase | WIRED (app.test.tsx) |
| web views | doors | `doorsFor(issue)` (`location.origin`) | WIRED (template-level) |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real Data | Status |
|----------|------|--------|-----------|--------|
| `tk show` agent line | harness/session/finished_at | issue metadata written by `tk finish` | yes (probe) | ✓ FLOWING |
| doors web base | url | `.tasks/runtime.json` web row, else default | yes (probe) | ✓ FLOWING |
| comments row | counts | `metadata.reviewThreads` / review comment cards | yes (probe) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase test gate | `bun test packages/domain packages/cli/test/review-record-verify.test.ts packages/cli/test/doors.test.ts packages/cli/test/finish.test.ts packages/surface/test/runtime.test.ts packages/tui/test/app.test.tsx packages/web/test/server.test.ts --timeout 30000` | 84 pass / 1 fail (85 tests, 8 files) | ✓ PASS for Phase 7 (see note) |
| Harness default | scratch repo: `tk work` + commit, `tk finish <id> --session sA` (clean env) | `agent omp · session sA finished 2026-11-10 16:53` | ✓ PASS |
| Non-default beats default | `CURSOR_CONVERSATION_ID=c1 PI_SESSION_ID=p tk finish ... --session sB` | `agent cursor · session sB ...` | ✓ PASS |
| Precedence | `CODEX_THREAD_ID=t1 TK_HARNESS=zed tk finish ... --harness codex` | `agent codex ...` | ✓ PASS |
| Finish guard | `tk finish` without `tk work` | rejected: "finish requires a branch and pinned changeset base" | ✓ PASS |
| Doors default | `tk show` / `tk list` no runtime | `review tk review <id> · http://localhost:21579/tasks/<id>` | ✓ PASS |
| Doors registered | runtime.json web url `http://127.0.0.1:6111/` | show/list/`review_doors` use `http://127.0.0.1:6111/tasks/<id>` | ✓ PASS |
| Comments row | `--set-metadata reviewThreads=` open/resolved/dismissed/sent | `comments 0 · 2 open 1 ✓` | ✓ PASS |

**Excluded failure (not Phase 7):** `packages/web/test/server.test.ts` › "serves the shell for the task, diff and file deep links (D-01)" fails on `expect(body).toContain('id="taskView"')` for `/tasks/abc`. `taskView` is owned by in-progress plan 05-02 (`.planning/phases/05-web-review/05-02-PLAN.md`), being edited concurrently in `packages/web`. The Phase 7 web assertions in the same file ("serves the shell and board API", `ldoors` / `doorsFor(i).tui`) pass. Per instruction, the 4 known failures in `packages/tui/test/review.test.tsx` (plan 04-02) were excluded and not run; `packages/tui/test/app.test.tsx` (Phase 7 TUI doors) passes.

### Probe Execution

No `scripts/*/tests/probe-*.sh` declared; the scratch-workspace CLI probe above stands in (scratchpad `p7probe`, not in repo).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| REC-01 | 07-01, 07-04 | Harness registry, omp first, codex/cursor; agent line renders from it | ✓ SATISFIED | Truth 1 |
| REC-02 | 07-02, 07-03, 07-04 | Both review doors on every task surface | ✓ SATISFIED | Truth 2 |
| REC-03 | 07-01, 07-04 | Session id + finish time recorded and shown in agent line; comments row | ✓ SATISFIED | Truths 1, 3 |

No orphaned requirements (REQUIREMENTS.md maps only REC-01..03 to Phase 7).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX/TODO/HACK in Phase 7 files (presentation.ts hits are the `tk todo` "TODOs" label) | — | none |
| `packages/domain/src/review-record.ts` | `commentSummary` | `N` = issue comment count while M/K come from threads; synthetic threads with no backing comments give `comments 0 · 2 open 1 ✓` | ℹ️ Info | In real use thread comments are ordinary issue comments (Phase 3 store), so N ≥ threads; only hand-written metadata produces the odd row |
| `packages/cli/src/tk.ts` | 559 | `--harness` / `TK_HARNESS` values are stored verbatim, not checked against the registry | ℹ️ Info | An unregistered id renders as-is; intended override behavior |
| `packages/cli/src/tk.ts` | leaseHolder | reads `OMP_SESSION_ID` (omp exports `PI_SESSION_ID`) — flagged in 07-01 SUMMARY | ℹ️ Info | outside Phase 7 scope; not filed |

### Human Verification Required

### 1. Web doors in a browser

**Test:** Run `tk web`, open the board, the list view and a task modal.
**Expected:** Cards show `tk review <id> · /tasks/<id>` (full URL in title); list rows show the `tk review <id>` door; modal shows agent chip, TUI door and the `<origin>/tasks/<id>` link, plus the comments row.
**Why human:** Only the served template text is asserted; no test runs the client render in a DOM.

### 2. TUI doors line at normal width

**Test:** Open TUI list/kanban/detail/task view at ~120 cols.
**Expected:** One dim doors line for the focused task, usable (07-02 notes URL clipping in the 50% list pane).
**Why human:** Tests run at 160-200 cols; visual acceptability.

### Gaps Summary

No gaps. All three success criteria and REC-01..03 are implemented, wired and exercised by passing tests plus an independent scratch-workspace probe. Status is `human_needed` only for browser/terminal visual confirmation of the doors. Caveat: the covered digest includes `packages/web/src/app.html`, `packages/web/test/server.test.ts` and TUI files that concurrent executors (05-02, 04-02) are editing, so the fingerprint will go stale when their edits land.

---

_Verified: 2026-11-10T16:58:00Z_
_Verifier: Claude (gsd-verifier)_


## Human Verification Result (2026-11-10)

Performed in a live browser (agent-browser) and a 120x40 tmux TUI session:
1. Web doors — PASS: board cards show `tk review <id> · /tasks/<id>`; task modal shows agent line, `tk review <id>`, `http://localhost:8811/tasks/<id>`, comments row.
2. TUI doors at 120 cols — PASS (task view shows both doors in full); minor: list-pane doors line truncates the URL (`http://localhost:`) — filed as a tk follow-up, Phase 9 rebuilds that pane.

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
- Phase-specific recheck (3/3 truths). `HARNESS_REGISTRY` and `detectHarness` are in `domain/review-record.ts`. `tk finish` resolves the harness as `--harness` > `TK_HARNESS` > `detectHarness` (`tk.ts:580`). Doors and comments rows are covered by the review-record-verify, doors, tui app and runtime tests, all green.
