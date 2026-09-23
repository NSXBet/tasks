/**
 * tk web — local web UI over a tasks workspace, the browser sibling of the TUI.
 * One Bun HTTP server serves the single-page shell (app.html) plus a small
 * JSON API over the same typed surface the CLI and TUI use. Dev mode (`-d`)
 * adds an SSE channel that live-reloads the page when the shell file changes
 * and opens the browser automatically.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createSurface, type SurfaceError, type TasksSurface } from "@tasks/surface";

export interface WebServerOptions {
  readonly root: string;
  readonly port?: number;
  readonly dev?: boolean;
}

export interface WebServer {
  readonly port: number;
  readonly url: string;
  readonly close: () => Promise<void>;
}

const asError = (cause: unknown): SurfaceError =>
  cause instanceof Error ? { kind: "runtime", message: cause.message } : { kind: "runtime", message: String(cause) };

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const shellPath = (): string => join(import.meta.dir, "app.html");

/** First free port at or above `want` (10 probes); falls back to 0 (ephemeral). */
const listenPort = async (want: number): Promise<number> => {
  for (let candidate = want; candidate < want + 10; candidate += 1) {
    const free = await new Promise<boolean>((resolveProbe) => {
      const probe = Bun.serve({
        port: candidate,
        fetch: (): Response => new Response(null),
      });
      probe.stop(true);
      resolveProbe(true);
    });
    if (free) return candidate;
  }
  return 0;
};

export const startWebServer = async (options: WebServerOptions): Promise<WebServer> => {
  const surface: TasksSurface = await createSurface({ root: options.root });
  const actor = process.env["USER"] ?? "unknown";
  const dev = options.dev ?? false;
  const port = await listenPort(options.port ?? 8420);

  let shellGeneration = 0;
  let reloadWaiters: Array<((chunk: string) => void) | null> = [];
  let stopWatching: (() => void) | null = null;
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
    stopWatching = () => clearInterval(ticker);
  }
  const server = Bun.serve({
    port,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
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
        const page = await surface.all();
        if (!page.ok) return json({ error: page.error }, 500);
        const sprints = await surface.sprintList();
        const activeSprint = sprints.ok ? sprints.value.find((sprint) => sprint.status === "active") ?? null : null;
        return json({ issues: page.value, actor, now: new Date().toISOString(), sprints: sprints.ok ? sprints.value : [], activeSprint });
      }
      const body = async (): Promise<Record<string, unknown>> => {
        try {
          const parsed: unknown = await request.json();
          // Guard proves the object shape; individual keys stay unvalidated by design (each read narrows again).
          if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
          return {};
        } catch { return {}; }
      };
      const issueMatch = /^\/api\/issue\/([^/]+)(\/[a-z]+)?$/.exec(url.pathname);
      if (request.method === "POST" && issueMatch !== null) {
        const id = decodeURIComponent(issueMatch[1]!);
        const action = issueMatch[2] ?? "";
        const input = await body();
        const text = (key: string): string | undefined => { const value = input[key]; return typeof value === "string" ? value : undefined; };
        const outcome: { ok: true; value: unknown } | { ok: false; error: SurfaceError } = await (async (): Promise<{ ok: true; value: unknown } | { ok: false; error: SurfaceError }> => {
          if (action === "/comment") return surface.comment(id, text("text") ?? "");
          if (action === "/claim") return surface.claim(id);
          if (action === "/archive") return surface.archive(id);
          if (action === "/unarchive") return surface.unarchive(id);
          if (action === "/sprint-add") return surface.sprintAdd(id);
          if (action === "/sprint-remove") return surface.sprintRemove(id);
          const patch: Record<string, unknown> = {};
          if (input["title"] !== undefined) patch["title"] = text("title");
          if (input["description"] !== undefined) patch["description"] = text("description");
          if (input["status"] !== undefined) patch["status"] = text("status");
          if (input["priority"] !== undefined) patch["priority"] = Number(input["priority"]);
          if (input["assignee"] !== undefined) patch["assignee"] = input["assignee"] === null ? null : text("assignee");
          return surface.update(id, patch);
        })();
        if (!outcome.ok) return json({ error: outcome.error }, 400);
        return json({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/api/sprint/start") {
        const input = await body();
        const started = await surface.sprintStart(typeof input["name"] === "string" ? input["name"] : "", { carry: input["carry"] === true });
        if (!started.ok) return json({ error: started.error }, 400);
        return json({ ok: true, sprint: started.value.sprint, moved: started.value.moved });
      }
      if (request.method === "POST" && url.pathname === "/api/sprint/close") {
        const closed = await surface.sprintClose();
        if (!closed.ok) return json({ error: closed.error }, 400);
        return json({ ok: true, sprint: closed.value.sprint, moved: closed.value.moved });
      }
      if (request.method === "POST" && url.pathname === "/api/issue") {
        const input = await body();
        const created = await surface.create({ title: typeof input["title"] === "string" ? input["title"] : "", priority: typeof input["priority"] === "number" ? input["priority"] : 2 });
        if (!created.ok) return json({ error: created.error }, 400);
        return json({ ok: true, id: created.value.id });
      }
      return json({ error: { kind: "not_found", message: `no route: ${request.method} ${url.pathname}` } }, 404);
    },
  });
  return {
    port: server.port ?? 0,
    url: `http://localhost:${server.port}`,
    close: async () => {
      stopWatching?.();
      reloadWaiters = [];
      await new Promise<void>((resolveClose) => {
        server.stop(true);
        resolveClose();
      });
      await surface.store.close();
    },
  };
};

export type { SurfaceError };
export { asError };
