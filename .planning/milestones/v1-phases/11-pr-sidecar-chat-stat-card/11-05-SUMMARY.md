---
phase: 11-pr-sidecar-chat-stat-card
plan: 05
subsystem: WORKSPC commit / open pr (web + TUI), git commit helper, surface commit operation
tags: [workspc, commit, pr, web, tui, git, docs]

requires: [11-03, 09-06, 09-11, 10-04, 10-05]
provides:
  - "packages/git/src/commands.ts: gitCommitTracked(cwd, message, runner) → GitOutcome & { nothingToCommit }"
  - "packages/surface/src/operations/commit.ts: commitWorktree(deps {cwd, transact, runner?}, id, message) → { id, sha, report }; normalizeCommitMessage; COMMIT_MESSAGE_MAX"
  - "packages/surface/src/operations/pr.ts: storeTransact(store) — SurfaceStore.transact (Result) → throwing transact dep"
  - "web: POST /api/review/:id/commit {message}, POST /api/review/:id/pr; taskview workspace.pr; WORKSPC pr row + commit (inline form) / open pr buttons"
  - "TUI: WORKSPC `pr` row, `[C] commit  [P] open pr` hint, `commit` composer mode, AppActions.commitTask / openPr"
affects: [web task view, TUI task view, docs overview/architecture]

actuals:
  tasks: 3
  commits: 0

key-files:
  created:
    - packages/surface/src/operations/commit.ts
    - packages/surface/test/commit.test.ts
  modified:
    - packages/git/src/commands.ts
    - packages/git/test/adapter.test.ts
    - packages/surface/src/operations/pr.ts
    - packages/surface/src/index.ts (one additive export line)
    - packages/web/src/review.ts
    - packages/web/src/server.ts
    - packages/web/src/app.html
    - packages/web/test/taskview.test.ts
    - packages/tui/src/app/context.ts
    - packages/tui/src/app/composer.tsx
    - packages/tui/src/app/App.tsx
    - packages/tui/src/app/task.tsx
    - packages/tui/src/app/help.tsx
    - packages/tui/test/taskview.test.tsx
    - docs/src/content/docs/overview.md
    - docs/src/content/docs/architecture.md

key-decisions:
  - "commit = `git commit --all --message=<msg>` (one argv token) in the recorded worktree; never --no-verify/--amend/--allow-empty/push. Guards run before any commit: empty message, no worktree on disk, main checkout (realpath vs mainWorktreeRoot(gitCommonDir(cwd))), branch mismatch, nothing tracked."
  - "The report restamp runs after the commit in its own short transaction; a failing stamp is swallowed (report: null) so it never hides or undoes the commit."
  - "storeTransact captures the error thrown inside the work fn and rethrows it, so MessageError text (gh/git/refusal messages) reaches web/TUI verbatim; SurfaceStore.transact alone would have flattened it."
  - "Web errors map to 400 {error: {kind: 'runtime', message}}, which the page's api()/toast already shows. No RPC verb, no VERBS change."
  - "TUI errors go through notify(`commit <id>: <message>`) untruncated instead of reportError (which cuts at 50 chars), so the refusal/gh text stays verbatim."

requirements-completed: [PR-01]

coverage:
  - id: D1
    description: "gitCommitTracked argv, ok / nothingToCommit (incl. `nothing added to commit but untracked files present`) / hook failure, leading-dash message stays one token"
    requirement: PR-01
    verification:
      - kind: unit
        ref: "packages/git/test/adapter.test.ts#gitCommitTracked (11-05, D-04)"
        status: pass
  - id: D2
    description: "commitWorktree on a real repo + linked worktree: tracked+staged committed, untracked left, sha == HEAD, report.head == sha and commits +1, no push/--amend/--no-verify argv; empty msg, missing/unrecorded worktree, branch mismatch, untracked-only (record unchanged), main checkout all refuse with no commit; storeTransact rethrows the original error"
    requirement: PR-01
    verification:
      - kind: integration
        ref: "packages/surface/test/commit.test.ts"
        status: pass
  - id: D3
    description: "web routes: workspace.pr null → commit 200 (subject, untracked ignored, dirty drops) → empty 400 → no worktree 400; pr create via fake gh → workspace.pr.number 7 → refresh, one `pr create` in the gh log; /nonexistent/gh → 400 `gh not found`; shell has data-ws-act=commit|pr, id=wsCommitMsg, no prompt("
    requirement: PR-01
    verification:
      - kind: integration
        ref: "packages/web/test/taskview.test.ts#WORKSPC actions (11-05)"
        status: pass
  - id: D4
    description: "TUI: WORKSPC shows `[C] commit  [P] open pr` and `pr —`; C empty → `commit message is empty`, no commit; C `tui: commit` → subject + `✓ committed`; P with fake gh → metadata.pr.number 7, `PR #7`, `pr       PR #7 · open`; on CHANGES C/P do nothing (no composer, no gh call)"
    requirement: PR-01
    verification:
      - kind: e2e
        ref: "packages/tui/test/taskview.test.tsx#tui WORKSPC actions (11-05)"
        status: pass
  - id: D5
    description: "docs: overview (TUI + web WORKSPC, exact commit semantics), architecture (workspace.pr, both routes, commitWorktree/gitCommitTracked/storeTransact); docs build"
    verification:
      - kind: build
        ref: "cd docs && bun run build"
        status: pass
