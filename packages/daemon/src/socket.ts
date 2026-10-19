import { unlink } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * One global daemon per user. The socket lives under the OS temp dir with a
 * fixed name (short enough for macOS's ~104-char bind limit and stable across
 * repo moves); `TKD_SOCKET` overrides it so tests never share a namespace.
 */
export const daemonSocketPath = (): string => process.env['TKD_SOCKET'] ?? join(tmpdir(), 'tkd.sock');

/** Removes a leftover socket file; ENOENT is fine, anything else is real. */
export const cleanStaleSocket = async (socketPath: string): Promise<void> => {
  try {
    await unlink(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
};

/**
 * Probes a socket with a best-effort TCP-level connect. Resolves true when
 * something is listening (a live daemon), false when nothing responds (stale
 * file or fresh path). Never throws.
 */
export const socketAlive = (socketPath: string, timeoutMs = 750): Promise<boolean> => {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const probe = net.connect({ path: socketPath });
  const settle = (alive: boolean): void => {
    probe.removeAllListeners();
    probe.destroy();
    resolve(alive);
  };
  probe.setTimeout(timeoutMs, () => settle(false));
  probe.once('connect', () => settle(true));
  probe.once('error', () => settle(false));
  return promise;
};

/** Resolves after `ms` milliseconds. */
export const delay = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};
