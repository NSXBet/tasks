/**
 * tk web — local web UI over a tasks workspace, the browser sibling of the TUI.
 * One Bun HTTP server serves the single-page shell (app.html) plus a small
 * JSON API over the same typed surface the CLI and TUI use. Dev mode (`--dev`)
 * adds an SSE channel that live-reloads the page when the shell file changes
 * and opens the browser automatically.
 *
 * Instance model: one server per port. Binding the default port while another
 * tk web server is already serving the workspace fails loudly with the live
 * instance's identity instead of silently drifting to the next port.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import {
  readWorktreeFile, reviewPayloadFor, reviewThreads, threadInputFrom,
  worktreeOf, writeWorktreeFile, type ReviewIssueLike,
} from "./review.js";
import { ReviewCommentStoreError } from "@tasks/review";
import {
  createSurface, pidAlive, probeWebServer, readRuntimeRegistry,
  registerRuntime, unregisterRuntime, WEB_DEFAULT_PORT, WEB_RUNTIME_ID,
  type SurfaceError, type TasksSurface, type WebRuntimeRow, type WebServerStatus,
} from "@tasks/surface";
import { dispatchRpc, PROTOCOL_VERSION, type RpcOutcome, type SurfaceLease } from "@tasks/rpc";

export interface WebServerOptions {
  readonly root: string;
  readonly port?: number;
  readonly dev?: boolean;
  /** Bind an ephemeral port instead of the default, bypassing the single-instance check. */
  readonly randomPort?: boolean;
  /** Inject an existing surface (daemon hosting): reused verbatim, never closed by the server. */
  readonly surface?: TasksSurface;
}

export interface WebServer {
  readonly port: number;
  readonly url: string;
  readonly status: () => WebServerStatus;
  readonly close: () => Promise<void>;
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const shellPath = (): string => join(import.meta.dir, "app.html");

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
        ? `port ${port} is in use by another process — pick --port N or --random-port`
        : `port ${port} already serving ${live.workspace} — stop it with tk web stop, or pick --port N / --random-port`,
    );
    this.name = "PortBusyError";
    this.port = port;
    this.live = live;
  }
}

