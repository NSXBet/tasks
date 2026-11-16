---
title: "Testing"
order: 6
---
# Testing Patterns

**Analysis Date:** 2026-11-12

## Test Framework

**Runner:**
- Bun's test runner (`bun test`, Bun ≥ 1.3 via `packageManager: "bun@1.3.x"` in `package.json`). There is no `bunfig.toml` and no `vitest.config.*`.
- Test imports are split: most packages import `{ describe, expect, it, afterEach }` **from `'vitest'`** (vitest ^4.0.16 is a devDependency in the root `package.json`; the API is resolved by `bun test`), while TUI tests (and `packages/web/test/review.test.ts`) import **from `'bun:test'`** (`packages/tui/test/app.test.tsx`, `taskview.test.tsx`). Match the existing imports of the file you extend.
- TypeScript `^5.9.3`, `bun-types` for runtime types.

**Run Commands (root `package.json`):**

```bash
bun test packages/*/test/*.test.ts          # full suite — the CI command (.github/workflows/build-binaries.yml)
bun run test                                 # root script: bun test --timeout 15000 (every *.test.* under the repo)
bun run test:sqlite                          # bun run --filter @tasks/sqlite test
bun run test:cli                             # bun run --filter @tasks/cli test
bun run test:tui                             # bun run --filter @tasks/tui test (adds --timeout 15000)
bun run check                                # tsc --noEmit per package, dependency order
```

**Critical quirk:** per-package test scripts are `bun run build && cd ../.. && bun test packages/<pkg>/test` — they (a) build first and (b) run with **repo root as cwd**. Adapter tests import compiled output (`import { FileAdapter } from '../dist/index.js';` in `packages/file/test/file.test.ts`), while domain/application tests import from `'../src/index.js'`. Always run package tests from the repo root.

## Test File Organization

**Location:** separate `test/` directory per package, not co-located: `packages/<pkg>/test/<unit>.test.ts`. TUI tests use `.tsx` (`packages/tui/test/app.test.tsx`).

**Inventory:** `domain/test/{issue,review-record,changes-card,pr-record}.test.ts`, `application/test/ports.test.ts`, `sqlite/test/sqlite.test.ts` (+ `claim-worker.mjs` helper), `postgres/test/postgres.test.ts`, `file/test/file.test.ts`, `workspace/test/workspace.test.ts`, `git/test/{adapter,changeset,concurrency,hooks,porcelain,prune,resolver,runner,sync}.test.ts`, `surface/test/{surface,runtime,watch,status-runs,sessions,finish,changeset,changeset-freeze,changes,commit,pr,prune,review-comments,leases,events-derive,events-log,events-read}.test.ts`, `cli/test/{tk,presentation,update,runtime-inbox,agents,hooks,work,finish,changes,comments,pr,watch,events,doors,show-changeset,review-record-verify,onboard,contract,daemon,leases}.test.ts` (+ `fixtures/gh`), `daemon/test/daemon.test.ts`, `review/test/{headless-smoke,review-comment-store,show-review}.test.ts` (+ `helpers/`), `tui/test/{app,boot,image-size,events,routes,frozen-source,review,review-edit,review-selection,taskview}.test.tsx|ts` (+ shared `fixtures.ts`, `wait.ts`) + `smoke.ts` / `review-smoke.ts` / `taskview-smoke.ts` (pty E2E), `web/test/{server,taskview,review,live,events,edit-loop}.test.ts`, `beads/test/beads.test.ts`, `pi-extention/test/{entry,inbox}.test.ts`, `terminal-image/test/terminal-image.test.ts`; `packages/lua` runs its own lune suite (`bun run --filter @tasks/lua test`).

## Test Structure

**Suite organization** (`packages/domain/test/issue.test.ts`, `packages/workspace/test/workspace.test.ts`):

```typescript
import { afterEach, describe, expect, it } from 'vitest';

describe('@tasks/workspace config', () => {
  it('reads a missing config.json as empty rather than failing', async () => {
    const dir = tasksDir();
    expect(await readWorkspaceConfig(dir)).toEqual({});
  });
});
```

