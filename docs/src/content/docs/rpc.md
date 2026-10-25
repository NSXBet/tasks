---
title: "RPC API"
order: 9
---

# RPC API

Every tk client — the CLI, the web UI, the pi extension — talks to the same typed surface through **one dispatch table**. `@tasks/rpc` owns the wire protocol, the verb table, and a transport-agnostic dispatcher; `@tasks/daemon` owns the unix-socket transport (`tkd`). A method is addable in exactly one place: the verb table.

## Transports

| Transport | Used by | Lifetime |
|---|---|---|
| `tkd` unix-socket daemon | CLI (`tk web`, watchers), pi extension | One daemon per workspace; spawned on first connect, idles out after 10 min with zero connections and nothing hosted (`idleMs: 0` disables) |
| In-process dispatcher | web server routes | Web server owns a memoized surface lease per workspace |
| Web HTTP (`POST /api/rpc`, `GET /api/events`) | `@tasks/lua` Luau client (`packages/lua/luau/tk`) — lune scripts and Tern plugins such as `examples/tern/tk-board` | Talks to whatever `tk web` hosts; discovery reads the hosted-web row from `<root>/.tasks/runtime.json` |

The socket lives under the OS temp directory with a content-derived name (macOS binds unix sockets at ~104 chars, so a socket inside a deep repo path would routinely overflow). `tk web` bootstraps the daemon automatically; `tk daemon status` and `tk daemon stop` (plus `start` / `restart`) inspect or manage it without the web server.

## Web HTTP endpoints

`tk web` exposes the dispatcher over plain HTTP at `POST /api/rpc` — the same envelope and error kinds as above, with two transport differences:

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
{ "events": [ { "seq": 7, "kind": "issue.updated", "at": "…", "issue": { "id": "tasks-3", … } } ], "dropped": 0 }
```

`events` are watch frames re-sequenced by the server with monotonically increasing `seq`; pass the highest `seq` you have seen back as `after` to skip already-delivered events. `dropped` is a cumulative host-level counter of events evicted from the server's bounded ring (512 events, 5-minute TTL) before you read them — on a nonzero value, reconcile with a fresh `issue.list` rather than replaying.

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
- `root` is required on every frame except `hello`: dispatch rejects a missing or empty one with `root_invalid`. On the socket transport the daemon resolves it to its own pinned workspace; the in-process web dispatcher resolves it to the served workspace.
- Result values are the surface's `Result` type verbatim: `{ ok: true, value }` nests inside the envelope's `value`, and `SurfaceError` kinds surface as wire errors unchanged.

## Handshake

Call `hello` first. It returns the contract versions and the full method list:

```jsonc
{ "tk": "tk", "protocol": 2, "verbs": 2, "methods": ["board.get", "deps.add", …] }
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
  "kinds": ["issue.updated"],      // optional filter, WatchEventKind union
  "ids": ["tasks-1"],              // optional filter, issue ids
  "label": "session-x",            // optional
  "interval": 5000                 // optional poll interval, positive integer ms
}
```

Event frames share the connection, one per line:

```jsonc
{ "v": 2, "subscription": "my-tag", "event": { "seq": 42, "kind": "issue.updated", "at": "2026-10-18T19:33:00.000Z", "issueId": "tasks-1", "counts": { "open": 3, "blocked": 1, "readyToReview": 1 }, "data": { "actor": "yuri" } } }
```

`seq` is per-subscription monotonic — the ordering authority, never timestamps. `kind` is one of `issue.created`, `issue.updated`, `issue.status_changed`, `issue.commented`, `issue.deleted`, `ready.changed`, `counts.changed`, `run.changed`; `data.from`/`data.to` accompany status changes and `data.runId` accompanies `run.changed`. A subscription's watch loop restarts automatically if it exits on its own; dropping the socket ends it.

## Verb table

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

The actor identity for mutations comes from the workspace (the daemon's store actor, `process.env.USER ?? 'unknown'`), not from the frame.

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

`connectOrSpawn` connects to a running daemon or spawns one, self-healing from a stale socket file or dead pid. `probeDaemon(root, timeoutMs)` inspects a running daemon without ever spawning one (returns `null` when none is alive). The pi extension opts into this transport with `TK_EVENTS=daemon`; otherwise it runs the in-process watch loop.
