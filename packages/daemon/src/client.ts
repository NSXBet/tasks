import { spawn } from 'node:child_process';
import net from 'node:net';
import { join } from 'node:path';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  ContractMismatch,
  expectContract,
  PROTOCOL_VERSION,
  VERBS_VERSION,
  type HelloResult,
  type RpcRequest,
  type RpcResponse,
} from '@tasks/rpc';
import type { WatchEvent } from '@tasks/surface';
import type { DaemonStatus } from './server.js';
import { cleanStaleSocket, daemonSocketPath, delay, socketAlive } from './socket.js';

export interface RpcClient {
  /** Single round trip: send, await the response envelope. */
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** The daemon's pid, captured from pid-bearing responses (daemon.ping). */
  readonly pid: number | undefined;
  /** The socket path the client is riding. */
  readonly socketPath: string;
  /** Graceful stop request (daemon.stop), then end the socket. */
  stop(): Promise<void>;
  /** Immediate teardown. */
  close(): void;
}

export interface ConnectOptions {
  /** Idle-exit delay (ms) used when this call spawns the daemon. */
  readonly idleMs?: number;
  /** Milliseconds to wait for a freshly spawned daemon's socket. Default 5000. */
  readonly spawnTimeoutMs?: number;
  /** Called once when the daemon connection dies (exit or transport loss). */
  readonly onClose?: (error: Error) => void;
  /**
   * Receives unsolicited event frames pushed by the daemon for subscriptions
   * opened on this client (`events.subscribe` / `events.unsubscribe`).
   */
  readonly onEvent?: (subscription: string, event: WatchEvent) => void;
}

/** Thrown when no daemon could be reached or spawned. */
export class DaemonUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DaemonUnavailableError';
  }
}

interface PendingEntry {
  readonly promise: Promise<RpcResponse>;
  readonly resolve: (response: RpcResponse) => void;
}

/** Resolves the first good response for an outstanding request id. */
class PendingMap {
  readonly #pending = new Map<string, PendingEntry>();
  #nextId = 1;

