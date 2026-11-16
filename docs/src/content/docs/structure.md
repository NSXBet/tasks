---
title: "Structure"
order: 3
---
# Codebase Structure

**Analysis Date:** 2026-11-12

## Directory Layout

```text
tasks/
├── package.json               # Bun workspaces root; pi/omp extension wiring; exports map
├── tsconfig.json              # Composite project references (15 packages)
├── bun.lock                   # Bun lockfile
├── AGENTS.md                  # Agent-facing repo guidance (holds the managed tk block)
├── CHANGELOG.md               # Release notes (release.yml refuses to publish without a section)
├── install.sh                 # Installer for the tk binary
├── skills-lock.json           # Skill lockfile
├── packages/                  # All source — 19 workspace packages
│   ├── domain/                # @tasks/domain — zod model, wire codecs, review-record / stat-card / PR-record helpers
│   ├── application/           # @tasks/application — ports, Result, run codes
│   ├── workspace/             # @tasks/workspace — config, backend resolution, blobs
│   ├── file/                  # @tasks/file — JSON-per-issue adapter
│   ├── sqlite/                # @tasks/sqlite — SQLite adapter
│   ├── postgres/              # @tasks/postgres — Postgres adapter + blob store
│   ├── s3/                    # @tasks/s3 — S3 blob adapter
│   ├── beads/                 # @tasks/beads — beads JSONL interop
│   ├── git/                   # @tasks/git — typed git adapter (the only git spawner)
│   ├── surface/               # @tasks/surface — TasksSurface facade, event log, watch, discovery, gh
│   ├── rpc/                   # @tasks/rpc — wire protocol + the verb table + dispatcher
│   ├── daemon/                # @tasks/daemon — tkd unix-socket daemon (RPC, events, hosted web)
│   ├── review/                # @tasks/review — vendored Hunk review component (diff, comments, task-view model)
│   ├── cli/                   # @tasks/cli — tk CLI (bin: tk), skill + onboard templates
│   ├── tui/                   # @tasks/tui — tk-tui OpenTUI app (bin: tk-tui)
│   ├── web/                   # @tasks/web — tk web server + SPA shell + review island
│   ├── pi-extention/          # pi/omp agent-host extension (sic — misspelled, do not rename)
│   ├── terminal-image/        # @tasks/terminal-image — TUI image helper
│   └── lua/                   # @tasks/lua — hand-written Luau tk client (json/transport/wire/client/events), lune-tested
├── examples/tern/tk-board/    # Tern plugin: live tk board over the Luau client
├── docs/
│   ├── src/content/docs/      # This docs site (Astro): overview, architecture, … rpc
│   └── html/                  # Standalone HTML documents (e.g. task-to-review-v1.html)
├── .agents/                   # Agent plans, project skills (.agents/skills/tasks/SKILL.md), TUI test evidence
├── .claude/skills/            # Claude Code skills
├── .github/workflows/         # build-binaries.yml, release.yml, nightly.yml
├── .trail/                    # Repo context graph + learnings
├── .vibe-wise/                # Learning-mode notes
└── .planning/                 # GSD planning docs and milestone archives
```

Per-package skeleton (used by every package):

```text
packages/<name>/
├── package.json    # name @tasks/<name>; build = tsc -p; check = tsc --noEmit
├── tsconfig.json
├── src/            # Sources (*.ts / *.tsx)
├── test/           # Co-located tests (*.test.ts, bun test)
└── dist/           # Generated tsc output (gitignored)
```

## Directory Purposes

**`packages/domain`:**
- Purpose: pure entity model — zod schemas, branded IDs, wire codecs, transition policy.
- Key files: `packages/domain/src/issue.ts` (nearly everything), `packages/domain/src/index.ts` (barrel).

**`packages/application`:**
- Purpose: ports and shared vocabulary — persistence contracts, Result, migration declarations, run side-effect codes.
- Key files: `packages/application/src/ports/issue-repository.ts`, `packages/application/src/ports/composition-root.ts`, `packages/application/src/result.ts`, `packages/application/src/run-codes.ts`.

**`packages/workspace`:**
- Purpose: `.tasks/` workspace semantics — config schema/read/write, backend selection, blob-store opening, attachment ingestion, storage descriptors (`packages/workspace/src/storage.ts:90` `describeStorage`).
- Key files: `packages/workspace/src/config.ts`, `packages/workspace/src/storage.ts`, `packages/workspace/src/attachments.ts`, `packages/workspace/src/index.ts`.