---

# Phase 11 Plan 05: WORKSPC `commit` / `open pr` (web + TUI). Summary

**Commits withheld per AGENTS.md.** Everything is in the main tree, uncommitted. STATE.md and ROADMAP.md were not touched (orchestrator override). No real gh or remote was used: tests and probes use the 11-02 fake gh (via a wrapper) and local bare `origin` repos in temp/scratch dirs.

## What was built

### Task 1 (tracer): `gitCommitTracked` → `commitWorktree` → `storeTransact`
- `@tasks/git` `gitCommitTracked(cwd, message, runner)` runs `git commit --all --message=<msg>`. On a non-zero exit, `nothingToCommit` is set when the output matches `nothing (added )?to commit|no changes added to commit`.
- `@tasks/surface` `commitWorktree` normalises the message (C0/C1 controls except `\n`/`\t` stripped, trimmed, 4000-char cap). It reads the issue, runs the guards, commits outside the DB transaction, reads the sha with `gitBranchHead`, and restamps `metadata.report` (`reportStampFor`) in one short re-reading transaction.
- `storeTransact(store)` in pr.ts. Its export is one additive line in index.ts (`operations/commit.js`).
- The tracer verify command passed before the web/TUI work started.

### Task 2: web
- `TaskViewWorkspace.pr` = `readPrRecord(metadata)`.
- Two routes in the reviewParts block, both with `{cwd: active.root, transact: storeTransact(active.surface.store)}`:
  - `POST /api/review/:id/commit` → `{ok, sha, report}`
  - `POST /api/review/:id/pr` → `{ok, op, pr}`