  reserve(): { id: string; settled: Promise<RpcResponse> } {
    const id = String(this.#nextId++);
    const { promise, resolve } = Promise.withResolvers<RpcResponse>();
    this.#pending.set(id, { promise, resolve });
    return { id, settled: promise };
  }

  settle(id: string | undefined, response: RpcResponse): void {
    const entry = id === undefined ? undefined : this.#pending.get(id);
    if (entry === undefined) return; // late frame for an already-settled id
    this.#pending.delete(id!);
    entry.resolve(response);
  }

  /** Fails everything outstanding (connection died). */
  rejectAll(error: Error): void {
    for (const entry of this.#pending.values()) entry.resolve({ v: PROTOCOL_VERSION, ok: false, error: { kind: 'internal', message: `connection lost: ${error.message}` } });
    this.#pending.clear();
  }
}

const CLIENT_CONTRACT = { protocol: PROTOCOL_VERSION, verbs: VERBS_VERSION };

/**
 * Connects to the global tkd daemon, spawning one when the socket is dead or
 * stale (self-heal: stale files are unlinked, then a fresh daemon starts).
 * The given workspace root is stamped onto every request so the daemon serves
 * the right surface. Verifies the hello contract before returning; version
 * drift throws {@link ContractMismatch}.
 */
export const connectOrSpawn = async (root: string, options: ConnectOptions = {}): Promise<RpcClient> => {
  const socketPath = daemonSocketPath();
  const spawnTimeoutMs = options.spawnTimeoutMs ?? 5000;

  let socket: net.Socket;
  if (await socketAlive(socketPath)) {
    try {
      socket = await connectSocket(socketPath);
    } catch {
      // Probe succeeded but connect failed — stale file. Self-heal by spawn.
      await cleanStaleSocket(socketPath);
      socket = await spawnAndConnect(socketPath, options, spawnTimeoutMs);
    }
  } else {
    socket = await spawnAndConnect(socketPath, options, spawnTimeoutMs);
  }

  const client = new SocketClient(socket, socketPath, root, options.onEvent, options.onClose);
  await verifyHello(client);
  return client;
};

/** Opens a raw socket connection to `socketPath`, rejecting after `timeoutMs`. */
const connectSocket = async (socketPath: string, timeoutMs = 1000): Promise<net.Socket> => {
  const { promise: connected, resolve: resolveConnected, reject: rejectConnected } = Promise.withResolvers<net.Socket>();
  const socket = net.connect({ path: socketPath });
  const timer = setTimeout(() => rejectConnected(new Error(`connect timeout: ${socketPath}`)), timeoutMs);
  socket.once('connect', () => {
    clearTimeout(timer);
    resolveConnected(socket);
  });
  socket.once('error', (error: Error) => {
    clearTimeout(timer);
    rejectConnected(error);
  });
  return connected;
};

export const connectDaemon = async (timeoutMs = 1000): Promise<RpcClient | null> => {
  const socketPath = daemonSocketPath();
  if (!(await socketAlive(socketPath, timeoutMs))) return null;
  const socket = await connectSocket(socketPath, timeoutMs).catch(() => null);
  if (socket === null) return null; // probe won the race, connect lost — treat as not running
  const client = new SocketClient(socket, socketPath);
  try {
    await verifyHello(client);
  } catch {
    await cleanStaleSocket(socketPath);
    return null;
  }
  return client;
};

const spawnAndConnect = async (socketPath: string, options: ConnectOptions, spawnTimeoutMs: number): Promise<net.Socket> => {
  // Spawned daemons must never be immortal: 10 minutes after the last call,
  // an unconfigured daemon exits. Callers pass idleMs to pin longer/shorter.
  const args = [join(import.meta.dir, 'main.ts'), '--idle-ms', String(options.idleMs ?? 600_000)];
  const child = spawn(process.execPath, args, { stdio: 'ignore', detached: false });
  child.unref();

  const deadline = Date.now() + spawnTimeoutMs;
  while (Date.now() < deadline) {
    await delay(100);
    if (!(await socketAlive(socketPath))) continue;
    try {
      return await connectSocket(socketPath);
    } catch {
      // keep polling until the deadline
    }
  }
  child.kill();
  throw new DaemonUnavailableError(`daemon did not come up on ${socketPath} within ${spawnTimeoutMs}ms`);
};

/** Hello handshake shared by every connect path: contract check, or close and rethrow. */
const verifyHello = async (client: RpcClient): Promise<void> => {
  try {
    const hello = await client.call('hello');
    if (!Value.Check(HelloResponseSchema, hello)) throw new DaemonUnavailableError('daemon hello did not match the hello contract');
    expectContract(CLIENT_CONTRACT, hello as unknown as HelloResult);
  } catch (error) {
    client.close();
    throw error;
  }
};

class SocketClient implements RpcClient {
  readonly #pending = new PendingMap();
  readonly #socket: net.Socket;
  readonly socketPath: string;
  readonly #root: string | undefined;
  #pid: number | undefined;
  #buffer = '';

  readonly #onEvent: ((subscription: string, event: WatchEvent) => void) | undefined;
  readonly #onClose: ((error: Error) => void) | undefined;

  constructor(
    socket: net.Socket,
    socketPath: string,
    root?: string,
    onEvent?: (subscription: string, event: WatchEvent) => void,
    onClose?: (error: Error) => void,
  ) {
    this.#socket = socket;
    this.socketPath = socketPath;
    this.#root = root;
    this.#onEvent = onEvent;
    this.#onClose = onClose;
    this.#socket.on('data', (chunk: Buffer) => {
      this.#buffer += chunk.toString('utf8');
      let newline = this.#buffer.indexOf('\n');
      while (newline >= 0) {
        const line = this.#buffer.slice(0, newline).trim();
        this.#buffer = this.#buffer.slice(newline + 1);
        newline = this.#buffer.indexOf('\n');
        if (line === '') continue;
        this.#onFrame(line);
      }
    });
    let died = false;
    const die = (error: Error): void => {
      if (!died) {
        died = true;
        this.#onClose?.(error);
      }
      this.#pending.rejectAll(error);
    };
    this.#socket.on('close', () => die(new Error('socket closed')));
    this.#socket.on('error', die);
  }

