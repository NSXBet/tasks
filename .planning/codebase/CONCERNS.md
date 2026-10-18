---
last_mapped_commit: fac7670c14c0ab1eb2bde4342d36fbbffc44167b
last_mapped_at: 2026-10-17
---
# Codebase Concerns

**Analysis Date:** 2026-10-17

## Tech Debt

**Monolithic CLI dispatcher:**
- Issue: `packages/cli/src/tk.ts` is a single 1,148-line file holding arg parsing helpers, workspace discovery, backend config, and the entire command dispatch tree (`tk.ts:1006-1072` shows the nested if/else style). Every new subcommand grows this file. It also imports from nearly every package, making it the de-facto god module.
- Files: `packages/cli/src/tk.ts` (1,148 lines), `packages/cli/src/presentation.ts` (839 lines, every formatter for every command)
- Impact: High merge-conflict surface; hard to locate command logic; presentation and dispatch are interleaved (`value = issueWire(issue); human = () => confirmation(...)` patterns repeat per command).
- Fix approach: Split dispatch into per-command modules (e.g. `commands/issue.ts`, `commands/run.ts`) exporting a table of `{ name, isWriter, json, human, run }` handlers that `tk.ts` iterates; move formatter pairs alongside their commands.

**Densely written SQL adapters:**
- Issue: `packages/sqlite/src/index.ts` and `packages/postgres/src/index.ts` use a one-line-minified style (multi-statement methods on single lines, e.g. `index.ts:52-64`), unlike the readable `packages/file/src/index.ts`. Methods are hard to review and diff.
- Files: `packages/sqlite/src/index.ts`, `packages/postgres/src/index.ts`
- Impact: Review friction; a typo in a long one-line try/catch is easy to miss; both adapters must stay feature-parallel with `file`.
- Fix approach: Reformat to the `file` adapter's style (one statement per line, doc comments on ports) without changing logic; consider a shared migration-history implementation (`validate_history` logic is copy-pasted in both adapters at `sqlite/src/index.ts:53` and `postgres/src/index.ts:46`).

**Duplicated board/blocked/ready logic between TUI and watch:**
- Issue: "What is blocked/ready/counts" is implemented twice: pure helpers in `packages/tui/src/store.ts` (`isBlocked`, `unblockGains`, `detectCycles`, counts via `loadBoard`) and independently in `packages/surface/src/watch/core.ts:98-110` (`blockedIds`, `readyIds`, `WatchCounts`). Each has its own poll loop too: TUI polls every 1s via `boardSignature` change detection, watch defaults to 2000ms (`protocol.ts:52`).
- Files: `packages/tui/src/store.ts`, `packages/surface/src/watch/core.ts`
- Impact: The two counters can drift when a status rule changes (e.g. adding a terminal status other than `closed` — watch hardcodes `TERMINAL_STATUSES = ['closed']` at `core.ts:15` while TUI uses `board.counts` from its own rules).
- Fix approach: Move blocked/ready/counts computation into one shared pure module (e.g. `packages/application` or `packages/surface/src/board.ts`) consumed by both.

**Duplicated workspace discovery:**
- Issue: Upward `.tasks/` discovery with git-worktree fallback exists in both `packages/cli/src/tk.ts:131-138` (`rootFrom`) and `packages/surface/src/discover.ts:15-19` (`discover`).
- Files: `packages/cli/src/tk.ts`, `packages/surface/src/discover.ts`
- Impact: If worktree discovery semantics change in one place, the CLI and TUI/web disagree about which workspace is active.
- Fix approach: Have the CLI import `discover` from `@tasks/surface` and delete `rootFrom`.

**Dead vitest configuration:**
- Issue: `vitest.config.ts` at repo root plus `vitest` in devDependencies exists, but all tests run on `bun test` (`packages/*/test/*.test.ts`, bun-native APIs in tests); nothing references vitest at runtime.
- Files: `vitest.config.ts`, `package.json`
- Impact: Two test runners advertised; contributors may run vitest against bun-only tests and get confusing failures.
- Fix approach: Delete `vitest.config.ts` and the vitest devDependency; document `bun test` in AGENTS.md.