- `describe` labels read like scope names: `'tk-compatible issue domain'`, `'application contracts'`, `'@tasks/workspace config'`.
- `it()` bodies are dense one-liners or short blocks with several expects; each `it` starts with a behavior statement ("round-trips prefix and storage through config.json", "rejects an unknown backend rather than silently ignoring it").
- TUI tests use `test()` instead of `it()` and wrap rendering in `try { ... } finally { ... }` cleanup.

## Fixtures and Factories

**Temp workspace helper — the standard setup/teardown pattern** (`packages/surface/test/surface.test.ts`, `packages/cli/test/tk.test.ts`, `packages/workspace/test/workspace.test.ts`):

```typescript
const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-surface-")); workspaces.push(value); return value; }
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });
```

Real filesystem in temp dirs — never mock `fs`.

**Domain fixture factory** (`packages/sqlite/test/sqlite.test.ts`, `packages/file/test/file.test.ts`):

```typescript
const createdAt = new Date('2025-01-01T00:00:00.000Z');
function issue(id: string, patch: Partial<Issue> = {}): Issue {
  return IssueSchema.parse({ id: issueId(id), title: 'Task', /* ...full base... */ ...patch });
}
```

Full-valid base object + `Partial<Issue>` patch, parsed through the real Zod schema. Copy this for new fixtures.

**Injected clock:** adapters take `now: () => at` so timestamps are deterministic (`new FileAdapter({ dir, now: () => now })`, `packages/file/test/file.test.ts`).

## Mocking

**Framework:** hand-rolled fakes only — no `jest.mock`, no `sinon`, no mocking library.

**Hand-written client fake** (`packages/postgres/test/postgres.test.ts`):

```typescript
class MockClient { calls: Call[] = []; queue: Reply[] = []; /* records queries, scripts replies */ }
// passed in as: new PostgresAdapter({ client: client as never, now: () => at })
```

- Record calls, queue canned replies, assert on captured SQL (`expect(text(client)).toContain('FROM public.schema_migrations')`).

**Fake gh** (`packages/cli/test/fixtures/gh`, used by `packages/cli/test/pr.test.ts` and `finish.test.ts`): a POSIX `sh` script that stands in for the GitHub CLI so `tk pr` tests never reach GitHub.

- Copy it to a temp `bin/gh` (mode 0755) and put that directory first on `PATH`; blank `TK_GH`, `GH_TOKEN` and `GITHUB_TOKEN` in the child env so the real gh and real credentials are never used.
- `FAKE_GH_LOG=<file>` appends each argv line (`pr view 7 --json number,url,state`, `pr merge 7 --squash`, …) — assert on the exact gh calls, or that a read-only command adds no line.
- `FAKE_GH_DIR=<dir>` holds the PR state (`<dir>/state`: `OPEN` / `CLOSED` / `MERGED`, written by `pr create|close|merge`); write it directly to simulate a remote change. `<dir>/existing` makes `pr list` report an open PR #7 (adoption). `FAKE_GH_FAIL=1` exits 4 with `gh: authentication required`.
- `origin` is a temp bare repo (`git init --bare`), so `tk pr create`'s push is real but offline; `git ls-remote origin <branch>` proves close/merge kept the branch.
- Unit tests of `gh.ts` / `operations/pr.ts` (`packages/surface/test/pr.test.ts`) skip the binary and pass a fake `ProcessRunner` that records argv.

**What to mock:**
- Storage client seams (pg client), clocks, ID generators — the application ports in `packages/application/src/ports/`.
- For pure schema/codec code (`packages/domain`), mock nothing — parse and assert.

**What NOT to mock:**
- The filesystem (use `mkdtemp` temp dirs).
- The CLI binary: `packages/cli/test/tk.test.ts` spawns the real executable — `Bun.spawnSync([process.execPath, join(process.cwd(), "packages/cli/src/tk.ts"), ...])` — and asserts on the JSON envelope `{ error: { kind, message } }` and stdout output. Follow this pattern for new CLI commands.
- The renderer for TUI (see below).