**`packages/surface`:**
- Purpose: the single service facade and shared runtime services.
- Key files: `packages/surface/src/surface.ts` (facade + `createSurface`), `packages/surface/src/store.ts` (SurfaceStore, transaction wrapper), `packages/surface/src/discover.ts` (`rootFrom`), `packages/surface/src/errors.ts`, `packages/surface/src/envelope.ts`, `packages/surface/src/tree.ts`, `packages/surface/src/gh.ts` (the only gh caller), `packages/surface/src/leases.ts`; `operations/` (create, query, mutate, deps, comments, sprint, attachments, views, finish, changeset, changes, review-comments, sessions, commit, pr, prune, leases); `events/` (log, recorder, derive, query, tail, cursors, watch — the `.tasks/events.jsonl` wire); `watch/` (child-entry.ts, core.ts, protocol.ts, wakeups.ts); `runtime.ts` (registry).

**`packages/git`:**
- Purpose: typed git adapter — the only place tk spawns git. `runner.ts` = process runners (async `bunRunner`/`nodeRunner`, sync `spawnSyncRunner`); `commands.ts` = enumerated async git commands; `sync.ts` = enumerated sync commands for git hooks; `porcelain.ts` = output parsing; `resolver.ts` = worktree placement; `hooks.ts` = worktree setup hooks / package-manager setup; `prune.ts` = worktree pruning.

**`packages/cli`:**
- Purpose: CLI frontends. `tk.ts` = dispatch; `args.ts` = parser; `presentation.ts` = all output formatting (and the `PRIME` context); `hooks.ts`/`hooks-json.ts`/`agent-hooks.ts` = hook integrations; `onboard.ts` = the managed AGENTS.md block; `tree.ts` = tree view; `update.ts` = self-update; `skill.ts` = skill install. `skills/tasks/SKILL.md` is the shipped skill and `templates/agents/tk-section.md` the onboard block body. Git access goes through `@tasks/git`.

**`packages/tui`:**
- Purpose: terminal UI. `src/main.tsx` = entry/renderer lifecycle; `src/store.ts` = pure board model + graph algorithms (dependency trees, Tarjan cycles, critical chain, kanban grouping) + the event-log tail; `src/app/` = one file per panel (`task.tsx` task view, `tasklist.tsx` TASKS column, `diff.tsx` review, `artifact.tsx` artifact view, `hunkEdit.tsx` inline edit); `src/review/` = review source, live watch, guarded edits, selection; `src/theme.ts`, `src/format.ts` = styling/format helpers.

**`packages/web`:**
- Purpose: local web UI. `src/main.ts` = entry (flags, port resolution, daemonize), `src/server.ts` = Bun HTTP server + JSON API + SSE, `src/review.ts` = review/task-view payloads and guarded file I/O, `src/client/review-island.tsx` = the `@pierre/diffs` review island (served as `/assets/review-island.js`), `src/app.html` = single-page shell.

**`packages/pi-extention`:**
- Purpose: register tasks tools/commands/watch widget inside pi and omp hosts. `src/index.ts` = extension factory, `src/inbox.ts` = automatic review inbox, `src/watch-manager.ts` = watch lifecycle + widget state; `skills/` ships agent skills (glob-registered from root `package.json`).

**`packages/rpc`, `packages/daemon`:**
- Purpose: `rpc/src/verbs.ts` is the single verb table, `protocol.ts` the versions and error codes, `dispatch.ts` the transport-agnostic dispatcher; `daemon/src/server.ts` serves it on the `tkd` socket, `client.ts` connects or spawns, `events.ts` hosts `events.subscribe`, `web.ts` hosts `tk web`.

**`packages/review`:**
- Purpose: tk's review component, vendored from Hunk. Git-free entries: `@tasks/review/headless` (patch → changeset/diff stats), `@tasks/review/watch` (debounced watch controller), `@tasks/review/lifecycle` and `@tasks/review/taskview` (type-import-only models shared with the web), `@tasks/review/opentui` (the diff view).

**`packages/beads`:**
- Purpose: read/convert legacy beads JSONL workspaces — `export.ts` (resolve), `migrate.ts`, `plan.ts`, `records.ts`, `workspace.ts`, `search-path.ts`.

**`packages/lua`:**
- Purpose: hand-written Luau reimplementation of the tk RPC client surface — no TypeScript, no codegen. `luau/tk/json.luau` (encoder/decoder), `transport.luau` (tern + lune request seam), `wire.luau` (protocol/verbs versions + verb table mirroring `packages/rpc/src/verbs.ts`), `client.luau` (connect/discovery/`call`/`get`/`unwrap`), `events.luau` (poll loop). Tested with lune (`lune run luau/tk/tests/run_all.luau`).
- Key files: `packages/lua/luau/tk/client.luau`, `packages/lua/luau/tk/wire.luau`.

