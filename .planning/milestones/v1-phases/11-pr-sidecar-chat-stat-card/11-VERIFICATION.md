---
phase: 11-pr-sidecar-chat-stat-card
verified: 2026-11-12T17:23:16Z
status: passed
score: 3/3 must-haves verified
covered_files:
  - ".planning/phases/11-pr-sidecar-chat-stat-card/11-01-PLAN.md"
  - ".planning/phases/11-pr-sidecar-chat-stat-card/11-01-SUMMARY.md"
  - ".planning/phases/11-pr-sidecar-chat-stat-card/11-02-PLAN.md"
  - ".planning/phases/11-pr-sidecar-chat-stat-card/11-02-SUMMARY.md"
  - ".planning/phases/11-pr-sidecar-chat-stat-card/11-03-PLAN.md"
  - ".planning/phases/11-pr-sidecar-chat-stat-card/11-03-SUMMARY.md"
  - ".planning/phases/11-pr-sidecar-chat-stat-card/11-04-PLAN.md"
  - ".planning/phases/11-pr-sidecar-chat-stat-card/11-04-SUMMARY.md"
  - ".planning/phases/11-pr-sidecar-chat-stat-card/11-05-PLAN.md"
  - ".planning/phases/11-pr-sidecar-chat-stat-card/11-05-SUMMARY.md"
  - "docs/src/content/docs/architecture.md"
  - "docs/src/content/docs/integrations.md"
  - "docs/src/content/docs/overview.md"
  - "docs/src/content/docs/rpc.md"
  - "docs/src/content/docs/testing.md"
  - "packages/cli/src/presentation.ts"
  - "packages/cli/src/tk.ts"
  - "packages/cli/test/changes.test.ts"
  - "packages/cli/test/finish.test.ts"
  - "packages/cli/test/fixtures/gh"
  - "packages/cli/test/pr.test.ts"
  - "packages/domain/src/changes-card.ts"
  - "packages/domain/src/index.ts"
  - "packages/domain/src/pr-record.ts"
  - "packages/domain/test/changes-card.test.ts"
  - "packages/domain/test/pr-record.test.ts"
  - "packages/git/src/commands.ts"
  - "packages/git/test/adapter.test.ts"
  - "packages/lua/luau/tk/events.luau"
  - "packages/lua/luau/tk/wire.luau"
  - "packages/pi-extention/src/inbox.ts"
  - "packages/pi-extention/src/index.ts"
  - "packages/pi-extention/src/watch-manager.ts"
  - "packages/pi-extention/test/entry.test.ts"
  - "packages/pi-extention/test/inbox.test.ts"
  - "packages/rpc/src/protocol.ts"
  - "packages/surface/src/events/derive.ts"
  - "packages/surface/src/events/query.ts"
  - "packages/surface/src/gh.ts"
  - "packages/surface/src/index.ts"
  - "packages/surface/src/operations/changes.ts"
  - "packages/surface/src/operations/commit.ts"
  - "packages/surface/src/operations/finish.ts"
  - "packages/surface/src/operations/pr.ts"
  - "packages/surface/src/surface.ts"
  - "packages/surface/test/changes.test.ts"
  - "packages/surface/test/commit.test.ts"
  - "packages/surface/test/events-derive.test.ts"
  - "packages/surface/test/pr.test.ts"
  - "packages/tui/src/app/App.tsx"
  - "packages/tui/src/app/composer.tsx"
  - "packages/tui/src/app/context.ts"
  - "packages/tui/src/app/help.tsx"
  - "packages/tui/src/app/task.tsx"
  - "packages/tui/test/taskview.test.tsx"
  - "packages/web/src/app.html"
  - "packages/web/src/review.ts"
  - "packages/web/src/server.ts"
  - "packages/web/test/taskview.test.ts"
