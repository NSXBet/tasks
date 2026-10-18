---
last_mapped_commit: fac7670c14c0ab1eb2bde4342d36fbbffc44167b
last_mapped_at: 2026-10-17
---
# Coding Conventions

**Analysis Date:** 2026-10-17
<!-- refreshed: 2026-10-17 -->

## Naming Patterns

**Files:**
- kebab-case for multi-word files: `packages/application/src/ports/issue-repository.ts`, `packages/application/src/run-side-effects.ts`, `packages/application/src/use-cases/issue-use-cases.ts`, `packages/application/src/ports/composition-root.ts`
- Single-concept files named by the concept: `packages/domain/src/issue.ts`, `packages/application/src/result.ts`, `packages/surface/src/errors.ts`
- CLI/TUI view files are short lowercase nouns: `packages/tui/src/app/detail.tsx`, `list.tsx`, `kanban.tsx`, `statusbar.tsx`
- Test files mirror the unit under test inside a per-package `test/` directory: `packages/domain/test/issue.test.ts`, `packages/surface/test/surface.test.ts`

**Functions:**
- camelCase; small pure helpers are exported single-line arrow consts with an explicit return type: `export const issueId = (value: string): IssueId => IssueIdSchema.parse(value);` (`packages/domain/src/issue.ts`)
- Named factories use verbs: `createSurface` (`packages/surface/src/surface.ts`), `canonicalTimestampCodec` (`packages/application/src/ports/timestamp-codec.ts`)

**Types:**
- PascalCase. Identifiers are branded via Zod: `export const IssueIdSchema = z.string().trim().regex(...).brand<'IssueId'>();` then `export type IssueId = z.infer<typeof IssueIdSchema>;` (`packages/domain/src/issue.ts`). Follow this for any new ID — never accept a raw `string` where a branded type exists.
- Every Zod schema constant is named `<Type>Schema`: `IssueSchema`, `RunSchema`, `AgentSchema`, `CommentSchema` (`packages/domain/src/issue.ts`).

**Error kinds:**
- snake_case string discriminants: `'parse' | 'validation' | 'readonly' | 'not_found' | 'conflict' | 'runtime'` (`packages/surface/src/errors.ts`); `'validation' | 'not_found' | 'conflict' | 'lifecycle' | 'repository' | 'migration'` (`packages/application/src/result.ts`).

**Wire format:**
- snake_case at persistence/wire boundaries (`created_at`, `acceptance_criteria` — see `baseRow` in `packages/postgres/test/postgres.test.ts`), camelCase internally. Unknown wire fields are preserved round-trip via an explicit `wireUnknown` field pattern (`packages/domain/src/issue.ts`); keep doing this for forward compatibility.

## Code Style

**Formatting:**
- No formatter or linter is configured (no biome.json, .prettierrc, eslint config, or dprint config anywhere in the repo). Formatting is by convention only — match the surrounding file; do NOT add a formatter config or reformat unrelated code as a side effect.
- 2-space indentation, semicolons, trailing commas in multiline literals, spaces inside braces `{ ok: true, value }`.
- **Quotes are split by package — respect the local convention of the package you are editing:**
  - Single quotes: `packages/domain`, `packages/application`, `packages/sqlite`, `packages/postgres`, `packages/file`, `packages/workspace`, `packages/s3`, `packages/beads`, `packages/surface` (mostly)
  - Double quotes: `packages/cli`, `packages/tui`, `packages/web`, `packages/pi-extention`

**TypeScript strictness (enforced by `tsconfig.json`, per-package check = `tsc --noEmit`):**
- `strict: true`, `noImplicitOverride: true`, `noPropertyAccessFromIndexSignature: true`, `exactOptionalPropertyTypes: true`, `useUnknownInCatchVariables: true`, `verbatimModuleSyntax: true`, `isolatedModules: true`, `composite: true`, declaration+declarationMap+sourceMap, `types: ["bun-types"]`.
- Because of `verbatimModuleSyntax`: type-only imports MUST use `import type { ... } from '...'` or the inline `type` modifier — this is done consistently, e.g. `import type { Issue } from '@tasks/domain';` (`packages/application/src/ports/issue-repository.ts`).
- Relative imports inside a package always carry the `.js` extension even for `.ts` sources: `from '../result.js'`, `from './issue.js'` (ESM style).
- `readonly` on every interface property and `readonly T[]` for arrays: `interface IssueQuery { readonly status?: IssueStatus; readonly limit?: number; readonly cursor?: IssueId; }` (`packages/application/src/ports/issue-repository.ts`).
- Discriminated unions use a `readonly kind:` discriminant for both errors and domain states (`packages/application/src/result.ts`, `packages/domain/src/issue.ts`).

## Architecture Conventions (where logic belongs)

**Hexagonal / ports-and-adapters — respect the dependency direction:**

| Layer | Location | Rules |
|---|---|---|
| Domain | `packages/domain/src/` | Zod schemas + branded types + pure codecs (`xFromBdWire`/`xToBdWire`). No I/O, no `Result` |
| Application | `packages/application/src/` | `Result<T, E = AppError>` carrier (`result.ts`), ports in `src/ports/` (interfaces only: `IssueUnitOfWork`, `BlobStore`, `Clock`, `IdGenerator`, `TransactionManager`), use-case interfaces in `src/use-cases/issue-use-cases.ts`. Zero runtime deps besides domain |
| Adapters | `packages/{sqlite,postgres,file,s3,beads}/src/` | Implement application ports. Constructor takes injected ports (`{ dir, now }`, `{ client, now }`) |
| Surface | `packages/surface/src/` | Facade over application use-cases. `createSurface()` (`surface.ts`), operations split by verb: `operations/{create,query,mutate,deps,comments,attachments,views}.ts`, watch layer in `watch/` |
| Presentation | `packages/cli/src/tk.ts`, `packages/tui/src/`, `packages/web/src/server.ts` | Parse/serialize only; map failures to the CLI JSON envelope `{ error: { kind, message } }` via `packages/surface/src/errors.ts` |

