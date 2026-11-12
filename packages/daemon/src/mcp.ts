import type net from 'node:net';
import {
  fromJsonSchema,
  McpServer,
  ReadBuffer,
  serializeMessage,
  type JSONRPCMessage,
  type JsonSchemaType,
  type Transport,
} from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { dispatchRpc, mcpToolName, PROTOCOL_VERSION, VERB_TABLE, type RpcContext, type SurfaceLease } from '@tasks/rpc';

/**
 * MCP transport over an already-accepted unix socket: newline-delimited
 * JSON-RPC, the same framing as the MCP stdio binding (and the daemon's RPC
 * ndjson). `pending` carries bytes the daemon already read past the first line
 * while sniffing the protocol, so nothing is lost on handoff.
 */
export class SocketTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private readonly buffer = new ReadBuffer();
  private closed = false;

  constructor(private readonly socket: net.Socket, private readonly pending: string = '') {}

  async start(): Promise<void> {
    this.socket.on('data', (chunk: Buffer) => this.feed(chunk));
    this.socket.on('error', (error) => this.onerror?.(error));
    this.socket.on('close', () => this.finish());
    if (this.pending !== '') this.feed(Buffer.from(this.pending, 'utf8'));
  }

  private feed(chunk: Buffer): void {
    this.buffer.append(chunk);
    for (;;) {
      let message: JSONRPCMessage | null;
      try {
        message = this.buffer.readMessage();
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
        continue; // ReadBuffer drops the bad line; keep draining.
      }
      if (message === null) return;
      this.onmessage?.(message);
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.socket.destroyed) this.socket.write(serializeMessage(message));
  }

  async close(): Promise<void> {
    this.socket.end();
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.buffer.clear();
    this.onclose?.();
  }
}

export interface McpServerDeps {
  /** Connection's bound default root (`transport.bind`), read per call; undefined when unbound. */
  readonly root: () => string | undefined;
  readonly provide: (root: string) => Promise<SurfaceLease>;
  readonly ctx: RpcContext;
}

const SERVER_VERSION = '0.1.0';

/** Adds the optional stateless `root` override to a verb's JSON-Schema params. */
const toolSchema = (params: unknown): JsonSchemaType => {
  const base = (params ?? { type: 'object', additionalProperties: false }) as { properties?: Record<string, unknown> } & Record<string, unknown>;
  return {
    ...base,
    type: 'object',
    properties: { ...(base.properties ?? {}), root: { type: 'string', description: 'Absolute workspace root; overrides the connection default set by transport.bind.' } },
  } as JsonSchemaType;
};

/**
 * One McpServer per connection: a tool per VERB_TABLE entry (sorted for a
 * deterministic `tools/list`). Tool-execution failures are results with
 * `isError: true`, never JSON-RPC errors.
 */
export const createMcpServer = (deps: McpServerDeps): McpServer => {
  const server = new McpServer({ name: 'tk', version: SERVER_VERSION });
  for (const method of Object.keys(VERB_TABLE).sort()) {
    const verb = VERB_TABLE[method]!;
    server.registerTool(
      mcpToolName(method),
      { description: verb.description, inputSchema: fromJsonSchema<Record<string, unknown>>(toolSchema(verb.params)) },
      async (args: Record<string, unknown>) => {
        const { root: override, ...params } = args ?? {};
        const root = typeof override === 'string' && override !== '' ? override : deps.root();
        const outcome = await dispatchRpc({ v: PROTOCOL_VERSION, method, params, ...(root === undefined ? {} : { root }) }, deps.provide, deps.ctx);
        if (!outcome.ok) {
          return { content: [{ type: 'text' as const, text: `error ${outcome.error.kind}: ${outcome.error.message}` }], isError: true };
        }
        const value = outcome.value;
        const structured = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };
        return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }], structuredContent: structured, isError: false };
      },
    );
  }
  return server;
};

/**
 * Serves MCP on one accepted socket. `serveStdio` owns the era decision (the
 * opening message selects 2026-07-28 vs legacy `initialize`; legacy is served
 * by default) and builds one McpServer per connection from the factory. It
 * starts and closes the transport.
 */
export const serveMcp = (socket: net.Socket, pending: string, deps: McpServerDeps): void => {
  serveStdio(() => createMcpServer(deps), { transport: new SocketTransport(socket, pending) });
};
