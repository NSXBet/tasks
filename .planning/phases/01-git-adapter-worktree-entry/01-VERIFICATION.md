---
phase: 01-git-adapter-worktree-entry
verified: 2026-10-18T15:58:53Z
status: passed
score: 5/5 must-haves verified
covered_files: [
  ".planning/phases/01-git-adapter-worktree-entry/01-01-PLAN.md",
  ".planning/phases/01-git-adapter-worktree-entry/01-02-PLAN.md",
  ".planning/phases/01-git-adapter-worktree-entry/01-01-SUMMARY.md",
  ".planning/phases/01-git-adapter-worktree-entry/01-02-SUMMARY.md",
  "packages/git/src/runner.ts",
  "packages/git/src/commands.ts",
  "packages/git/src/porcelain.ts",
  "packages/git/src/resolver.ts",
  "packages/git/src/index.ts",
  "packages/git/package.json",
  "packages/git/tsconfig.json",
  "packages/git/test/adapter.test.ts",
  "packages/git/test/resolver.test.ts",
  "packages/git/test/concurrency.test.ts",
  "packages/git/test/porcelain.test.ts",
  "packages/cli/src/tk.ts",
  "packages/cli/src/presentation.ts",
  "packages/cli/src/hooks.ts",
  "packages/cli/package.json",
  "packages/cli/tsconfig.json",
  "packages/cli/test/tk.test.ts",
  "packages/cli/test/work.test.ts",
  "packages/workspace/src/config.ts",
  "packages/workspace/test/workspace.test.ts"
]
covered_digest: "v2:sha256:692acac35d383f8fc6aaabaed5c33485e0570080c156d8c105036a3ebc715263"
behavior_unverified: 0
overrides_applied: 0
---

# Phase 1: Git Adapter & Worktree Entry — Verification Report

**Phase Goal:** The PR container exists — every task can get a worktree on its own branch, and all git access flows through one typed adapter.
**Verified:** 2026-10-18T15:58:53Z
**Status:** passed
**Re-verification:** No — initial verification
**Mode note:** Phase goal is not a User Story (no `As a …, I want to …, so that …` shape), so MVP-mode narrowing does not apply; standard goal-backward verification was run against the three ROADMAP success criteria plus both PLAN must-have sets.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `tk work <id>` creates/enters the worktree on branch `tk/<id>` at the resolver-chosen path and records pinned base SHA, path, and branch on the task record; `tk show` renders WORKTREE/branch (Roadmap SC1, GIT-03) | ✓ VERIFIED | `packages/cli/src/tk.ts:598-645` (`work()`): `gitWorktreeAdd` with `createBranch`, base = `gitMergeBase` output, `uow.save(changed(current, { branch: usedBranch, metadata: { …, worktree: path, changeset } }))` at tk.ts:645; `presentation.ts:97-98` renders branch/worktree. Empirical probe (scratch repo): `tk work tk-le4` → `{"path":"…/repo-tk-le4","branch":"tk/tk-le4","base":"5069c848…"}`, `git worktree list` shows the registered worktree at the same commit, HEAD = `tk/tk-le4`, `tk show` prints `BRANCH/BASE/WORKTREE`. E2E tests: `packages/cli/test/work.test.ts` (6 scenarios through the real binary) |
| 2 | One resolver end-to-end — default sibling, `worktree.dir` config, per-task metadata override — shared by `tk work` and `tk worktree create`; inline path logic deleted (Roadmap SC2, GIT-02) | ✓ VERIFIED | Both call sites use `resolveWorktreePath` from `@tasks/git`: `tk.ts:207` (worktree create, reads `config.worktree?.dir`) and `tk.ts:609` (work, override > config > default). Resolver precedence + determinism tested in `packages/git/test/resolver.test.ts`; config consumer in `packages/cli/test/tk.test.ts:745`; per-task override in `work.test.ts:53`; schema key `worktree.dir` defined in `packages/workspace/src/config.ts:62`. No inline path construction remains in `runWorktree`/`work` — placement is resolver-only |
| 3 | Recorded evidence is git-derived only; no changeset caching beyond the pinned base (Roadmap SC3 / prohibition) | ✓ VERIFIED | Base recorded at tk.ts:630-645 comes from `gitMergeBase` (a real git query, not caller input); `metadata["changeset"]` carries only `base` (01-02 code + SUMMARY); `work.test.ts` asserts no fabricated base is pinned when the worktree pre-exists |
| 4 | `packages/git` exists as `@tasks/git` — one abortable runner, enumerated commands, porcelain parsing; `packages/cli/src/git.ts` deleted, all importers migrated (GIT-01) | ✓ VERIFIED | `runner.ts` (Bun.spawn, abort-signal kill, `code: -1` on null exit), `commands.ts` (14 enumerated commands, each wrapping exactly one git invocation), `porcelain.ts` (`parseWorktreePorcelain`), `resolver.ts`, `index.ts` re-exporting all. `packages/cli/src/git.ts` is absent (`ls` fails) and grep finds **0** remaining `./git.js` imports in packages/cli; hooks.ts import migrated to `@tasks/git` (commit 670a05c diff) |
| 5 | Failures are surfaced, not swallowed (plan prohibition) | ✓ VERIFIED | Query commands return `null` on non-zero exit and callers coalesce via `fail()` (`tk.ts:180-181`, `tk.ts:610-612`); mutating commands return `GitOutcome{ok, stderr}` which is unwrapped into errors. Probe evidence: in a repo with no initial commit, `tk work` exits 1 with git's message `fatal: not a valid object name: 'main'` — error propagated, not masked |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