covered_digest: "v3:sha256:3d73427c9cb9db972bcca62a8e4e2aa61811e45d10272904ea763e2ba8a2e530"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Real GitHub run. In a throwaway GitHub repo you own, with `gh auth login` done and TK_GH unset: tk work <id>, commit, tk finish, then `tk pr create <id>` twice, `tk pr sync <id>`, `tk pr merge <id>` (and on a second task `tk pr close <id>`). Then open a PR for a third task's branch by hand with `gh pr create` and run `tk pr create` on that task."
    expected: "One PR is opened; the second create says `(already open)` and makes no second PR. metadata.pr = {number, url, state:'open'} matches GitHub. sync reflects the real state. merge merges with a merge commit, does not delete the remote branch and does not touch the local worktree; the record shows `merged`. close leaves the branch in place; the record shows `closed`. The hand-made PR is adopted (op `adopt`), not duplicated. No command needs `--admin`."
    why_human: "Every automated run used the fixture fake gh (packages/cli/test/fixtures/gh). Only real gh can confirm that `gh pr create` prints the URL as its last stdout line, that `gh pr view --json number,url,state` uses OPEN/MERGED/CLOSED, that `gh pr list --head <branch>` finds a same-repo head, and how `gh pr merge` behaves when run from the repo root while the branch is checked out in a linked worktree."
  - test: "Live pi/omp session with the built extension: start `tasks_watch_start` on a task, then from another terminal run `tk finish`, `tk pr create`, `tk pr merge` and an approval."
    expected: "The chat gets a `📊 tasks: Changes · <id> N commits · +A −D · F files → …/tasks/<id>/diff · tk review <id>` card and a `🔀 tasks: PR #n for <id> — <state> (<url>)` card, with no patch text. The inbox PR-merged and approval followUps end with the stat card line."
    why_human: "The pi host (@earendil-works/pi-coding-agent) is not installed here. entry.test.ts and inbox.test.ts drive formatEvent and createInbox with stubs, not a real model turn."
---

# Phase 11: PR Sidecar & Chat Stat Card Verification Report

**Phase Goal:** A task has at most one PR, managed as a verb not a poller, and chat never carries a raw diff
**Mode:** mvp. The goal is an outcome, not a User Story, so (as in Phase 10) it was verified goal-backward against the 3 roadmap success criteria, with the user flow run end to end in a scratch workspace.
**Verified:** 2026-11-12T17:23:16Z
**Status:** human_needed
**Re-verification:** No (initial verification)

## User Flow Coverage

This ran in a scratch workspace: `scratchpad/e2e11.sh`, log in `scratchpad/e2e11.log`. The setup was:
- The fixture fake gh was copied to `$S/bin/gh` and put first on PATH (`which gh` → scratch path).
- `GH_TOKEN`, `GITHUB_TOKEN` and `TK_GH` were blank.
- `origin` was a local bare repo.
- No real gh and no real remote were touched.

