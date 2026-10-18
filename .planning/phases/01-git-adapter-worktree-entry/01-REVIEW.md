---
phase: 01-git-adapter-worktree-entry
reviewed: 2026-10-18T15:49:59Z
depth: deep
files_reviewed: 23
files_reviewed_list:
  - bun.lock
  - package.json
  - packages/cli/package.json
  - packages/cli/src/hooks.ts
  - packages/cli/src/presentation.ts
  - packages/cli/src/tk.ts
  - packages/cli/test/tk.test.ts
  - packages/cli/test/work.test.ts
  - packages/cli/tsconfig.json
  - packages/git/package.json
  - packages/git/src/commands.ts
  - packages/git/src/index.ts
  - packages/git/src/porcelain.ts
  - packages/git/src/resolver.ts
  - packages/git/src/runner.ts
  - packages/git/test/adapter.test.ts
  - packages/git/test/concurrency.test.ts
  - packages/git/test/porcelain.test.ts
  - packages/git/test/resolver.test.ts
  - packages/git/tsconfig.json
  - packages/workspace/src/config.ts
  - packages/workspace/test/workspace.test.ts
  - tsconfig.json
findings:
  critical: 1
  warning: 6
  info: 3
  total: 10
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-10-18T15:49:59Z
**Depth:** deep
**Files Reviewed:** 23
**Status:** issues_found

## Summary

The phase lands `@tasks/git` (runner, enumerated commands, porcelain parsing, pure worktree resolver) and the `tk work` entry, re-pointing `tk worktree`/hooks/presentation at the new package. Architecture is clean: one spawn chokepoint (`runner.ts`), pure `--porcelain` parsing, a zero-I/O resolver whose races deliberately surface as git errors, and `{name}` config expansion. Tests cover the important re-entry and placement paths, and the `work`-command tests match observable behavior.

The one BLOCKER is a broken `--readonly` contract for `tk work`: the command performs git mutations and issue-metadata writes but is absent from the `writers` gate at `tk.ts:35` and dispatched unconditionally at `tk.ts:1083` — a direct contradiction of the documented readonly guarantee, and with the default `file` storage backend the write even succeeds (the readonly flag is dropped in `openStorage`). The remaining warnings are edge-case robustness gaps (detached-HEAD branch label, POSIX `$` replacement-pattern injection in the resolver, unguarded `merge-base` on unpinned bases, non-atomic branch-then-worktree creation, upstream semantics that misclassify never-pushed branches) plus minor quality items. No injection into git argv is possible (argument arrays, no shell); no secrets; no path handling defects beyond those noted.

## Critical Issues

### CR-01: `tk --readonly work <id>` bypasses the readonly gate and mutates git state + issue metadata

**File:** `packages/cli/src/tk.ts:35,1045,1083`
**Issue:** The readonly contract is enforced by a command allowlist: `const writers = new Set([...])` at `tk.ts:35` does not contain `"work"`, so the gate `if (booleanFlag(args, "readonly") && writers.has(command)) fail("readonly mode blocks writes")` (`tk.ts:1045`) never fires for `work`, and the dispatcher runs it unconditionally: `else if (command === "work") { const result = await service.work(args); ... }` (`tk.ts:1083`). `service.work` performs multiple mutations: `gitCreateBranch` (`tk.ts:619`), `gitWorktreeAdd` (`tk.ts:622`), and a metadata save transaction recording `branch`/`worktree`/`changeset.base` (`tk.ts:636-647`). This is exactly the class of write `--readonly` exists to prevent (e.g. a read-only CI/agent harness invoking `tk --readonly work tk-123` silently creates branches and worktrees). Worse, the partial-defense expectation also fails: `tk.ts:1068-1069` passes `{ readonly }` to `openStorage`, but the default `file` backend drops the flag entirely — `new FileAdapter({ dir: tasksDir })` ignores `options.readonly` (`packages/workspace/src/storage.ts:63-66`, verified by read; only the sqlite backend honors it at line 71) — so under the default backend every write in `work` succeeds in readonly mode; under sqlite, the git mutations already happened before the adapter errors, leaving a branch + worktree with no recorded issue evidence.