All behavior-dependent truths (state transitions: worktree creation, branch creation, re-entry pin preservation) were exercised with real behavioral evidence: the E2E test suite through the actual CLI binary plus an independent scratch-repo probe. No truth rests on symbol presence alone.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/git/src/runner.ts` | One abortable process runner | ✓ VERIFIED | `bunRunner` with abort-signal kill; injected `ProcessRunner` for testability |
| `packages/git/src/commands.ts` | Every git command enumerated | ✓ VERIFIED | 14 commands incl. `gitCommonDir`, `gitWorktreeAdd(createBranch)`, `gitMergeBase`; `mainWorktreeRoot` derived from common dir |
| `packages/git/src/porcelain.ts` | `git worktree list --porcelain` parsing | ✓ VERIFIED | `parseWorktreePorcelain` → `WorktreeEntry{path,branch,bare,locked}` |
| `packages/git/src/resolver.ts` | One placement resolver | ✓ VERIFIED | Pure/sync, override > config > default sibling, `{name}` expansion |
| `packages/git/test/*` | Tests for parsing, precedence, abort | ✓ VERIFIED | 4 files; included in the 119-test pass |
| `packages/cli/src/tk.ts` | `work` command + worktree wiring via adapter | ✓ VERIFIED | `work()` at 598-645; `runWorktree` dispatcher uses adapter+resolver |
| `packages/cli/src/presentation.ts` | Show renders BRANCH/BASE/WORKTREE | ✓ VERIFIED | Lines 97-98; probe output confirms |
| `packages/cli/src/git.ts` | Deleted | ✓ VERIFIED (absent) | `ls` fails; 0 `./git.js` imports remain |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/cli/src/tk.ts` (work) | `@tasks/git` adapter | imports + calls (tk.ts:11,21,609-645) | WIRED | All git calls through adapter; `bunRunner` default |
| `packages/cli/src/tk.ts` (worktree create) | `resolveWorktreePath` | tk.ts:205-207 | WIRED | `config.worktree?.dir` honored |
| `packages/cli/src/tk.ts` (work) | `resolveWorktreePath` | tk.ts:606-609 | WIRED | Same resolver function, same precedence |
| `work()` | task record persistence | `uow.save` with branch/worktree/changeset metadata (tk.ts:645) | WIRED | Probe: values survive to `tk show` |
| `presentation.ts` | recorded metadata | reads `metadata["worktree"]`/branch (97-98) | WIRED | Probe renders the lines |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `work()` | `base` | `gitMergeBase` (git query) | Yes | ✓ FLOWING |
| `work()` | `path` | `resolveWorktreePath` → `gitWorktreeAdd` | Yes | ✓ FLOWING |
| `work()` | `branch` | constructed `tk/<id>`, verified via `gitBranchExists`/created via `gitCreateBranch` | Yes | ✓ FLOWING |
| `tk show` | BRANCH/BASE/WORKTREE | task-record metadata written by `work()` | Yes | ✓ FLOWING (probe-verified) |

No static fallbacks, no hardcoded literals feeding rendered output.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full phase test suite | `bun test packages/git/test packages/cli/test` | 119 pass, 0 fail, 11 files, 884 expect() | ✓ PASS |
| Worktree creation + evidence recording | scratch repo: `tk init` → `tk create` → `tk work <id> --json` | JSON `{path, branch:"tk/tk-le4", base:"5069c848…", created:true}` | ✓ PASS |
| Real git worktree registered | `git worktree list` in probe repo | Two entries: main + `repo-tk-le4` at same SHA | ✓ PASS |
| `tk show` renders evidence | `tk show tk-le4` | `BRANCH: tk/tk-le4`, `BASE: 5069c848…`, `WORKTREE: …/repo-tk-le4` | ✓ PASS |
| Re-entry preserves pinned base | second `tk work <id>` | `✓ worktree ready … (existing)` | ✓ PASS |
| Error propagation | `tk work` in commit-less repo | exit 1, `fatal: not a valid object name: 'main'` surfaced | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| (none declared) | No `scripts/*/tests/probe-*.sh` in PLAN/SUMMARY and none conventional | Phase covered by Step 7b spot-checks instead | N/A |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| GIT-01 | 01-01 | Typed git adapter in `packages/git` — one abortable runner, enumerated commands, porcelain parsing — so every later git call goes through it | ✓ SATISFIED | Truth 4; runner/commands/porcelain files + tests; `packages/cli/src/git.ts` deleted, importers migrated |
| GIT-02 | 01-01, 01-02 | `resolveWorktreePath()` — default sibling, `worktree.dir` config, per-task override; one resolver for both `tk work` and `tk worktree create`, inline path logic deleted | ✓ SATISFIED | Truth 2; both call sites wired to the single resolver; tests at tk.test.ts:745, work.test.ts:53, resolver.test.ts |
| GIT-03 | 01-02 | `tk work <id>` creates/enters worktree on `tk/<id>` and records pinned base SHA, path, branch in the task record | ✓ SATISFIED | Truth 1; probe + work.test.ts E2E |

No orphaned requirements: the traceability table maps exactly GIT-01..03 to Phase 1 and all three are claimed and satisfied. (CHG-*/FIN-*/REV-*/WEB-*/LC-*/INJ-* belong to later phases.)

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/cli/src/tk.ts` | 35, 1045 | `work` missing from `writers` set — `tk --readonly work <id>` dispatches (tk.ts:1083) and performs git mutations + metadata writes, bypassing the `readonly mode blocks writes` gate | ⚠️ Warning | Correctness defect in a phase-built command, but readonly enforcement is not a declared must-have of this phase (no SC, no plan truth/prohibition). Independently flagged as critical by 01-REVIEW.md. One-line fix: add `"work"` to the writers set (tk.ts:35) + regression test. Recommend folding into phase 2 or an immediate gap-closure commit |
| `packages/surface/src/git.ts` | whole file | Second, near-duplicate git adapter (its own runner/commands) | ℹ️ Info | Predates this phase (introduced in cf1a35b, an ancestor of the roadmap commit c7552ab). GIT-01 is forward-looking ("every later git call goes through it"); surface package was not in phase scope. Candidate for later consolidation — not a phase-1 gap |
| `packages/cli/src/hooks.ts` | 43, 737 | `spawnSync("git", …)` outside the adapter | ℹ️ Info | Same pre-existing baseline (0ba0add); the phase only migrated hooks.ts imports off the deleted `./git.js` module. Out of scope for GIT-01's contract |
| — | — | Debt markers (TBD/FIXME/XXX/HACK/PLACEHOLDER) | — | None in any phase-modified file (grep clean) |

