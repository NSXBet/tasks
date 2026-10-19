/**
 * Watch lifecycle for the extension: runs the watch poll loop IN-PROCESS per
 * subscription (the previous spawn-a-child design broke under omp, whose
 * execPath is the omp binary, not bun), coalesces and delivers notifications
 * to the host session, and keeps the above-editor widget in sync.
 *
 * Opt-in daemon transport (`useDaemon`, i.e. `TK_EVENTS=daemon`): each
 * subscription rides the tkd socket instead (`events.subscribe`), so the poll
 * cost lives in the shared daemon. Daemon death mid-session falls back to the
 * in-process loop transparently.
 *
 * Notification primitive (verified identical on both hosts):
 *   pi.sendUserMessage(text, { deliverAs: "followUp" })
 * Queued after the current run while streaming; starts a turn when idle.
 */
import type { WatchCounts, WatchEvent, WatchSubscription } from "@tasks/surface";
import { runWatchLoop } from "@tasks/surface";
import { openSurfaceStore, type SurfaceStore } from "@tasks/surface";
import { connectOrSpawn } from "../../daemon/src/index.ts";
import { renderWatchWidgetLines, type WatchRow } from "./widget.ts";

export interface WatchManagerOptions {
  readonly root: string;
  /** Opt-in daemon transport (`TK_EVENTS=daemon`): subscriptions ride the tkd socket. */
  readonly useDaemon?: boolean;
  /** Host session bridge; implemented in index.ts against ExtensionAPI. */
  readonly notify: (text: string) => void;
  readonly refreshWidget: () => void;
  readonly hasUI: () => boolean;
}

interface ActiveWatch {
  readonly id: string;
  readonly subscription: WatchSubscription;
  readonly startedAt: number;
  readonly stop: () => void;
  readonly done: Promise<void>;
  lastEvent: WatchEvent | null;
}

export class WatchManager {
  readonly #watches = new Map<string, ActiveWatch>();
  /** Ids whose start() is still connecting; guards concurrent duplicate starts. */
  readonly #pending = new Set<string>();
  readonly #options: WatchManagerOptions;
  #store: SurfaceStore | null = null;
  /** Latest board counters; refreshed on every delivered event. */
  #counts: WatchCounts | null = null;

  constructor(options: WatchManagerOptions) {
    this.#options = options;
  }

