# Phase 2: Changeset Derivation & Completion Contract - Pattern Map

**Mapped:** 2026-10-18
**Files analyzed:** 10 (3 modify git adapter, 1 new surface op file, 2 modify surface, 1 modify domain, 2 modify CLI, 1 test set)
**Analogs found:** 10 / 10 — every new/modified file has an exact, tracked analog

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/git/src/commands.ts` (modify) | adapter-command | process request-response | `packages/git/src/commands.ts` (existing command shape) | exact |
| `packages/git/src/porcelain.ts` (modify) | parser/utility | pure transform | `packages/git/src/porcelain.ts` (`parseWorktreePorcelain`) | exact |
| `packages/surface/src/operations/changeset.ts` (new) | service-operation | request-response (shell git + read metadata) | `packages/surface/src/operations/mutate.ts` | exact |
| `packages/surface/src/operations/mutate.ts` (modify — close-path freeze) | service-operation | CRUD (store transact) | its own `changeStatus` (lines 104-119) | exact |
| `packages/surface/src/surface.ts` (modify — facade wiring) | facade | wiring | its own `createSurface` wiring (lines 157-162) | exact | (02-02 scope only — 02-01 exports via `index.ts` and does not touch surface.ts) |
| `packages/domain/src/issue.ts` (modify — policy addition) | model/policy | pure | its own `StatusTransitionPolicy` (lines 87-91) | exact | (reuse-only — NO modification in this phase: issue.ts is interface-only, live-verified; finishPolicy implementing the existing interface lands in `packages/surface/src/operations/finish.ts` per 02-02 assumption 1) |
| `packages/cli/src/tk.ts` (modify — `finish` command) | controller | request-response | its own `work()` service method (lines 595-650) | exact |
| `packages/cli/src/tk.ts` (modify — dispatch + writers) | controller/dispatch | registry | `writers` set + dispatch lines 36, 1056, 1094 | exact |
| `packages/cli/src/presentation.ts` (modify — wire + render) | presentation | transform/format | `issueWire` (96-100), `formatShow` (210-232), `formatWorktreeList` (609-616) | exact |
| test set (git/surface/cli) | test | vitest | `adapter.test.ts`, `porcelain.test.ts`, `work.test.ts`, `status-runs.test.ts` | exact |

**Planner decision point (flagged up front):** tk has **two write paths** that both count as "the close path" for CHG-02 (D-05):
1. **CLI `CommandService.mutate`** — `packages/cli/src/tk.ts:411-418` (close/reopen/set-state build the patch inline and call `applyRunSideEffects` at line 418).
2. **Surface `changeStatus`** — `packages/surface/src/operations/mutate.ts:104-119` (same shape; `applyRunSideEffects` at line 117).

A freeze implemented only in the surface path leaves `tk close` (CLI path) unfrozen and vice versa. Both analogs are shown below; the planner must decide whether to cover both call sites or route one through the other.

---

## Pattern Assignments

### `packages/git/src/commands.ts` (modify — add log + numstat commands)

**Analog:** `packages/git/src/commands.ts:1-59` (its own module)

**Module contract + runner plumbing** (lines 1-17) — every command wraps exactly one git invocation through an injected `ProcessRunner`; the private `git()` helper returns `stdout` on exit 0 and **null otherwise** (probes are nullable):

```typescript
/**
 * Every git command tk runs, enumerated in one place.
 *
 * Each function wraps exactly one git invocation through a `ProcessRunner`
 * (default `bunRunner`) and returns either a parsed/derived value or a
 * structured outcome — never a raw spawn call at the call site.
 */
import { dirname } from "node:path";
import { bunRunner, type ProcessRunner } from "./runner.js";
import { parseWorktreePorcelain, type WorktreeEntry } from "./porcelain.js";