**WIP stubs reachable from user commands:**
- Issue: `tk work` / `tk review` mock flows are explicit WIP stubs (`packages/cli/src/presentation.ts:221-232` — env setup and edit/comment actions not implemented); TUI fixture mock actions call `notify("WIP")` (`packages/tui/src/fixture.ts:349-360`); web board has `data-wip` buttons that do nothing.
- Files: `packages/cli/src/presentation.ts`, `packages/tui/src/fixture.ts`, `packages/web/src/app.html`
- Impact: Users hitting `tk work` get a mock summary, not an implementation; acceptable while the task→review plan (`.agents/plans/2026-10-08-task-to-review.md`) is in flight, but these seams must be replaced, not forgotten.
- Fix approach: Track them as tk issues under the task-to-review label; remove `data-wip` and `notify("WIP")` when the real flows land.

## Known Bugs

No `TODO`/`FIXME`/`HACK`/`XXX` markers exist in `packages/` (verified by grep), and no reproducible bug was found during this scan. The stale-lock behavior under Fragile Areas is the closest latent-bug candidate.

## Security Considerations

**`tk web` binds all interfaces with an unauthenticated mutation API:**
- Risk: `packages/web/src/server.ts` calls `Bun.serve({ port, ... })` without a `hostname` option, which in Bun defaults to `0.0.0.0` (all interfaces). The JSON API includes unauthenticated mutations — `POST /api/issue/:id/comment`, issue update endpoints, `POST /api/stop`, sprint mutations — so anyone on the LAN can read and mutate the tracker, and `POST /api/stop` is reachable by a drive-by `fetch(..., {mode:'no-cors'})` from any website open in a local browser (empty body passes the handler).
- Files: `packages/web/src/server.ts` (serve setup ~line 90-140, stop endpoint)
- Current mitigation: Instance model checks and `PortBusyError` prevent port confusion, not access control; `unregisterRuntime` cleanup only tidies registry state.
- Recommendations: Bind `127.0.0.1` explicitly (add a `--host` escape hatch for the rare LAN-share case); reject requests whose `Host`/`Origin` is not the bound host for state-changing methods.

**Blob responses served with stored mime, no hardening headers:**
- Risk: Blob bytes are served back with the stored `mime` from metadata and no `X-Content-Type-Options: nosniff`/CSP. A stored `text/html` blob navigated directly executes script in the board's origin.
- Files: `packages/web/src/server.ts` (blob endpoint), `packages/web/src/main.ts`
- Current mitigation: Inline rendering in `app.html` restricts to image mimes, and HTML interpolation escapes via `esc()`.
- Recommendations: Add `nosniff`, `Content-Security-Policy` and `Content-Disposition: inline; filename=...` (or `attachment` for non-image mimes) on blob routes.

**Positive notes (do not regress):**
- Hook installers refuse to follow symlinks and check managed content before rewriting (`packages/cli/src/hooks.ts:351+`).
- Self-update verifies `checksums.txt` SHA-256 before atomically replacing the binary (`packages/cli/src/update.ts`, `installDownloadedBinary`).
- SQL adapters are fully parameterized (`$1`/`?` bindings; the only `${}` interpolation is over trusted clause fragments at `postgres/src/index.ts:56`).

## Performance Bottlenecks

**Full-issue-page read per poll tick:**
- Problem: Every watcher tick lists the entire issue page — TUI every 1s (`packages/tui/src/store.ts` watch loop), watch core default 2000ms with `limit: 100_000` (`packages/surface/src/watch/core.ts:49-50`).
- Files: `packages/tui/src/store.ts`, `packages/surface/src/watch/core.ts`
- Cause: Watermark-diff design requires seeing every issue's `updatedAt` each tick; the file backend re-reads and JSON-parses every issue file on each `list()`.
- Improvement path: Per-backend watermark readers (already anticipated in the `core.ts` comment) or a persisted last-modified index; for `file`, an mtime-sorted directory scan can short-circuit unchanged ticks.

**O(N²) blocked computation in watch diff:**
- Problem: `diffOnce` builds `blockedIds` with `all.some(...)` nested inside `all.filter(...)` per issue (`packages/surface/src/watch/core.ts:98`), re-scanning the full page for each issue every tick.
- Files: `packages/surface/src/watch/core.ts`
- Cause: Naive dependency resolution; fine at hundreds of issues, quadratic at tens of thousands.
- Improvement path: Build a `Map<targetId, boolean(open)>` of blockers once per tick, then one pass over dependency edges (same pattern as `isBlocked` in `packages/tui/src/store.ts`).