  /** Readonly store shared by all in-process watch loops (lazy). */
  async #watchStore(): Promise<SurfaceStore> {
    if (this.#store === null) {
      this.#store = await openSurfaceStore(this.#options.root, { readonly: true });
    }
    return this.#store;
  }

  /** Latest counts; null until the first poll tick delivered an event. */
  counts(): WatchCounts | null {
    return this.#counts;
  }
  /** Close the shared readonly watch store; call on session shutdown. */
  async close(): Promise<void> {
    this.stopAll();
    await this.#store?.close();
    this.#store = null;
  }

  /** Start one subscription; id is derived from filters for dedupe. */
  async start(subscription: WatchSubscription): Promise<string> {
    const id = watchId(subscription);
    if (this.#watches.has(id) || this.#pending.has(id)) return id;
    this.#pending.add(id);
    try {
      const watch = this.#options.useDaemon === true
        ? await this.#startDaemon(id, subscription).catch(() => this.#startInProcess(id, subscription))
        : this.#startInProcess(id, subscription);
      this.#adopt(watch);
      return id;
    } finally {
      this.#pending.delete(id);
    }
  }

  /** Registers a watch: map entry, self-removal on completion, widget refresh. */
  #adopt(watch: ActiveWatch): void {
    this.#watches.set(watch.id, watch);
    void watch.done.then(() => {
      // A dead watcher removes itself; the session learns via status tool.
      if (this.#watches.get(watch.id) === watch) {
        this.#watches.delete(watch.id);
        this.#options.refreshWidget();
      }
    });
    this.#options.refreshWidget();
  }

  /** In-process transport: the poll loop runs inside this process. */
  #startInProcess(id: string, subscription: WatchSubscription): ActiveWatch {
    let stopping = false;
    const done = (async () => {
      try {
        const store = await this.#watchStore();
        await runWatchLoop(store, subscription, (event) => this.#onEvent(id, event), () => stopping || !this.#watches.has(id));
      } catch (cause) {
        if (this.#watches.has(id)) this.#options.notify(`⚠ tasks watcher error: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    })();
    return {
      id,
      subscription,
      startedAt: Date.now(),
      stop: () => { stopping = true; },
      done,
      lastEvent: null,
    };
  }

  /** Daemon transport: events arrive over the tkd socket (`events.subscribe`). */
  async #startDaemon(id: string, subscription: WatchSubscription): Promise<ActiveWatch> {
    const { promise: closed, resolve: resolveClosed } = Promise.withResolvers<void>();
    let stopping = false;
    let self: ActiveWatch | undefined;
    const client = await connectOrSpawn(this.#options.root, {
      onEvent: (tag, event) => {
        if (tag === id) this.#onEvent(id, event);
      },
      onClose: (error) => {
        resolveClosed();
        // Daemon death mid-session: transparently fall back to the in-process
        // loop rather than silently dropping the subscription.
        if (stopping || self === undefined || this.#watches.get(id) !== self) return;
        this.#watches.delete(id);
        this.#adopt(this.#startInProcess(id, subscription));
        this.#options.notify(`⚠ tasks daemon lost — watching in-process (${error.message})`);
      },
    });
    try {
      await client.call('events.subscribe', { subscription: id, root: this.#options.root, ...subscription });
    } catch (cause) {
      client.close();
      throw cause;
    }
    self = {
      id,
      subscription,
      startedAt: Date.now(),
      stop: () => {
        stopping = true;
        resolveClosed();
        // Dropping the socket unsubscribes server-side; no round-trip needed.
        client.close();
      },
      done: closed,
      lastEvent: null,
    };
    return self;
  }

  stop(id?: string): number {
    if (id === undefined) {
      const count = this.#watches.size;
      for (const watch of [...this.#watches.values()]) watch.stop();
      this.#watches.clear();
      this.#options.refreshWidget();
      return count;
    }
    const watch = this.#watches.get(id);
    if (watch === undefined) return 0;
    watch.stop();
    this.#watches.delete(id);
    this.#options.refreshWidget();
    return 1;
  }

  status(): readonly { id: string; seq: number; startedAt: number; lastEvent: WatchEvent | null }[] {
    return [...this.#watches.values()].map((watch) => ({
      id: watch.id,
      seq: watch.lastEvent === null ? 0 : watch.lastEvent.seq,
      startedAt: watch.startedAt,
      lastEvent: watch.lastEvent,
    }));
  }

  get size(): number {
    return this.#watches.size;
  }

  stopAll(): void {
    this.stop();
  }

  #onEvent(id: string, event: WatchEvent): void {
    if (event.counts !== undefined) this.#counts = event.counts;
    const watch = this.#watches.get(id);
    if (watch !== undefined) watch.lastEvent = event;
    this.#options.notify(formatEvent(event, this.#counts));
    this.#options.refreshWidget();
  }

  /** Widget rows; call from the host's 1s refresh tick. */
  widgetRows(): readonly WatchRow[] {
    return [...this.#watches.values()].map((watch) => ({
      name: watch.id,
      detail: watch.lastEvent === null ? "starting…" : `${watch.lastEvent.kind}${watch.lastEvent.issueId === undefined ? "" : ` ${watch.lastEvent.issueId}`}`,
      seq: watch.lastEvent === null ? 0 : watch.lastEvent.seq,
      startedAt: watch.startedAt,
      pending: watch.lastEvent !== null && Date.now() - new Date(watch.lastEvent.at).valueOf() < 5000,
    }));
  }

  /** Widget content factory for ctx.ui.setWidget. */
  widgetComponent(): { invalidate(): void; render(width: number): string[] } {
    return {
      invalidate() {},
      render: (width: number) => renderWatchWidgetLines(this.widgetRows(), this.#counts, width),
    };
  }
}

const watchId = (subscription: WatchSubscription): string => {
  const parts = [
    subscription.kinds === undefined ? "all" : subscription.kinds.join("+"),
    subscription.ids === undefined ? "" : subscription.ids.join("+"),
    subscription.label ?? "",
  ].filter(Boolean);
  return parts.join(":") || "all";
};

/** Icon-prefixed board counters: 🟢 open · ⛔ blocked · 👀 ready-to-review. */
export const formatCounts = (counts: WatchCounts): string =>
  `🟢 ${counts.open} open · ⛔ ${counts.blocked} blocked · 👀 ${counts.readyToReview} ready-to-review`;

/** One-line human summary; steered into the session as a followUp message. */
export const formatEvent = (event: WatchEvent, counts?: WatchCounts | null): string => {
  const at = event.at.slice(11, 19);
  const id = event.issueId ?? "";
  const board = counts === undefined ? (event.counts === undefined ? null : formatCounts(event.counts)) : (counts === null ? null : formatCounts(counts));
  const suffix = board === null ? "" : ` · ${board}`;
  switch (event.kind) {
    case "issue.created":
      return `📋 tasks: issue ${id} created (${at})${suffix}`;
    case "issue.updated":
      return `📝 tasks: issue ${id} updated (${at})${suffix}`;
    case "issue.status_changed":
      return `🔁 tasks: issue ${id} status changed (${at})${suffix}`;
    case "issue.commented":
      return `💬 tasks: issue ${id} received a comment (${at})${suffix}`;
    case "issue.deleted":
      return `🗑 tasks: issue ${id} deleted (${at})${suffix}`;
    case "ready.changed":
      return `✅ tasks: ready set changed — call tasks_ready when idle (${at})${suffix}`;
    case "counts.changed":
      return `📊 tasks: board counts changed — ${board ?? formatCounts(event.counts ?? { open: 0, blocked: 0, readyToReview: 0 })} (${at})`;
    case "run.changed": {
      const runId = event.data?.runId ?? "";
      const transition = event.data?.from !== undefined && event.data?.to !== undefined ? `${event.data.from} → ${event.data.to}` : (event.data?.to ?? "");
      return `🏃 tasks: run ${runId} for issue ${id} — ${transition} (${at})${suffix}`;
    }
    default:
      return `📋 tasks: ${event.kind} ${id} (${at})${suffix}`;
  }
};