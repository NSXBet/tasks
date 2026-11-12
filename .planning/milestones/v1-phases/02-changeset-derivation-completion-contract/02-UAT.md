---
status: complete
phase: 02-changeset-derivation-completion-contract
source: [02-01-SUMMARY.md, 02-02-SUMMARY.md]
started: 2026-10-19T00:27:18Z
updated: 2026-10-19T03:14:09Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 3
name: Counts re-derive live
expected: |
  Add a commit to the task's branch, then re-run `tk show <id>`. The COMMITS/FILES rows and counts reflect the branch's current state — no re-run of `tk work`, nothing cached.
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server/service. Clear ephemeral state (temp DBs, caches, lock files). Start the application from scratch. Server boots without errors, any seed/migration completes, and a primary query (health check, homepage load, or basic API call) returns live data.
result: pass

### 2. Live changeset in tk show
expected: Run `tk show <id>` on a task pinned by `tk work` (branch + changeset base). Output shows COMMITS (n) with sha + subject lines and FILES (n) with a status-colored code + path per file; counts appear in section headers.
result: pass

### 3. Counts re-derive live
expected: Add a commit to the task's branch, then re-run `tk show <id>`. The COMMITS/FILES rows and counts reflect the branch's current state — no re-run of `tk work`, nothing cached.
result: pass
note: Ran by assistant on tasks-etqk (freshly pinned via tk work) — before COMMITS (34), probe commit 430b01e on tk/tasks-etqk, after COMMITS (35) with 430b01e at top; PROBE.md appears in FILES. Re-derived from git alone. Surface defect logged as Issue 2 (base pin anchored to stale origin/HEAD, not local default tip).

### 4. Deleted-branch decay
expected: Delete the task's branch, then run `tk show <id>`. Command exits 0; COMMITS and FILES sections are omitted (derivation decays to null) and the record itself is unaffected.
result: pass
note: Ran by assistant (user-approved deletion). Worktree removed, `git branch -D tk/tasks-etqk` (was 0347eeb) → `tk show tasks-etqk` exit 0, zero COMMITS/FILES headers, empty stderr, record renders normally.

### 5. Rename and binary files in FILES
expected: With a rename and a binary change on the branch, `tk show <id>` FILES rows show the rename code (e.g. R100) with the destination path, and binary files contribute 0 additions/deletions to the counts.
result: pass
note: Ran by assistant. Raw git: `R096\ttsconfig.json\ttsconfig-renamed.json` (source exists at base; endpoint-diff-added files correctly show A — first probe confirmed). Render: `R tsconfig-renamed.json` — bare magenta R (score collapsed by the IN-1 renderer, presentation.ts:231) with destination path; binary logo.bin renders as `A logo.bin`, raw numstat `-\t-\tlogo.bin` → parseNumstat maps to 0/0 so counts unaffected.

### 6. Confirm auto-covered deliverables (02-02)
expected: Confirmation summary of 02-02's five deliverables (D1-D5), each auto-covered by passing unit/integration tests — user confirms the automated results stand in for manual testing.
result: pass
note: Confirmed by user during sleep-mode handoff (2026-10-19T03:14Z). D1 finish→ready-to-review + finish.test.ts; D2 refuse w/o record/session; D3 idempotent re-finish (D-11); D4 freeze exactly once (changeset-freeze.test.ts); D5 closed show renders frozen snapshot, no git calls, finish never freezes. All five: integration tests, pass.

### 7. tk finish moves the task into ready-to-review
expected: `tk finish <id> --session <sid>` moves the task into ready-to-review, records agent_session + finished_at, and prints live-derived counts
result: pass
source: automated
coverage_id: D1

### 8. finish refuses without work record or --session
expected: finish refuses without a work record (branch + pinned base) and without --session (D-10)
result: pass
source: automated
coverage_id: D2

### 9. Repeat finish idempotent
expected: Repeat finish is idempotent on status; session/finished_at re-recorded (D-11)
result: pass
source: automated
coverage_id: D3

### 10. Close freezes changeset exactly once
expected: Close freezes the changeset tuple exactly once; later closes never re-freeze; non-closed transitions refuse to freeze
result: pass
source: automated
coverage_id: D4

### 11. Closed tk show renders frozen snapshot
expected: Closed `tk show` renders the frozen snapshot with no git calls (survives branch deletion); finish never freezes
result: pass
source: automated
coverage_id: D5

## Summary

total: 11
passed: 11
issues: 0
pending: 0
skipped: 0

## Issues

### Issue 1: `tk work` default worktree placement is sibling, not `.worktrees/`
resolution: fixed — `18c1151` resolver default flipped to the in-repo `.worktrees` pool (per-task override and `worktree.dir` config precedence unchanged); tests updated (resolver, concurrency, work).
test: 3 (setup)
description: User reports the worktree should have been created under `.worktrees/` — that is the expected default. Actual: `resolveWorktreePath` defaults to sibling placement (`<repo>-<id>` beside the repo; observed `tasks-tasks-j4e`, prunable), pinned by `packages/git/test/resolver.test.ts` ("defaults to sibling placement"). `.worktrees/` placement is reachable only via `.tasks/config.json` `worktree.dir` or per-task `worktree_dir` metadata override. Product decision needed: change the code default to `.worktrees/{name}` (phase 1 scope, touches resolver + tests) or configure workspace placement.
reported: 2026-10-19

### Issue 2: Base pin anchors to stale origin/HEAD — changeset spans the entire local line
resolution: fixed — `366e015` `gitDefaultBranch` anchors to the local default line when origin/HEAD is stale (reweld-aware: local ahead of origin → local wins); pinned by a real-git adapter test. — FIXED 2026-10-19
`tk work tasks-etqk` pinned BASE = 97ab249d ("test(tui): add tests for image size") instead of main's tip 879d0ad, so the derived changeset covers all 34+ commits since the repo root — including other tasks' and planning commits.
Root cause chain (code-verified): `gitDefaultBranch` (packages/git/src/commands.ts:26) prefers `origin/HEAD` over local main/master when configured; origin/main here is stale at 97ab249d (local main was welded/rewritten to 879d0ad and not pushed); `tk work` (packages/cli/src/tk.ts:~660) pins base = `gitMergeBase(branch, defaultBranch)` = the stale remote tip. `git rev-parse origin/HEAD origin/main` → 97ab249d; `main` → 879d0ad.
Fix: `gitDefaultBranch` now prefers the LOCAL default tip when it is strictly ahead of origin/HEAD (remote is ancestor of local but not vice versa); in-sync, diverged, and remote-ahead cases keep origin/HEAD. Regression test: "git integration > anchors the default branch to the local line when origin/HEAD is stale" (packages/git/test/adapter.test.ts) covers in-sync → origin/main and local-ahead → main. Verified: git 25/25, cli+surface 168/168.

## Gaps

[none yet]
