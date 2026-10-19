import net from 'node:net';
import {
  createSurface,
  MessageError,
  rootFrom,
  type SurfaceStore,
  type TasksSurface,
} from '@tasks/surface';
import {
  dispatchRpc,
  PROTOCOL_VERSION,
  rpcResponse,
  type RpcRequest,
  type RpcResponse,
  type SurfaceLease,
} from '@tasks/rpc';
import { PortBusyError } from '@tasks/web';
import { cleanStaleSocket, daemonSocketPath, socketAlive } from './socket.js';
import { asWatchKinds, createEventsHost, eventsSubscribeError, type EventsSubscribeParams } from './events.js';
import { createWebHost, type WebStartParams } from './web.js';

/** Rejected when a daemon is already listening on the global socket. */
export class DaemonStartError extends Error {
  constructor(message: string, readonly code: 'already_running') {
    super(message);
    this.name = 'DaemonStartError';
  }
}

export interface DaemonStatus {
  readonly pid: number;
  readonly socketPath: string;
  /** Resolved workspace roots currently holding open surfaces. */
  readonly roots: readonly string[];
  readonly connections: number;
  readonly eventSubscriptions: number;
  readonly idleMs: number;
  readonly uptimeMs: number;
}

export interface DaemonHandle {
  readonly socketPath: string;
  readonly pid: number;
  status(): DaemonStatus;
  stop(): Promise<void>;
  /** Resolves once the socket is closed and removed. */
  readonly stopped: Promise<void>;
}

export interface DaemonOptions {
  /** Idle exit delay in ms with zero connections; 0 disables idle exit. */
  readonly idleMs?: number;
}

const DEFAULT_IDLE_MS = 10 * 60 * 1000;

/**
 * The tkd socket server: one global daemon per user, hosting the RPC verb
 * table over ndjson frames for any tasks workspace. Clients name the workspace
 * (`root`) per request; the daemon caches one surface per root and serves it
 * to every consumer (CLI status/stop, `web.start` hosting, `events.subscribe`
 * watch loops). The daemon self-heals (stale socket cleanup, spawn-on-connect
 * from the client side) and idles out when nothing holds a connection.
 */
