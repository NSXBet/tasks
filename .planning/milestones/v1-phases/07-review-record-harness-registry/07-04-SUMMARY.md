---
phase: 07-review-record-harness-registry
plan: 04
subsystem: verification
status: complete
tags: [review-record, harness-registry, review-doors, e2e, verification]
requires:
  - phase: 07-01
    provides: "detectHarness + agent_harness at finish; DEFAULT_WEB_BASE :21579"
  - phase: 07-02
    provides: "resolveWebBase; TUI doors"
  - phase: 07-03
    provides: "CLI list-family doors footer; web list-row doors"
provides:
  - "packages/cli/test/review-record-verify.test.ts — one e2e file proving spec verify items 1, 6, 7, SC 1-3 and the DEFAULT_WEB_BASE drift pin"
key-files:
  created:
    - packages/cli/test/review-record-verify.test.ts
  modified: []
requirements-completed: [REC-01, REC-02, REC-03]
actuals:
  tasks: 2
  commits: 0
completed: 2026-11-10
---

# Phase 7 Plan 04: Review-record verification — Summary

I added one test file, `packages/cli/test/review-record-verify.test.ts`, with 7 cases, and all of them pass. It proves Phase 7 SC1-3 and spec verify items 1 (Product), 6 (Registry) and 7 (Doors). The full Phase 7 gate is green. The only failures in the TUI suite come from concurrent 04-02 work in progress and are unrelated to Phase 7 (details below). This plan changed no production code, and no gaps were found.

Commits were withheld per AGENTS.md (conservative profile). The work is in the main tree, and STATE.md and ROADMAP.md were not touched.

## Test cases (`describe("Phase 7 review record — spec verify 1, 6, 7")`)

| Case | What it asserts |
|---|---|
| item 1 (Product) | The flow is `tk work`, then commits for `a.txt` and `b.txt`, then `tk finish <id> --session s1`. Human `tk show` then contains `agent omp · session s1 finished`, `tk review <id>`, `/tasks/<id>`, `comments 0 · 0 open 0 ✓`, `BRANCH:`, `COMMITS (2)` and `FILES (2)`. In `show --json`, the `changeset.files` paths equal `git diff --name-only <base>..<branch>` run by the test (`a.txt`, `b.txt`). Finish metadata keys are limited to the pre-finish work record plus `agent_session`, `finished_at`, `agent_harness` and `changeset`. `metadata.changeset` has a string `base` and no `files` or `commits`. |
| item 6 (Registry) | `HARNESS_REGISTRY[0].id === "omp"`, and the ids include codex and cursor. Adding a `zed` entry that has only `env: ["ZED_SESSION_ID"]` gives `detectHarness(...) === "zed"`, and `agentLine` renders `agent zed · session z1` with no code change. |
| item 6 e2e | `tk finish --session s2` with `CODEX_THREAD_ID=t` makes `tk show` print `agent codex · session s2`. |
| item 7 (Doors, CLI) | With a web runtime registered at `http://127.0.0.1:5999`, human `tk show` has both doors. `--json` `review_doors` is `{ tui: "tk review <id>", web: "http://127.0.0.1:5999/tasks/<id>" }`. `list`, `ready`, `query status=open` and `children <parent>` each print `http://127.0.0.1:5999/tasks/<id>` and `tk review <id>`. |
| item 7 (Doors, web) | `packages/web/src/app.html`, read as text, contains the board-card door `${esc(doorsFor(issue).tui)}`, the list-row door `class="ldoors mono"…${esc(doorsFor(i).tui)}` and the modal `id="mDoors"…${esc(d.tui)}…${esc(d.web)}`. All three go through `esc(`. |
| comments row (D-03) | `--set-metadata reviewThreads=...` with threads open/resolved/dismissed shows `1 open 1 ✓`. With all threads resolved or dismissed it shows `All resolved`. The JSON value in `metadataEntry` parsed as-is; no quoting changes were needed. |
| drift pin | `DEFAULT_WEB_BASE === \`http://localhost:${WEB_DEFAULT_PORT}\`` |