  #onFrame(line: string): void {
    let response: RpcResponse;
    try {
      response = JSON.parse(line) as RpcResponse;
    } catch {
      return;
    }
    // Unsolicited event frames carry no id and a `subscription` tag; route them
    // to the onEvent hook instead of the pending-response map.
    if (response.id === undefined && 'event' in response && typeof (response as { subscription?: unknown }).subscription === 'string') {
      const frame = response as unknown as { subscription: string; event: WatchEvent };
      this.#onEvent?.(frame.subscription, frame.event);
      return;
    }
    // Capture before settle: pid-bearing responses are themselves pending calls.
    if (response.ok && typeof response.value === 'object' && response.value !== null && 'pid' in response.value && typeof response.value.pid === 'number') {
      this.#pid = response.value.pid;
    }
    this.#pending.settle(response.id, response);
  }

  get pid(): number | undefined {
    return this.#pid;
  }

  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const { id, settled } = this.#pending.reserve();
    // hello carries no root; every other request names the workspace this
    // client was opened for. Rootless clients (management) send none and may
    // only touch daemon.* / web.* / hello.
    const request: RpcRequest = {
      v: PROTOCOL_VERSION,
      id,
      method,
      params,
      ...(this.#root === undefined || method === 'hello' ? {} : { root: this.#root }),
    };
    this.#socket.write(`${JSON.stringify(request)}\n`);
    const response = await settled;
    if (response.ok) return response.value;
    throw new RpcCallError(method, response.error);
  }

  async stop(): Promise<void> {
    await this.call('daemon.stop');
    this.#socket.end();
  }

  close(): void {
    this.#socket.destroy();
  }
}

/** Boundary schema for the daemon's hello payload — validated, then read typed. */
const HelloResponseSchema = Type.Object({
  tk: Type.String(),
  protocol: Type.Number(),
  verbs: Type.Number(),
  methods: Type.Array(Type.String()),
});

/** Carries the RPC wire error into the thrown-exception world of callers. */
export class RpcCallError extends Error {
  constructor(
    readonly method: string,
    readonly wireError: { kind: string; message: string },
  ) {
    super(`${method}: [${wireError.kind}] ${wireError.message}`);
    this.name = 'RpcCallError';
  }
}

/** Boundary schema for `daemon.ping`'s status payload — validated, then read typed. */
const DaemonStatusSchema = Type.Object({
  pid: Type.Number(),
  socketPath: Type.String(),
  roots: Type.Array(Type.String()),
  connections: Type.Number(),
  eventSubscriptions: Type.Number(),
  idleMs: Type.Number(),
  uptimeMs: Type.Number(),
});

/**
 * Inspects the running daemon without spawning one; null when none is alive.
 * Observing or stopping the daemon must not conjure one into existence.
 */
export const probeDaemon = async (timeoutMs = 1000): Promise<DaemonStatus | null> => {
  const socketPath = daemonSocketPath();
  if (!(await socketAlive(socketPath, timeoutMs))) return null;
  const socket = await connectSocket(socketPath, timeoutMs);
  const client = new SocketClient(socket, socketPath);
  try {
    const ping = await client.call('daemon.ping');
    if (!Value.Check(DaemonStatusSchema, ping)) return null;
    return ping as DaemonStatus;
  } catch {
    await cleanStaleSocket(socketPath);
    return null;
  } finally {
    client.close();
  }
};
