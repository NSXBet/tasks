/**
 * tk web — local web UI over a tasks workspace, the browser sibling of the TUI.
 * One Bun HTTP server serves the single-page shell (app.html) plus a small
 * JSON API over the same typed surface the CLI and TUI use. Dev mode (`--dev`)
 * adds an SSE channel that live-reloads the page when the shell file changes
 * and opens the browser automatically.
 *
 * Instance model: one shared interface. The first server binds the default
 * port; a later `tk web` from any workspace repoints that live instance at
 * its own workspace via POST /api/open instead of starting a rival server,
 * so exactly one web UI exists to keep open in a browser tab.
 */
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import {
  readWorktreeFile, reviewPayloadFor, reviewThreads, threadInputFrom,
  worktreeOf, writeWorktreeFile, type ReviewIssueLike,
} from "./review.js";
import { ReviewCommentStoreError } from "@tasks/review";
import {
  createSurface, pidAlive, probeWebServer, readRuntimeRegistry, readWebWorkspaces, rootFrom,
  registerRuntime, unregisterRuntime, WEB_DEFAULT_PORT, WEB_RUNTIME_ID, writeWebWorkspaces,
  type SurfaceError, type TasksSurface, type WebRuntimeRow, type WebServerStatus,
} from "@tasks/surface";
import { dispatchRpc, rpcResponse, PROTOCOL_VERSION, type RpcOutcome, type RpcRequest, type SurfaceLease } from "@tasks/rpc";
import { runWatchLoop, type WatchEvent, type WatchEventKind } from "@tasks/surface";

export interface WebServerOptions {
  readonly root: string;
  /** Port to bind; 0 binds an ephemeral port (tests). Omitted: the shared default. */
  readonly port?: number;
  readonly dev?: boolean;
  /** Inject an existing surface (daemon hosting): reused verbatim, never closed by the server. */
  readonly surface?: TasksSurface;
  /** Invoked whenever the server tears itself down (HTTP /api/stop or failed ownership probe), so a host can drop its reference. */
  readonly onStopped?: () => void;
}

