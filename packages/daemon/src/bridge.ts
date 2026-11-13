import { PROTOCOL_VERSION } from '@tasks/rpc';
import { connectRawSocket } from './client.js';

export interface BridgeOptions {
  /** Workspace root the MCP session is bound to (`transport.bind`). */
  readonly root: string;
  /** Milliseconds to wait for a freshly spawned daemon's socket. Default 5000. */
  readonly spawnTimeoutMs?: number;
  /** Idle-exit delay (ms) used when this call spawns the daemon. */
  readonly idleMs?: number;
  /** Input stream (default process.stdin). */
  readonly input?: NodeJS.ReadableStream;
  /** Output stream carrying only MCP lines (default process.stdout). */
  readonly output?: NodeJS.WritableStream;
}

/**
 * Stdio MCP bridge: connects to (or spawns) tkd, sends the `transport.bind`
 * RPC frame, waits for its ok reply (never forwarded), then pipes bytes both
 * ways without parsing them. Resolves with an exit code: 0 on stdin EOF or a
 * clean socket close, 1 when the bind is refused or the daemon is unreachable
 * (reason on stderr). Nothing but MCP lines is written to the output.
 */
export const bridgeStdio = async (options: BridgeOptions): Promise<number> => {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  // Hold stdin from the start so early client frames (e.g. server/discover)
  // buffer instead of being lost while the daemon connects.
  const early: Buffer[] = [];
  let inputEnded = false;
  const onEarlyData = (chunk: Buffer | string): void => { early.push(Buffer.from(chunk)); };
  const onEarlyEnd = (): void => { inputEnded = true; };
  input.on('data', onEarlyData);
  input.once('end', onEarlyEnd);

  let socket;
  try {
    ({ socket } = await connectRawSocket({
      ...(options.spawnTimeoutMs === undefined ? {} : { spawnTimeoutMs: options.spawnTimeoutMs }),
      ...(options.idleMs === undefined ? {} : { idleMs: options.idleMs }),
    }));
  } catch (error) {
    process.stderr.write(`tk mcp: daemon unavailable (${error instanceof Error ? error.message : String(error)})\n`);
    return 1;
  }

  const bindId = 'bind';
  const bind = await new Promise<{ readonly ok: boolean; readonly message?: string; readonly rest: string }>((resolve) => {
    let buffer = '';
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      socket.off('data', onData);
      socket.off('close', onClose);
      const line = buffer.slice(0, newline);
      const rest = buffer.slice(newline + 1);
      try {
        const reply = JSON.parse(line) as { ok?: boolean; error?: { message?: string } };
        resolve({ ok: reply.ok === true, ...(reply.error?.message === undefined ? {} : { message: reply.error.message }), rest });
      } catch {
        resolve({ ok: false, message: 'unparseable bind reply', rest });
      }
    };
    const onClose = (): void => resolve({ ok: false, message: 'daemon closed the connection', rest: '' });
    socket.on('data', onData);
    socket.once('close', onClose);
    socket.write(`${JSON.stringify({ v: PROTOCOL_VERSION, id: bindId, method: 'transport.bind', params: { root: options.root } })}\n`);
  });
  if (!bind.ok) {
    process.stderr.write(`tk mcp: transport.bind failed: ${bind.message ?? 'unknown error'}\n`);
    socket.destroy();
    return 1;
  }

  return await new Promise<number>((resolve) => {
    let done = false;
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      input.off('data', onData);
      socket.destroy();
      output.write('', () => resolve(code)); // flush queued output before the caller exits
    };
    const onData = (chunk: Buffer | string): void => { socket.write(chunk); };

    socket.on('data', (chunk: Buffer) => { output.write(chunk); });
    socket.on('close', () => finish(0));
    socket.on('error', (error: Error) => {
      process.stderr.write(`tk mcp: ${error.message}\n`);
      finish(1);
    });

    if (bind.rest !== '') output.write(bind.rest);
    input.off('data', onEarlyData);
    input.off('end', onEarlyEnd);
    for (const chunk of early) socket.write(chunk);
    // stdin EOF is the graceful shutdown signal: half-close so in-flight replies still drain
    // (the daemon closes its side in response), with a short cap in case it does not.
    const onEnd = (): void => {
      socket.end();
      setTimeout(() => finish(0), 500).unref();
    };
    if (inputEnded) { onEnd(); return; }
    input.on('data', onData);
    input.once('end', onEnd);
  });
};