## Evidence table: spec verify item → proving test(s) → result

| Item | Proving test(s) | Result |
|---|---|---|
| Spec 1 Product: PR-shaped record, derived lists | review-record-verify "item 1 (Product)"; finish.test.ts "finish never freezes the changeset snapshot"; show-review.test.ts | pass |
| Spec 6 Registry: omp first, harness as data | review-record-verify "item 6 (Registry)" + "item 6 e2e"; domain review-record.test.ts detection cases; finish.test.ts codex/cursor/omp/precedence | pass |
| Spec 7 Doors: show/list/kanban/web | review-record-verify "item 7 (Doors, CLI)" + "item 7 (Doors, web)"; doors.test.ts (all 8 list-family commands); web server.test.ts (served shell); tui app.test.tsx (task view, list, kanban, detail) | pass |
| SC1 agent line from registry (REC-01) | item 6 cases + finish.test.ts | pass |
| SC2 doors on every task surface (REC-02) | item 7 cases + doors.test.ts + tui app.test.tsx + web server.test.ts | pass |
| SC3 comments row (REC-03) | review-record-verify "comments row (D-03)"; item 1 `comments 0 · 0 open 0 ✓` | pass |
| DEFAULT_WEB_BASE drift | review-record-verify "drift pin" | pass |

## Gate run

| Command | Result |
|---|---|
| `bun test --timeout 30000 packages/cli/test/review-record-verify.test.ts` | 7 pass / 0 fail (70 expects) |
| `bun test packages/domain/test/review-record.test.ts packages/surface/test/runtime.test.ts` | 17 pass / 0 fail |
| `bun test --timeout 30000 packages/cli/test/finish.test.ts packages/cli/test/doors.test.ts packages/cli/test/presentation.test.ts packages/cli/test/review-record-verify.test.ts packages/review/test/show-review.test.ts` | 36 pass / 0 fail |
| `bun test --timeout 15000 packages/tui/test packages/web/test` run 1 | 84 pass / 4 fail (88 tests) |
| same, run 2 | 86 pass / 4 fail (90 tests; the concurrent executor added tests between runs) |
| `bun test --timeout 15000` tui app/boot/routes/image-size/review-edit + `packages/web/test` (everything except `review.test.tsx`) | 78 pass / 0 fail |
| `cd packages/domain && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `cd packages/cli && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `cd packages/tui && bun run check` | exit 0 |
| `grep -rn "4747" packages/*/src docs/src` | no hits |
| `cd docs && bun run build` | Complete |

**TUI failures (not Phase 7):** both runs failed the same 4 tests, all in `packages/tui/test/review.test.tsx`, `describe("tui in-view hunk edit")`. The error each time was `frame predicate never matched within 12000ms`. The failing tests are: `e on a selected hunk opens the buffer…`, `esc cancels the buffer…`, `e with no hunk selected toasts…` and `E on a selected thread opens the review-comment edit composer`. That file is untracked, as are `src/app/hunkEdit.tsx` and `src/review/edit.ts`. It belongs to the 04-02 executor, which is running at the same time, and its tests were still being added between my two runs. Phase 7's TUI door tests live in `app.test.tsx`, and they passed in both runs and in the isolated run. Because the failure repeated in both runs, it is not a transient race but 04-02's work in progress. 04-02 owns it.

## Deviations from Plan

- In the hermetic env I set `NO_COLOR: "1"`, as doors.test.ts does, so substring assertions are not split by ANSI codes.
- The comments-row fixture uses `a.txt` lines 1-3 for all three threads, where the plan had t3 on `b.txt` with no line. The statuses are the same, so the counting rule is exercised the same way.
- The "item 7 (Doors, CLI)" case seeds a plain workspace (parent + child) without git. The doors do not depend on a work record.
- Task 2 did not change the test file because there was no flakiness.

## Gaps

None. All assertions pass against current production code.

## Self-Check: PASSED

- `packages/cli/test/review-record-verify.test.ts` exists, and its 7 cases pass.
- No commits to verify (withheld per AGENTS.md).