const git = async (runner: ProcessRunner, cwd: string, args: readonly string[]): Promise<string | null> => {
  const result = await runner.run(["git", ...args], cwd);
  return result.code === 0 ? result.stdout : null;
};
```

**Two return-shape conventions to copy** (lines 42-52) — read-shaped commands parse porcelain and return `[]` on null; mutating commands return a structured `GitOutcome`:

```typescript
export interface GitOutcome {
  readonly ok: boolean;
  readonly stderr: string;
}

export const gitWorktreeList = async (cwd: string, runner: ProcessRunner = bunRunner): Promise<readonly WorktreeEntry[]> => {
  const text = await git(runner, cwd, ["worktree", "list", "--porcelain"]);
  return text === null ? [] : parseWorktreePorcelain(text);
};
```

New commands follow the same signature shape: `gitLogOneline(cwd, base, branch, runner = bunRunner)` → `readonly CommitEntry[]` and `gitDiffNumstat(cwd, base, branch, runner = bunRunner)` → `readonly NumstatEntry[]`, each delegating to a new porcelain parser — mirroring `gitWorktreeList` exactly (D-01, D-13). Null stdout → `[]` (the locked empty→`[]` invariant). Note the existing 3-dot merge-base helper `gitMergeBase` (line 39-41) is available if derivation needs the effective base; D-01 pins `base..<branch>` / `base...<branch>` literals from metadata.

**Runner** (`packages/git/src/runner.ts`, full) — commands never spawn; they default the last parameter to `bunRunner` so tests inject fakes:

```typescript
export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}
// ... default implementation:
const spawned = Bun.spawn(["git", ...command], { cwd, stdout: "pipe", stderr: "pipe" });
// ... abort-wiring + Promise.all over stdout/stderr/exited, then:
return { stdout: stdout.trim(), stderr: stderr.trim(), code: exited === null ? -1 : exited };
```

**No change needed in `packages/git/src/index.ts`** — it is `export * from "./runner.js"; export * from "./commands.js"; export * from "./porcelain.js"; export * from "./resolver.js";` (full file), so new exports flow through automatically.

---

### `packages/git/src/porcelain.ts` (modify — log + numstat parsers)

**Analog:** `packages/git/src/porcelain.ts` (full file, 25 lines) — the locked invariants are the module docstring, the readonly-entry interface, record flushing per blank line, and empty input → `[]`:

```typescript
/** Parsing of git's machine-readable (`--porcelain`) output. Pure text in, entries out. */

export interface WorktreeEntry {
  readonly path: string;
  readonly branch: string | null;
  readonly bare: boolean;
  readonly locked: boolean;
}

/** Parses `git worktree list --porcelain`; the main worktree is always first. */
export function parseWorktreePorcelain(text: string): readonly WorktreeEntry[] {
  const entries: Worktree[] = [];        // (accumulator elided in original read; flush per record)
  let path = "", branch: string | null = null;
  let bare = false, locked = false;
  for (const line of text.split("\n")) {
    if (line === "") { flush(); continue; }
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line.startsWith("branch ")) branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    else if (line === "bare") bare = true;
    else if (line.startsWith("locked")) locked = true;
  }
  flush();
  return entries;
}
```

Copy for `parseLogOneline` (one `sha subject` record per line → `commits[{sha, subject}]`) and `parseNumstat` (`added\tdeleted\tpath` plus `--name-status`-style status, per D-02's `files[{path, status}]` + `counts{additions, deletions}`): same header docstring, same readonly entry interfaces, `""`/whitespace-only input returns `[]` (porcelain.test.ts:24-27 pins this contract — see test analog).

---

### `packages/surface/src/operations/changeset.ts` (new — derivation + finish operations)

**Analog:** `packages/surface/src/operations/mutate.ts` (operation-file pattern)

**Operation file header + helpers** (lines 2-6, verbatim imports) — operations take `SurfaceStore`, use `getOrThrow`, throw `MessageError`, and import cross-package helpers from `@tasks/application`:

```typescript
import { issuePriority, issueTitle, issueDescription, issueId, dependencyTarget, isBlobAttachment, IssueAttachmentSchema } from '@tasks/domain';
import { activeRun, applyRunSideEffects, err, nextRunId, ok, type IssueUnitOfWork, type Result } from '@tasks/application';
import type { SurfaceStore } from '../store.js';
import { getOrThrow } from '../store.js';
import { MessageError } from '../errors.js';