| # | Step | Expected | Evidence | Status |
|---|------|----------|----------|--------|
| 1 | `tk work` → commit → `tk finish --session s1` | Stat card, no diff | `✓ Finished vf-8wo` / `Changes · vf-8wo  1 commit · +4 −0 · 2 files  → http://localhost:21579/tasks/vf-8wo/diff · tk review vf-8wo` / `next: tk pr create vf-8wo`; a grep for `^diff --git`, `^@@` or committed `+one`/`+two` lines found 0; `metadata.report = {changes:{commits:1,files:2,additions:4,deletions:0}, head, at}` | ✓ |
| 2 | `tk changes <id>` | Same card; JSON `changes` object | Human output identical to the finish card; `{"source":"live","stale":false,"stat":{…},"links":{"tui":"tk review vf-8wo","web":"…/tasks/vf-8wo/diff"}}` | ✓ |
| 3 | `tk pr <id>` before create | Local mirror, zero gh | `no PR — run tk pr create vf-8wo`; the gh log is empty at that point | ✓ |
| 4 | `tk pr create` (once) | Push + open + record | `✓ PR #7 open for vf-8wo — https://github.com/acme/app/pull/7`; `tk/vf-8wo` is on the bare origin; gh log: `pr list --head tk/vf-8wo --state open …`, `pr create --head tk/vf-8wo --base main --title=Verify PR flow --body=tk: vf-8wo … Changes · vf-8wo 1 commit …`, `pr view <url>` | ✓ |
| 5 | Re-run `tk pr create` (twice) | Adopts/refreshes, no second PR | `… (already open)`, JSON `op:"refresh"`; `pr create count: 1` in the gh log | ✓ |
| 5b | Adopt path (3rd task, `existing` PR on fake GitHub) | No create | JSON `op:"adopt"`; gh log has only `pr list …` | ✓ |
| 6 | `tk pr sync` | Exactly one gh call | `op:"sync"`, a single `pr view 7 --json number,url,state` | ✓ |
| 7 | `tk pr merge` | `--merge`, no `--admin` or `--delete-branch`; task not closed | `✓ PR #7 merged for vf-8wo — next: tk close vf-8wo`; gh log `pr view 7`, `pr merge 7 --merge`, `pr view 7`; admin/delete-branch count 0; task status stays `ready-to-review`; worktree present. A second merge is a no-op (only `pr view`). | ✓ |
| 8 | events.jsonl | `task.pr` + `task.report` lines | `task.report` (finish) → `task.pr {op:create, number:7, url, state:open, head:tk/vf-8wo}` → `task.report`s → `task.pr {op:state, state:merged}`; no `task.update` lists `metadata.pr`/`metadata.report` (count 0); `tk watch --drain --from 0` shows `task.pr #7 create open`, `task.report 1 commits +4 −0 2 files`, `task.pr #7 state merged` | ✓ |
| 9 | Worktree pruned | `tk close` prunes | After merging the branch into local main (standing in for the GitHub merge being pulled) + approve + close: `✓ Closed vf-8wo … — worktree pruned`; the directory is gone and no `tk/vf-8wo` local branch is left | ✓ |
| 10 | `tk changes` after prune | Frozen snapshot / report | `{"source":"snapshot","stale":false,…,"stat":{"commits":1,"files":2,"additions":4,"deletions":0}}` + `PR #7 · merged · …` | ✓ |
| 10b | Report rung (2nd task finished, then worktree removed + `git branch -D`, task not closed) | Stale report card, no invented diff | `tk changes`: `… 1 commit · +1 −0 · 1 file … · stale — from finish report 2026-11-12T16:46:02.564Z`, JSON `source:"report", stale:true`; `tk show` shows a `CHANGES` section with the same stale card | ✓ |
| 11 | gh failures | Clear message, nothing written | `TK_GH=/nonexistent/gh` → `✗ gh not found — install GitHub CLI (https://cli.github.com) or set TK_GH`; `FAKE_GH_FAIL=1` → `✗ gh pr view failed: gh: authentication required` | ✓ |
| 12 | `tk pr close`, then `tk pr create` | Branch kept; 1-to-1 refusal | `✓ PR #7 closed for vf-jqs (branch kept)`; then `✗ vf-jqs already has PR #7 (closed) — one PR per task; run tk pr sync vf-jqs` | ✓ |
| 13 | Web WORKSPC `commit` / `open pr` | Spec §2 VIEW 1 rail buttons work | `bun packages/web/src/main.ts <scratch repo> --port 57910` (free port), `AGENT_BROWSER_SESSION=verify11`. WORKSPC shows `state 2 DIRTY` and the `commit` and `open pr` buttons. The `commit` button opens an inline textbox (no `prompt()`); an empty submit shows the toast `commit message is empty`; typing and pressing Enter shows `✓ committed 6cdd3ef on vf-eqw`, with no modal opened. The worktree log has `6cdd3ef web: verifier commit`, `loose.txt` is still untracked, and the panel shows `1 DIRTY`. The branch was not pushed by commit, and `task.report` was restamped with head 6cdd3ef. `open pr` → `✓ PR #7 open — https://github.com/acme/app/pull/7`, a `pr  PR #7 · open` row (`<a … target="_blank" rel="noopener noreferrer">`), and the button becomes `refresh pr`. Only then is `tk/vf-eqw` on origin; gh log list → create → view; `task.pr op:create` appended. Cleanup: server bun pid 16676 killed, the port is free, and the browser is closed. | ✓ |

## Goal Achievement

### Observable Truths