- Never import an adapter (`@tasks/sqlite` etc.) from domain/application; composition happens in `packages/application/src/ports/composition-root.ts` and the CLI entry.
- New cross-cutting capability = new port interface in `packages/application/src/ports/` + adapter implementation + wiring in the composition root.
- Unit of work pattern: `UnitOfWork.withinTransaction(work)` hands work a transaction-bound repo (`packages/application/src/ports/issue-repository.ts`). Deprecated aliases get explicit doc comments: `/** Compatibility alias; do not use outside migration path. */ export type IssueRepository = IssueUnitOfWork;` — follow that style when deprecating.

## Error Handling

**Patterns:**
- Expected failures are values, not exceptions: `export type Result<T, E = AppError> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };` with `ok`/`err` constructors (`packages/application/src/result.ts`). Public application/surface APIs return `Result`; never throw adapter errors upward.
- `AppError` is a closed union of `kind`-discriminated interfaces (`packages/application/src/result.ts`). Add new failure modes as new union members, not as thrown `Error` subclasses.
- The surface layer flattens the union into CLI-parity messages with exhaustive ternary mapping (`appErrorMessage`, `packages/surface/src/errors.ts`) and a heuristic `classifyMessage` for legacy thrown `MessageError`s. Keep the CLI JSON contract `{ error: { kind, message } }` stable when touching this file.
- CLI parse failures use a local `fail()` that prints and exits with a nonzero code (`packages/cli/src/tk.ts`); reserved exit codes live in `packages/application/src/run-codes.ts`.
- `catch (e)` variables are `unknown` (`useUnknownInCatchVariables`) — narrow before use; never assert `e as Error`.

## Import Organization

**Order (observed consistently, e.g. `packages/sqlite/test/sqlite.test.ts`):**
1. Test framework imports (`vitest`/`bun:test`)
2. `node:` builtins (`node:fs/promises`, `node:path`, `node:crypto`)
3. External packages (`zod`, `react`, `@opentui/core`)
4. Workspace packages (`@tasks/domain`, `@tasks/application`, ...) — always by `@tasks/<pkg>` alias, never deep relative paths across packages
5. Relative imports (`../src/index.js`, `./issue.js`)

**Path aliases:** none in tsconfig. Cross-package imports resolve via the root `package.json` `exports` map (`"@tasks/domain"` → source under `bun`, `dist` for Node) plus per-package `exports` fields (`"bun": "./src/index.ts", "default": "./dist/index.js"`). When adding a package: add its `exports` block in its own `package.json` AND wire `"./<pkg>"` in the root `package.json` exports map.

## Logging

**Framework:** none. The CLI prints directly to stdout/stderr; the web server logs via `console`. Do not introduce a logging library; keep diagnostics as `Result` errors or explicit `console.error` in entry points only.

## Comments

**When to Comment:**
- Doc comments (`/** ... */`) explain *why* and state contracts, e.g. `/** Local identifiers are tk human-readable IDs, never database UUIDs. */` (`packages/domain/src/issue.ts`), `/** Typed, expected-failure carrier. Public APIs return this instead of leaking adapter errors. */` (`packages/application/src/result.ts`).
- Config object fields get one-line doc comments (`packages/workspace/src/config.ts`).
- Regression tests carry inline comments naming the bug being pinned (`packages/cli/test/tk.test.ts`).
- No `TODO`/`FIXME` noise — if it's a decision, write the decision.

## Function Design

**Size:** use-case functions stay small and delegate; the CLI entry (`packages/cli/src/tk.ts`, ~1150 lines) is the one sanctioned long file — put new CLI behavior in small named helpers above `main`, not inline in the command switch.

**Parameters:** single object parameter with `readonly` fields for anything with >2 args (`CreateIssueInput`, `ChangeIssueStatusInput` in `packages/application/src/use-cases/issue-use-cases.ts`); input types reuse domain branded types.

**Return Values:** `Promise<Result<T>>` for anything that can fail; plain values for pure codecs.

## Module Design

**Exports:** each package has a barrel `src/index.ts`. `packages/domain/src/index.ts` uses an explicit named re-export list; `packages/surface/src/index.ts` groups `export *` per module. Prefer the explicit list for public-contract packages so the API surface is reviewable.

**Barrel files:** the barrel is the ONLY import path for consumers (`@tasks/domain`, `@tasks/surface`). Do not import `@tasks/domain/dist/...` or deep files.

**Executables:** entry scripts start with `#!/usr/bin/env bun` (`packages/cli/src/tk.ts`, `packages/tui/src/main.tsx`) and are exposed via `bin` in the package's `package.json`.

## Build & Verification Commands

```bash
bun run check      # tsc --noEmit per package, in dependency order
bun run build      # tsc per package; adapter tests import dist output, so build before adapter tests
bun test packages/*/test/*.test.ts   # full suite (see TESTING.md)
```

---

*Convention analysis: 2026-10-17*