**Fix:**
```ts
// tk.ts:35 — add "work" to the writer set
const writers = new Set(["init", "create", "q", "update", "close", /* … */ "unarchive", "work"]);
```
If `work` under `--readonly` is meant to be a harmless no-op preview instead, gate it explicitly before dispatch (after the shared gate at `tk.ts:1045`):
```ts
else if (command === "work") {
  if (booleanFlag(args, "readonly")) fail("readonly mode blocks writes");
  const result = await service.work(args);
  ...
}
```
Additionally pass `readonly` through to the `file` backend in `packages/workspace/src/storage.ts` (or fail fast when `options.readonly` is set with backend `file`) so storage-level gating matches the documented "gate uniformly across backends" contract (`packages/application/src/ports/composition-root.ts:15`).

## Warnings

### WR-01: Detached HEAD surfaces as branch name `"HEAD"`, defeating the detached-branch display contract

**File:** `packages/git/src/commands.ts:25`
**Issue:** `gitCurrentBranch` runs `rev-parse --abbrev-ref HEAD`, which prints the literal string `HEAD` (exit 0) on a detached HEAD rather than failing, so the function resolves to `"HEAD"` instead of signaling detachment. The presentation contract assumes null means detached — `field("Branch:", info.branch ?? dim("(detached)"))` (`packages/cli/src/presentation.ts:621`) — so `tk worktree info` inside a detached worktree prints the meaningless label `Branch: HEAD` in both human and `--json` output (`tk.ts:186-187` wires the value verbatim). The `?? (detached)` fallback is dead code as written.

**Fix:** Normalize the sentinel at the adapter boundary:
```ts
export const gitCurrentBranch = async (cwd: string, runner: ProcessRunner = bunRunner): Promise<string | null> => {
  const branch = await git(runner, cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch === "HEAD" ? null : branch;
};
```

### WR-02: `String.replace` replacement patterns in `input.name` corrupt resolved worktree paths

**File:** `packages/git/src/resolver.ts:31,38`
**Issue:** Both `{name}` expansions pass the raw issue/task name as the replacement string: `input.override!.replace(/\{name\}/g, input.name)` (line 31) and `dir.replace(/\{name\}/g, input.name)` (line 38). When the replacement string contains `$` sequences, `String.prototype.replace` interprets them: `$&` inserts the matched token `{name}`, `$'` inserts the remainder of the string, `$1` would (with a capturing regex) insert groups. For example, a config `dir: "wt-{name}"` with name `foo$&bar` resolves to `wt-{name}bar` instead of `wt-foo$&bar`. Names come from issue ids today (`tk.ts:609`), but the resolver's own doc comment (`resolver.ts:16-17`) states names "pass through unchanged — validating them is the caller's responsibility," i.e. arbitrary caller strings are an intended input. The resolver is documented as pure and total; silent path corruption violates that.

**Fix:** Escape `$` in the replacement (or use a function replacement, which is pattern-free):
```ts
const expand = (template: string, name: string): string =>
  template.replace(/\{name\}/g, () => name);
```
Use `expand(input.override!, input.name)` at line 31 and `expand(dir, input.name)` (or `dir.includes("{name}") ? expand(dir, input.name) : join(dir, input.name)`) at line 38.

### WR-03: `merge-base` is spawned with a null base argument, producing garbage resolution paths in `work`

**File:** `packages/cli/src/tk.ts:630-635`
**Issue:** In `service.work`, the base computation reads `const base = issue.branch === null ? await gitDefaultBranch(mainRoot) : null;` then `const baseSha = base === null ? null : await gitMergeBase(...)` (verified block at `tk.ts:627-635`). Two robustness gaps: (a) `gitDefaultBranch` returning null is silently treated as "unpinned", but when it returns a name, `gitMergeBase(mainRoot, branch, base)` runs `git merge-base <branch> <base>` — if the default branch exists but shares no history with `tk/<id>` (orphan branches), `merge-base` exits non-zero and the `git()` helper maps that to `null`, again silently yielding "unpinned" even though a base *was* pinned conceptually; (b) `gitMergeBase` (`packages/git/src/commands.ts:41-44`) passes the raw strings into argv — fine — but callers never distinguish "no common ancestor" from "branch missing", so a typo-level environment regression is swallowed as a valid empty base rather than a warning in the recorded `changeset.base`. The recorded evidence field therefore degrades silently instead of alerting the operator.