**History append not batched:**
- Problem: `#appendHistory` opens/appends per event with `fs.appendFileSync`, and `#readHistory` parses the entire NDJSON file to produce `AuditEntry[]` with synthesized sequential ids (`packages/file/src/index.ts:236-260`).
- Files: `packages/file/src/index.ts`
- Cause: Append-only design without compaction or indexing.
- Improvement path: Acceptable at current scale; if audit trails grow, add rotation or an index file (last line offset).

## Fragile Areas

**File adapter lock has no liveness check:**
- Files: `packages/file/src/index.ts:266-294` (`#acquireLock`/`#releaseLock`)
- Why fragile: `mkdir`-based lock with a 5s timeout, after which the lock is force-released **without checking the PID file it just wrote** — two concurrent processes can end up both believing they hold the lock (holder paused, NFS, or simply >5s transaction). The wait loop busy-spins for 10ms instead of sleeping.
- Safe modification: Before force-release, read `<lock>/pid` and `kill(pid, 0)` to confirm the holder is dead; replace the busy-wait with `Bun.sleepSync(10)`.
- Test coverage: `packages/file/test/file.test.ts` covers happy paths; no concurrent-process lock contention test.

**TUI watch loop swallows all errors:**
- Files: `packages/tui/src/store.ts` (poll loop catch: "Keep polling through transient storage failures")
- Why fragile: Storage corruption or adapter errors are invisible; the board just goes stale with only the stale-mark hint.
- Safe modification: Surface consecutive-failure counts into the status bar before deciding to keep polling.
- Test coverage: None — the poll loop has no dedicated test (`packages/tui/test/` covers views/fixtures, not the store loop).

**SQLite adapter serializes everything through one shared connection:**
- Files: `packages/sqlite/src/index.ts:55-56` (`withinTransaction` promise chain; comment: "concurrent transactions would nest BEGIN on it and wedge the handle")
- Why fragile: Any code path that mutates via the raw `#db()` outside `withinTransaction` breaks the serialization invariant.
- Safe modification: Keep all writes routed through `transact`; add an assertion/comment contract on the private handle.

**Recursive Tarjan cycle detection:**
- Files: `packages/tui/src/store.ts` (`detectCycles`, `strongConnect` recursion)
- Why fragile: Deep dependency chains (thousands deep) overflow the JS stack; code comment itself says it is sized for "board sizes here are TUI-scale."
- Safe modification: If boards ever get big, convert to an explicit-stack iterative Tarjan.

**Test artifacts committed into the repo:**
- Files: `.agents/tests/tui-test-*/` (PNG/GIF screenshots, currently dirty in the worktree)
- Why fragile: Binary verification artifacts churn with every TUI change and bloat diffs; `graft/` at repo root is an empty stray directory.
- Safe modification: Move screenshots out of git or gitignore the directories; remove the empty `graft/` dir.

## Scaling Limits

**Watch/poll architecture is O(total issues) per tick:**
- Current capacity: Comfortable to low thousands of issues (file backend: per-file reads each tick; watch caps at `limit: 100_000`, `packages/surface/src/watch/core.ts:49`).
- Limit: File backend degrades when tick read time exceeds the poll interval; 100k issue cap silently truncates events beyond it.
- Scaling path: Per-backend incremental watermarks (mtimes for file, `updated_at > watermark` for SQL) — the event contract in `packages/surface/src/watch/protocol.ts` already supports it.

**SQLite single-connection throughput:**
- Current capacity: One writer at a time (promise-chain serialization).
- Limit: Write-heavy agent workloads queue on the chain; fine locally, a ceiling for concurrent automation.
- Scaling path: WAL mode + write coalescing, or direct agents at the postgres backend.

## Dependencies at Risk

**Hard Bun coupling:**
- Risk: `Bun.S3Client` (`packages/s3/src/index.ts`), `Bun.serve` (`packages/web/src/server.ts`), `bun:sqlite` (`packages/sqlite/src`), `Bun.spawnSync`, `Bun.SHA256`, and the compiled `/$bunfs/` check (`packages/cli/src/update.ts`) — the codebase cannot run on Node, and Bun minor bumps have historically changed `Bun.serve`/`S3Client` behavior.
- Impact: Runtime upgrades are load-bearing migrations; CI must pin `packageManager: bun@1.3.14` (`package.json`).
- Migration plan: None needed by choice; keep `bun.lock` in lockstep and smoke-test `tk web`, `tk watch`, and `tk update` on every Bun bump.

