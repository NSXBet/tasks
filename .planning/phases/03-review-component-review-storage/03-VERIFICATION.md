---
phase: 03-review-component-review-storage
verified: 2026-11-10T16:20:00Z
status: passed
score: 9/9 must-haves verified
covered_files: [
    ".planning/phases/03-review-component-review-storage/03-01-PLAN.md",
    ".planning/phases/03-review-component-review-storage/03-01-SUMMARY.md",
    ".planning/phases/03-review-component-review-storage/03-02-PLAN.md",
    ".planning/phases/03-review-component-review-storage/03-02-SUMMARY.md",
    ".planning/phases/03-review-component-review-storage/03-03-PLAN.md",
    ".planning/phases/03-review-component-review-storage/03-03-SUMMARY.md",
    ".planning/phases/03-review-component-review-storage/03-04-PLAN.md",
    ".planning/phases/03-review-component-review-storage/03-04-SUMMARY.md",
    ".planning/phases/03-review-component-review-storage/03-05-PLAN.md",
    ".planning/phases/03-review-component-review-storage/03-05-SUMMARY.md",
    "README.md",
    "docs/src/content/docs/overview.md",
    "docs/src/content/docs/testing.md",
    "packages/cli/src/presentation.ts",
    "packages/cli/src/tk.ts",
    "packages/cli/test/presentation.test.ts",
    "packages/cli/test/tk.test.ts",
    "packages/domain/src/review-record.ts",
    "packages/domain/test/review-record.test.ts",
    "packages/git/src/commands.ts",
    "packages/git/test/adapter.test.ts",
    "packages/pi-extention/package.json",
    "packages/review/package.json",
    "packages/review/scripts/headless-smoke.ts",
    "packages/review/src/app/taskStoreCommentStore.ts",
    "packages/review/src/core/patch/gitFormat.ts",
    "packages/review/src/core/run/config.test.ts",
    "packages/review/src/core/run/config.ts",
    "packages/review/src/core/watch/plan.test.ts",
    "packages/review/src/core/watch/signature.test.ts",
    "packages/review/src/extension-api/types.ts",
    "packages/review/src/extensions/apply.ts",
    "packages/review/src/headless.ts",
    "packages/review/test/headless-smoke.test.ts",
    "packages/review/test/review-comment-store.test.ts",
    "packages/review/test/show-review.test.ts",
    "packages/surface/src/operations/review-comments.ts",
    "packages/surface/test/review-comments.test.ts",
    "packages/tui/src/review/source.ts",
    "packages/web/src/app.html",
    "packages/web/src/review.ts"
]
covered_digest: "v3:sha256:200dd85c7ee8629818221d886efbabaf1e76f534863184379877f078f6b50e05"
behavior_unverified: 0
overrides_applied: 0
deferred:
  - truth: "REV-02 'in-diff edits persist' (reviewer edits a changed file in place) and spec verify item 2 'live, editable'"
    addressed_in: "Phase 4 / Phase 5"
    evidence: "Phase 4 SC2/SC3: 'A commit from a second terminal re-renders the diff live' / 'An in-view edit persists to the worktree file and the diff re-renders around it'; Phase 5 SC3: 'A web edit writes the worktree file and appears in the TUI's diff'"
---

# Phase 3: Review Component & Review Storage — Verification Report