| # | Truth (roadmap SC) | Status | Evidence |
|---|-------|--------|----------|
| 1 | One PR per task: a 1-to-1 relation on the record with `tk pr create`, `tk pr sync`, `tk pr close` (and merge) through `gh`. gh is the remote truth and sync is explicit. | ✓ VERIFIED | `packages/surface/src/operations/pr.ts` (prCreate refresh/adopt/create, closed/merged refusal; prSync = one `gh pr view`; prTransition close/merge with a precheck view) and `packages/surface/src/gh.ts` (argv-only, closed merge-method enum, no `--admin`/`--delete-branch`, no timers). No `setInterval`/`setTimeout` in gh.ts, pr.ts or commit.ts. gh callers are tk.ts, the web server and the TUI context/App only, all from explicit user actions. E2E steps 3–7, 5b, 11, 12 and 13 above; `packages/cli/test/pr.test.ts`, `packages/surface/test/pr.test.ts` and web/TUI `P`/`open pr` tests all pass. |
| 2 | Chat/agent output carries a stat card (commits · +− · files) that links to the task's changes view; a diff is never printed into chat. | ✓ VERIFIED | `packages/domain/src/changes-card.ts` `statCardLine`. The finish card, PR body and `tk changes` card were observed in the e2e, with 0 diff markers. The pi `formatEvent` `task.report`/`task.pr` cases (watch-manager.ts:294) are tested by `entry.test.ts` "task.pr renders the PR card; task.report renders the stat card from event data alone (never a diff)". The inbox card is tested by `inbox.test.ts` (PR merged → PR line + next + stale report card; an approval ends with the card; a throwing card leaves the message unchanged). `task.report`/`task.pr` reach events.jsonl (e2e step 8). |
| 3 | When the worktree is out of reach, changes fall back to task.commit / task.report stats as the cache. | ✓ VERIFIED | `resolveChanges` ladder in `packages/surface/src/operations/changes.ts`: closed+snapshot → live → report (stale) → snapshot (stale) → null. The finish stamp is `metadata.report` (finish.ts via `reportStampFor`), and it never writes `changeset.head`. E2E steps 10 and 10b (snapshot after prune; stale report after branch deletion, in both `tk changes` and `tk show`). Also `packages/cli/test/changes.test.ts` and `packages/surface/test/changes.test.ts`. |