export interface WebServer {
  readonly port: number;
  readonly url: string;
  readonly status: () => WebServerStatus;
  /** Repoints the server at another tasks workspace (`POST /api/open`). */
  readonly open: (path: unknown) => Promise<{ ok: boolean; message?: string }>;
  readonly close: () => Promise<void>;
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const shellPath = (): string => join(import.meta.dir, "app.html");

/**
 * The review island ships as a single browser bundle built from its React
 * entrypoint. The bundle is cached outside dev; dev rebuilds per request so
 * edits show up with the shell's own reload workflow.
 */
let islandBundle: string | null = null;
const islandBundleFor = async (dev: boolean): Promise<string | null> => {
  if (!dev && islandBundle !== null) return islandBundle;
  try {
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, "client", "review-island.tsx")],
      target: "browser",
      minify: !dev,
    });
    if (!build.success) {
      for (const message of build.logs) console.error(message);
      return null;
    }
    islandBundle = await build.outputs[0]!.text();
    return islandBundle;
  } catch (cause) {
    console.error(`review island build failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    return null;
  }
};

/**
 * Thrown when the requested port is taken. Carries the running tk web server's
 * identity when one answered the probe, so the CLI can tell the user exactly
 * what to stop or how to dodge the port.
 */
export class PortBusyError extends Error {
  readonly port: number;
  readonly live: WebServerStatus | null;
  constructor(port: number, live: WebServerStatus | null) {
    super(
      live === null
        ? `port ${port} is in use by another process — pick --port N`
        : `port ${port} already serving ${live.workspace} — run tk web to repoint the shared instance here, stop it with tk web stop, or pick --port N`,
    );
    this.name = "PortBusyError";
    this.port = port;
    this.live = live;
  }
}

export const startWebServer = async (options: WebServerOptions): Promise<WebServer> => {
  // The served workspace is mutable: POST /api/open repoints the whole
  // surface (dispatch root, review threads, worktree watchers) at another
  // tasks workspace, so every request reads the active surface. `owned`
  // marks surfaces this server created itself — only those are closed on
  // switch or shutdown; an injected surface (daemon hosting) stays its
  // owner's responsibility.
  let active: { root: string; surface: TasksSurface; owned: boolean } = {
    root: options.root,
    surface: options.surface ?? await createSurface({ root: options.root }),
    owned: options.surface === undefined,
  };
  const actor = process.env["USER"] ?? "unknown";
  // Server-lifetime lease: one surface per active workspace, closed on switch
  // and in stopServer. Every JSON route is a verb-table skin — dispatch, param
  // validation, and error kinds stay single-sourced in @tasks/rpc; this server
  // only maps outcomes to HTTP.
  const provide = async (): Promise<SurfaceLease> => ({ surface: active.surface, dispose: async () => {} });
  const call = async (method: string, params: Record<string, unknown> = {}): Promise<RpcOutcome> =>
    dispatchRpc({ v: PROTOCOL_VERSION, method, root: active.root, params }, provide, { actor });
  const errorStatus = (kind: string): number => (kind === "internal" ? 500 : 400);
  const threads = (): ReturnType<typeof reviewThreads> => reviewThreads(active.surface.store);
  const issueWire = async (id: string): Promise<ReviewIssueLike | null> => {
    const outcome = await call("issue.show", { id });
    if (!outcome.ok || typeof outcome.value !== "object" || outcome.value === null) return null;
    return outcome.value as ReviewIssueLike;
  };
  const dev = options.dev ?? false;
  const startedAt = new Date().toISOString();
  // The shared-interface slot is WEB_DEFAULT_PORT; `--port N` moves it, port 0
  // binds an ephemeral port (tests only).
  const port = options.port ?? WEB_DEFAULT_PORT;
  const tasksDir = active.surface.store.tasksDir;
  // Known workspaces for the browser picker: the boot workspace first, then
  // every workspace this server has served (persisted beside the runtime
  // registry so the list outlives the server).
  const workspaces: string[] = [options.root];
  for (const entry of await readWebWorkspaces(tasksDir)) {
    if (!workspaces.includes(entry)) workspaces.push(entry);
  }
  // Crash cleanup: a web row whose pid is gone must not block the next start.
  // Watch rows are untouched — their heartbeat lifecycle belongs to the watcher.
  const staleWebRows = (await readRuntimeRegistry(tasksDir)).filter(
    (row): row is WebRuntimeRow => row.kind === "web" && !pidAlive(row.pid),
  );
  for (const row of staleWebRows) await unregisterRuntime(tasksDir, row.id);
  const live = port === 0 ? null : await probeWebServer(`http://localhost:${port}`);
  if (live !== null) throw new PortBusyError(port, live);

  let shellGeneration = 0;
  let reloadWaiters: Array<((chunk: string) => void) | null> = [];
  const stopWatches: Array<() => void> = [];
  const stopWatching = (): void => { for (const stop of stopWatches) stop(); };
  if (dev) {
    // mtime polling rather than fs.watch: one file, no watcher-type variance across runtimes.
    let lastMtime = 0;
    const ticker = setInterval(() => {
      void (async (): Promise<void> => {
        try {
          const stats = await stat(shellPath());
          if (lastMtime !== 0 && stats.mtimeMs !== lastMtime) shellGeneration += 1;
          lastMtime = stats.mtimeMs;
        } catch { /* shell gone; keep last generation */ }
      })();
    }, 400);
    stopWatches.push(() => clearInterval(ticker));
  }
  // Worktree watch (step 10): live-reload open pages when any task's worktree
  // changes on disk. The watched set is re-derived from the board every few
  // seconds, so `tk work`-created worktrees join without a server restart.
  const watchedWorktrees = new Map<string, FSWatcher>();
  const broadcastReload = (): void => {
    for (const waiter of reloadWaiters) waiter?.(`data: reload\n\n`);
  };
  const syncWorktreeWatch = async (): Promise<void> => {
    const board = await call("board.get");
    if (!board.ok || typeof board.value !== "object" || board.value === null || !("issues" in board.value)) return;
    const rows = board.value.issues;
    if (!Array.isArray(rows)) return;
    const wanted = new Set<string>();
    for (const row of rows) {
      const worktree = worktreeOf(row);
      if (worktree !== null) wanted.add(worktree);
    }
    for (const [path, watcher] of watchedWorktrees) {
      if (!wanted.has(path)) {
        watchedWorktrees.delete(path);
        void watcher.close();
      }
    }
    for (const path of wanted) {
      if (watchedWorktrees.has(path)) continue;
      try {
        const watcher = watch(path, { ignoreInitial: true, depth: 6 });
        let debounce: ReturnType<typeof setTimeout> | undefined;
        watcher.on("all", () => {
          clearTimeout(debounce);
          debounce = setTimeout(() => { debounce = undefined; broadcastReload(); }, 250);
        });
        watchedWorktrees.set(path, watcher);
      } catch { /* worktree vanished between scan and watch; joins on a later pass */ }
    }
  };
  const worktreeScan = setInterval(() => { void syncWorktreeWatch(); }, 5_000);
  stopWatches.push(() => {
    clearInterval(worktreeScan);
    for (const watcher of watchedWorktrees.values()) void watcher.close();
    watchedWorktrees.clear();
  });
  void syncWorktreeWatch();
  // Events ring (tasks-861t): one host-level watch loop feeds a bounded ring;
  // RPC clients poll GET /api/events and reconcile with the cumulative dropped
  // counter — the Luau client's short-poll transport.
  const eventRing = createEventRing({ capacity: 512, ttlMs: 5 * 60_000 });
  let eventLoopStopped = false;
  stopWatches.push(() => { eventLoopStopped = true; });
  void runWatchLoop(
    active.surface.store,
    { interval: 250 },
    (event) => eventRing.push(event),
    () => eventLoopStopped,
  ).catch(() => { /* loop logged its 3-strikes failure; ring keeps serving what it holds */ });
  // Bind last: a squatted port (any non-tk process) must surface as PortBusyError,
  // not a raw bind crash that leaves the surface store open.
  let server: Bun.Server<never>;
  try {
    server = Bun.serve({
      port,
      async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      const body = async (): Promise<Record<string, unknown>> => {
        try {
          const parsed: unknown = await request.json();
          // Guard proves the object shape; individual keys stay unvalidated by design (each read narrows again).
          if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
          return {};
        } catch { return {}; }
      };
      if (request.method === "GET" && url.pathname === "/api/status") {
        return json(status());
      }
      if (request.method === "POST" && url.pathname === "/api/open") {
        const input = await body();
        const result = await open(input["path"]);
        if (!result.ok) return json({ error: { kind: "param", message: result.message ?? "invalid path" } }, 400);
        return json({ ok: true, ...status() });
      }
      if (request.method === "POST" && url.pathname === "/api/stop") {
        // Respond first so the stopper gets a clean ack; the server tears down right after.
        setTimeout(() => { void stopServer(); }, 50);
        return json({ ok: true, stopped: status() });
      }
      if (request.method === "GET" && url.pathname === "/") {
        const shell = await readFile(shellPath(), "utf8");
        return new Response(shell, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (request.method === "GET" && url.pathname === "/assets/review-island.js") {
        const bundle = await islandBundleFor(dev);
        if (bundle === null) return json({ error: { kind: "runtime", message: "review island bundle failed to build" } }, 500);
        return new Response(bundle, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
      }
      if (request.method === "GET" && url.pathname === "/events") {
        let generation = shellGeneration;
        const stream = new ReadableStream<Uint8Array>({
          start: (controller) => {
            const encoder = new TextEncoder();
            const write = (chunk: string): void => controller.enqueue(encoder.encode(chunk));
            write(`retry: 2000\n\n`);
            reloadWaiters.push((chunk) => write(chunk));
            const tick = setInterval(() => {
              if (shellGeneration !== generation) {
                generation = shellGeneration;
                write(`data: reload\n\n`);
              }
            }, 250);
            // Idleness guard: the SSE channel only matters while the page is open.
            request.signal.addEventListener("abort", () => {
              clearInterval(tick);
              reloadWaiters = reloadWaiters.filter((waiter) => waiter !== null);
              try { controller.close(); } catch { /* already closed */ }
            });
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
      }
      if (request.method === "POST" && url.pathname === "/api/rpc") {
        // 1 MiB body cap: RPC params are small JSON documents; anything larger
        // is abuse (blobs go through the evidence attachment path instead).
        const raw = await request.text();
        if (raw.length > 1_048_576) return json({ error: { kind: "invalid_params", message: "rpc body exceeds 1 MiB" } }, 413);
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch {
          return json({ error: { kind: "invalid_params", message: "body must be valid JSON" } }, 400);
        }
        const envelope = (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as Record<string, unknown>;
        if (!("method" in envelope) || typeof envelope.method !== "string") {
          return json({ error: { kind: "invalid_params", message: "method is required" } }, 400);
        }
        if (!("v" in envelope) || typeof envelope.v !== "number") {
          return json({ error: { kind: "invalid_params", message: "v (protocol version) must be a number" } }, 400);
        }
        if ("root" in envelope) {
          return json({ error: { kind: "invalid_params", message: "root is injected server-side and must be omitted" } }, 400);
        }
        const params = "params" in envelope && envelope.params !== null && typeof envelope.params === "object" && !Array.isArray(envelope.params)
          ? envelope.params as Record<string, unknown>
          : {};
        const rpcRequest: RpcRequest = {
          v: envelope.v,
          method: envelope.method,
          root: options.root,
          params,
          ...(typeof envelope.id === "string" ? { id: envelope.id } : {}),
        };
        const outcome = await dispatchRpc(rpcRequest, provide, { actor });
        return json(rpcResponse(rpcRequest, outcome), outcome.ok ? 200 : errorStatus(outcome.error.kind));
      }
      if (request.method === "GET" && url.pathname === "/api/events") {
        const after = Number(url.searchParams.get("after") ?? "0");
        if (!Number.isInteger(after) || after < 0) return json({ error: { kind: "invalid_params", message: "after must be a non-negative integer" } }, 400);
        const kindsParam = url.searchParams.get("kinds");
        const kinds = kindsParam === null ? undefined : kindsParam.split(",").map((k) => k.trim()).filter((k) => k !== "");
        const { events, dropped } = eventRing.query(after, kinds);
        return json({ events, dropped });
      }
      if (request.method === "GET" && url.pathname === "/api/board") {
        const board = await call("board.get");
        if (!board.ok) return json({ error: board.error }, errorStatus(board.error.kind));
        return json(board.value);
      }
      const blobMatch = /^\/api\/issue\/([^/]+)\/blob\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && blobMatch !== null) {
        const id = decodeURIComponent(blobMatch[1]!);
        const ref = decodeURIComponent(blobMatch[2]!);
        const outcome = await active.surface.evidenceRead(id, ref);
        if (!outcome.ok) return json({ error: outcome.error }, 500);
        const content = outcome.value;
        if (content === null) return json({ error: { kind: "runtime", message: `no stored blob for ${ref}` } }, 404);
        return new Response(content.bytes as unknown as BodyInit, { headers: { "content-type": content.meta.mime, "cache-control": "no-store" } });
      }
      const issueMatch = /^\/api\/issue\/([^/]+)(\/[a-z-]+)?$/.exec(url.pathname);
      if (request.method === "POST" && issueMatch !== null) {
        const id = decodeURIComponent(issueMatch[1]!);
        const action = issueMatch[2] ?? "";
        const input = await body();
        const text = (key: string): string | undefined => { const value = input[key]; return typeof value === "string" ? value : undefined; };
        const outcome = await (async (): Promise<RpcOutcome> => {
          if (action === "/comment") return call("issue.comment", { id, body: text("text") ?? "" });
          if (action === "/detach-blob") return call("issue.detachBlob", { id, ref: text("ref") ?? "" });
          if (action === "/claim") return call("issue.claim", { id });
          if (action === "/archive") return call("issue.archive", { id });
          if (action === "/unarchive") return call("issue.unarchive", { id });
          if (action === "/sprint-add") return call("sprint.add", { id });
          if (action === "/sprint-remove") return call("sprint.remove", { id });
          const patch: Record<string, unknown> = {};
          if (input["title"] !== undefined) patch["title"] = text("title");
          if (input["description"] !== undefined) patch["description"] = text("description");
          if (input["status"] !== undefined) patch["status"] = text("status");
          if (input["priority"] !== undefined) patch["priority"] = Number(input["priority"]);
          if (input["assignee"] !== undefined) patch["assignee"] = input["assignee"] === null ? null : text("assignee");
          return call("issue.update", { id, ...patch });
        })();
        if (!outcome.ok) return json({ error: outcome.error }, errorStatus(outcome.error.kind));
        return json({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/api/sprint/start") {
        const input = await body();
        const started = await call("sprint.start", { name: typeof input["name"] === "string" ? input["name"] : "", carry: input["carry"] === true });
        if (!started.ok) return json({ error: started.error }, errorStatus(started.error.kind));
        const value = started.value as { sprint: unknown; moved: unknown };
        return json({ ok: true, sprint: value.sprint, moved: value.moved });
      }
      if (request.method === "POST" && url.pathname === "/api/sprint/close") {
        const closed = await call("sprint.close");
        if (!closed.ok) return json({ error: closed.error }, errorStatus(closed.error.kind));
        const value = closed.value as { sprint: unknown; moved: unknown };
        return json({ ok: true, sprint: value.sprint, moved: value.moved });
      }
      const reviewParts = url.pathname.startsWith("/api/review/")
        ? url.pathname.split("/").filter((part) => part !== "")
        : null;
      if (reviewParts !== null) {
        const rid = decodeURIComponent(reviewParts[2] ?? "");
        const sub = reviewParts[3] ?? "";
        try {
          const issue = await issueWire(rid);
          if (issue === null) return json({ error: { kind: "runtime", message: `no issue ${rid}` } }, 404);
          if (sub === "" && request.method === "GET") return json(await reviewPayloadFor(options.root, issue));
          if (sub === "file" && (request.method === "GET" || request.method === "PUT")) {
            const relativePath = url.searchParams.get("path") ?? "";
            if (request.method === "GET") {
              const read = await readWorktreeFile(options.root, issue, relativePath);
              if (!read.ok) return json({ error: read.error }, read.error.kind === "missing" ? 404 : 400);
              return json(read.value);
            }
            const input = await body();
            const contents = input["contents"];
            if (typeof contents !== "string") return json({ error: { kind: "runtime", message: "contents must be a string" } }, 400);
            const written = await writeWorktreeFile(options.root, issue, relativePath, contents);
            if (!written.ok) return json({ error: written.error }, written.error.kind === "missing" ? 404 : 400);
            return json({ ok: true });
          }
          if (sub === "threads") {
            const threadId = reviewParts[4] === undefined ? null : decodeURIComponent(reviewParts[4]);
            const tail = reviewParts[5] === undefined ? null : decodeURIComponent(reviewParts[5]);
            if (request.method === "GET") return json(await threads().list(rid));
            if (threadId === null) {
              if (request.method !== "POST") return json({ error: { kind: "runtime", message: "unsupported method" } }, 405);
              const created = threadInputFrom(await body());
              if (created === null) return json({ error: { kind: "runtime", message: "filePath and body are required" } }, 400);
              return json(await threads().create(rid, created));
            }
            const input = await body();
            const text = (key: string): string | undefined => { const value = input[key]; return typeof value === "string" ? value : undefined; };
            if (request.method === "POST" && tail === null) {
              const replyBody = text("body");
              if (replyBody === undefined) return json({ error: { kind: "runtime", message: "body is required" } }, 400);
              return json(await threads().reply(rid, threadId, { body: replyBody }));
            }
            if (request.method === "POST" && tail === "resolve") {
              return json(await threads().setResolved(rid, threadId, { resolved: input["resolved"] === true }));
            }
            if (request.method === "PUT" && tail !== null) {
              const editBody = text("body");
              if (editBody === undefined) return json({ error: { kind: "runtime", message: "body is required" } }, 400);
              return json(await threads().editComment(rid, threadId, tail, editBody));
            }
            return json({ error: { kind: "runtime", message: "unsupported method" } }, 405);
          }
          return json({ error: { kind: "runtime", message: `unknown review route ${sub}` } }, 404);
        } catch (cause) {
          if (cause instanceof ReviewCommentStoreError) return json({ error: { kind: "runtime", message: cause.message } }, 404);
          throw cause;
        }
      }
      if (request.method === "POST" && url.pathname === "/api/issue") {
        const input = await body();
        const created = await call("issue.create", { title: typeof input["title"] === "string" ? input["title"] : "", priority: typeof input["priority"] === "number" ? input["priority"] : 2 });
        if (!created.ok) return json({ error: created.error }, errorStatus(created.error.kind));
        const value = created.value as { id: string };
        return json({ ok: true, id: value.id });
      }
      return json({ error: { kind: "not_found", message: `no route: ${request.method} ${url.pathname}` } }, 404);
      },
    });
  } catch {
    stopWatching?.();
    if (active.owned) await active.surface.store.close();
    throw new PortBusyError(port, null);
  }

  // Replace-by-id registration: the fixed `web` id makes the row a singleton per workspace.
  await registerRuntime(tasksDir, {
    id: WEB_RUNTIME_ID,
    kind: "web",
    pid: process.pid,
    port: server.port ?? port,
    url: `http://localhost:${server.port}`,
    workspace: options.root,
    startedAt,
  });
  const status = (): WebServerStatus => ({
    tk: "web",
    workspace: active.root,
    workspaces,
    pid: process.pid,
    port: server.port ?? port,
    url: `http://localhost:${server.port}`,
    startedAt,
    dev,
  });

  /** Repoints the server at another tasks workspace. Invalid paths are rejected; the current one is a no-op ack. */
  const open = async (rawPath: unknown): Promise<{ ok: boolean; message?: string }> => {
    if (typeof rawPath !== "string" || rawPath.length === 0) return { ok: false, message: "path must be a non-empty string" };
    const root = resolve(rawPath);
    if (root === active.root) return { ok: true };
    // Discover from the path like the CLI does: a subdirectory of a workspace
    // resolves to its enclosing root; anything without a `.tasks` ancestor is
    // rejected before openStorage can fabricate a fresh empty workspace.
    const discovered = await rootFrom(root);
    if (discovered === null) return { ok: false, message: `not a tasks workspace: no .tasks at or above ${root}` };
    // Same workspace through a different path (e.g. a subdirectory): no-op —
    // re-running the swap would close and reopen the surface for nothing.
    if (discovered === active.root) return { ok: true };
    let surface: TasksSurface;
    try {
      surface = await createSurface({ root: discovered });
    } catch (error) {
      return { ok: false, message: `not a usable workspace: ${error instanceof Error ? error.message : String(error)}` };
    }
    // Close only surfaces we created; an injected surface stays its owner's.
    if (active.owned) await active.surface.store.close().catch(() => {});
    const previousTasksDir = join(active.root, ".tasks");
    active = { root: discovered, surface, owned: true };
    // The web registry row moves with the server: workspace-relative
    // `tk web stop`/`port` resolve through the serving workspace's own
    // registry, so a repoint must re-home the row or those commands fall
    // back to the shared default port and can hit a different instance.
    await registerRuntime(join(discovered, ".tasks"), {
      id: WEB_RUNTIME_ID,
      kind: "web",
      pid: process.pid,
      port: server.port ?? port,
      url: `http://localhost:${server.port}`,
      workspace: discovered,
      startedAt,
    });
    await unregisterRuntime(previousTasksDir, WEB_RUNTIME_ID).catch(() => {});
    // Picker list moves the new workspace to the front and persists; watchers
    // and open pages follow the new board.
    const next = [discovered, ...workspaces.filter((entry) => entry !== discovered)];
    workspaces.length = 0;
    workspaces.push(...next);
    void writeWebWorkspaces(join(discovered, ".tasks"), next).catch(() => {});
    void syncWorktreeWatch();
    broadcastReload();
    return { ok: true };
  };

  // Ownership proof: on macOS a second listener can "bind" a taken port without
  // error while the kernel keeps routing traffic to the original owner, so only
  // a live HTTP answer carrying our own pid proves we actually serve this port.
  // Runs after `status` is defined — the probe exercises the real /api/status route.
  const owned = await probeWebServer(`http://localhost:${server.port ?? port}`);
  if (owned === null || owned.pid !== process.pid) {
    options.onStopped?.();
    stopWatching?.();
    await server.stop(true);
    await unregisterRuntime(tasksDir, WEB_RUNTIME_ID);
    if (active.owned) await active.surface.store.close();
    throw new PortBusyError(port, owned);
  }

  const stopServer = async (): Promise<void> => {
    // The HTTP /api/stop route calls this directly, so it is the only hook that
    // covers every stop path — a hosting daemon must drop its reference here.
    options.onStopped?.();
    stopWatching?.();
    reloadWaiters = [];
    await server.stop(true);
    await unregisterRuntime(tasksDir, WEB_RUNTIME_ID);
    if (active.owned) await active.surface.store.close();
  };
  return {
    port: server.port ?? 0,
    url: `http://localhost:${server.port}`,
    status,
    open,
    close: stopServer,
  };
};

export type { SurfaceError };

/**
 * Bounded watch-event ring backing GET /api/events. Re-sequences events with a
 * host-level monotonic `seq` (each watch loop's own seq restarts), evicts by
 * TTL first then capacity, and counts every eviction in a cumulative `dropped`
 * total so pollers can detect gaps: any monotonic jump in `dropped` means
 * re-fetch `board.get` to resync. Units are milliseconds per the watch layer.
 */
export interface EventRing {
  push: (event: WatchEvent) => void;
  query: (after: number, kinds?: readonly string[]) => { events: WatchEvent[]; dropped: number };
  droppedCount: () => number;
}
export const createEventRing = (options: { capacity: number; ttlMs: number }): EventRing => {
  const events: WatchEvent[] = [];
  let nextSeq = 0;
  let droppedTotal = 0;
  const evict = (): void => {
    const now = Date.now();
    while (events.length > 0 && now - Date.parse(events[0]!.at) > options.ttlMs) {
      events.shift();
      droppedTotal += 1;
    }
    while (events.length > options.capacity) {
      events.shift();
      droppedTotal += 1;
    }
  };
  return {
    push: (event) => {
      nextSeq += 1;
      events.push({ ...event, seq: nextSeq });
      evict();
    },
    query: (after, kinds) => ({
      events: events.filter(
        (event) => event.seq > after && (kinds === undefined || kinds.includes(event.kind)),
      ),
      dropped: droppedTotal,
    }),
    droppedCount: () => droppedTotal,
  };
};

/** Opens `url` in the default browser (macOS `open`; silently absent elsewhere). */
export const launchBrowser = (url: string): void => {
  try { Bun.spawn(["open", url], { stdout: "ignore", stderr: "ignore" }); }
  catch { /* non-macOS: user opens the URL themselves */ }
};
