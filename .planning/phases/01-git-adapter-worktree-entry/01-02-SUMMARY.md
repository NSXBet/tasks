---
plan: "01-02"
phase: 1
title: "tk work <id> — worktree entry on branch tk/<id> with recorded evidence"
completed: true
---

# Plan 01-02 Summary: tk work <id>

## What was built
- `tk work <id>` (replacing the Phase-0 mock `work` show command) in `packages/cli/src/tk.ts` (`CommandService.work`):
  - Requires a git repository (fails via `gitCommonDir` null).
  - Branch `tk/<id>`; per-task `metadata["worktree_dir"]` override wins over `worktree.dir` config over sibling default, resolved through `resolveWorktreePath` from `@tasks/git`.
  - Creation path: `gitBranchExists` → `gitCreateBranch` (enumerated adapter commands) → `gitWorktreeAdd` without `-b`; re-entry reuses the existing worktree (`created: false`) — no destructive flags ever.
  - Records on the issue: `branch`, `metadata["worktree"]` (path), `metadata["changeset"].base` (pinned once at creation, never rewritten on re-entry). All values come from actual git output.
- Adapter additions (`packages/git/src/commands.ts`): `gitBranchExists`, `gitCreateBranch`; `gitWorktreeAdd` gained a `createBranch` parameter.
- Presentation: `formatShow` renders `WORKTREE:`/`BASE:` lines (recorded evidence wins, Phase-0 review mock is the fallback); `issueWire` exposes `worktree` and `changeset.base` (wire-only, no schema change). Dead `formatWork` removed (clean cutover).
- Help text updated.

## Verification (all passing)
- `bun test packages/cli/test/work.test.ts` — 6 tests: create+record (path, branch, base, human output), re-entry idempotence (`created:false`, base preserved), `tk show` renders WORKTREE/BASE, `--json` wire exposes `worktree` + `changeset.base`, per-task `worktree_dir` metadata override with `{name}` expansion, dirty-placement failure surfaces git's stderr.
- `bun test packages/cli/test packages/git/test` — 119 pass, 0 fail.
- `bun run check` — exit 0 (tsc across all packages).
- Typecheck caught and fixed: `Metadata`-typed changeset for `JsonValue` compatibility; `commonDir` null narrowing via `fail()` coalescing.

## Commits
- `tk work <id>`: worktree entry with recorded evidence (branch/path/pinned base) — src + tests + docs.

## Notes for later phases
- `metadata["changeset"]` currently carries only `base`; commits/files/diff derive lazily in later phases.
- Old mock `work` expectations ("main @ 9f13ee4" fragments) remain covered via the review-mock fallback in `formatShow`.
