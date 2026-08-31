/**
 * Watch lifecycle for the extension: spawns the tk-watch child per
 * subscription, parses NDJSON frames, coalesces and delivers notifications to
 * the host session, and keeps the above-editor widget in sync.
 *
 * Notification primitive (verified identical on both hosts):
 *   pi.sendUserMessage(text, { deliverAs: "followUp" })
 * Queued after the current run while streaming; starts a turn when idle.
 */
import type { WatchEvent, WatchSubscription } from "@tasks/surface";
import { spawnWatchChild, type WatchHandle } from "@tasks/surface";
import { renderWatchWidgetLines, type WatchRow } from "./widget.js";

export interface WatchManagerOptions {
  /** Absolute path to the bundled tk-watch.js child script. */
  readonly watchScript: string;
  readonly root: string;
  /** Host session bridge; implemented in index.ts against ExtensionAPI. */
  readonly notify: (text: string) => void;
  readonly refreshWidget: () => void;
  readonly hasUI: () => boolean;
}

interface ActiveWatch {
  readonly id: string;
  readonly handle: WatchHandle;
  readonly subscription: WatchSubscription;
  readonly startedAt: number;
  lastEvent: WatchEvent | null;
}

export class WatchManager {
  readonly #watches = new Map<string, ActiveWatch>();
  readonly #options: WatchManagerOptions;
  #seq = 0;

  constructor(options: WatchManagerOptions) {
    this.#options = options;
  }

  /** Start one subscription; id is derived from filters for dedupe. */
  start(subscription: WatchSubscription): string {
    const id = watchId(subscription);
    const existing = this.#watches.get(id);
    if (existing !== undefined) return id;
    const handle = spawnWatchChild({
      watchScript: this.#options.watchScript,
      root: this.#options.root,
      subscription,
      onEvent: (event) => this.#onEvent(id, event),
      onError: (error) => this.#options.notify(`⚠ tasks watcher error: ${error.message}`),
    });
    this.#watches.set(id, { id, handle, subscription, startedAt: Date.now(), lastEvent: null });
    void handle.done.then(() => {
      // A dead watcher removes itself; the session learns via status tool.
      this.#watches.delete(id);
      this.#options.refreshWidget();
    });
    this.#options.refreshWidget();
    return id;
  }

  stop(id?: string): number {
    if (id === undefined) {
      const count = this.#watches.size;
      for (const watch of this.#watches.values()) watch.handle.stop();
      return count;
    }
    const watch = this.#watches.get(id);
    if (watch === undefined) return 0;
    watch.handle.stop();
    this.#watches.delete(id);
    this.#options.refreshWidget();
    return 1;
  }

  status(): readonly { id: string; seq: number; startedAt: number; lastEvent: WatchEvent | null }[] {
    return [...this.#watches.values()].map((watch) => ({
      id: watch.id,
      seq: watch.handle.seq(),
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
    this.#seq = event.seq;
    const watch = this.#watches.get(id);
    if (watch !== undefined) watch.lastEvent = event;
    this.#options.notify(formatEvent(event));
    this.#options.refreshWidget();
  }

  /** Widget rows; call from the host's 1s refresh tick. */
  widgetRows(): readonly WatchRow[] {
    return [...this.#watches.values()].map((watch) => ({
      name: watch.id,
      detail: watch.lastEvent === null ? "starting…" : `${watch.lastEvent.kind}${watch.lastEvent.issueId === undefined ? "" : ` ${watch.lastEvent.issueId}`}`,
      seq: watch.handle.seq(),
      startedAt: watch.startedAt,
      pending: watch.lastEvent !== null && Date.now() - new Date(watch.lastEvent.at).valueOf() < 5000,
    }));
  }

  /** Widget content factory for ctx.ui.setWidget. */
  widgetComponent(): { invalidate(): void; render(width: number): string[] } {
    return {
      invalidate() {},
      render: (width: number) => renderWatchWidgetLines(this.widgetRows(), width),
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

/** One-line human summary; steered into the session as a followUp message. */
export const formatEvent = (event: WatchEvent): string => {
  const at = event.at.slice(11, 19);
  const id = event.issueId ?? "";
  switch (event.kind) {
    case "issue.created":
      return `📋 tasks: issue ${id} created (${at})`;
    case "issue.updated":
      return `📝 tasks: issue ${id} updated (${at})`;
    case "issue.status_changed":
      return `🔁 tasks: issue ${id} status changed (${at})`;
    case "issue.commented":
      return `💬 tasks: issue ${id} received a comment (${at})`;
    case "issue.deleted":
      return `🗑 tasks: issue ${id} deleted (${at})`;
    case "ready.changed":
      return `✅ tasks: ready set changed — call tasks_ready when idle (${at})`;
    default:
      return `📋 tasks: ${event.kind} ${id} (${at})`;
  }
};
