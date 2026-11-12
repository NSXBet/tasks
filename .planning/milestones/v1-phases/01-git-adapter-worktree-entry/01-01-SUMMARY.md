# Plan 01-01 Summary: Typed git adapter + one resolver

**Status:** COMPLETE
**Commits:** `670a05c` (adapter + wiring), `9f09f50` (tests)

## What was built

- **`packages/git` (`@tasks/git`)** — typed adapter with:
  - `src/runner.ts`: `ProcessRunner` interface + `bunRunner` (Bun.spawn, trimmed output, abort-signal cancellation, `code: -1` on null exit).
  - `src/commands.ts`: every git command enumerated (`gitCommonDir`, `gitToplevel`, `gitCurrentBranch`, `gitDefaultBranch`, `gitMergeBase`, `gitWorktreeAdd/Remove/List`, `gitHasUncommittedChanges`, `gitHasUnpushedCommits`, `gitStashCount`, `mainWorktreeRoot`); structured `GitOutcome` instead of raw spawn at call sites.
  - `src/porcelain.ts`: `parseWorktreePorcelain` → `{ path, branch, bare, locked }`.
  - `src/resolver.ts`: `resolveWorktreePath({ repoRoot, name, dir?, override? })` — precedence: per-task override > `worktree.dir` config (`{name}` placeholder expands; absent → name appended; relative resolves against repoRoot) > sibling default `<parent-of-repo-root>/<name>`. Pure, no FS access.
- **Migrations:** `packages/cli/src/git.ts` deleted; `tk.ts` and `hooks.ts` import from `@tasks/git`; `gitMergeBase` review path and `hunk.ts` git calls now go through the adapter. Dead inline `resolve(start, name)` logic removed from `worktree remove`.
- **Config:** `worktree: { dir }` key added to `WorkspaceConfigSchema` (`.tasks/config.json`), round-trip tested.
- **Wiring:** root `package.json` exports `"./git"`, build/check chains, tsconfig project references, `@tasks/cli` dependency.

## Deviations

- Old behavior wrote `.gitignore` entries for in-repo worktrees; sibling default makes that dead — deleted (test now asserts no `.gitignore` rewrite).
- Resolver semantics aligned to plan exactly: override is a verbatim path (no name append); config `dir` gets `{name}`/name-append. Tests match.

## Verification (all passing)

- `bun test packages/git/test packages/workspace/test packages/cli/test` → 16 + 30 + 98 pass, 0 fail.
- `bun run check` → exit 0 (tsc --noEmit across all packages).
- `grep -rn "resolve(start, name)" packages/cli/src/tk.ts` → no matches.
- `grep -rn "Bun.spawn" packages/cli/src packages/domain/src packages/surface/src` → no hit contains "git" (spawns are hunk/bun/brew only).
- `ls packages/cli/src/git.ts` → not found (deleted, not wrapped).

## Edge predicates locked (plan task 2)

porcelain: entries/branch/bare, detached-as-branchless, empty input, adjacency of identical entries, ordering preserved. resolver: sibling default, override>config>default, `{name}` expansion, relative-dir resolution against repoRoot, purity (no FS mutation), determinism (same-tick concurrency equality). runner: pre-aborted signal kills child promptly.

## GIT-03 note

Plan's FLAGGED-UNVERIFIED probe row (GIT-03 edge) intentionally remains for manual review against 01-02 evidence, per no-silent-drop equality.