const now = (): Date => new Date();
const changed = (issue: Issue, patch: Partial<Issue>): Issue => ({ ...issue, ...patch, updatedAt: now() });
```

**The status-transition operation** (lines 104-119, verbatim) — the direct analog for `finishIssue`: `transact` → `getOrThrow` → `changed()` → save (unwrap-or-throw `MessageError`) → `applyRunSideEffects` (this is what makes `ready-to-review` finalize the active run — the behavior finish must keep, per plan §5 and `packages/surface/test/status-runs.test.ts:67`):

```typescript
/** close/reopen/set-state: sets status plus startedAt/closedAt side effects. */
export const changeStatus = (store: SurfaceStore, id: string, change: StatusChange) => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, id);
  const status = change.status;
  let next = changed(issue, {
    status,
    closedAt: status === 'closed' ? now() : null,
    startedAt: status === 'in_progress' ? issue.startedAt ?? now() : issue.startedAt,
  });
  if (change.reason !== undefined && change.reason !== '') {
    next = { ...next, notes: [issue.notes, change.reason].filter(Boolean).join('\n') };
  }
  const saved = await uow.save(next);
  if (!saved.ok) throw new MessageError('save failed');
  await applyRunSideEffects(uow, next, issue.status, status, now());
  return next;
});
```

**`getOrThrow`** (`packages/surface/src/store.ts:84-88`) — the CLI-identical not-found message every operation starts with:

```typescript
export const getOrThrow = async (uow: IssueUnitOfWork, raw: string): Promise<Issue> => {
  const found = await uow.findById(issueId(raw));
  const issue = found.ok ? found.value : null;
  if (!issue) throw new MessageError(`issue not found: ${raw}`);
```

**`SurfaceStore` shape** (`packages/surface/src/store.ts:19-33`) — note `transact` returns a `Result`, and `MessageError` inside maps to a classified `SurfaceError`:

```typescript
export interface SurfaceStore {
  readonly root: string;
  readonly tasksDir: string;
  /** Issue-id prefix from workspace config (default `tk`). */
  ...
  readonly adapter: StorageAdapter;
  /** One transaction around surface work; MessageError inside maps to classified SurfaceError. */
  transact<T>(work: (uow: IssueUnitOfWork) => Promise<T>): Promise<Result<T, SurfaceError>>;
  close(): Promise<void>;
}
```

**Derivation read pattern:** unlike mutations, derivation (D-01/D-03) shells git through `@tasks/git` with the issue's worktree path as cwd and needs no store transaction for the read itself — the closest analog is how `tk.ts` calls `gitWorktreeList(mainRoot)` (line 611) outside any transaction. Freeze/finish are the write halves and use the full `transact` + `changed()` pattern above.

**Metadata write shape (the freeze):** copy Phase 1's exactly-once-pinned-base write in `tk.ts:644-646` — additive sibling keys inside the existing `metadata["changeset"]` JsonValue object (D-04/D-06):

```typescript
const recordedBase = typeof changeset["base"] === "string" && changeset["base"] !== "" ? changeset["base"] : null;
unwrap(await uow.save(changed(current, { branch: usedBranch, metadata: { ...current.metadata, worktree: path, changeset } })));
```

---

### `packages/surface/src/surface.ts` (modify — facade wiring)

**Analog:** its own wiring block (lines 157-162 of 214) — one line per operation, delegating to the operation file:

```typescript
    update: (id, patch) => updateIssue(store, id, patch),
    status: (id, change) => changeStatus(store, id, change),
    defer: (id, until) => deferIssue(store, id, until),
    undefer: (id) => undeferIssue(store, id),
    archive: (id) => archiveIssue(store, id),
```

Add `finish`/`changeset` (names per planner) the same way; `TasksSurface` is the typed interface the CLI and pi/omp extension both consume (module docstring: "The typed Tasks surface: one factory consumed by the tk CLI and the pi/omp..."). New members go on the interface + the returned object literal.

---

### `packages/domain/src/issue.ts` (modify — finish denial policy)

**Analog:** `packages/domain/src/issue.ts:87-91` — the policy seam finish uses (D-09); closed/done denial is an addition at this seam, in the pure domain package (no I/O):

```typescript
/** Adapter/config supplies lifecycle vocabulary and timestamp effects. */
export interface StatusTransitionPolicy { transition(issue: Pick<Issue, 'status' | 'startedAt' | 'closedAt'>, transition: StatusTransition): StatusTransitionResult; }
export function transitionStatus(policy: StatusTransitionPolicy, issue: Pick<Issue, 'status' | 'startedAt' | 'closedAt'>, transition: StatusTransition): StatusTransitionResult { return policy.transition(issue, transition); }
```

Statuses are open-vocabulary strings (`IssueStatusSchema = vocabulary('issue status')`, line 17-18); the CLI's lifecycle list (`KNOWN_STATUSES`, tk.ts:84) includes `ready-to-review`. `Issue` carries `branch` (tk.ts:555 uses `issue.branch !== null`), so "no branch record → refuse" (D-10) checks `issue.branch` / `metadata["worktree"]`.

---

### `packages/cli/src/tk.ts` (modify — `finish` command)

**Analog:** `tk.ts` `CommandService.work()` (lines 595-650) — the Phase 1 command that already records changeset evidence; `finish` copies this shape (id parse → fail() → git reads → metadata write → `{ value, human }` return):

```typescript
  /**
   * `tk work <id>` — create or re-enter the task's worktree on branch `tk/<id>`
   * and record the PR container evidence on the issue: branch, worktree path,
   * and the base SHA pinned once at creation. Every recorded value comes from
   * an actual git operation's output — never caller- or agent-supplied lists.
   */
  async work(args: ParsedArgs): Promise<{ readonly value: Record<string, unknown>; readonly human: (() => string) | null }> {
    const raw = args.positionals[1] ?? fail("work requires an issue id");
    if (raw.trim() === "") fail("work requires a non-empty issue id");
    const commonDir = await gitCommonDir(this.root);
    ...
    const override = typeof issue.metadata["worktree_dir"] === "string" ? (issue.metadata["worktree_dir"] as string) : null;
    const branch = `tk/${issue.id}`;
    ...
      const outcome = await gitWorktreeAdd(mainRoot, placement.path, branch, false);
      if (!outcome.ok) fail(outcome.stderr || `failed to create worktree at ${placement.path}`);
    ...
    return { value: { id: updated.id, path, branch: usedBranch, base: updated.recordedBase, created }, human: () => green(`✓ worktree ready at ${cyan(path)} (branch ${usedBranch})`) + (created ? "" : dim(" (existing)")) + (note !== "" ? dim(` — ${note}`) : "") };
  }
```

Git imports come from `@tasks/git` (line 11: `gitBranchExists, gitCommonDir, gitCreateBranch, gitCurrentBranch, gitDefaultBranch, gitHasUncommittedChanges, gitHasUnpushedCommits, gitMergeBase, gitStashCount, gitToplevel, gitWorktreeAdd, gitWorktreeList, gitWorktreeRemove, mainWorktreeRoot, resolveWorktreePath`) — add the new derivation commands to this import list.

**Dispatch + writers + readonly gate** (the three registration seams `finish` must touch):

Line 36 — writers set (D-12 adds `finish` **and** repays CR-01 by adding `work`):

```typescript
const writers = new Set(["init", "create", "q", "update", "close", "reopen", "defer", "undefer", "comment", "note", "assign", "priority", "tag", "dep", "label", "set-state", "import", "migrate", "delete", "remove", "rename", "link", "duplicate", "supersede", "todo", "backup", "rename-prefix", "switch-backend", "hooks", "attach", "detach", "sprint", "agent", "run", "archive", "unarchive"]);
```

Line 1056 — gate (automatic once `finish` is in the set):

```typescript
const config = await readWorkspaceConfig(tasksDir); if (booleanFlag(args, "readonly") && writers.has(command)) fail("readonly mode blocks writes");
```

Line 1094 — dispatch (insert next to `work`):

```typescript
else if (command === "work") { const result = await service.work(args); value = result.value; human = result.human; }
```

**The CLI close path** (lines 411-418) — the second "close path" analog for the CHG-02 freeze decision (see Planner decision point above). Note it already fires `applyRunSideEffects` on any status change, inline in `CommandService.mutate`:

```typescript
if (["close", "reopen", "set-state"].includes(command)) { const status = command === "close" ? "closed" : command === "reopen" ? "open" : args.positionals[2] ?? fail("set-state requires state"); patch = { status, closedAt: status === "closed" ? new Date() : null, startedAt: status === "in_progress" ? issue.startedAt ?? new Date() : issue.startedAt }; ... }
...
const result = changed(issue, patch); unwrap(await uow.save(result)); if (patch.status !== undefined && patch.status !== issue.status) await applyRunSideEffects(uow, result, issue.status, result.status, new Date()); return result; });
```

**Session flag/env (D-08):** flags are read via `stringFlag(args, "session")` / `booleanFlag(...)` (lines 10, 417); env fallback is `process.env["TK_SESSION"]` in the same style as the actor identity (`stringFlag(args, "actor") ?? process.env["USER"] ?? "unknown"`, line 1085).

---

### `packages/cli/src/presentation.ts` (modify — wire shape + show/finish rendering)

**Analog 1 — wire shape** (`presentation.ts:96-100`): `issueWire` already emits the changeset object; extend it with `commits`/`files`/`counts` keys when derived (and render the frozen snapshot verbatim for closed issues, D-06):

```typescript
    notes: issue.notes, design: issue.design, acceptance_criteria: issue.acceptanceCriteria, estimated_minutes: issue.estimate,
    spec_id: issue.specId, external_ref: issue.externalRef, branch: issue.branch,
    worktree: typeof issue.metadata["worktree"] === "string" ? issue.metadata["worktree"] : null,
    changeset: { base: wireChangesetBase(issue.metadata) },
    metadata: issue.metadata,
