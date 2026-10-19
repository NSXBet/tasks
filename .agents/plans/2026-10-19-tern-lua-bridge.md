# Tern Lua bridge — a Luau client library for the tk RPC server

Date: 2026-10-19

## Goal

A Luau library (`packages/lua`) that Tern plugins use to call tk's verb table and
subscribe to tk events — full RPC parity over HTTP, with types generated from the
one source of truth (`VERB_TABLE`).

## Context

- **Tern** (`so.stencil.tern`, `/Applications/Tern.app`) is a Luau plugin host (Rust/mlua).
  Its plugin API (`tern.d.luau`, via `tern plugin types`) exposes: `tern.fetch` (HTTP,
  16 MiB cap, `timeout_ms`), `tern.fs` (sync file I/O), `tern.process.run` (spawn with
  timeout), `tern.timer.after`, `tern.json` (`decode` drops null members; `tern.json.null`
  for explicit nulls), `tern.kv`, `tern.log`. **No unix sockets.**
- **tk** already serves the verb table two ways: the tkd socket (CLI/TUI) and the web
  server's route skins (`packages/web/src/server.ts`). The web host rides the daemon
  (`createWebHost`) and registers its `web` row (url, port) in `.tasks/runtime.json`.
- Prior art: `.worktrees/poc/` proved contract-first codegen — one zod declaration →
  `generated/wire.luau` (types + decoders) → Lua client, zero hand-maps. That pattern
  carries over, but the source of truth is now TypeBox (`VERB_TABLE` is JSON Schema already).

## Design decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Transport | HTTP via `tern.fetch`, **not** sockets | Tern exposes no unix socket API; fetch is the only in-process network call. The tkd socket stays the CLI/TUI transport. |
| Generic RPC route | `POST /api/rpc` on the web server → `dispatchRpc` | Verb parity for plugins without 56 hand-written routes; reuses the existing lease provider — no second dispatcher. |
| Events | `GET /api/events?after=<seq>` + short polling | `tern.fetch` returns whole responses (no streaming/SSE). The web host runs one shared watch loop with a bounded ring buffer; poll returns `{events, dropped}`. |
| Type source | Emit `wire.luau` from `VERB_TABLE`'s TypeBox schemas | TypeBox schemas are JSON Schema natively — generator imports them directly; PoC's emit pattern, no zod detour. |
| Test runtime | lune 0.11 (installed) drives the Luau side | Tern's VM can't run under bun test. Transport is an injected interface: `tern.fetch` on device, lune `net.request` in tests. |
| Nulls | Decode: absent ≡ null (tern.json already drops null members). Encode: `json.null()` sentinel for nullable params (`parent: null` filters) | Matches how `optNullOrStr` params behave on the wire; both hosts get a `json.luau` shim. |
| Auth | None; localhost only | Same posture as `tk web` today — single-user local tool. |
| Home | `packages/lua` (`@tasks/lua`); example plugin under `packages/lua/examples/tk-board/` | Repo convention; plugin links via `tern plugin link`. |

## Steps

### Phase 1 — HTTP transport on tk (prereq)
1. `POST /api/rpc` in `packages/web/src/server.ts`: parse JSON body → inject the served
   workspace as `root` → `dispatchRpc(request, provide, {actor})` → `json(rpcResponse(...))`.
   Tests: hello, issue.create roundtrip, `method_unknown`, `param_invalid`.
2. Events ring buffer in the web host: one shared watch loop per served surface, capacity
   512 (5-min TTL); `GET /api/events?after=<seq>&kinds=<a,b>` → `{events: WatchEvent[], dropped}`.
   Tests: create via `/api/rpc` → poll returns `issue.created` with growing seq; overflow → `dropped`.
3. Docs: `rpc.md` HTTP-transport section; CHANGELOG. (Per the AGENTS.md docs rule.)

### Phase 2 — codegen
4. `packages/lua/generator.ts`: import `VERB_TABLE` + `PROTOCOL_VERSION`/`VERBS_VERSION`
   from `@tasks/rpc`; emit `luau/tk/wire.luau` — version constants, `methods` list,
   per-verb params/result Luau type aliases (best-effort from schema: `string?`, `{string}`,
   nullable markers), per-verb thin call helpers. Committed; `bun run generate` regenerates.
5. Freshness test: regenerating in test must produce zero diff — CI fails when
   `wire.luau` is stale vs `VERB_TABLE`.

### Phase 3 — Luau runtime
6. `luau/tk/json.luau` — host shim: `null()`, `is_null(v)`, `encode`, `decode` (arrays
   tagged; null members dropped). Backed by `tern.json` when present, lune `serde` otherwise.
7. `luau/tk/transport.luau` — `{ request(method, url, body, timeout_ms) → {status, body} }`
   interface + two implementations: `tern.fetch`, lune `net.request`.
8. `luau/tk/client.luau` — `connect(root, opts)`:
   - discovery: read `<root>/.tasks/runtime.json` (kind `"web"` row) via `tern.fs`;
     stale/absent → spawn `tk web` via `tern.process.run`, parse `http://localhost:<port>`
     from stdout, re-read; validate with `GET /api/status`.
   - `hello` + version check → `ContractMismatch`-style error on drift.
   - `call(method, params)`: attaches `root`, monotonic id, timeout; `ok:false` → error
     `{kind, message}` (RpcCallError shape).
   - generated per-verb helpers (`client.issues.create(params)`, …) from `wire.luau`.
9. `luau/tk/events.luau` — `subscribe(client, {kinds, interval_ms, on_event, on_resync, on_error})`:
   timer-driven poll loop (default 2 s), `after` watermark, `dropped > 0` → `on_resync`
   (caller refetches via `board.get`), `stop()`.

### Phase 4 — tests
10. Unit fixtures (lune): decode roundtrips + villain cases (empty arrays, null members,
    unicode, big ints, missing fields).
11. Integration: bun test boots `tk web --random-port` on a temp workspace (existing
    `packages/web` test harness), runs a lune client script end-to-end: hello →
    issue.create → issue.show → events poll sees `issue.created` → JSON summary printed;
    bun test asserts on the summary.
12. Full `bun test` + docs build green.

### Phase 5 — example plugin, dogfooded
13. `packages/lua/examples/tk-board/`: `plugin.toml` + `host.luau` — a `tern.block.define`
    board listing ready/in-progress issues (`board.get`), refreshes from the event poll,
    toasts errors. `tern plugin link` it, `tern plugin reload`, verify in the live Tern UI.

## Verification

- Phase 1–4: tests above; `bun test` full suite green; docs build green.
- Phase 5: plugin loads in Tern (`tern plugin list` clean), board block renders the
  workspace's real issues, creating an issue via `tk` updates the block within ~2 s.
- Contract drift: bump a verb's schema → generator test fails until `wire.luau` regenerated.

## Out of scope

- Unix-socket transport in Luau (impossible on Tern's API).
- Auth tokens, non-localhost binding, SSE/long-poll (short poll v1; long-poll is a later upgrade).
- Hammerspoon or other Lua hosts (lib stays transport-seamed so it could port).
- The TUI deep-links WIP currently in the tree — untouched.