**`examples/tern/tk-board`:**
- Purpose: Tern plugin showing a live tk issue board as a plugin block. `host.luau` defines the `board` block (discovery walks up from `cx.cwd` to a `.tasks/runtime.json`, reads the hosted-web row, fetches `issue.list` via the vendored client); `lib/tk/` holds copies of `packages/lua/luau/tk` (Tern's `require` cannot reach outside the plugin directory — `sync.sh` refreshes them). Registered with Tern via a `tk-board.path` file in the plugins directory.

## Key File Locations

**Entry Points:**
- `packages/cli/src/tk.ts`: `tk` CLI (shebang `#!/usr/bin/env bun`, bin `tk`).
- `packages/tui/src/main.tsx`: `tk-tui` TUI entry (bin `tk-tui`).
- `packages/web/src/main.ts`: `tk web` server entry.
- `packages/pi-extention/src/index.ts`: pi/omp extension default export (wired in root `package.json` `pi.extensions`/`omp.extensions`).

**Configuration:**
- `package.json` (root): workspaces `packages/*`, scripts (`build`, `check`, `test`, `tk`, `tk:tui`), exports map `./domain`, `./workspace`, `./application` (bun→src, default→dist), `./cli`.
- `tsconfig.json` (root): composite references — `git, domain, application, sqlite, postgres, file, workspace, s3, surface, cli, beads, tui, web, rpc, daemon` (note: `review`, `terminal-image`, `lua` and `pi-extention` are NOT in references).
- `packages/workspace/src/config.ts`: schema for `.tasks/config.json` (`prefix`, `storage` {backend, filename, url, urlEnv}, `attachments`, `webPort`, `worktree` {dir, post_start, post_checkout, pre_end, install}, `tuiImage`).
- `.github/workflows/*.yml`: build/release/nightly CI.
- `install.sh`: installs bins from GitHub releases.

**Core Logic:**
- `packages/surface/src/store.ts`: storage open + `transact()` error classification.
- `packages/surface/src/operations/*.ts`: every business operation (one file per area).
- `packages/tui/src/store.ts`: board derivation + dependency graph algorithms (pure functions).

**Testing:**
- `packages/*/test/*.test.ts`: bun test suites (inventory in [Testing](#testing)); `packages/tui/test/{smoke,review-smoke,taskview-smoke}.ts` are tmux pty probes run by hand.
- Run: `bun test packages/*/test/*.test.ts` (root script `test`); per-package `test:sqlite`, `test:cli`, `test:tui`.

## Naming Conventions

**Files:**
- kebab-case for modules: `run-side-effects.ts`, `search-path.ts`, `child-entry.ts`.
- One React component per file, matching the component name: `packages/tui/src/app/statusbar.tsx` exports `StatusBar`.
- Tests mirror the module under test: `image-size.test.ts` ↔ image-size helpers in `store.ts`; adapter suites named after the adapter (`sqlite.test.ts`, `file.test.ts`).

**Directories:**
- Package dirs singular nouns when possible (`domain`, `file`, `sqlite`), by-tech for adapters; `pi-extention` is a historical misspelling (extension) — leave as-is, references point at this exact path (root `package.json` `pi.extensions`).

**Exports:**
- `export const` function-style APIs (`createSurface`, `openStorage`, `buildBoard`), `export type` for interfaces; barrels in `src/index.ts` re-exporting everything public.
- Branded-id constructors are lowercase verbs: `issueId()`, `sprintId()`, `runId()` (`packages/domain/src/issue.ts`).

**Imports:**
- All packages use `.js`-suffixed relative ESM imports (`./store.js`) — required by `verbatimModuleSyntax` + tsc emit. Exception: `packages/pi-extention/src/*` imports `.ts` paths (`../../surface/src/index.ts`) because hosts rewrite them.
- Cross-package imports always use `@tasks/<name>` workspace deps, never deep paths (sole exception: `pi-extention` relative import noted above).

## Where to Add New Code

**New CLI command (`tk foo`):**
- Parse args: `packages/cli/src/args.ts` helpers (`stringFlag`, `booleanFlag`, `statusFlag`).
- Add switch arm in `packages/cli/src/tk.ts` — keep it thin: parse → one surface call → one `packages/cli/src/presentation.ts` formatter → exit code from `packages/application/src/run-codes.ts`.
- Tests: `packages/cli/test/` if the package has one, else cover at the surface level (`packages/surface/test/` pattern).

**New surface operation:**
1. Implement in the matching `packages/surface/src/operations/<area>.ts` (create a new file if a new area, e.g. `operations/attachments.ts` precedent).
2. Add the method to the `TasksSurface` interface and wire it in `createSurface()` (`packages/surface/src/surface.ts:68-112`).
3. Re-export types from `packages/surface/src/index.ts`.
4. Add a CLI arm and/or TUI keybinding/web route as needed (frontends only).
5. Tests in `packages/surface/test/` following the existing suite style.

**New storage backend:**
1. New package `packages/<backend>` with `src/index.ts` exporting an adapter implementing `UnitOfWork & MigrationPort` from `@tasks/application` (model on `packages/file/src/index.ts` or `packages/sqlite/src/index.ts`).
2. Extend the `StorageConfigSchema` discriminated union in `packages/workspace/src/config.ts` with a new `backend` variant.
3. Add a lazy `await import('@tasks/<backend>')` branch in `openStorage()` (`packages/workspace/src/storage.ts:66`).
4. Register the package in root `package.json` workspaces (automatic via `packages/*`) and add it to root `build`/`check` scripts + `tsconfig.json` references.
5. Include `MigrationStep`s with real SQL/checksums — `MigrationPort.verifyMigrations` validates them.

**New domain field on Issue:**
1. Schema + superRefine in `packages/domain/src/issue.ts` (add to `IssueSchema`, column/field sets, and both `issueFromBdWire`/`issueToBdWire` for wire compat).
2. SQLite: new `MigrationStep` in `packages/sqlite/src/index.ts` (never edit `001-initial`).
3. File adapter writer/reader in `packages/file/src/index.ts`.
4. Surface exposure via the relevant operation in `packages/surface/src/operations/`.
5. Presentation: CLI formatter (`packages/cli/src/presentation.ts`), TUI detail pane (`packages/tui/src/app/detail.tsx`).

**New TUI panel/view:**
- Component: `packages/tui/src/app/<name>.tsx` (one component per file).
- Register the view kind in `packages/tui/src/app/context.ts` (`ViewKind`), mount + key-route it in `packages/tui/src/app/App.tsx`.
- Pure logic (filters, grouping, graph metrics) goes in `packages/tui/src/store.ts` as pure exported functions — panels must stay thin and read state only via `useApp()`.
- Tests: `packages/tui/test/` (render-level tests use `@opentui` fixtures; see `app.test.tsx`, `taskview.test.tsx`, `review.test.tsx`).

**New web API route:**
- Handler in `packages/web/src/server.ts` next to existing JSON routes; always go through the `TasksSurface` instance, return via the shared `json()` helper.

**New pi/omp tool:**
- Register in `packages/pi-extention/src/index.ts` `tasksExtension` with a typebox schema (`Type` from the root `typebox` dep — not zod); route through `withSurface()`.
- Agent skills: add `packages/pi-extention/skills/<name>/SKILL.md` (auto-globbed from root `package.json`).

**Utilities:**
- Shared helpers used by only one package stay in that package (`packages/<pkg>/src/*.ts`).
- Anything crossing package boundaries must live in `@tasks/domain` (types/schemas) or `@tasks/application` (ports/Result) — never in a frontend.

## Special Directories

**`packages/*/dist/`:**
- Purpose: tsc build output consumed by the root `exports` map `default` condition.
- Generated: Yes. Committed: No (`**/dist/` in `.gitignore`).

**Generated `*.js` / `*.js.map` inside `src/`:**
- Purpose: stray tsc emit artifacts (e.g. `packages/application/src/index.js`).
- Generated: Yes. Committed: No for `.js`/`.js.map` (`*.js`, `*.js.map` in `.gitignore`); `.d.ts` files in `src/` are NOT ignored — verify they are not hand-edited before committing.

**`.tasks/` (runtime, per user workspace — not in this repo):**
- Purpose: workspace data: `config.json`, `issues/` + `history/` (file backend) or `tasks.db` (sqlite), `attachments/`, `sprints/`, `agents/`, `runs/`, the event log `events.jsonl` (+ `events.lock`), per-subscriber `cursors.json`, the runtime registry `runtime.json`, `leases.json`. Created by `tk init`.

**`docs/`:**
- Purpose: this Astro docs site (`docs/src/content/docs/*.md`, built with `cd docs && bun run build`) and standalone HTML documents under `docs/html/` (e.g. `task-to-review-v1.html`).
- Generated: No (hand-written Markdown; some HTML exports are scripted). Committed: Yes.

**`.vibe-wise/`, `.planning/`, `.claude/skills/`:**
- Purpose: agent workflow metadata (learning notes, GSD planning docs, project skill).
- Generated: tooling-owned. Committed: Yes (`.planning/` per repo convention).

---

*Structure analysis: 2026-11-12*
