---
phase: 2
fixed_at: 2026-10-18T21:35:21Z
review_path: .planning/phases/02-changeset-derivation-completion-contract/02-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 2: Code Review Fix Report

**Fixed at:** 2026-10-18T21:35:21Z
**Source review:** .planning/phases/02-changeset-derivation-completion-contract/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2
- Fixed: 2
- Skipped: 0

## Fixed Issues

### WR-01: Close-shaped saves bypass the exactly-once freeze

**Files modified:** `packages/surface/src/operations/mutate.ts`, `packages/cli/src/tk.ts`
**Commit:** ce83498
**Applied fix:** Routed the three bypass close paths — surface `markDuplicate`, surface `markSuperseded`, and CLI `markDuplicate` / `markSuperseded` / `todoDone` — through `freezeChangesetUow` with the established merge pattern already used by `changeStatus` and `closeMany` (`frozen === null ? result : { ...result, metadata: { ...result.metadata, changeset: frozen } }`). The branch-less derive-null case saves with metadata untouched, so branch-less closes remain no-ops. Removed the stale `// No CHG-02 freeze here: branch-less todo items derive null — nothing to freeze.` exemption comment on `todoDone` (task-type issues can carry a branch + base record from `tk work`, so the exemption was wrong). No new helper functions were introduced — each site inlines the freeze+merge, matching the existing convention and the `ts-no-tiny-functions` rule. Freeze semantics stay exactly-once: `freezeChangesetUow` refuses when a snapshot is already frozen, so reopen→re-close cannot re-freeze.

### WR-02: Frozen-snapshot absence invisible on close dispatch

**Files modified:** `packages/cli/src/tk.ts`
**Commit:** 26f9e91
**Applied fix:** Added a module-level `warnUnfrozenChangeset(issue)` helper in `packages/cli/src/tk.ts` that emits a non-fatal stderr warning (project convention: `process.stderr.write("tk: ...")`) when a closed issue ends with a changeset base record but no frozen snapshot — the signature of a CHG-02 freeze that failed derivation at close time. Wired it into all four close dispatches: `duplicate`, `supersede`, `todo done`, and the `close` verb of `update`/`close`/... `set-state` mutate. The helper gates on `status === "closed"` plus `readChangesetBase(...) !== null` and `readChangesetSnapshot(...) === null`, so non-close verbs (reopen, defer, label) and fully-frozen closes stay silent. One call-site exception to `ts-no-tiny-functions`: four dispatch sites need lockstep behavior, which is the rule's allowed case.

## Verification

- **Tier 1 (every fix):** re-read all modified regions; fix text present, surrounding code intact (confirmed via edit tool readback).
- **Tier 2:** `bunx tsc --noEmit -p packages/surface` → exit 0; `bunx tsc --noEmit -p packages/cli` → exit 0 after each fix.
- **Full suite:** `bun test` after the last fix commit: 328 pass / 15 fail across 343 tests. All 15 failures are ~10s timeouts in `packages/tui` (`deep-link boot`, `tui app` suites) whose test files are uncommitted sibling-agent work (`git status`: `packages/tui/src/app/*` modified, `boot.test.tsx`/`routes.test.ts` added; `packages/cli/test/onboard.test.ts` added) — zero failures reference surface or cli tests.
- **Affected packages isolated:** `bun test packages/surface packages/cli` → **168 pass, 0 fail** (1138 expect() calls, 17 files), including the changeset-freeze suite. No fix rolled back — the workspace failures are pre-existing sibling-agent territory, not caused by WR-01/WR-02.
- **Verification location:** main checkout — `workflow.use_worktrees` is `false`, so edits and commits ran directly on the working branch (no worktree, no temp branch).

---

_Fixed: 2026-10-18T21:35:21Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
