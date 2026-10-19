import { connectDaemon, probeDaemon } from './client.js';
import { DaemonStartError, startDaemon, type DaemonOptions } from './server.js';
import { cleanStaleSocket, daemonSocketPath } from './socket.js';

const USAGE = `usage: tkd [--idle-ms N]            start the global daemon
       tkd status                  print the running daemon's status or {"running":false}
       tkd stop [--timeout-ms N]   stop the running daemon (idempotent)`;

const idleMsArg = (args: string[]): number | undefined => {
  const index = args.indexOf('--idle-ms');
  if (index < 0) return undefined;
  const raw = args[index + 1];
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`invalid --idle-ms: ${raw ?? '(missing)'}`);
  return value;
};

const timeoutMsArg = (args: string[]): number => {
  const index = args.indexOf('--timeout-ms');
  if (index < 0) return 5000;
  const raw = args[index + 1];
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid --timeout-ms: ${raw ?? '(missing)'}`);
  return value;
};

const start = async (args: string[]): Promise<number> => {
  const idleMs = idleMsArg(args);
  const options: DaemonOptions = idleMs === undefined ? {} : { idleMs };
  try {
    const handle = await startDaemon(options);
    process.stderr.write(`tkd listening on ${handle.socketPath} (pid ${handle.pid})\n`);
    await handle.stopped;
    return 0;
  } catch (error) {
    if (error instanceof DaemonStartError) {
      process.stderr.write(`tkd: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
};

const status = async (): Promise<number> => {
  const running = await probeDaemon();
  process.stdout.write(`${JSON.stringify(running === null ? { running: false, socketPath: daemonSocketPath() } : { running: true, ...running })}\n`);
  return 0;
};

const stop = async (args: string[]): Promise<number> => {
  const timeoutMs = timeoutMsArg(args);
  if (!(await probeDaemon(timeoutMs))) {
    await cleanStaleSocket(daemonSocketPath());
    process.stdout.write(`${JSON.stringify({ stopped: false, reason: 'not-running' })}\n`);
    return 0;
  }
  try {
    const client = await connectDaemon(timeoutMs);
    if (client === null) throw new Error('daemon vanished between probe and connect');
    await client.stop();
    client.close();
    process.stdout.write(`${JSON.stringify({ stopped: true })}\n`);
  } catch {
    // The stop call raced a dying daemon — the socket is going away either way.
    await cleanStaleSocket(daemonSocketPath());
    process.stdout.write(`${JSON.stringify({ stopped: false, reason: 'daemon-unreachable' })}\n`);
    return 1;
  }
  return 0;
};

/** tkd — the global daemon: start (default), `status`, or `stop`. */
const main = async (): Promise<number> => {
  const args = process.argv.slice(2);
  const command = args[0];
  try {
    if (command === 'status') return await status();
    if (command === 'stop') return await stop(args.slice(1));
    return await start(args);
  } catch (error) {
    process.stderr.write(`tkd: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
};

process.exitCode = await main();