**Dual validation libraries:**
- Risk: `zod@^4` (domain schemas) and `typebox@^1.3.18` (pi-extention tool schemas only, `packages/pi-extention/src/index.ts:15`) coexist as root dependencies.
- Impact: Two schema ecosystems to track for CVEs/breaking changes; typebox exists only because omp maps it for extension tool schemas (`pi-extention/src/index.ts:6-8`).
- Migration plan: Keep the split intentional and documented; do not add a third.

## Missing Critical Features

**Dolt sync described but not implemented:**
- Problem: `AGENTS.md` states issues live in a local Dolt database and sync via `refs/dolt/data` on the git remote; this codebase contains no Dolt sync — the only Dolt code is the beads migration reader (`packages/beads/src/workspace.ts`), and `.tasks/` has no `issues.jsonl` passive export.
- Blocks: Multi-machine sync for the file backend; the documented sync story is aspirational.
- Fix approach: Either implement `refs/dolt/data` push/pull or correct `AGENTS.md` to describe the actual storage adapters (`file`/`sqlite`/`postgres`) and the `.tasks/` runtime layout.

**No automated backup/rotation of `.tasks/`:**
- Problem: `tk backup` produces a one-shot archive (`formatBackup` in `packages/cli/src/presentation.ts`); there is no scheduled or post-write snapshot, and the sqlite backend is a single `tasks.db` file.
- Blocks: Recovery from corruption without external tooling.
- Fix approach: Add a `tk backup --cron`-style hook or document a standard sqlite `.backup` recipe per backend.

## Test Coverage Gaps

**`@tasks/s3` — zero tests:**
- What's not tested: Everything — `S3BlobStore` put/read/meta/delete, AWS profile credential resolution, key construction (`packages/s3/src/index.ts`, no test file in `packages/s3/test/`).
- Files: `packages/s3/src/index.ts`
- Risk: Blob attachments silently break (or corrupt sidecar/data pairs) with no signal until used in production.
- Priority: High

**pi-extention — 43 test lines for 600+ source lines:**
- What's not tested: Tool registration contracts (`index.ts` 405 lines), `WatchManager` lifecycle/child cleanup (`watch-manager.ts` 196 lines) beyond `entry.test.ts`.
- Files: `packages/pi-extention/src/index.ts`, `packages/pi-extention/src/watch-manager.ts`, `packages/pi-extention/test/entry.test.ts`
- Risk: Watch child processes leaking on stop; tool schema drift against omp.
- Priority: High

**Web server and client shell:**
- What's not tested: 1,464-line inline SPA in `packages/web/src/app.html` has no tests at all (comment/attachment/board interactions only manually verified); `server.test.ts` (137 lines) covers a fraction of routes.
- Files: `packages/web/src/app.html`, `packages/web/src/server.ts`, `packages/web/test/server.test.ts`
- Risk: Regressions in the browser UI ship unnoticed (only mitigated by manual screenshots under `.agents/tests/`).
- Priority: High

**TUI store logic:**
- What's not tested: `packages/tui/src/store.ts` (437 lines) — board derivation, `boardSignature` change detection, the 1s poll loop, `detectCycles` — has no `store.test.ts`; `app.test.tsx` tests views with mocked stores, `smoke.ts` runs against real fixtures.
- Files: `packages/tui/src/store.ts`, `packages/tui/test/`
- Risk: Counter/blocking drift (see duplicated-logic debt) lands without test failure.
- Priority: Medium

**Domain and application cores are thinly direct-tested:**
- What's not tested: `packages/domain/test/issue.test.ts` is 30 lines and `packages/application/test/ports.test.ts` is 12 for the two pure-core packages (schemas, wire codecs, run side effects). Both are exercised transitively via adapter tests.
- Files: `packages/domain/test/issue.test.ts`, `packages/application/test/ports.test.ts`
- Risk: Wire-format round-trip regressions surface as confusing adapter failures instead of domain failures.
- Priority: Medium

---

*Concerns audit: 2026-10-17*