## TUI Testing (three tiers)

1. **Headless render tests** (`packages/tui/test/app.test.tsx`, `boot.test.tsx`, `taskview.test.tsx`, `review.test.tsx`): `testRender` from `@opentui/react/test-utils` + `mockInput.pressKey()` + `await setup.waitForFrame((value) => value.includes("blocked by"), { maxPasses: 40 })`, asserting `expect(frame).toContain(...)`. Tests boot a real store over a temp workspace (`openTuiStore`, `attachEvidenceUow` from `@tasks/surface`); there is no fixture board — the review and task-view tests seed scratch git repos (shared helpers in `packages/tui/test/fixtures.ts`). Run via `bun run test:tui` (15s timeout).
2. **Unit tests** for pure helpers: `packages/tui/test/image-size.test.ts`.
3. **Real-pty smoke** (`packages/tui/test/smoke.ts`): tmux-driven E2E — seeds an issue through the real CLI, drives the real TUI with keys, `capture-pane` assertions. See the team skill `.agents/skills/tui-testing/SKILL.md`: interactive verification happens in a Herdr pane, VHS tape runs (`run.tape`) produce print evidence saved to `.agents/tests/tui-test-<issue-id>/`. Do not mock the renderer; the frame is the product.

   **Review probe** (`bun packages/tui/test/review-smoke.ts`): the same tmux harness over a scratch git repo. It runs `tk init` / `tk create` / `tk work`, then drives the real `tk review <id>` end to end. It checks that the view opens over the tk-derived diff and shows the `watching worktree — re-derives as commits land ●` line, that a commit from a second process re-renders it with no key, that `/ live ↵` file search selects the new `src/live.ts`, that `,` navigates back to the first changed file, and that `2` / `1` switch the diff to split and back to unified in place (the frame keeps `tk/<id>` and never shows the list view). A `]` `e` inline edit saved with `ctrl+s` must land in the worktree file. It then writes a `c` comment that a fresh `tk show <id>` lists under `REVIEW (1)`, checks that a branchless task shows `no branch yet — run tk work`, and quits that last session with a plain `q` (9 checks). It needs `tmux` and `git`, uses its own tmux socket and a per-pid session name, and removes both the tmux server and the scratch repo on every exit path. It is not a `*.test.*` file, so `bun test` never collects it.

   **Task-view probe** (`bun packages/tui/test/taskview-smoke.ts`): the same harness over a scratch repo with `tk work` and one uncommitted worktree edit. It launches the real TUI binary (`packages/tui/src/main.tsx <scratch>`) at 140×40, presses `5`, and checks that the task view leads with `◧ v open diff` and `ARTIFACTS`, that the rail shows `SESSIONS │ CHANGES │ WORKSPC │ MINIMAP` with an `a.ts` row carrying the needs-review `●`, that `Tab` switches the panel (WORKSPC shows `host`), and that after `tmux resize-window -x 90` the `[ worktree … ]` chip stays while the rail is gone, then (back at 140 columns, with a PNG attached as evidence) that `Enter` on the CHANGES `a.ts` row opens the diff modal (`f ⤢ full view`) over the task, that `f` expands to the full diff view (stats line `· +1 −1`), and that `]` walks past the last file into EVIDENCE, where the `▣ evidence:` caption row renders. Back in the task view, `J` + `o` on the evidence artifact opens the artifact view in `EVIDENCE` mode with its `▣ evidence:` row, `Escape` returns to the task view, `j` + `o` on the CHANGES `a.ts` row opens a `CODE` file view with numbered lines (`1 │ export const a = 2…`), and a `c` line comment typed there is read back off the record by a spawned `tk show <id>`. Finally two more working tasks are created and the pane resized to 160 columns: the left `TASKS` column lists all three, `]` switches the task view to the next row and `[` back, and a `]]` burst sent in one `send-keys` write moves two rows (12 checks; prints `N passed, M failed`, exits non-zero on any failure).

## Headless review smoke

