---
last_mapped_commit: fac7670c14c0ab1eb2bde4342d36fbbffc44167b
last_mapped_at: 2026-10-17
---
# Technology Stack

**Analysis Date:** 2026-10-17

## Languages

**Primary:**
- TypeScript 5.9.3 — 100% of source across 14 packages in `packages/*`; compiled per-package with `tsc -p tsconfig.json` to `dist/` (no bundler). TSX only in `packages/tui/src/app/*.tsx` (TUI components).
- POSIX Shell — `install.sh` (release installer).

**Secondary:**
- None.

## Runtime

**Environment:**
- Bun 1.3.14 (pinned via `packageManager` in `package.json`; CI installs 1.3.14). README requires Bun 1.3+ to run from source.
- Packages run directly from TypeScript under Bun (`bun` export conditions in every package `package.json` map to `./src/index.ts`); node compatibility is maintained only where needed — `packages/sqlite/src/index.ts` falls back from `bun:sqlite` to `node:sqlite` (`DatabaseSync`) when loaded under Node (pi host via jiti).
- `bun-types` ^1.4.0 supplies global types (`"types": ["bun-types"]` in root `tsconfig.json`).

**Package Manager:**
- Bun workspaces (root `package.json` declares `"workspaces": ["packages/*"]`).
- Lockfile: `bun.lock` present (CI installs with `--frozen-lockfile`).

## Frameworks

**Core:**
- OpenTUI 0.5.11 (`@opentui/core`, `@opentui/react`) — terminal UI framework for `packages/tui`; renderer, `useKeyboard`, `NativeImage`, `TextareaRenderable` all come from OpenTUI.
- React ^19.2.0 — component model inside the OpenTUI TUI (`createRoot`, hooks; `packages/tui/src/app/App.tsx`).
- No HTTP framework — `packages/web/src/server.ts` uses Bun's native HTTP server (`Bun.serve` in tests, `Response`-based handlers).
- No web framework on the CLI — hand-rolled arg parsing in `packages/cli/src/args.ts`.

**Testing:**
- vitest ^4.0.16 — runner for `packages/{domain,application,file,postgres,workspace,beads,cli,surface,pi-extention}` (`vitest run packages/<p>/test`).
- `bun test` — runner for `packages/{sqlite,workspace,beads,cli,tui}` tests (OpenTUI test-utils require it: `@opentui/react/test-utils` in `packages/tui/test/app.test.tsx`). Both runners coexist; match the package's `test` script.

**Build/Dev:**
- `tsc` (TypeScript ^5.9.3) — per-package ESM build to `dist/` with `.d.ts` + source maps; packages build their workspace deps first via chained `bun run --filter` calls.
- `bun build --compile` — single-file executables for 4 targets (linux-x64, linux-arm64, darwin-x64, darwin-arm64), defined in `.github/workflows/build-binaries.yml`.

## Key Dependencies

**Critical:**
- `zod` ^4.2.1 — all domain modeling and wire validation. Branded schemas (`packages/domain/src/issue.ts`: `IssueIdSchema` with `z.string().brand<'IssueId'>()`), `.strict()` config schemas (`packages/workspace/src/config.ts`), plus bd wire-format converters. Used by domain, workspace, root; changing domain shapes means touching zod schemas.
- `pg` ^8.16.3 — PostgreSQL adapter (`packages/postgres/src/index.ts`: `Pool`, `PoolClient`; `packages/postgres/src/blob.ts` for blob storage).
- `typebox` ^1.3.18 — LLM tool input schemas in the agent extension (`packages/pi-extention/src/index.ts`).
- `@opentui/core` / `@opentui/react` 0.5.11 — the entire TUI rendering layer; version-locked pair.

**Infrastructure:**
- `@tasks/*` workspace packages — hexagonal layering: `domain` → `application` (ports/use-cases) → adapters (`sqlite`, `postgres`, `file`, `s3`) → `workspace` (config/storage composition) → `surface` (typed API + watch) → `cli`/`tui`/`web`/`pi-extention`.
- `ws` ^8.18.0 — declared in `packages/tui` devDependencies; no import found in `packages/tui` source (likely vestigial).
- `@types/node` ^22, `@types/react` ^19.2.0, `@types/pg` — type-only.

## Configuration

**Environment:**
- Workspace config lives in `.tasks/config.json` (per-project), validated by zod in `packages/workspace/src/config.ts`. Keys: `prefix`, `storage` (`{backend: file|sqlite|postgres, filename?, url?, urlEnv?}`), `attachments` (`{store: fs|s3|postgres, s3?, postgres?, lfs?}`), `webPort`.
- Env vars: `TASKS_DATABASE_URL` (postgres connection string, env-indirected on purpose so credentials never land in committed config — `packages/workspace/src/storage.ts`), `TK_WEB_PORT` (web server port override, `packages/web/src/main.ts`), `TK_BUILD_REF` (compile-time `--define` baked by CI, `.github/workflows/build-binaries.yml`).
- No `.env` files present in the repo (checked; none exist). No `bunfig.toml`. No inline secrets.
- `skills-lock.json` — lockfile for agent skills pulled from GitHub/local sources (hashes recorded).
- Root `package.json` `pi` and `omp` fields register the agent extension entry (`./packages/pi-extention/src/index.ts`) and skill globs for both agent hosts.

**Build:**
- `tsconfig.json` (root, extended by every package) — strictest settings: `strict`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `isolatedModules`, `composite`, `declaration`+`declarationMap`, `forceConsistentCasingInFileNames`, `types: ["bun-types"]`.
- CI npm registry goes through a proxy (`fbr.land`) with an 8-attempt retry loop in `.github/workflows/build-binaries.yml` (burst rate-limiting).

## Platform Requirements

**Development:**
- Bun 1.3+; macOS or Linux. TUI pty E2E (`packages/tui/test/smoke.ts`) additionally needs `tmux` (OpenTUI's Zig renderer stalls on a bare pty). AWS CLI only needed to test S3 profile credential lookup.

**Production:**
- Self-contained single-binary `tk` (no Bun required at runtime) for linux/darwin on arm64/x64, published as GitHub Release assets with `checksums.txt` (sha256). Consumers install via `install.sh` (curl/wget + shasum) or Homebrew (`nsxbet/tap/tasks`); `tk update` (in `packages/cli/src/update.ts`) self-updates from GitHub Releases or shells out to `brew upgrade`.
- The web UI (`tk web`) runs wherever Bun runs; it binds a local port (default via `WEB_DEFAULT_PORT` in `packages/surface/src/runtime.ts`) and coordinates single-instance/port-busy behavior through a runtime registry on disk (`packages/surface/src/runtime.ts`).

---

*Stack analysis: 2026-10-17*