**Phase Goal:** tk owns its diff component — the vendored hunk slice takes tk-derived input and writes review state straight to the task record
**Verified:** 2026-11-10T16:20:00Z
**Status:** passed
**Re-verification:** No — initial verification
**Mode note:** ROADMAP marks the phase `mvp`, but the goal is not a User Story (same as Phases 1 and 2). The verifier used standard goal-backward verification against the 4 ROADMAP SCs plus the PLAN must-haves of 03-01..03-05.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: `packages/review` passes a headless smoke and opens a diff of any repo from node | ✓ VERIFIED | `bun test packages/review/test/headless-smoke.test.ts` → 2 pass / 0 fail. The node describe was not skipped (node v26 is on PATH). The verifier ran it independently: `bun build packages/review/scripts/headless-smoke.ts --target=node` → a 71 KB bundle, then `node smoke.mjs <this repo> --base HEAD~1 --head HEAD </dev/null` → rc 0, 4 files, +9/−4. The default-base form also prints valid JSON. `src/headless.ts` exports `changesetFromPatch` / `createHunkDiffFilesFromPatch` with no git, OpenTUI or store imports. Also present: changeset (`core/changeset`), review types (`core/review/types.ts`), watch controller (`core/watch/controller.ts`), and the `@pierre/diffs` 1.3.5 dep. Neither a session broker nor the hunk comment sidecar exists: `src/app` contains only `taskStoreCommentStore.ts`, and there are no server/WebSocket listeners. |
| 2 | SC2a: one git adapter. `hunk-vcs`/`hunk-git` fold into `packages/git`, and review has no git code | ✓ VERIFIED | Grepping `Bun.spawn|spawnSync|child_process|execFile|["git"` over `packages/review/src` and `packages/review/scripts` → 0 hits, tests included. `core/vcs` keeps only `types.ts`, `index.ts` and `untracked.ts`, with no jj/sl adapters, no Jujutsu/Sapling prose and no `createJjRepo`. Grepping `["git",` / `` $`git `` / `"git",` across `packages/*/src` outside `packages/git` → 0. Web (`review.ts:80,85,110`) and TUI (`review/source.ts:54,70`) get their patches only through `gitDiffPatch` (`packages/git/src/commands.ts:91`, with an `--end-of-options` guard). `packages/surface/src/git.ts` was deleted. |
| 3 | SC2b: the `tk hunk` spawn path is deleted | ✓ VERIFIED | `packages/cli/src/hunk.ts` is absent. `bun packages/cli/src/tk.ts hunk x` → `✗ unknown command: hunk`, rc 1. `grep -w` for planHunk, writeAgentContext, parseHunkComments, pendingHunkComments, formatHunkComment, scratchDirectory and hunkCommentMetaKey over `packages/*/src` → 0. No `["hunk", …]` spawn argv exists. The only hits are `HOMEBREW_ARTIFACT_NAMES` (file-name list) and a doc comment. `tk review <id>` dispatches to `runTui tk://diff/<id>` (`tk.ts:1397`). Docs and README no longer mention `tk hunk`. |
| 4 | SC2c: the `pi-extention` workspace-dep fix rides the phase | ✓ VERIFIED | `packages/pi-extention/package.json` dependencies are `{ "@tasks/daemon": "workspace:*", "@tasks/surface": "workspace:*" }`. |
| 5 | SC3: a reviewer comment on a line or file persists to the task record and shows in `tk show` with resolve counts | ✓ VERIFIED | Scratch workspace E2E, run by the verifier (`tk init` + `tk create`, then `taskStoreCommentStore(store).createThread` for `src/x.ts:7` and the file-level `docs/y.md`, store closed, then a fresh `tk show` process). Output: `comments 2 · 2 open 0 ✓` and `REVIEW (2) · 2 open · 0 ✓`, followed by `○ src/x.ts:7  verifier  rename this` and `○ docs/y.md  verifier  file-level note`. Both TUI (`App.tsx:109`) and web (`web/src/review.ts:220`) write through this same `taskStoreCommentStore`. Test: `packages/review/test/show-review.test.ts` passes. |
| 6 | SC4: resolving flips a comment to ✓, and an all-resolved thread shows "All resolved" in the header, stored on the record | ✓ VERIFIED | Same E2E. Resolving one comment (new store, closed, fresh `tk show`) gives `REVIEW (2) · 1 open · 1 ✓` and `✓ src/x.ts:7`. Resolving both gives `REVIEW (2) · All resolved`, both rows `✓`, comments row `comments 2 · All resolved · 2 ✓`. `tk show --json` returns `review.counts = {resolved:2, unresolved:0, allResolved:true}`. Every read is a separate process, so the state is the one stored in `metadata.reviewThreads`. |
| 7 | D-02: legacy hunk-synced comments are imported once into review threads, and tk never writes the old key | ✓ VERIFIED | E2E. A task was seeded with `metadata.hunkComments:['h1','h2']` and `hunk-h1` / `hunk-h2` comments. A pure `tk show` (before persist) shows `REVIEW (2)` with `○ lib/q.ts:42 hunk legacy one` and `○ lib/r.ts hunk legacy two`, and `hunkComments` is still on the record. The adapter's `listThreads` returns `[hunk-h1, lib/q.ts, 42, new, open]` and `[hunk-h2, lib/r.ts, null, old, open]`. After that, `metadata.hunkComments` is gone, the threads are `[hunk-h1, hunk-h2]`, and there are still 2 comments (no duplicate roots). The only source occurrence of `hunkComments` is `LEGACY_HUNK_COMMENTS_KEY` (`review-comments.ts:33`). |
| 8 | D-09: CLI, TUI (domain) and web share one counting rule (dismissed settles, sent counts as open) | ✓ VERIFIED | `domain/review-record.ts` `commentSummary`/`commentsLine`, consumed by TUI `task.tsx:83` and CLI `formatShow`. `web/src/app.html:715-726` mirrors the rule inline. Covered by `packages/domain/test/review-record.test.ts` and `packages/cli/test/presentation.test.ts` (partial, all-resolved and dismissed-only cases), both in the green regression run. |
| 9 | 03-03: parked bundled-adapter tests are resolved; `bun test packages/review/src` is green with fewer skips | ✓ VERIFIED | No `describe.skip` remains in `core/watch/*.test.ts`. The remaining skips are platform `skipIf` plus one unrelated theme `test.skip` (`config.test.ts:1493`). The regression total has 5 skips. |