export const startWebServer = async (options: WebServerOptions): Promise<WebServer> => {
  // Injected surface (daemon hosting) is reused verbatim and never closed here;
  // its owner controls the lifecycle.
  const surface = options.surface ?? await createSurface({ root: options.root });
  const actor = process.env["USER"] ?? "unknown";
  // Server-lifetime lease: one surface, closed in stopServer. Every JSON route
  // is a verb-table skin — dispatch, param validation, and error kinds stay
  // single-sourced in @tasks/rpc; this server only maps outcomes to HTTP.
  const provide = async (): Promise<SurfaceLease> => ({ surface, dispose: async () => {} });
  const call = async (method: string, params: Record<string, unknown> = {}): Promise<RpcOutcome> =>
    dispatchRpc({ v: PROTOCOL_VERSION, method, root: options.root, params }, provide, { actor });
  const errorStatus = (kind: string): number => (kind === "internal" ? 500 : 400);
  const threads = reviewThreads(surface.store);
  const issueWire = async (id: string): Promise<ReviewIssueLike | null> => {
    const outcome = await call("issue.show", { id });
    if (!outcome.ok || typeof outcome.value !== "object" || outcome.value === null) return null;
    return outcome.value as ReviewIssueLike;
  };
  const dev = options.dev ?? false;
  const startedAt = new Date().toISOString();
  // The single-instance slot is WEB_DEFAULT_PORT; `--port N` moves it, `--random-port` bypasses it.
  const port = options.randomPort === true ? 0 : options.port ?? WEB_DEFAULT_PORT;
  const tasksDir = surface.store.tasksDir;
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
  // Bind last: a squatted port (any non-tk process) must surface as PortBusyError,
  // not a raw bind crash that leaves the surface store open.
  let server: Bun.Server<never>;
  try {
    server = Bun.serve({
      port,
      async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/status") {
        return json(status());
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
      if (request.method === "GET" && url.pathname === "/api/board") {
        const board = await call("board.get");
        if (!board.ok) return json({ error: board.error }, errorStatus(board.error.kind));
        return json(board.value);
      }
      const blobMatch = /^\/api\/issue\/([^/]+)\/blob\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && blobMatch !== null) {
        const id = decodeURIComponent(blobMatch[1]!);
        const ref = decodeURIComponent(blobMatch[2]!);
        const outcome = await surface.evidenceRead(id, ref);
        if (!outcome.ok) return json({ error: outcome.error }, 500);
        const content = outcome.value;
        if (content === null) return json({ error: { kind: "runtime", message: `no stored blob for ${ref}` } }, 404);
        return new Response(content.bytes, { headers: { "content-type": content.meta.mime, "cache-control": "no-store" } });
      }
      const body = async (): Promise<Record<string, unknown>> => {
        try {
          const parsed: unknown = await request.json();
          // Guard proves the object shape; individual keys stay unvalidated by design (each read narrows again).
          if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
          return {};
        } catch { return {}; }
      };
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
            if (request.method === "GET") return json(await threads.list(rid));
            if (threadId === null) {
              if (request.method !== "POST") return json({ error: { kind: "runtime", message: "unsupported method" } }, 405);
              const created = threadInputFrom(await body());
              if (created === null) return json({ error: { kind: "runtime", message: "filePath and body are required" } }, 400);
              return json(await threads.create(rid, created));
            }
            const input = await body();
            const text = (key: string): string | undefined => { const value = input[key]; return typeof value === "string" ? value : undefined; };
            if (request.method === "POST" && tail === null) {
              const replyBody = text("body");
              if (replyBody === undefined) return json({ error: { kind: "runtime", message: "body is required" } }, 400);
              return json(await threads.reply(rid, threadId, { body: replyBody }));
            }
            if (request.method === "POST" && tail === "resolve") {
              return json(await threads.setResolved(rid, threadId, { resolved: input["resolved"] === true }));
            }
            if (request.method === "PUT" && tail !== null) {
              const editBody = text("body");
              if (editBody === undefined) return json({ error: { kind: "runtime", message: "body is required" } }, 400);
              return json(await threads.editComment(rid, threadId, tail, editBody));
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
    await surface.store.close();
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
    workspace: options.root,
    pid: process.pid,
    port: server.port ?? port,
    url: `http://localhost:${server.port}`,
    startedAt,
    dev,
  });

  // Ownership proof: on macOS a second listener can "bind" a taken port without
  // error while the kernel keeps routing traffic to the original owner, so only
  // a live HTTP answer carrying our own pid proves we actually serve this port.
  // Runs after `status` is defined — the probe exercises the real /api/status route.
  const owned = await probeWebServer(`http://localhost:${server.port ?? port}`);
  if (owned === null || owned.pid !== process.pid) {
    stopWatching?.();
    await server.stop(true);
    await unregisterRuntime(tasksDir, WEB_RUNTIME_ID);
    if (options.surface === undefined) await surface.store.close();
    throw new PortBusyError(port, owned);
  }

  const stopServer = async (): Promise<void> => {
    stopWatching?.();
    reloadWaiters = [];
    await server.stop(true);
    await unregisterRuntime(tasksDir, WEB_RUNTIME_ID);
    if (options.surface === undefined) await surface.store.close();
  };
  return {
    port: server.port ?? 0,
    url: `http://localhost:${server.port}`,
    status,
    close: stopServer,
  };
};

export type { SurfaceError };

/** Opens `url` in the default browser (macOS `open`; silently absent elsewhere). */
export const launchBrowser = (url: string): void => {
  try { Bun.spawn(["open", url], { stdout: "ignore", stderr: "ignore" }); }
  catch { /* non-macOS: user opens the URL themselves */ }
};