**Score:** 3/3 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/domain/src/changes-card.ts` | Card types + `statCardLine` | ✓ VERIFIED | 89 lines; imported by surface, cli and pi-extention |
| `packages/domain/src/pr-record.ts` | `PrRecord`, `readPrRecord`, `prLine` | ✓ VERIFIED | Used by derive.ts, pr.ts, presentation, web |
| `packages/surface/src/gh.ts` | Single gh chokepoint | ✓ VERIFIED | view/list/create/close/merge; 127 → not-found message |
| `packages/surface/src/operations/pr.ts` | create/sync/show/close/merge + `storeTransact` | ✓ VERIFIED | Wired in tk.ts, web server.ts, TUI context.ts/App.tsx |
| `packages/surface/src/operations/changes.ts` | `resolveChanges`, `reportStampFor`, `changesOf` | ✓ VERIFIED | Used by finish, `tk changes`/`tk show`, pr body, `TasksSurface.changes`, pi inbox card |
| `packages/surface/src/operations/commit.ts` | Guarded `commitWorktree` | ✓ VERIFIED | Web route + TUI `C`; e2e step 13 |
| `packages/git/src/commands.ts` | `gitPushBranch`, `gitCommitTracked` | ✓ VERIFIED | Adapter tests pass; push observed on the bare origin |
| `packages/surface/src/events/derive.ts` | `prEvents` / `reportEvents`; pr/report covered | ✓ VERIFIED | e2e step 8 |
| `packages/pi-extention/src/{watch-manager,inbox,index}.ts` | Stat/PR cards, `changes` op | ✓ VERIFIED (unit) | Live host rendering is human item 2 |
| `packages/web/src/app.html`, `server.ts`, `review.ts` | WORKSPC commit/open pr, `POST /api/review/:id/commit\|pr` | ✓ VERIFIED | Browser probe step 13 |
| `packages/tui/src/app/task.tsx` (+ App/context/composer/help) | `C commit` / `P open pr`, pr row | ✓ VERIFIED | taskview.test.tsx "C commits tracked changes…" / "P opens the PR through the fake gh…" pass |
| `packages/cli/test/fixtures/gh` | Fake gh | ✓ VERIFIED | Used for every gh call in this verification |
| `VERBS_VERSION` 6 | TS + Luau | ✓ VERIFIED | `packages/rpc/src/protocol.ts:23`, `packages/lua/luau/tk/wire.luau:18` |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| finishIssueUow | reportStampFor → deriveChangeset | Same save | ✓ WIRED (metadata.report observed after finish) |
| tk.ts finish/changes/show | resolveChanges → statCardLine | formatFinish/formatChanges/formatShow | ✓ WIRED |
| tk.ts `pr` | prCreate/prSync/prShow/prClose/prMerge | transact over the DB | ✓ WIRED |
| prCreate | gitPushBranch, then gh.ts | Push first | ✓ WIRED (branch on origin before the PR; the failed-push test aborts before gh) |
| formatFinish | readPrRecord + statCardLine | PR line / `next: tk pr create` | ✓ WIRED (observed `next: tk pr create vf-8wo`) |
| withEventLog | deriveIssueEvents → prEvents/reportEvents | Committed save | ✓ WIRED |
| pi inbox | TasksSurface.changes → statCardLine | `card` option (index.ts:144) | ✓ WIRED |
| Web WORKSPC buttons | POST /api/review/:id/commit\|pr → commitWorktree\|prCreate | storeTransact | ✓ WIRED (browser) |
| TUI `C`/`P` | commitWorktree / prCreate | actions in context.ts | ✓ WIRED (taskview.test.tsx) |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| Stat card (CLI/pi/PR body) | ChangesView.stat | `deriveChangeset` (git) → report → snapshot | Yes (counts match the commit: +4 −0, 2 files) | ✓ FLOWING |
| WORKSPC `pr` row | taskview `workspace.pr` | `readPrRecord(metadata)` written by prCreate | Yes | ✓ FLOWING |
| `task.report` / `task.pr` events | data | before/after metadata of the committed save | Yes | ✓ FLOWING |

### Behavioral Spot-Checks / Suite Runs

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full workspace suites (run once) | `bun test --timeout 30000 packages/git packages/domain packages/surface/test packages/cli/test packages/web/test packages/tui/test packages/pi-extention/test` | 670 pass, 0 fail, 67 files | ✓ PASS |
| Typechecks | `bun run check` in git, domain, surface, cli, web, tui | All exit 0 | ✓ PASS |
| Luau | `lune run luau/tk/tests/run_all.luau` | `tk lua: all suites passed` | ✓ PASS |
| Docs | `cd docs && bun run build` | `Complete!` | ✓ PASS |
| E2E CLI loop | `scratchpad/e2e11.sh` | See User Flow Coverage | ✓ PASS |
| Web WORKSPC | agent-browser `verify11` | See step 13 | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| TUI review smoke | `bun packages/tui/test/review-smoke.ts` | all green (9 checks) | PASS |
| TUI taskview smoke | `bun packages/tui/test/taskview-smoke.ts` (4 runs) | 12/12 twice; 11/12 twice, both times failing check 12 `TASKS column … a ]] burst moves two rows` | PASS (flaky; pre-existing Phase 9 flake noted in 09-VERIFICATION advisory; not a Phase 11 surface) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PR-01 | 11-02, 11-03, 11-04, 11-05 | One PR per task with create / sync / close (merge) via gh; sync is a verb, never a poller (R28, R65) | ✓ SATISFIED (fake gh); real gh = human item 1 | Truth 1 |
| PR-02 | 11-01, 11-03, 11-04 | Chat carries a stat card linking to the changes view, never a raw diff (R60) | ✓ SATISFIED; live pi host = human item 2 | Truth 2 |
| PR-03 | 11-01, 11-04 | Changes fall back to task.commit / task.report stats when the worktree is out of reach (R61) | ✓ SATISFIED | Truth 3 |

No orphaned requirements: REQUIREMENTS.md maps only PR-01..03 to Phase 11, and every one is claimed by a plan.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/surface/src/events/derive.ts` | 131-137 | `reportEvents` compares the whole stamp, including `at`, so every restamp with the same counts emits a fresh `task.report`. The e2e saw 5 `task.report` lines for one unchanged stat (finish, create, two re-run creates, sync). | ⚠️ Warning | A pi `tasks_watch_start` session would post a repeated 📊 card on each `tk pr create`/`sync`. This is not a diff and not a goal failure, but it is chat noise against R60's "one card" intent. Fix: compare `{changes, head}` only. |
| `packages/web/src/app.html` (WORKSPC) | — | `commit` stays enabled when every dirty entry is untracked | ℹ️ Info | Clicking it returns the clear refusal (flagged in 11-05 SUMMARY follow-ups) |
| Stat card / PR body links | — | Web link uses the config/default base (`localhost:21579`) even when the web UI is served on another port | ℹ️ Info | Link may point at the wrong port for non-default setups |
| `metadata.pr` shape | — | Spec §13 record lists `{number, url, state, head, base, openedAt}`; implementation stores `{number, url, state}` (`task.pr` data adds `head`) | ℹ️ Info | Matches the locked CONTEXT decision D-01; a deliberate narrowing |
| Web WORKSPC branch row | — | Shows `tk/<id> → <base sha7>`, where the spec mock shows `→ main` | ℹ️ Info | Cosmetic |