**Fix:** Make the degenerate outcomes explicit at the call site:
```ts
const baseSha = base === null ? null : await gitMergeBase(mainRoot, branch, base);
if (base !== null && baseSha === null) note = `warning: no merge-base between ${usedBranch} and ${base}; base left unpinned`;
```
(or have `gitMergeBase` return a discriminated `{ ok, sha | reason }` outcome like `gitWorktreeAdd`/`gitCreateBranch` already do, and surface `reason` in `note`).

### WR-04: Branch creation and worktree creation are two independent mutations with no cleanup on failure

**File:** `packages/cli/src/tk.ts:618-625`
**Issue:** `service.work` creates the branch first (`gitCreateBranch(mainRoot, branch)` at `tk.ts:619-621`) and then the worktree (`gitWorktreeAdd(mainRoot, path, branch, false)` at `tk.ts:622-624`). If the worktree add fails (target path occupied, as the test suite itself exercises in `work.test.ts:86-92`, or a dirty pre-existing directory), the freshly created `tk/<id>` branch is left behind in the repo. The issue metadata is not touched (good — the transaction runs later), but the repository now contains an orphan `tk/<id>` branch pointing at HEAD; a retry after the user frees the path succeeds, but a retry where the user instead created the worktree manually with a *different* base now reuses the stale branch silently (line 617-625 re-entry path treats "branch exists" as "resume"). Divergent state accumulates with no signal.

**Fix:** Roll back the branch when the subsequent worktree add fails:
```ts
if (!createdBranch.ok) fail(`branch creation failed: ${createdBranch.stderr}`);
const added = await gitWorktreeAdd(mainRoot, placement.path, branch, false);
if (!added.ok && created) await git(runner, mainRoot, ["branch", "-D", branch]); // best-effort rollback
if (!added.ok) fail(`worktree creation failed: ${added.stderr}`);
```
(adjust to the exported command set — add `gitBranchDelete` to `packages/git/src/commands.ts` if needed — and keep the rollback best-effort so a genuine rollback failure is reported, not masked.)

### WR-05: `gitHasUnpushedCommits` reports "pushed" for any branch whose upstream is not ahead-comparable

**File:** `packages/git/src/commands.ts:74-78`
**Issue:** The function derives `upstream = rev-parse --abbrev-ref --symbolic-full-name @{u}`; on any failure — no upstream, `@{u}` ambiguous, or the ref not resolvable — `git()` returns null and the code returns `true` ("has unpushed commits"). The doc comment frames this as conservative ("treat as not safe to assume pushed"), but the inverse case is wrong in a dangerous direction: a branch whose upstream exists but is *ahead* of HEAD (e.g. someone rebased/pushed force-updates, or HEAD was reset behind) yields `rev-list upstream..HEAD` = 0, so the function reports `false` ("fully pushed") while local work may actually be diverged/lost from the user's perspective. Consumers using this to decide "safe to remove worktree" (`tk worktree remove` flow, `packages/git/src/commands.ts` consumers in `tk.ts:205-217`) would proceed on a false negative.

**Fix:** Compute both directions and require `behind === 0` as well:
```ts
const ahead = await git(runner, cwd, ["rev-list", "--count", `${upstream}..HEAD`]);
const behind = await git(runner, cwd, ["rev-list", "--count", `HEAD..${upstream}`]);
return ahead !== "0" || behind !== "0"; // any divergence means "do not assume pushed"
```
and rename/doc the function to match its true semantics ("has unpushed or diverged commits") so callers cannot misread it.

### WR-06: `worktree remove` refuses any directory that still contains untracked files, including tool-created noise, with no override