### Human Verification Required

None. All must-have truths are CLI-level behaviors exercised with deterministic evidence: full E2E test suite (119/119 through the real binary) and an independent scratch-repo probe covering creation, evidence recording, rendering, and re-entry. No UI, real-time, or external-service behavior remains unverified in this phase's scope.

### Gaps Summary

No gaps against the declared must-haves. The goal is observably achieved: the PR container exists (worktree per task on `tk/<id>` with git-derived recorded evidence) and tk's own worktree/git plumbing flows through one typed adapter (`@tasks/git`), with `packages/cli/src/git.ts` deleted and its importers migrated.

Two out-of-scope findings are recorded for the orchestrator's attention:

1. **Readonly gate bypass (⚠️ Warning)** — `tk work` is absent from the `writers` set (tk.ts:35), so `--readonly` does not block it despite the command mutating git state and issue metadata (dispatch tk.ts:1083, gate tk.ts:1045). Not a phase must-have, but it contradicts the pre-existing readonly contract and was raised as critical by the committed 01-REVIEW.md. Cheapest fix belongs in an early follow-up: add `"work"` to the set and a regression test.
2. **Pre-existing parallel git plumbing (ℹ️ Info)** — `packages/surface/src/git.ts` (second adapter) and `hooks.ts` `spawnSync("git")` calls predate the roadmap and were untouched by phase 1; GIT-01's "every later git call" language makes them future consolidation targets, not phase-1 failures.

---

_Verified: 2026-10-18T15:58:53Z_
_Verifier: Claude (gsd-verifier)_
