---
title: "RPC API"
order: 9
---

# RPC API

Every tk client — the CLI, the web UI, the pi extension, the Luau client — talks to the same typed surface through **one dispatch table**. `@tasks/rpc` owns the wire protocol, the verb table, and a transport-agnostic dispatcher; `@tasks/daemon` owns the unix-socket transport (`tkd`). A method is addable in exactly one place: the verb table.

## Transports

| Transport | Used by | Lifetime |
|---|---|---|
| `tkd` unix-socket daemon | CLI (`tk web`, `tk daemon`), pi extension with `TK_EVENTS=daemon`, MCP clients (see [MCP on the daemon](#mcp-on-the-daemon)) | One daemon per user, serving any workspace (each frame names its `root`; one cached surface per root); spawned on first connect, idles out after 10 min with zero connections and nothing hosted (`idleMs: 0` disables) |
| In-process dispatcher | web server routes | Web server owns a memoized surface lease per workspace |
| Web HTTP (`POST /api/rpc`, `GET /api/events`) | `@tasks/lua` Luau client (`packages/lua/luau/tk`) — lune scripts and Tern plugins such as `examples/tern/tk-board` | Talks to whatever `tk web` hosts; discovery reads the hosted-web row from `<root>/.tasks/runtime.json` |

The socket is `tkd.sock` in the OS temp directory (`TKD_SOCKET` overrides it) — never inside the repo, since macOS caps unix socket paths at ~104 chars. `tk web` bootstraps the daemon automatically; `tk daemon status` and `tk daemon stop` (plus `start` / `restart`) inspect or manage it without the web server.

## Web HTTP endpoints

`tk web` exposes the dispatcher over plain HTTP at `POST /api/rpc` — the same [envelope](#envelope) and [error kinds](#errors) as the socket, with two transport differences:

- `root` is **not** accepted from the client. The server injects the workspace it serves into every request; any client-supplied `root` is ignored. This keeps a browser page from pointing RPC calls at another workspace.
- Bodies are single JSON objects (not NDJSON lines), capped at 1 MiB (`413` above the cap); malformed JSON is `400`.

```sh
curl -X POST http://localhost:21579/api/rpc \
  -H 'content-type: application/json' \
  -d '{"v":2,"id":"c1","method":"issue.list","params":{}}'
# → 200 {"v":2,"id":"c1","ok":true,"value":[ …issues… ]}
```

Watch events are served at `GET /api/events?after=<seq>&kinds=a,b` (kinds filter optional, comma-separated):

```jsonc
{ "events": [ { "seq": 7, "kind": "task.update", "at": "…", "issueId": "tasks-3", "data": { "actor": "…", … } } ], "dropped": 0, "workspace": "/path/to/repo" }
```

The page is read straight from the served workspace's event log (`.tasks/events.jsonl`, the same wire `tk watch` and the daemon tail) — no in-memory buffer. Each event is one log line as a `WatchEvent`, and `seq` is that line's durable log seq: pass the highest `seq` you have seen back as `after` to resume. A page holds at most 512 events (the first 512 after `after`); keep paging while a full page comes back. `kinds` accepts the spec kinds (`task.created`, `task.status`, `task.comment`, …) and the legacy names through the alias table (`issue.status_changed` → `task.status`, etc.). Since nothing is ever evicted, `dropped` is always `0`; it stays in the payload for client compatibility. `workspace` names the log being read: after a `POST /api/open` repoint it changes and seqs belong to the new workspace's log, so a client that sees a different `workspace` restarts from `after=0` (or reconciles with a fresh `issue.list`).

The browser shell gets the same events pushed: `GET /events` (SSE) carries a named `event: task` frame with the `WatchEvent` JSON for every line appended to the served workspace's log, from any writer (CLI, TUI, agents, the web itself). It sits beside the existing unnamed `data: reload` frames (dev shell edits, repoints) and named `event: review` frames (live worktree/branch diff); after a repoint the stream carries only the new workspace's events.

## Envelope

One JSON object per line (NDJSON). Requests and responses both carry `v: 2` (`PROTOCOL_VERSION`).

```jsonc
// request
{ "v": 2, "id": "r1", "method": "issue.show", "params": { "id": "tasks-1" }, "root": "/path/to/repo" }
// response
{ "v": 2, "id": "r1", "ok": true, "value": { /* issue */ } }
// or
{ "v": 2, "id": "r1", "ok": false, "error": { "kind": "not_found", "message": "…" } }
```

- `id` is optional; the response echoes it when present. Transports assign one when the client omits it.
- `root` is required on every frame except `hello`: dispatch rejects a missing or empty one with `root_invalid`. On the socket transport the daemon opens (and caches) a surface for that workspace, rejecting a path that is not a tasks workspace; the in-process web dispatcher resolves it to the served workspace.
- Result values are the surface's `Result` type verbatim: `{ ok: true, value }` nests inside the envelope's `value`, and `SurfaceError` kinds surface as wire errors unchanged.

## Handshake

Call `hello` first. It returns the contract versions and the full method list:

```jsonc
{ "tk": "tk", "protocol": 2, "verbs": 6, "methods": ["board.get", "comments.list", …] }
```

Clients must fail loudly on drift — `expectContract()` throws `ContractMismatch` when either version differs. `protocol` bumps on envelope changes (fields, error kinds); `verbs` bumps when methods, params, or result shapes change.

## Errors

| `error.kind` | Meaning |
|---|---|
| `method_unknown` | Method not in the table (client too new, or typo) |
| `param_invalid` | Params failed the verb's schema |
| `contract_mismatch` | `hello` negotiation failed |
| `root_invalid` | Root does not resolve to a tasks workspace |
| `internal` | Unexpected failure — message carries detail |

Any `SurfaceError` kind (e.g. `not_found`, `runtime`) passes through verbatim from the verb handler.

## Daemon methods

The daemon intercepts these frames itself; everything else falls through to the verb table.

| Method | Params | Result |
|---|---|---|
| `daemon.ping` | — | `{ pid, socketPath, roots, connections, eventSubscriptions, idleMs, uptimeMs }` — `roots` are the workspace roots currently holding open surfaces |
| `transport.bind` | `{ root }` | `{ root }` — sets this connection's default workspace root for MCP tool calls (see [MCP on the daemon](#mcp-on-the-daemon)); `root_invalid` when empty. Stored per socket, dropped on close |
| `daemon.stop` | — | Stops the daemon: hosted web, event subscriptions, and the registry row all shut down |
| `web.start` | `{ root, port?, open? }` | Hosts the web UI for one workspace inside the daemon (port `0` binds ephemeral — tests); returns the live server (`url`, …). A live host is left running; `tk web` repoints it per workspace |
| `web.status` | — | `{ hosting: false }` or `{ hosting: true, url, … }` |
| `web.stop` | — | `{ stopped: boolean }` |
| `events.subscribe` | see below | No response value; event frames arrive unsolicited |
| `events.unsubscribe` | `{ subscription? }` | Omit to drop every subscription on the connection |

`events.subscribe` params:

```jsonc
{
  "subscription": "my-tag",        // required, non-empty; re-subscribing replaces the old loop
  "root": "/path/to/repo",         // required: the workspace whose event log to tail
  "kinds": ["task.status"],        // optional filter: log types, or legacy aliases (below)
  "ids": ["tasks-1"],              // optional filter, issue ids
  "label": "session-x",            // optional, issues carrying this label
  "after": 120,                    // optional: replay every log line with seq > after first
  "interval": 5000                 // optional fallback poll interval, positive integer ms
}
```

Event frames share the connection, one per line:

```jsonc
{ "v": 2, "subscription": "my-tag", "event": { "seq": 42, "kind": "task.status", "at": "2026-10-18T19:33:00.000Z", "issueId": "tasks-1", "counts": { "open": 3, "blocked": 1, "readyToReview": 1 }, "data": { "from": "in-progress", "to": "ready-to-review", "actor": "yuri" } } }
```

**Source: the event log.** Events are the lines of `.tasks/events.jsonl` — one append-only log per workspace, written in-process by the command that made the change (CLI, web, TUI, any surface caller). There is no daemon broker: the daemon hosts each subscription as a tail of that log (`runWatchLoop`), the same reader `tk watch`, web `/events`, the TUI and the pi extension use. Each log line carries the envelope `{ seq, host, ts, task, type, actor, session?, data }`, and an event maps it 1:1: `kind` = `type`, `at` = `ts`, `issueId` = `task`, `seq` = the log `seq`, `data` = the line's `data` plus `actor` and (when set) `session`. `counts` (board counters) is attached to every delivered event.

| `kind` | written when | `data` |
|---|---|---|
| `task.created` | a task is created | `title`, `status`, `owner`, `assignee` |
| `task.status` | status changes (approvals are `to: approved\|rejected`) | `from`, `to`; `tk finish` adds `session`, `finishedAt`; a repeat finish is `from = to` with `refinish: true` |
| `task.owner` | owner or assignee changes (one event each) | `field` (`owner`\|`assignee`), `from`, `to` |
| `task.comment` | a plain comment is added (`kind: "note"`), or a review comment moves (`kind: "review"`, one per transition; a batched send is one `to: "sent"` per card) | note: `comment`, `author`, `body` · review: `comment` (also as deprecated `commentId`), `from`, `to`, `file`, `line`, `location`, `author`, `body` |
| `task.evidence` | an evidence blob is attached | `id`, `name`, `mime` |
| `task.worktree` | the worktree path or branch changes | `path`, `branch` |
| `task.pr` | `metadata.pr` changes — only the `tk pr` verbs write it; gh is never polled. `op` is `create` when a PR first appears (or its number changes), `close` when its state moves to closed, `state` for any other state move; a url-only change emits nothing | `op` (`create`\|`state`\|`close`), `number`, `url`, `state` (`open`\|`closed`\|`merged`), `head` (the task branch) |
| `task.report` | the counts-only `metadata.report` stamp changes (`tk finish`, `tk pr create`/`sync`, the web/TUI commit action) — the stat card data, never a diff | `changes` `{commits, files, additions, deletions}`, `head`, `at` |
| `task.update` | any other field changes | `fields` (sorted names; uncovered metadata keys as `metadata.<key>`) |
| `task.deleted` | a task is deleted | `title` |
| `run.changed` | a run is created or changes state | `runId`, `from`, `to` |

`seq` is the log's sequence number: monotonic and gap-free in the log, so a filtered subscription sees gaps — that is normal. Ordering authority is `seq`, never timestamps. A subscription starts at the log's current end (the start cursor is pinned before the `events.subscribe` reply, so a later write is never missed); pass `after` to replay first. A subscription's loop restarts automatically if it exits on its own, resuming after the last delivered `seq`; dropping the socket ends it.

Legacy kind names are still accepted in `kinds` and expand to log types; they are never emitted (`ready.changed` and `counts.changed` no longer exist as events — `counts` rides on every event instead):

| legacy name | matches |
|---|---|
| `issue.created` | `task.created` |
| `issue.status_changed` | `task.status` |
| `issue.commented` | `task.comment` |
| `issue.deleted` | `task.deleted` |
| `issue.updated` | `task.update`, `task.owner`, `task.evidence`, `task.worktree`, `task.pr`, `task.report` |
| `ready.changed`, `counts.changed` | `task.created`, `task.status`, `task.deleted`, `task.update` |

`tk watch` subscribers keep per-subscriber cursors (`{ <host>: <last consumed seq> }` per subscriber name) in `.tasks/cursors.json`. Watch filters are queries: `task=`, `status=`, `owner=`, `type=`, `actor=`, `mine` — comma-joined clauses AND, `|` separates alternatives (`parseEventQuery` / `matchesEvent` in `@tasks/surface`).

VERBS 5 (from 4): event kinds became the log types, `seq` became the log seq, and `events.subscribe` gained `after`.

VERBS 6 (from 5): `task.pr` and `task.report` event kinds (the `issue.updated` alias covers both).

## MCP on the daemon

The same `tkd` socket also speaks the Model Context Protocol, served by the official SDK (`@modelcontextprotocol/server` 2.x, `packages/daemon/src/mcp.ts`). MCP over a unix socket reuses the stdio binding's framing — newline-delimited JSON-RPC — which is exactly the daemon's ndjson framing.

**Revisions.** The daemon uses the SDK's `serveStdio` entry over a custom `SocketTransport` (`ReadBuffer` + `serializeMessage`). The opening MCP message picks the era per connection: a 2026-07-28 request (per-request `_meta` envelope with `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities`, `server/discover`) is served stateless; a legacy `initialize` (e.g. 2025-06-18) is served as a normal handshake (`legacy: 'serve'`, the SDK default). The SDK fills `resultType`, `_meta.serverInfo`, and `ttlMs`/`cacheScope` on `tools/list`.

**One protocol per connection.** RPC frames are served until the first line whose JSON carries `"jsonrpc"`; from then on the connection is MCP for its lifetime and RPC frames on it are ignored (and the reverse: a connection that never sends a `jsonrpc` line stays RPC). This lets a bridge send `transport.bind` as an RPC establishment step before its first MCP line. MCP connections count as connections for idle accounting.

**Tools.** One tool per `VERB_TABLE` entry, named by `mcpToolName` (`issue.create` becomes `issue_create`), in sorted order, with the verb's `description` and its typebox `params` as the JSON input schema. The SDK's `fromJsonSchema` helper wraps the schema; no zod is involved. `web.*`, `events.*`, `daemon.*`, and `transport.bind` are not tools.

**Root.** MCP forbids relying on earlier requests for context, so the workspace root is a property of the transport binding (like a stdio process's cwd): `transport.bind { root }` sets the connection default, and every tool accepts an optional `root` string argument that overrides it per call. With neither, the call returns a tool error `root_invalid`.

**`tk mcp`.** MCP clients that only launch stdio servers use `tk mcp [--root <path>]` (`bridgeStdio` in `packages/daemon/src/bridge.ts`): it connects to or spawns the daemon, sends `transport.bind` as a plain RPC frame, waits for its `ok:true` reply (not forwarded), then pipes bytes both ways without parsing. See `integrations.md` for client registration.

**Results.** A call dispatches through `dispatchRpc`. Success returns `content: [{ type: 'text', text: <JSON, indent 1> }]`, `structuredContent` (the value; non-object values are wrapped as `{ value }`), `isError: false`. A failure returns `isError: true` with text `error <kind>: <message>` (tool errors are results, not JSON-RPC errors).

## Verb table

Every verb entry carries `params` (schema), `handler`, and a one-line model-facing `description` (what it does, key params, what it returns). The `description` is metadata, not wire contract: editing it never bumps `VERBS_VERSION`. It exists so a transport can derive a tool list from the table — the planned MCP surface registers one tool per verb using `description` plus the Typebox `params` schema.

MCP tool names: `mcpToolName(method)` replaces `.` with `_` (`issue.create` → `issue_create`; `hello` is unchanged), since MCP tool names must match `[A-Za-z0-9_-]`. `rpcMethodName(toolName)` is the reverse lookup against the verb table keys and returns `null` for an unknown name. Both are exported from `@tasks/rpc`; `verbNames()` is sorted, so a derived tool list has a deterministic order.

Shared param schemas:

- **ListOptions** (`issue.list`, `issue.ready`): `status?`, `parent?`, `assignee?`, `type?`, `priority?`, `label?`, `sprint?`, `archived?`, `limit?`, `claim?`
- **CreateParams** (`issue.create`): `title` plus `description?`, `status?`, `priority?`, `type?`, `owner?`, `assignee?`, `due?`, `deferUntil?`, `parent?`, `labels?`, `notes?`, `design?`, `acceptanceCriteria?`, `estimate?`, `specId?`, `externalRef?`, `branch?`, `metadata?`, `attachments?` (`{path, metadata?}`), `deps?`
- **UpdateParams** (`issue.update`): `id` plus any CreateParams field (except `attachments`/`deps`) as a patch; optional fields accept `null` to clear

| Verb | Params |
|---|---|
| `hello` | — → `{ tk, protocol, verbs, methods }` |
| `board.get` | — → issues, sprints, active sprint, actor, now (composed) |
| `issue.show` / `issue.children` / `issue.epic` / `issue.comments` / `issue.claim` / `issue.archive` / `issue.unarchive` / `issue.undefer` | `{ id }` |
| `issue.create` | CreateParams |
| `issue.update` | UpdateParams |
| `issue.list` / `issue.ready` | ListOptions |
| `issue.blocked` / `issue.orphans` | — |
| `issue.search` | `{ text }` |
| `issue.query` | `{ expression }` |
| `issue.stale` | `{ days }` |
| `issue.status` | `{ id, status, reason? }` |
| `issue.finish` | `{ id, session }` |
| `issue.defer` | `{ id, until? }` |
| `issue.assign` | `{ id, assignee }` |
| `issue.priority` | `{ id, priority }` |
| `issue.labelAdd` / `issue.labelRemove` | `{ id, label }` |
| `issue.note` | `{ id, body }` |
| `issue.comment` | `{ id, body }` |
| `comments.list` | `{ id }` → `{ comments, counts }` — review comments of one task as cards `{ id, location, file, line, endLine, evidence, author, body, status, replies }`; `counts` is `{ total, open, sent, resolved, dismissed, unresolved, label, allResolved }` (`label` renders `N open · K ✓`) |
| `comments.send` | `{ id, ids? }` → `{ sent, counts }` — explicit batched send: every `open` comment (or just `ids`) becomes `sent` in one transaction and is returned as cards; one summary issue comment records the batch. Nothing is delivered per-comment |
| `comments.status` | `{ id, comment, status }` — move one comment to `open` (reopen), `resolved`, or `dismissed`; `sent` is reachable only through `comments.send` |
| `issue.duplicate` | `{ id, canonical }` |
| `issue.supersede` | `{ id, replacement }` |
| `issue.closeMany` | `{ ids, reason? }` |
| `issue.delete` | `{ ids }` |
| `issue.rename` | `{ from, to }` |
| `issue.attach` | `{ id, path, metadata? }` |
| `issue.detach` | `{ id, path }` |
| `issue.detachBlob` | `{ id, ref }` |
| `deps.list` | `{ id, direction?: "up" \| "down" }` |
| `deps.add` / `deps.remove` | `{ id, target, type? }` |
| `deps.link` | `{ id1, id2, type? }` |
| `sprint.list` / `sprint.close` | — |
| `sprint.start` | `{ name, carry? }` |
| `sprint.add` / `sprint.remove` | `{ id }` |
| `sprint.move` | `{ id, target }` |
| `views.all` / `views.counts` / `views.stats` / `views.graph` | — |
| `views.tree` | `{ all?, status?, depth? }` |
| `views.duplicates` | `{ minSimilarity? }` |
| `views.lint` | `{ ids?, type?, status? }` |
| `runtime.list` | — |
| `runtime.activity` | `{ limit? }` |
| `inbox.list` | `{ all? }` |
| `inbox.read` / `inbox.archive` | `{ runId }` |
| `lease.acquire` | `{ name, holder, purpose?, ttlMs?, waitMs?, issue? }` |
| `lease.list` | — |
| `lease.release` | `{ name, holder }` |
| `lease.renew` | `{ name, holder, ttlMs? }` |

The actor identity for mutations comes from the workspace (the daemon's store actor, `process.env.USER ?? 'unknown'`), not from the frame.

### Resource leases

Leases are advisory holds on shared machine resources (a simulator, a dev port,
a seeded database) coordinated through a plain `<workspace>/.tasks/leases.json`
book — any session on the machine can inspect and respect them without a
broker. tk serializes access by convention, not by proxying the resource.

- `lease.acquire` grants `{ ok: true, value: { name, holder, purpose, issue, grantedAt, expiresAt } }` or fails with kind `conflict` naming the current holder and time remaining. `waitMs` (capped at 300 000) long-polls server-side: the call re-checks the file every 250 ms until a grant or deadline. `issue` (optional) must resolve to a live issue — typos fail at acquire time with kind `not_found`.
- Holds are TTL-based (default 900 000 ms, range 1 s–24 h). `lease.renew` extends one's own hold from now; a stale renew can never extend a foreign session's hold (wrong-holder renew fails with kind `conflict`).
- `lease.release` drops one's own hold; releasing a name you don't hold fails `conflict`, an unknown name fails `not_found`.
- Expired holds vanish without ceremony: a crashed session's lease self-expires at its TTL, so nothing can deadlock a resource. Reads (`lease.list`) filter expiry in memory and never write.

## Deliberately excluded from RPC v1

- `surface.evidenceRead` — binary bytes; transports serve it as a blob route (web's `/api/issue/:id/blob/:ref`), not a JSON frame.
- `surface.watch` — server-push events; arrives as the events channel above, not a request/response verb.

The table is the single source of truth: if a verb isn't in it, no transport serves it.

## Consuming from code

```ts
import { connectOrSpawn, RpcCallError } from "@tasks/daemon";

const client = await connectOrSpawn("/path/to/repo", {
  spawnTimeoutMs: 5000, // wait for a freshly spawned daemon's socket
  idleMs: 600_000,      // idle-exit delay used when this call spawns the daemon
  onClose: (err) => { /* daemon died */ },
});

try {
  const issue = await client.call("issue.show", { id: "tasks-1" });
  await client.stop();        // graceful daemon.stop + socket end
} catch (err) {
  if (err instanceof RpcCallError) console.error(err.method, err.kind, err.message);
} finally {
  client.close();             // hard destroy, no RPC
}
```

`connectOrSpawn` connects to a running daemon or spawns one, self-healing from a stale socket file or dead pid. `probeDaemon(timeoutMs)` inspects the running daemon without ever spawning one (returns `null` when none is alive). The pi extension opts into this transport with `TK_EVENTS=daemon`; otherwise it runs the in-process watch loop.
