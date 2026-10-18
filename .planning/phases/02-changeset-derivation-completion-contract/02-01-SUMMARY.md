---
phase: 2-changeset-derivation-completion-contract
plan: 02-01
subsystem: cli, git, surface
tags: [changeset, git, porcelain, tk-show, lazy-derivation]
requires:
  - phase: 1
    provides: "Typed git adapter (@tasks/git runner/commands/porcelain); changeset base pinned at tk work (metadata[\"changeset\"].base)"
provides:
  - "gitLogOneline / gitDiffNumstat / gitDiffNameStatus adapter commands (two-dot log, three-dot diff, D-01/D-02 literal)"
  - "parseLogOneline / parseNumstat / parseNameStatus porcelain parsers (empty → [], binary `-` → 0, rename R-code with destination path)"
  - "deriveChangeset surface operation (packages/surface/src/operations/changeset.ts) — live re-derivation, never cached, never written to metadata (D-01, D-07)"
  - "tk show renders COMMITS and FILES sections from the branch against the pinned base; wire changeset gains commits/files/counts when derived"
  - "ChangesetPayload type exported from @tasks/surface"
affects: [02-02, completion-contract, tui]
key-files:
  - packages/git/src/commands.ts
  - packages/git/src/porcelain.ts
  - packages/surface/src/operations/changeset.ts
  - packages/cli/src/tk.ts
  - packages/cli/src/presentation.ts
key-decisions:
  - "Counts shape is { additions, deletions } only (D-02); commit/file counts appear in section headers, not the payload"
  - "Derivation scoped to the show dispatch (D-03): exactly one non-import deriveChangeset call site in tk.ts, pinned by a comment-gate in packages/cli/test/show-changeset.test.ts for 02-02's second call site"
  - "Rename detection requires the source path in the merge-base tree; test fixtures seed rename sources on the base branch, not the feature branch"
  - "Sibling-agent working-tree overlap handled by selective staging (index blobs built from HEAD + only this plan's hunks); one fix-forward commit restores the ONBOARD export the overlap dropped from the committed snapshot"
---

# Plan 02-01 Summary: Lazy changeset derivation (CHG-01)

## What Was Built

Three-layer tracer slice, end to end:

1. **git adapter** — `gitLogOneline` (two-dot `base..branch`, D-01), `gitDiffNumstat` and `gitDiffNameStatus` (three-dot `base...branch`, D-02) in `packages/git/src/commands.ts`; parsers `parseLogOneline`, `parseNumstat`, `parseNameStatus` in `porcelain.ts` (1:1 with git output, empty → `[]`, binary `-` columns → 0, verbatim R-codes with destination path).
2. **surface operation** — `deriveChangeset(context, base, branch)` in `packages/surface/src/operations/changeset.ts`: null base/branch/failed command → null (decay, D-04); success → `{ commits, files, counts: { additions, deletions } }` (D-02). Nothing derived is written to metadata (D-07). The D-01/D-02 command reconciliation is documented in its doc comment.
3. **CLI wiring** — `tk show` derives live on every read when the issue has a pinned base and a branch, replaces the wire `changeset` field with `{ base, commits, files, counts }`, and `formatShow` renders `COMMITS (n)` (sha + subject) and `FILES (n)` (status-colored code + path) sections. Empty lists omit their section; null payload keeps the plain `{ base }` wire shape. `@tasks/surface` gained the `@tasks/git` workspace dependency (build chains updated).

## Tasks Completed

| Task | Commit |
|------|--------|
| Task 1: adapter + porcelain + surface operation + git/surface tests | 2e4d042 |
| Task 2: tk show wiring + formatShow sections + e2e/renderer tests | af05aeb |
| (fix-forward: restore ONBOARD export dropped by selective-staging overlap) | 77f0964 |

## Verification

- `bun run --filter @tasks/git check` / `@tasks/surface check` / `@tasks/cli check` — all exit 0.
- Tests: git 21 pass (porcelain, adapter incl. fakeRunner D-01 literal assertion, live-repo rename/binary/binary-additions/decay/stability), surface 29 pass (deriveChangeset incl. decay + no-metadata-write), cli 123 pass (e2e: tk work flow shows commits/files, wire counts, no-tk-work plain shape, deleted-branch decay exits 0, rename edge R-code + destination path, binary edge additions 0, base-pinned stability; renderer: sections present/omitted).
- Committed snapshot `77f0964` typechecks via `git archive` → isolated `bun install` + `@tasks/cli check` exit 0.

## Deviations

- None from plan scope. Selective staging was required because sibling plans share the working tree (`git checkout`/`git reset <commit>` blocked by workspace policy); a fix-forward commit (77f0964) restored the `ONBOARD` export that the overlap briefly dropped from the committed snapshot — behavior verified by typecheck.
- Plan file-count estimate: 11 planned; 12 touched counting bun.lock (workspace dep link for `@tasks/git` in `@tasks/surface`).

## Notes for 02-02

- `deriveChangeset` is exported from `@tasks/surface` (re-exported in `packages/surface/src/index.ts`); the finish wiring should import it the same way tk.ts does (`from "@tasks/surface"`).
- The scoping gate comment in `packages/cli/test/show-changeset.test.ts` expects a SECOND non-import `deriveChangeset` call site once finish lands — update that comment and the gate together.
- `ChangesetPayload` is the payload type to reuse for any completion-time snapshot.
- `finishPolicy` was annotated reuse-only in the plan (interface-only, live-verified; lives in `surface/operations/finish.ts` per 02-02 assumption 1).
