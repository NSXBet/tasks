import net from 'node:net';
import {
  runWatchLoop,
  type SurfaceStore,
  type WatchEvent,
  type WatchEventKind,
  type WatchSubscription,
} from '@tasks/surface';

/**
 * The daemon's events host: per-connection `events.subscribe` subscriptions
 * backed by the in-process watch loop. Each subscribing socket gets its own
 * loop (delivers ndjson event frames only to that socket); unsubscribing or
 * dropping the socket stops it. A loop that exhausts its error budget restarts
 * after a short delay while its socket lives. The global daemon serves every
 * workspace: each subscription names its `root` and the host leases a store
 * for it on demand.
 */

/** Restart delay for a subscription loop that died on its own. */
const RESTART_DELAY_MS = 1000;

/** The validated `events.subscribe` params. */
export interface EventsSubscribeParams extends WatchSubscription {
  /** Caller-chosen tag; replaces an existing subscription with the same tag. */
  readonly subscription: string;
  /** Workspace root this subscription watches (required — global daemon). */
  readonly root: string;
}

/** One live subscription: its tag, params, stop flag, and loop lifecycle. */
interface DaemonWatch {
  readonly params: EventsSubscribeParams;
  stopping: boolean;
  restartTimer: NodeJS.Timeout | undefined;
}

export interface EventsHost {
  /** Starts (or replaces) a subscription for a socket. */
  readonly subscribe: (socket: net.Socket, params: EventsSubscribeParams) => void;
  /** Stops one subscription (tag) on a socket; all when the tag is omitted. */
  readonly unsubscribe: (socket: net.Socket, subscription?: string) => void;
  /** Stops every subscription owned by a dropped socket. */
  readonly drop: (socket: net.Socket) => void;
  /** Stops every subscription (daemon shutdown). */
  readonly stopAll: () => void;
  /** Number of live subscriptions; > 0 pins the daemon against idle exit. */
  readonly count: () => number;
}

export const createEventsHost = (storeFor: (root: string) => Promise<SurfaceStore>): EventsHost => {
  const bySocket = new Map<net.Socket, Map<string, DaemonWatch>>();

  /** Schedules a fresh loop for a subscription whose loop exited on its own. */
  const scheduleRestart = (socket: net.Socket, watch: DaemonWatch): void => {
    if (watch.stopping || socket.destroyed || !socket.writable) return;
    watch.restartTimer = setTimeout(() => {
      if (watch.stopping || socket.destroyed || !socket.writable) return;
      bySocket.get(socket)?.delete(watch.params.subscription);
      start(socket, watch.params);
    }, RESTART_DELAY_MS);
    watch.restartTimer.unref?.();
  };

  const start = (socket: net.Socket, params: EventsSubscribeParams): DaemonWatch => {
    const watch: DaemonWatch = { params, stopping: false, restartTimer: undefined };
    void storeFor(params.root)
      .then((store) =>
        runWatchLoop(
          store,
          params,
          (event: WatchEvent) => {
            if (watch.stopping || socket.destroyed || !socket.writable) return;
            socket.write(`${JSON.stringify({ v: 1, subscription: params.subscription, event })}\n`);
          },
          () => watch.stopping,
        ),
      )
      .then(
        // Loop exited cleanly (shouldStop never set — socket outlived it) or
        // with a thrown error: either way, restart while the socket lives. A
        // dropped socket ends the subscription instead.
        () => scheduleRestart(socket, watch),
        () => scheduleRestart(socket, watch),
      );
    return watch;
  };

  const stop = (watch: DaemonWatch): void => {
    watch.stopping = true;
    if (watch.restartTimer !== undefined) clearTimeout(watch.restartTimer);
  };

  return {
    subscribe: (socket, params) => {
      let subs = bySocket.get(socket);
      if (subs === undefined) {
        subs = new Map();
        bySocket.set(socket, subs);
      }
      const existing = subs.get(params.subscription);
      if (existing !== undefined) {
        stop(existing);
        subs.delete(params.subscription);
      }
      subs.set(params.subscription, start(socket, params));
    },
    unsubscribe: (socket, subscription) => {
      const subs = bySocket.get(socket);
      if (subs === undefined) return;
      for (const [tag, watch] of subs) {
        if (subscription !== undefined && tag !== subscription) continue;
        stop(watch);
        subs.delete(tag);
      }
      if (subs.size === 0) bySocket.delete(socket);
    },
    drop: (socket) => {
      const subs = bySocket.get(socket);
      if (subs === undefined) return;
      for (const watch of subs.values()) stop(watch);
      bySocket.delete(socket);
    },
    stopAll: () => {
      for (const subs of bySocket.values()) {
        for (const watch of subs.values()) stop(watch);
      }
      bySocket.clear();
    },
    count: () => {
      let total = 0;
      for (const subs of bySocket.values()) total += subs.size;
      return total;
    },
  };
};

/** Validates `events.subscribe` params; returns the error message or null. */
export const eventsSubscribeError = (params: unknown): string | null => {
  if (typeof params !== 'object' || params === null) return 'events.subscribe: params object required';
  const p = params as Partial<EventsSubscribeParams>;
  if (typeof p.subscription !== 'string' || p.subscription === '') return 'events.subscribe: subscription must be a non-empty string';
  if (typeof p.root !== 'string' || p.root === '') return 'events.subscribe: root must be a non-empty workspace path';
  if (p.kinds !== undefined) {
    if (!Array.isArray(p.kinds) || p.kinds.some((k) => typeof k !== 'string')) return 'events.subscribe: kinds must be an array of strings';
  }
  if (p.ids !== undefined) {
    if (!Array.isArray(p.ids) || p.ids.some((id) => typeof id !== 'string' || id === '')) return 'events.subscribe: ids must be non-empty strings';
  }
  if (p.label !== undefined && typeof p.label !== 'string') return 'events.subscribe: label must be a string';
  if (p.interval !== undefined && (typeof p.interval !== 'number' || !Number.isInteger(p.interval) || p.interval <= 0)) {
    return 'events.subscribe: interval must be a positive integer';
  }
  return null;
};

/** Asserts the wire kind union at the daemon boundary (parse, don't guess). */
export const asWatchKinds = (kinds: readonly string[] | undefined): WatchEventKind[] | undefined =>
  kinds === undefined ? undefined : ([...kinds] as WatchEventKind[]);