**Score:** 9/9 truths verified (0 present, behavior-unverified). Each state-transition truth (5, 6, 7) has a passing named test and an independent verifier E2E run in a scratch workspace.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | REV-02 "in-diff edits persist", and spec verify item 2 "live, editable" | Phase 4 / Phase 5 | Phase 4 SC2/SC3 cover live re-render and in-view edits persisting to the worktree. Phase 5 SC3 covers web edits. Phase 3's 4 SCs cover comments and resolve state only. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/git/src/commands.ts` | `gitDiffPatch` | ✓ VERIFIED | `:91`; used by web, TUI and the smoke script |
| `packages/review/src/headless.ts` | git-free headless entry | ✓ VERIFIED | exported as `./headless` in package.json |
| `packages/review/scripts/headless-smoke.ts` | node smoke | ✓ VERIFIED | bundles and runs under plain node |
| `packages/review/test/headless-smoke.test.ts` | in-process + node smoke | ✓ VERIFIED | 2 pass |
| `packages/cli/src/tk.ts` | no hunk command; `review` JSON field | ✓ VERIFIED | `:1393`, `:1397` |
| `packages/surface/src/operations/review-comments.ts` | legacy importer | ✓ VERIFIED | `importLegacyHunkComments`, `withLegacyHunkImport` |
| `packages/review/src/app/taskStoreCommentStore.ts` | import on every adapter read | ✓ VERIFIED | E2E: `listThreads` persisted the import |
| `packages/domain/src/review-record.ts` | D-09 summary + All resolved | ✓ VERIFIED | |
| `packages/cli/src/presentation.ts` | REVIEW section | ✓ VERIFIED | E2E output above |
| `packages/review/test/show-review.test.ts` | adapter write → `tk show` E2E | ✓ VERIFIED | passes |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `headless-smoke.ts` | `@tasks/git gitDiffPatch` + `changesetFromPatch` | imports, bundled for node | ✓ WIRED |
| `web/src/review.ts`, `tui/src/review/source.ts` | `gitDiffPatch` | direct calls | ✓ WIRED |
| TUI `App.tsx` / web `review.ts` | `taskStoreCommentStore` | the same store for both | ✓ WIRED |
| `taskStoreCommentStore` | `withLegacyHunkImport` | inside `store.transact` | ✓ WIRED (E2E) |
| `formatShow` | surface `reviewComments(issue)` | cards + counts | ✓ WIRED (E2E) |
| TUI `task.tsx` | domain `commentSummary`/`commentsLine` | import | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real Data | Status |
|---|---|---|---|---|
| `tk show` REVIEW section | `reviewComments(issue)` | `metadata.reviewThreads` + root comments from the task store | yes (fresh-process E2E) | ✓ FLOWING |
| node smoke JSON | `changesetFromPatch(patch)` | `git diff` via `@tasks/git` against a real repo | yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Headless smoke incl. node | `bun test packages/review/test/headless-smoke.test.ts` | 2 pass / 0 fail | ✓ PASS |
| Node opens any repo | `node smoke.mjs <repo> --base HEAD~1 --head HEAD </dev/null` | rc 0, 4 files | ✓ PASS |
| `tk hunk` gone | `tk hunk x` | `unknown command: hunk`, rc 1 | ✓ PASS |
| Comment → record → show → resolve → All resolved; legacy import | `bun scratchpad/e2e.ts` (scratch workspace) | outputs quoted in truths 5–7 | ✓ PASS |
| Typecheck | `tsc --noEmit` for review, cli, domain, surface and git | all rc 0 | ✓ PASS |
| Regression | `bun test --timeout 30000 packages/review packages/surface packages/cli/test packages/git packages/web packages/tui` (run once) | 1414 pass / 5 skip / 0 fail across 138 files | ✓ PASS |

