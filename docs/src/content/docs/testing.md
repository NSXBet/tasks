---
title: "Testing"
order: 6
---
# Testing Patterns

**Analysis Date:** 2026-10-17
<!-- refreshed: 2026-10-17 -->

## Test Framework

**Runner:**
- Bun's test runner (`bun test`, Bun ≥ 1.3 via `packageManager: "bun@1.3.x"` in `package.json`). There is no `bunfig.toml` and no `vitest.config.*`.
- Test imports are split: most packages import `{ describe, expect, it, afterEach }` **from `'vitest'`** (vitest ^4.0.16 is a devDependency in the root `package.json`; the API is resolved by `bun test`), while TUI tests import **from `'bun:test'`** (`packages/tui/test/app.test.tsx`, `fixture.test.tsx`). Match the existing imports of the file you extend.
- TypeScript `^5.9.3`, `bun-types` for runtime types.

**Run Commands (root `package.json`):**

```bash
bun test packages/*/test/*.test.ts          # full suite — also the CI command (.github/workflows/build-binaries.yml)
bun run test:sqlite                          # bun run --filter @tasks/sqlite test
bun run test:cli                             # bun run --filter @tasks/cli test
bun run test:tui                             # bun run --filter @tasks/tui test (adds --timeout 15000)
bun run check                                # tsc --noEmit per package, dependency order
```

**Critical quirk:** per-package test scripts are `bun run build && cd ../.. && bun test packages/<pkg>/test` — they (a) build first and (b) run with **repo root as cwd**. Adapter tests import compiled output (`import { FileAdapter } from '../dist/index.js';` in `packages/file/test/file.test.ts`), while domain/application tests import from `'../src/index.js'`. Always run package tests from the repo root.

## Test File Organization

**Location:** separate `test/` directory per package, not co-located: `packages/<pkg>/test/<unit>.test.ts`. TUI tests use `.tsx` (`packages/tui/test/app.test.tsx`).

**Inventory:** `domain/test/issue.test.ts`, `application/test/ports.test.ts`, `sqlite/test/sqlite.test.ts` (+ `claim-worker.mjs` helper), `postgres/test/postgres.test.ts`, `file/test/file.test.ts`, `workspace/test/workspace.test.ts`, `surface/test/{surface,runtime,watch,status-runs}.test.ts`, `cli/test/{tk,presentation,update,runtime-inbox,agents,hooks}.test.ts`, `tui/test/{app,fixture,image-size}.test.tsx|ts` + `smoke.ts` (pty E2E), `web/test/server.test.ts`, `beads/test/beads.test.ts`, `pi-extention/test/entry.test.ts`, `terminal-image/test/terminal-image.test.ts`.

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

**What to mock:**
- Storage client seams (pg client), clocks, ID generators — the application ports in `packages/application/src/ports/`.
- For pure schema/codec code (`packages/domain`), mock nothing — parse and assert.

**What NOT to mock:**
- The filesystem (use `mkdtemp` temp dirs).
- The CLI binary: `packages/cli/test/tk.test.ts` spawns the real executable — `Bun.spawnSync([process.execPath, join(process.cwd(), "packages/cli/src/tk.ts"), ...])` — and asserts on the JSON envelope `{ error: { kind, message } }` and stdout output. Follow this pattern for new CLI commands.
- The renderer for TUI (see below).

## TUI Testing (three tiers)

1. **Headless render tests** (`packages/tui/test/app.test.tsx`, `fixture.test.tsx`): `testRender` from `@opentui/react/test-utils` + `mockInput.pressKey()` + `await setup.waitForFrame((value) => value.includes("blocked by"), { maxPasses: 40 })`, asserting `expect(frame).toContain(...)`. `app.test.tsx` boots a real store over a temp workspace (`openTuiStore`, `attachEvidenceUow` from `@tasks/surface`); `fixture.test.tsx` uses `openFixtureStore` from `packages/tui/src/fixture.ts` as a scripted scenario. Run via `bun run test:tui` (15s timeout).
2. **Unit tests** for pure helpers: `packages/tui/test/image-size.test.ts`.
3. **Real-pty smoke** (`packages/tui/test/smoke.ts`): tmux-driven E2E — seeds an issue through the real CLI, drives the real TUI with keys, `capture-pane` assertions. See the team skill `.agents/skills/tui-testing/SKILL.md`: interactive verification happens in a Herdr pane, VHS tape runs (`run.tape`) produce print evidence saved to `.agents/tests/tui-test-<issue-id>/`. Do not mock the renderer; the frame is the product.

## Test Types

**Unit:** domain schemas/codecs (`packages/domain`), workspace config (`packages/workspace`), pure helpers.
**Contract:** application port shapes + `expectTypeOf` type-level assertions (`packages/application/test/ports.test.ts`).
**Integration:** adapters over real SQLite file / temp dir (`packages/sqlite/test/sqlite.test.ts`, `packages/file/test/file.test.ts`), including migration history and checksum-mismatch rollback (`packages/postgres/test/postgres.test.ts` against `MockClient`).
**Subprocess E2E:** CLI via `Bun.spawnSync` against the real `tk.ts` (`packages/cli/test/tk.test.ts`, 826 lines).
**E2E smoke:** TUI via tmux (`packages/tui/test/smoke.ts`).

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

*Testing analysis: 2026-10-17*