Proves the review component opens a tk-derived diff of any repo from plain node, with no TTY. The patch always comes from `gitDiffPatch` in `@tasks/git`; the review package never spawns git. `@tasks/review/headless` (`packages/review/src/headless.ts`) is the git-free, OpenTUI-free, store-free entry: `changesetFromPatch`, `createHunkDiffFilesFromPatch`, `countHunkDiffStats`.

```bash
# in-process + bundled-for-node smoke over a scratch repo
bun test packages/review/test/headless-smoke.test.ts

# against any repo: prints {repoRoot, base, head, files:[{path, additions, deletions}], additions, deletions}
bun run --filter @tasks/git build   # node resolves @tasks/git to dist
bun build packages/review/scripts/headless-smoke.ts --target=node --outfile /tmp/smoke.mjs
node /tmp/smoke.mjs <repo> [--base <rev>] [--head <rev>]
```

Without `--head` the working tree is diffed (uncommitted work counts); without `--base` the base is the merge-base with the default branch, else `HEAD`.

## Test Types

**Unit:** domain schemas/codecs (`packages/domain`), workspace config (`packages/workspace`), pure helpers.
**Contract:** application port shapes + `expectTypeOf` type-level assertions (`packages/application/test/ports.test.ts`).
**Integration:** adapters over real SQLite file / temp dir (`packages/sqlite/test/sqlite.test.ts`, `packages/file/test/file.test.ts`), including migration history and checksum-mismatch rollback (`packages/postgres/test/postgres.test.ts` against `MockClient`).
**Subprocess E2E:** CLI via `Bun.spawnSync` against the real `tk.ts` (`packages/cli/test/tk.test.ts`, and the task → review suites `work`, `finish`, `changes`, `comments`, `pr`, `watch` over scratch git repos).
**Contract drift guard:** `packages/cli/test/contract.test.ts` checks the workflow contract across `tk onboard`, `tk prime` and every SKILL.md copy (see [Agent injection](#agent-injection--the-workflow-contract)).
**E2E smoke:** TUI via tmux (`packages/tui/test/smoke.ts`).

### Tests that spawn `tk watch` or tail the log

`packages/cli/test/watch.test.ts` and `packages/pi-extention/test/inbox.test.ts` run real waits on `fs.watch` and the OS clock, so no fake timer applies. Rules:

- One temp workspace per test (`mkdtemp` + `tk init`), removed in `afterEach`. Never write to the repo's own `.tasks/`.
- Pass every spawned child an explicit env without `TK_SESSION`, `PI_SESSION_ID` and `TK_EVENTS`. The default watch subscriber derives from `TK_SESSION`, and the event envelope's `session` (which the pi inbox uses to drop its own writes) comes from it too. Set it explicitly per actor when a test needs one (e.g. `TK_SESSION=s-review`).
- Give every `--until` a short `--timeout`, and every in-process wait (`tasks_wait`) a short `timeoutMs`.
- Kill spawned watchers in `afterEach` (`SIGKILL`); in-process tails (the pi inbox, `tasks_watch_start`) are stopped by firing `session_shutdown`.
- Wait with polling helpers and explicit deadlines (5 s), not fixed sleeps, when asserting that something arrives; a fixed short sleep is fine when asserting that nothing does.

## Assertion Patterns

**Result envelopes** (`packages/application/test/ports.test.ts`):

```typescript
const failure: Result<number> = err({ kind: 'not_found', resource: 'issue', id: 'tk-5au' });
expect(failure).toEqual({ ok: false, error: { kind: 'not_found', resource: 'issue', id: 'tk-5au' } });
```

**Schema rejection (forward-compat guards):**

```typescript
expect(IssueSchema.safeParse({ ...wire.run, startedAt: new Date('2024-12-31') }).success).toBe(false);
expect(() => runId('018f0e40-...')).toThrow();
await expect(readWorkspaceConfig(dir)).rejects.toThrow();
```

**Async:** plain `async/await` on promise-based APIs; no fake timers observed.

## Coverage

**Requirements:** none enforced; no coverage tooling configured.

---

*Testing analysis: 2026-11-12*