### Probe Execution

No probes were declared. Not applicable.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| REV-01 | 03-01, 03-02, 03-03 | vendored review slice; broker and comment store stripped; one git adapter; `tk hunk` deleted | ✓ SATISFIED | Truths 1–4, 9 |
| REV-02 | 03-04, 03-05 | comments persist to the task record (TUI and web share one store), per-comment resolve state, "All resolved" header | ✓ SATISFIED (comments/resolve); in-diff edits deferred to Phases 4/5 | Truths 5–8 |

No orphaned requirements: REQUIREMENTS.md maps only REV-01 and REV-02 to Phase 3.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| (all covered files) | — | TBD/FIXME/XXX | none found | — |
| `packages/cli/src/tk.ts` help text | — | `tk review <id>` is not listed in `tk --help`. The tk.test.ts assertion `help.stdout toContain("review")` only passes because of `--ready-to-review` | ℹ️ Info | Discoverability only. Dispatch works, and README/overview document the command. |
| `packages/domain/src/review-record.ts` / `web/src/app.html` | — | The TUI task view and web modal comments row count raw `reviewThreads` only, without the in-memory legacy import that `tk show` applies. For a legacy task no review door has opened yet, `tk show` reads 2 open while the TUI/web row reads 0 open. | ℹ️ Info | Lasts only until the first adapter read, which persists the import. Narrow and transient. |
| `packages/cli/dist/hunk.js` | — | stale build output (gitignored dist) | ℹ️ Info | Not source |

### Human Verification Required

None. Every SC was exercised programmatically: the headless smoke under node, and a multi-process scratch-workspace E2E.

### Gaps Summary

There are no gaps. The vendored review component is git-free and loads tk-derived patches headlessly from plain node. All git access goes through `@tasks/git`. `tk hunk` and its spawn path are gone. Legacy hunk comments are imported once. Review comments written through the shared TUI/web store persist on the task record and render in `tk show` with counts, ✓ and "All resolved" across fresh processes. Three info-level notes are listed above (help text, legacy pre-import count in TUI/web rows, stale dist). In-diff editing is deferred to Phases 4/5.

---

_Verified: 2026-11-10T16:20:00Z_
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
- Phase-specific recheck (9/9 truths). Headless-smoke test passes 2/2. Production `packages/review/src` and `packages/review/scripts` contain no spawn or git calls. `core/vcs` = types, index, untracked. `tk hunk x` gives `✗ unknown command: hunk`, rc 1. The removed hunk symbols have no hits. `pi-extention` deps are `@tasks/daemon` and `@tasks/surface` workspace:*. The comment, resolve and legacy-import paths are covered by show-review, review-record and presentation tests, all green. No `describe.skip` remains in core/watch. Advisory: the original "0 hits, tests included" no longer holds literally. `core/taskview/model.test.ts:20` (added by a later phase) runs `Bun.spawnSync(["git", …])` as a test-fixture helper. That is test setup, not review production git code, so SC2a still holds.
