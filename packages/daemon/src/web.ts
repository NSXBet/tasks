import type { TasksSurface } from '@tasks/surface';
import { launchBrowser, startWebServer, type WebServer } from '@tasks/web';

/** Params accepted by `web.start` over the socket. */
export interface WebStartParams {
  /** Workspace root to serve; required — the global daemon hosts any root. */
  readonly root: string;
  readonly port?: number;
  readonly open?: boolean;
}

/** Live web server as reported by `web.start` and `web.status`. */
export interface WebHostServer {
  readonly url: string;
  readonly port: number;
  readonly pid: number;
  readonly startedAt: string;
  readonly dev: boolean;
  /** The workspace this server is currently pointed at. */
  readonly root: string;
}

export type WebHostStatus = { readonly hosting: false } | ({ readonly hosting: true } & WebHostServer);

/**
 * The daemon's web host: at most one web server per daemon, created on demand
 * by `web.start` and reused until `web.stop` or daemon shutdown. The daemon's
 * surface is injected, so the server shares the daemon's store and never
 * closes it — the daemon owns the lifecycle end to end. Each `web.start`
 * names its workspace; a restarted server re-points at the new root.
 */
export const createWebHost = (surfaceFor: (root: string) => Promise<TasksSurface>) => {
  let server: WebServer | undefined;

  const describe = (web: WebServer): WebHostServer => {
    const s = web.status();
    return { url: s.url, port: s.port, pid: s.pid, startedAt: s.startedAt, dev: s.dev, root: s.workspace };
  };

  const start = async (params: WebStartParams): Promise<WebHostServer> => {
    if (server !== undefined) return describe(server);
    const started = await startWebServer({
      root: params.root,
      surface: await surfaceFor(params.root),
      // The server may tear itself down (HTTP /api/stop route, failed ownership
      // probe); this callback is the only hook that covers every stop path, so
      // the next web.start must be able to start fresh.
      onStopped: () => { server = undefined; },
      ...(params.port === undefined ? {} : { port: params.port }),
    });
    server = started;
    if (params.open === true) launchBrowser(started.url);
    return describe(server);
  };

  const stop = async (): Promise<boolean> => {
    if (server === undefined) return false;
    await server.close();
    return true;
  };

  const status = (): WebHostStatus => (server === undefined ? { hosting: false } : { hosting: true, ...describe(server) });

  const hosting = (): boolean => server !== undefined;

  return { start, stop, status, hosting };
};

export type WebHost = ReturnType<typeof createWebHost>;