**File:** `packages/cli/src/tk.ts:205-217`
**Issue:** The remove path blocks when `gitHasUncommittedChanges` is true (verified `tk.ts:206-214` region: uncommitted-changes check gates the destructive `gitWorktreeRemove(..., force)`), which is correct for tracked work. But `git status --porcelain` also reports untracked files (`packages/git/src/commands.ts:68-71`), and untracked noise in a worktree is routinely generated by tooling (`.env`, build caches, editor state) that was never part of the task. The command offers no `--force` passthrough and no distinction between "dirty tracked work" and "untracked residue", so users must hand-delete the directory (leaving git's worktree registration stale, requiring `git worktree prune`) — the exact footgun this command exists to avoid. The phase's own doc comment for the worktree module promises removal is guarded; the guard as implemented over-blocks.

**Fix:** Split the check and add an explicit override:
```ts
const dirty = await gitHasUncommittedChanges(path);
const dirtyTracked = dirty && (await git(runner, path, ["status", "--porcelain", "--untracked-files=no"])) !== "";
if (dirtyTracked && !booleanFlag(args, "force")) fail("worktree has uncommitted changes; use --force to discard");
```
and document `--force` in the `worktree` HELP text (`tk.ts` usage block) so the contract is discoverable.

## Info

### IN-01: `gitDefaultBranch` accepts any object named `main`/`master`, including tags

**File:** `packages/git/src/commands.ts:29`
**Issue:** The fallback `rev-parse --verify --quiet <candidate>` verifies *any* resolvable object, so a tag or remote ref named `main` satisfies the existence probe and is returned as the "default branch". Downstream `git merge-base <branch> <candidate>` still resolves the tag to a commit, so the computed base is a valid SHA — but it is the tag's commit at pin time, not the integration branch tip, and the recorded `changeset.base` silently encodes the wrong intent. (Note: the `--quiet` probe does print the SHA on success, so the truthiness check in the `for` loop is correct — verified empirically with git on this machine.)

**Fix:** Probe the ref namespace specifically: `rev-parse --verify --quiet refs/heads/<candidate>` (as `gitBranchExists` at `commands.ts:54` already does).

### IN-02: Config-sourced worktree dir resolves relative paths against `repoRoot`, diverging from git's cwd-relative semantics documented for overrides

**File:** `packages/git/src/resolver.ts:38-39` vs `resolver.ts:28-30`
**Issue:** The override branch resolves relative paths against the *caller's* cwd (`resolve(expanded)` with no base = cwd-relative; verified `resolver.ts:28-30`), while the config branch resolves relative paths against `repoRoot` (line 39). The doc comment (`resolver.ts:8-13`) documents relative overrides as "resolved against the repo root" — contradicting the implementation — and says nothing about config-relative resolution. Two relative-path semantics in one pure function with one of them mis-documented is a maintenance trap: the first caller that relies on the doc will get cwd-dependent placement that varies with where `tk` was invoked.

**Fix:** Pick one semantics and align both branches. Recommended: resolve both against `repoRoot` (deterministic, cwd-independent) and correct the doc comment for overrides to match; if cwd-relative overrides are intentional, document that explicitly and add a test pinning the behavior (the existing `resolver.test.ts` only pins absolute inputs).

### IN-03: `mainWorktreeRoot` returns the parent of the common dir unconditionally, mislabeled for bare repositories

**File:** `packages/git/src/commands.ts:86-95`
**Issue:** The doc comment claims `git-common-dir` is "always `<main-root>/.git`", but in a bare repository the common dir is the repo root itself (e.g. `/srv/repo.git`), so `dirname` yields `/srv` — a directory that contains no `.tasks/` and is not a worktree root. Today every caller reaches `mainWorktreeRoot` only after commands that fail in bare repos, so the defect is latent, but the function is exported as a general adapter primitive (`packages/git/src/index.ts:4`) and the next consumer inherits the trap.

**Fix:** Guard the invariant where it is established, not at every future call site:
```ts
export function mainWorktreeRoot(commonDir: string): string {
  if (!commonDir.endsWith("/.git") && commonDir !== "/.git") {
    throw new Error(`mainWorktreeRoot expects a non-bare common dir (…/.git), got: ${commonDir}`);
  }
  return dirname(commonDir);
}
```
(or return `string | null` and let callers `fail()` with the existing "requires a git repository" message).

---

_Reviewed: 2026-10-18T15:49:59Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