- app.html WORKSPC additions:
  - A `pr` row (an `esc`'d http(s) link, `target=_blank rel="noopener noreferrer"`).
  - A `.wsact` row: a neutral `commit` button, disabled with no worktree or a clean one, and a green `open pr` button, disabled without a branch, labelled `refresh pr` once a PR is open.
  - An inline `#wsCommitMsg` form (Enter submits, Esc cancels, `commit`/`cancel` buttons). The draft survives re-renders, and so does focus.
  - The extra note line.
- Clicks, input and keys are delegated once on `#taskView`. After either action the cached taskview is dropped and reloaded. There are no browser dialogs.

### Task 3: TUI + docs
- `ComposerMode` `"commit"` (label `commit`, placeholder `commit message (tracked + staged · never pushed)`).
- `AppActions.commitTask` / `openPr` in App.tsx call `commitWorktree` / `prCreate` in-process over `storeTransact(store.surface.store)`, then toast and `refresh()`.
- task.tsx:
  - `C`/`P` fire only when `wide && tab === "workspace"`.
  - The WORKSPC panel gains `pr  PR #n · state | —` and the dim `[C] commit  [P] open pr` hint.
  - ShellKeys returns early in the task view (escape only), so `C`/`P` reach no global action.
- help.tsx gains the WORKSPC line.
- overview.md covers the TUI and web paragraphs. architecture.md covers the taskview payload `pr`, the two HTTP routes, and the no-RPC operations paragraph. Both were re-read right before editing, and the edits are exact-string inserts (11-04 edits the same file concurrently).

## Deviations
- **[Rule 1] The nothing-to-commit regex was widened.** With only untracked files, git prints `nothing added to commit but untracked files present`, which the plan's regex missed. The surface test caught it, and an adapter test case was added.
- **[Rule 1] Web Enter-to-commit opened the task modal.** The submit re-renders the panel and removes the focused input, so the document-level `Enter → openModal` handler fired. The browser probe caught it. The fix is `stopPropagation` on Enter (Esc already had it).
- **[Rule 2] TUI errors are shown untruncated.** They use `notify` instead of `reportError`, which cuts at 50 chars. The plan requires gh/git errors to be shown verbatim.
- **[Test harness] The fake gh needs a wrapper script.** The web server and the TUI run in-process, and `bunRunner`'s `Bun.spawn` does not forward later `process.env` edits. `TK_GH` (read in-process) worked, but `FAKE_GH_LOG`/`FAKE_GH_DIR` did not reach the child. The tests therefore write a wrapper that bakes those two variables in and points `TK_GH` at it.
- **[Test detail] The TUI tab count depends on the worktree.** A worktree with no changes opens on SESSIONS, not CHANGES. The P test adds an edit so that CHANGES is the default, matching the existing tests (one `tab` → WORKSPC).

## Verification (all run)
| command | result |
|---|---|
| Task 1 verify (surface build; adapter + commit + pr tests; git/surface tsc) | 51 pass, tsc OK |
| `bun test packages/git/test packages/surface/test` | 214 pass, 0 fail |
| `bun run --filter @tasks/web check` + `bun test --timeout 15000 packages/web/test` | check OK; 44 pass, 0 fail (re-run after the Enter fix) |
| `bun run --filter @tasks/tui check` + `bun test --timeout 15000 packages/tui/test` | check OK; 125 pass, 0 fail |
| `grep -n "push\|--no-verify\|--amend" commit.ts` | only the module doc sentence ("nothing is pushed"); no argv |
| `grep -n "prompt(\|confirm(\|alert(" app.html` | only the pre-existing attachment-delete `confirm(`; nothing new |
| `grep "open pr" overview.md`, `grep "api/review/:id/commit" architecture.md` | present |
| `cd docs && bun run build` | Complete |
| `bun packages/tui/test/taskview-smoke.ts` | 12 passed, 0 failed |
| `bun packages/tui/test/review-smoke.ts` | all green (9 checks) |

**Browser probe** (`AGENT_BROWSER_SESSION=gsd1105`, scratch repo + bare origin + fake-gh wrapper, `tk web` on a free port):
- WORKSPC showed `2 DIRTY` and the `commit` / `open pr` buttons.
- An empty message toasted `commit message is empty`.
- Typing and pressing Enter gave `✓ committed 27ac030 on tk-vzk`, and the subject landed. `loose.txt` stayed untracked and the panel showed `1 DIRTY`.
- `open pr` gave `✓ PR #7 open — https://github.com/acme/app/pull/7`, the `pr` link with `rel="noopener noreferrer"`, and the button became `refresh pr`. The branch was pushed to the bare origin, and the gh log shows list → create → view.
- After the Enter fix, a re-probe showed `✓ committed 56a74c7`, `modal=false`, and no page errors.
- Cleanup: the daemon bun pid was killed each time, the port was freed, and the browser was closed.

**tmux probe** (own `/tmp/gsd1105.*` socket):
- `5` → Tab showed WORKSPC with `pr  PR #7 · open` and `[C] commit  [P] open pr`.
- `C` opened `commit tk-vzk`. Typing and pressing Enter gave `✓ committed 5257f27`, and the subject landed.
- `P` gave `✓ PR #7 open — …` (a refresh, so there was no second `pr create`).
- The server was killed and the socket removed.

## Threat model
- **T-11-19:** argv only, one `--message=` token (tested with `--amend --no-verify` as the message), controls stripped, length capped.
- **T-11-20:** worktree-only commit, with the main checkout, missing worktree and branch mismatch each refused and tested.
- **T-11-21:** recorded argv asserts that commit never pushes.
- **T-11-22:** accepted, as planned.
- **T-11-23:** `readPrRecord` http(s) only, plus `esc` and `noopener`.

## Follow-ups (not filed; orchestrator decides)
- The web `commit` button is enabled when the only dirty entries are untracked, because `dirty` counts them. Clicking it then gets the clear `nothing to commit … git add them first` refusal. A tracked-only dirty count would let the button disable itself.