No `TBD`/`FIXME`/`XXX` debt markers or placeholder text in the phase's files.

### Human Verification Required

### 1. Real GitHub `gh` run
**Test:** In a throwaway GitHub repo you own (with `gh auth login`, TK_GH unset), run tk work → commit → tk finish → `tk pr create` ×2 → `tk pr sync` → `tk pr merge`. On a second task run `tk pr close`. On a third task open a PR by hand with `gh pr create`, then run `tk pr create`.
**Expected:** One PR, refreshed on the re-run (`(already open)`). The record matches GitHub's state. The merge is a merge commit; the remote branch is kept and the local worktree is untouched. close keeps the branch. The hand-made PR is adopted, not duplicated.
**Why human:** Everything automated used the fixture fake gh. Real gh output formats (the create URL on stdout, OPEN/MERGED/CLOSED, `--head` lookup) and `gh pr merge` behaviour from the repo root while the branch is checked out in a linked worktree have not been exercised.

### 2. Live pi/omp chat cards
**Test:** Run a live pi/omp session with the extension and `tasks_watch_start` on a task. From another terminal run `tk finish`, `tk pr create`, `tk pr merge` and approve.
**Expected:** 📊 stat card and 🔀 PR card lines with no patch text. The inbox merge/approval followUps end with the stat card.
**Why human:** No pi host is installed here, so the tests stub notify/followUp.

### Gaps Summary

No blocking gaps. All three roadmap success criteria hold in the code and were exercised end to end with the fake gh and a local bare origin:
- One PR per task, created once and adopted on re-run, with sync/close/merge as explicit verbs, no poller, and no `--admin`/`--delete-branch`.
- A stat card with no diff on finish, `tk changes`, the PR body and the event wire.
- The snapshot/report fallback once the worktree or branch is gone.

The web WORKSPC `commit` / `open pr` buttons work in a real browser. Status is `human_needed` only for the real-GitHub gh run and the live pi host check. There is one Warning: duplicate `task.report` events on stat-neutral restamps. It is worth a follow-up but does not block the goal.

---

_Verified: 2026-11-12T17:23:16Z_
_Verifier: Claude (gsd-verifier)_


## Human Verification Result (2026-11-12)

Passed on automated evidence per the user's standing choice (phase 10: "Pass + track live check"); live-harness / real-GitHub checks are tracked as tk UAT tasks.


Fingerprint regenerated 2026-11-12 after applying the verifier's own Warning fix (derive.ts reportEvents compares counts+head only; events-derive.test.ts updated; architecture.md line updated); targeted suites 185/185 pass.