```

**Analog 2 — show renderer** (`formatShow`, lines 210-232): `tk show` gains COMMITS and FILES sections after WORKTREE/BASE, same colored-header + aligned-lines body style:

```typescript
const formatShow = (issue: Issue, images = []): string => {
  ...
  if (issue.branch !== null) parts.push(`${bold("WORKTREE:")}\n  ${cyan(issue.branch)}\n  ...`);
  if (issue.metadata["worktree"]) ...
  ...parts.push(`${bold("CHANGES:")}`); ...
  ...
  return parts.join("\n\n");
};
```

**Analog 3 — list-section renderer for counts** (`formatWorktreeList`, lines 609-616) — the tabular two-column style the COMMITS/FILES sections should imitate; finish output (`commits · +add −del · files`, per plan §product) is a one-line variant of this:

```typescript
const formatWorktreeList = (issues, entries): string => {
  ...
  lines.push(`  ${pad(issue.id, 10)} ${pad(entry?.branch ?? "—", 24)} ${pad(rel(entry?.path ?? ""), 34)} ${status}`); ...
  ...
};
```

---

### Test set (extend/new)

**Analog 1 — adapter unit test with fake runner** (`packages/git/test/adapter.test.ts:16-24` + assertions at 30-36): the fake runner keys responses on the joined command string and records every argv — copy for the new log/numstat commands (assert every command starts with `git`):

```typescript
function fakeRunner(responses: Readonly<Record<string, string>>): ProcessRunner & { commands: string[][] } {
  const commands: string[][] = [];
  return {
    commands,
    async run(command: readonly string[]) {
      commands.push([...command]);
      const key = command.join(" ");
      return { stdout: (responses[key] ?? "").trim(), stderr: "", code: key in responses ? 0 : 1 };
    },
  };
}
// assertions:
expect(await gitCurrentBranch("/repo", runner)).toBe("main");
expect(await gitWorktreeList("/repo", runner)).toMatchObject([{ branch: "main" }]);
expect(runner.commands.every((command) => command[0] === "git")).toBe(true);
```

Same file also pins the non-zero-exit doctrine the new commands must respect (adapter.test.ts:39-56): documented-nullable probes return null on failure; outcome-carrying commands return `{ ok: false, stderr }` verbatim — "no command function converts non-zero into a success-shaped default."

**Analog 2 — parser test** (`packages/git/test/porcelain.test.ts:4-42`): fixed porcelain text joined from an array, exact `toEqual` on parsed records, plus the locked degenerate cases — "returns `[]` for empty and whitespace-only input — always an array, never undefined, never throws" (lines 24-27) and "keeps two adjacent identical entries as two distinct records (1:1, no dedupe, no merge)" (lines 30-42). Copy verbatim for `parseLogOneline`/`parseNumstat`.

**Analog 3 — CLI command integration test** (`packages/cli/test/work.test.ts:1-27`): spawns the real `tk.ts` entrypoint against a temp git repo workspace; `json()` helper asserts exit 0 and parses `--json` output; `git()` helper shells real git for fixtures; `repoWorkspace()` builds repo + init + one issue:

```typescript
const executable = join(process.cwd(), "packages/cli/src/tk.ts");
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-work-")); dirs.push(value); return value; }
function run(directory: string, args: readonly string[], input?: string): { readonly stdout: string; readonly stderr: string; readonly status: number } { const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], ...); return ...; }
function json<T>(directory: string, args: readonly string[], input?: string): T { const result = run(directory, [...args, "--json"], input); expect(result.status, result.stderr).toBe(0); return JSON.parse(result.stdout) as T; }
function repoWorkspace(branch = "main"): { readonly repo: string; readonly id: string } {
  const repo = realpathSync(workspace()); // macOS /var → /private/var symlink
  git(repo, "init", "-q", "-b", branch);
  git(repo, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "init");
  json(repo, ["init", "--prefix", "tk"]);
  const issue = json<{ id: string }>(repo, ["create", "ship the thing"]);
  return { repo, id: issue.id };
}
```

A `finish.test.ts` (new, same harness) covers FIN-01 end-to-end: work → finish → `show --json` shows `ready-to-review` + session + counts; re-finish idempotent (D-11); no-branch refuse (D-10); closed/done denial (D-09); freeze-after-close with removed worktree (CHG-02 criterion 4). Note the existing show assertions format (work.test.ts:29-36): JSON shape via `shown["changeset"]["base"]`, human output via `stdout.toContain("BASE:")`.

**Analog 4 — surface-level status/run test** (`packages/surface/test/status-runs.test.ts:67-81`): finish's "ready-to-review finalizes the run" is already pinned here via `surface.status(...)` — the finish operation must preserve this behavior; the test shows the surface-level harness (`createSurface({ root })`, `runsOf` helper) to copy for a `changeset.test.ts`:

```typescript
it("finalizes the active run when moving to ready-to-review, rejected and archived", async () => {
  const root = workspace();
  const surface = await createSurface({ root });
  const reviewId = await start("review me");
  const review = await surface.status(reviewId, { status: "ready-to-review" });
  expect(review.ok).toBe(true);
  const reviewRuns = await runsOf(surface, reviewId);
  expect((reviewRuns ?? []).map((value) => ({ state: value.state, closedAt: value.closedAt !== null })))
    .toEqual([{ state: "in_review", closedAt: true }]);
```

---

## Shared Patterns

### ProcessRunner injection
**Source:** `packages/git/src/runner.ts` (module docstring) + `commands.ts:9-17`
**Apply to:** all new adapter commands
```typescript
/** Injected so command dispatch stays testable without a real git binary. */
// commands take `runner: ProcessRunner = bunRunner` as the LAST parameter
```

### Nullable probes vs structured outcomes
**Source:** `packages/git/src/commands.ts:9-13, 42-52`; doctrine pinned by `packages/git/test/adapter.test.ts:39-56`
**Apply to:** all new adapter commands — derivation reads parse `stdout` (null → `[]`); any new outcome-carrying command returns `{ ok, stderr }`; NEVER a success-shaped default on non-zero.

### Porcelain 1:1 parsing
**Source:** `packages/git/src/porcelain.ts`; locked by `packages/git/test/porcelain.test.ts:24-42`
**Apply to:** `parseLogOneline`, `parseNumstat` — one record per entry, no merging/dedup, empty/whitespace → `[]`, never throws.

### Surface operation shape
**Source:** `packages/surface/src/operations/mutate.ts:2-6, 104-119`
**Apply to:** new derivation/finish operations — `store.transact` + `getOrThrow` + `changed()` + `MessageError` + `applyRunSideEffects` on status change; metadata writes are additive `{ ...current.metadata, changeset }`.

### Metadata as JsonValue (no migrations)
**Source:** `packages/cli/src/tk.ts:644-646` (Phase 1 base pin)
**Apply to:** CHG-02 freeze — siblings written into `metadata["changeset"]`; narrow with `typeof x === "string"` guards as `wireChangesetBase` does (presentation.ts:99).

### CLI service-method + {value, human} pair
**Source:** `packages/cli/src/tk.ts:595-650` (`work`), dispatch at 1094, gate at 1056, writers at 36
**Apply to:** `finish` — service method returning `{ value, human }`, `fail()` for all refusals (D-08/D-10), writers set + help text (line 755 area) updated together.

### Domain purity
**Source:** `packages/domain/src/issue.ts:87-91` (`StatusTransitionPolicy`)
**Apply to:** finish's closed/done denial (D-09) lands at the domain policy seam; no I/O, no adapter imports in domain.

### Test placement + commands
**Source:** `.planning/codebase/CONVENTIONS.md` (build & verification)
**Apply to:** tests colocated `packages/*/test/*.test.ts`, vitest, `bun test packages/*/test/*.test.ts`, `bun run check`; adapter tests import `../src/index.js`.

## No Analog Found

None — every file in scope has an exact tracked analog (verified via `git ls-files`; all listed paths are tracked source, not mirrors).

**Open surface-shape questions the planner owns** (patterns exist for both sides; CONTEXT does not pick):
1. Close-path call site for the freeze — CLI `CommandService.mutate` (tk.ts:411-418) vs surface `changeStatus` (mutate.ts:104-119) vs both.
2. Whether `finish` lives as a CLI service method (like `work`) that reuses the new surface changeset operations, or dispatches through the surface facade; CONTEXT's code_context says "new derivation/finish operations follow the existing operation-file pattern" (surface), while the command-shape analog (`work`) is a CLI service method — the composition (CLI method delegating to surface ops) matches both patterns.

## Metadata

**Analog search scope:** `packages/git/src`, `packages/git/test`, `packages/surface/src`, `packages/surface/test`, `packages/cli/src`, `packages/cli/test`, `packages/domain/src`
**Files scanned:** ~30 (reads: git commands/runner/porcelain/index + 4 test files; surface store/surface.ts/git.ts/mutate/query; tk.ts greps at 36/84/410-418/595-650/1056/1094/1143; presentation.ts 96-100/210-232/609-616; domain issue.ts 17-18/87-91; status-runs.test.ts 50-90)
**Pattern extraction date:** 2026-10-18