export const startDaemon = async (options: DaemonOptions = {}): Promise<DaemonHandle> => {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const socketPath = daemonSocketPath();
  if (await socketAlive(socketPath)) {
    throw new DaemonStartError(`daemon already running on ${socketPath}`, 'already_running');
  }
  await cleanStaleSocket(socketPath);

  /** Open surfaces keyed by resolved workspace root; closed at shutdown. */
  const surfaces = new Map<string, TasksSurface>();
  /** In-flight openSurface promises so concurrent provide() calls share one open. */
  const opening = new Map<string, Promise<TasksSurface>>();

  const surfaceFor = async (root: string): Promise<TasksSurface> => {
    // Only actual tasks workspaces (a `.tasks/` directory) get surfaces; the
    // store would otherwise happily open an empty one and mask the bad root.
    if ((await rootFrom(root)) !== root) {
      throw new MessageError(`not a tasks workspace: ${root}`);
    }
    const cached = surfaces.get(root);
    if (cached !== undefined) return cached;
    const pending = opening.get(root);
    if (pending !== undefined) return pending;
    const opened = createSurface({ root }).then((surface) => {
      opening.delete(root);
      surfaces.set(root, surface);
      return surface;
    });
    opening.set(root, opened);
    return opened;
  };

  /** Store resolver for the events host; failures restart the loop (surfaced as restart delays). */
  const storeFor = async (root: string): Promise<SurfaceStore> => (await surfaceFor(root)).store;

  const provide = async (root: string): Promise<SurfaceLease> => ({
    surface: await surfaceFor(root),
    dispose: async () => {},
  });

  const events = createEventsHost(storeFor);
  const web = createWebHost(surfaceFor);

  const connections = new Set<net.Socket>();
  const { promise: stopped, resolve: resolveStopped } = Promise.withResolvers<void>();
  const startedAt = Date.now();
  let stopping = false;
  let idleTimer: NodeJS.Timeout | undefined;

  const idleCheck = (): void => {
    if (stopping || idleMs === 0) return;
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    if (connections.size > 0 || events.count() > 0) return;
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      void shutdown();
    }, idleMs);
    idleTimer.unref?.();
  };

  const writeResponse = (socket: net.Socket, response: RpcResponse): void => {
    if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
  };

  const handleFrame = async (socket: net.Socket, line: string): Promise<void> => {
    let request: RpcRequest;
    try {
      request = JSON.parse(line) as RpcRequest;
    } catch {
      return;
    }
    if (request.method === 'web.start') {
      const params = (request.params ?? {}) as Partial<WebStartParams>;
      if (typeof params.root !== 'string' || params.root === '') {
        writeResponse(socket, { v: PROTOCOL_VERSION, ...(request.id === undefined ? {} : { id: request.id }), ok: false, error: { kind: 'param_invalid', message: 'web.start: root must be a non-empty workspace path' } });
        return;
      }
      try {
        writeResponse(socket, { v: PROTOCOL_VERSION, ...(request.id === undefined ? {} : { id: request.id }), ok: true, value: await web.start({ root: params.root, ...(params.port === undefined ? {} : { port: params.port }), ...(params.open === undefined ? {} : { open: params.open }) }) });
      } catch (error) {
        writeResponse(socket, {
          v: PROTOCOL_VERSION,
          ...(request.id === undefined ? {} : { id: request.id }),
          ok: false,
          error: { kind: error instanceof PortBusyError ? 'port_busy' : 'internal', message: error instanceof Error ? error.message : String(error) },
        });
      }
      return;
    }
    if (request.method === 'web.stop') {
      writeResponse(socket, { v: PROTOCOL_VERSION, ...(request.id === undefined ? {} : { id: request.id }), ok: true, value: { stopped: await web.stop() } });
      return;
    }
    if (request.method === 'web.status') {
      writeResponse(socket, { v: PROTOCOL_VERSION, ...(request.id === undefined ? {} : { id: request.id }), ok: true, value: web.status() });
      return;
    }
    if (request.method === 'events.subscribe') {
      const error = eventsSubscribeError(request.params);
      if (error !== null) {
        writeResponse(socket, { v: PROTOCOL_VERSION, ...(request.id === undefined ? {} : { id: request.id }), ok: false, error: { kind: 'param_invalid', message: error } });
        return;
      }
      const params = request.params as EventsSubscribeParams;
      const kinds = asWatchKinds(params.kinds);
      events.subscribe(socket, { ...params, ...(kinds === undefined ? {} : { kinds }) });
      writeResponse(socket, { v: PROTOCOL_VERSION, ...(request.id === undefined ? {} : { id: request.id }), ok: true, value: { subscribed: params.subscription } });
      idleCheck();
      return;
    }
    if (request.method === 'events.unsubscribe') {
      const tag = (request.params as { subscription?: string } | undefined)?.subscription;
      events.unsubscribe(socket, typeof tag === 'string' ? tag : undefined);
      writeResponse(socket, { v: PROTOCOL_VERSION, ...(request.id === undefined ? {} : { id: request.id }), ok: true, value: {} });
      return;
    }
    if (request.method === 'daemon.ping') {
      writeResponse(socket, { v: PROTOCOL_VERSION, ...(request.id === undefined ? {} : { id: request.id }), ok: true, value: status() });
      return;
    }
    if (request.method === 'daemon.stop') {
      writeResponse(socket, { v: PROTOCOL_VERSION, ...(request.id === undefined ? {} : { id: request.id }), ok: true, value: {} });
      void shutdown();
      return;
    }
    const outcome = await dispatchRpc(request, provide, { actor: process.env['USER'] ?? 'unknown' });
    writeResponse(socket, rpcResponse(request, outcome));
  };

  const server = net.createServer((socket) => {
    connections.add(socket);
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
    let buffer = '';
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (line !== '') void handleFrame(socket, line);
      }
    });
    socket.on('close', () => {
      connections.delete(socket);
      events.drop(socket);
      idleCheck();
    });
    socket.on('error', () => {});
  });

  const { promise: alive, resolve: resolveAlive } = Promise.withResolvers<void>();
  server.listen(socketPath, () => resolveAlive());
  await alive;

  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const socket of connections) socket.destroy();
    // Hosted web (if any) unregisters its own runtime row on close; event
    // subscriptions stop with the daemon. Every cached surface closes.
    events.stopAll();
    await web.stop();
    await Promise.allSettled([...surfaces.values()].map((surface) => surface.store.close()));
    await cleanStaleSocket(socketPath);
    resolveStopped();
  };

  const status = (): DaemonStatus => ({
    pid: process.pid,
    socketPath,
    roots: [...surfaces.keys()],
    connections: connections.size,
    eventSubscriptions: events.count(),
    idleMs,
    uptimeMs: Date.now() - startedAt,
  });

  return {
    socketPath,
    pid: process.pid,
    status,
    stop: async () => {
      await shutdown();
    },
    stopped,
  };
};
