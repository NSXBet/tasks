/**
 * The agent inbox (D-04): tails `.tasks/events.jsonl` in-process from the
 * session's cursor (`pi:<session>`) and turns what a reviewer does on the
 * tasks this session follows into followUp messages, with the next command:
 *
 * - a sent review batch → one message listing every card
 * - a plain comment from someone else → `next: tk work <id>`
 * - status → approved / rejected → `next: tk close <id>` / `tk work <id>`
 * - a PR change (`task.pr`, written only by `tk pr` verbs) → `🔀 PR #<n> on <id> — <state> (<url>)`,
 *   plus `next: tk close <id>` when merged
 *
 * PR and verdict messages end with the task's stat card (optional `card`, the
 * `TasksSurface.changes` ladder): counts and links only, never a diff.
 *
 * Followed tasks: ids touched through the tools (`follow(ids)`), tasks whose
 * `metadata.worktree` contains the session cwd, and tasks whose
 * `metadata.agent_session` is this session. Events this session caused
 * (envelope `session`) are never echoed back. At start, the gap past the
 * cursor is drained into one "while you were away" brief; a first-ever
 * session seeds its cursor at the log end instead (no history dump).
 *
 * The extension only reads the log and writes its own cursor; it never
 * appends to the log.
 */
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  drainEvents, followEvents, lastEventSeq, openSurfaceStore, parseEventQuery, readCursor, seedCursor,
  type FollowHandle, type SurfaceStore, type TaskEvent,
} from "@tasks/surface";

/** Types the inbox reads: comments, verdicts and PR changes are delivered; worktree moves only grow the follow set. */
export const INBOX_TYPES = ["task.comment", "task.status", "task.pr"] as const;
const INBOX_QUERY = parseEventQuery(`type=${[...INBOX_TYPES, "task.worktree"].join("|")}`);
/** Per-task coalescing window: a burst (e.g. one send = one line per card) becomes one message. */
export const INBOX_COALESCE_MS = 250;

export interface InboxOptions {
  readonly root: string;
  readonly session: string;
  readonly cwd: string;
  readonly notify: (text: string) => void;
  /** Override the coalescing window (tests). */
  readonly coalesceMs?: number;
  /**
   * The stat card line for a task (counts + links, never a diff), appended to PR and verdict messages.
   * Null, a throw or a rejection leaves the message unchanged.
   */
  readonly card?: (task: string) => Promise<string | null>;
}

export interface Inbox {
  start(): Promise<void>;
  follow(ids: readonly string[]): void;
  stop(): Promise<void>;
  /** Followed task ids (diagnostics / tests). */
  followed(): readonly string[];
}

/** Cursor name of a session's inbox (and its `tasks_wait`). */
export const inboxSubscriber = (session: string): string => `pi:${session}`;

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u009b[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-_]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** Strips ANSI escapes and C0/C1 controls and collapses whitespace (T-10-28). */
export const sanitize = (value: unknown): string =>
  String(value ?? "").replace(ANSI, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const isSentCard = (event: TaskEvent): boolean => event.type === "task.comment" && event.data["kind"] === "review" && event.data["to"] === "sent";
const isNote = (event: TaskEvent): boolean => event.type === "task.comment" && event.data["kind"] === "note";
const isVerdict = (event: TaskEvent): boolean => event.type === "task.status" && (event.data["to"] === "approved" || event.data["to"] === "rejected");
const PR_STATES = ["open", "closed", "merged"];
const isPr = (event: TaskEvent): boolean => {
  if (event.type !== "task.pr") return false;
  const number = event.data["number"];
  return typeof number === "number" && Number.isInteger(number) && number > 0 && PR_STATES.includes(String(event.data["state"]));
};
/** Only these reach the agent. Other review moves (resolve, dismiss, reopen) and other status moves stay silent. */
export const isInboxEvent = (event: TaskEvent): boolean => isSentCard(event) || isNote(event) || isVerdict(event) || isPr(event);
/** Does this batch earn the trailing stat card (a verdict or a PR change)? */
export const wantsCard = (events: readonly TaskEvent[]): boolean => events.some((event) => isVerdict(event) || isPr(event));

/**
 * The message for one task's batch of inbox events (pure). Sections in this
 * order: sent cards, plain comments, verdicts (the last verdict wins), PR (the last PR line wins).
 */
export const inboxMessage = (task: string, events: readonly TaskEvent[]): string => {
  const id = sanitize(task);
  const sections: string[] = [];
  const cards = events.filter(isSentCard);
  if (cards.length > 0) {
    const lines = cards.map((event) => {
      const author = sanitize(str(event.data["author"]) ?? event.actor);
      return `[${sanitize(event.data["comment"])}] ${sanitize(event.data["location"] ?? event.data["file"] ?? "")} — ${author}: ${sanitize(event.data["body"])}`;
    });
    sections.push([`📝 ${cards.length} review comment(s) sent on ${id}`, ...lines, `next: address them, then tk comments resolve ${id} <cid>`].join("\n"));
  }
  const notes = events.filter(isNote);
  if (notes.length > 0) {
    const lines = notes.map((event) => `💬 ${sanitize(str(event.data["author"]) ?? event.actor)} on ${id}: ${sanitize(event.data["body"])}`);
    sections.push([...lines, `next: tk work ${id}`].join("\n"));
  }
  const verdict = events.filter(isVerdict).at(-1);
  if (verdict !== undefined) {
    sections.push(verdict.data["to"] === "approved" ? `✅ ${id} approved — next: tk close ${id}` : `↩ ${id} rejected — next: tk work ${id}`);
  }
  const pr = events.filter(isPr).at(-1);
  if (pr !== undefined) {
    const raw = pr.data["url"];
    const url = typeof raw === "string" && /^https?:\/\//.test(raw) ? ` (${sanitize(raw)})` : "";
    const state = sanitize(pr.data["state"]);
    sections.push(`🔀 PR #${pr.data["number"] as number} on ${id} — ${state}${url}` + (state === "merged" ? `\nnext: tk close ${id}` : ""));
  }
  return sections.join("\n\n");
};

/** The session-start brief: one message for everything missed, grouped by task in first-seen order. */
export const inboxBrief = (events: readonly TaskEvent[]): string | null => {
  const groups = groupByTask(events);
  if (groups.size === 0) return null;
  return [`📬 while you were away`, ...[...groups].map(([task, batch]) => inboxMessage(task, batch))].join("\n\n");
};

const groupByTask = (events: readonly TaskEvent[]): Map<string, TaskEvent[]> => {
  const groups = new Map<string, TaskEvent[]>();
  for (const event of events) {
    if (event.task === undefined) continue;
    const group = groups.get(event.task) ?? [];
    group.push(event);
    groups.set(event.task, group);
  }
  return groups;
};

const canonical = (path: string): string => {
  const absolute = resolve(path);
  try { return realpathSync(absolute); } catch { return absolute; }
};
/** Is `cwd` the worktree directory or inside it? */
const contains = (worktree: string, cwd: string): boolean => {
  const tree = canonical(worktree);
  return cwd === tree || cwd.startsWith(tree.endsWith(sep) ? tree : tree + sep);
};

/** All issues, paged (the follow-set seed runs once per session start). */
interface IssueRef { readonly id: string; readonly metadata: Readonly<Record<string, unknown>> }
const allIssues = async (store: SurfaceStore): Promise<readonly IssueRef[]> => {
  const result = await store.transact(async (uow) => {
    const out: IssueRef[] = [];
    let cursor: Parameters<typeof uow.list>[0]["cursor"];
    for (;;) {
      const page = await uow.list({ limit: 500, ...(cursor === undefined ? {} : { cursor }) });
      if (!page.ok) break;
      out.push(...page.value.items);
      if (page.value.nextCursor === null || page.value.items.length === 0) break;
      cursor = page.value.nextCursor;
    }
    return out;
  });
  return result.ok ? result.value : [];
};

export const createInbox = (options: InboxOptions): Inbox => {
  const { root, session, notify } = options;
  const cwd = canonical(options.cwd);
  const subscriber = inboxSubscriber(session);
  const coalesceMs = options.coalesceMs ?? INBOX_COALESCE_MS;
  const followSet = new Set<string>();
  const pending = new Map<string, { events: TaskEvent[]; timer: ReturnType<typeof setTimeout> }>();
  let store: SurfaceStore | null = null;
  let tail: FollowHandle | null = null;
  let stopped = false;

  /** Follow-set growth from the line itself, then: deliver it? */
  const accept = (event: TaskEvent): boolean => {
    const task = event.task;
    if (task === undefined) return false;
    if (event.type === "task.worktree") {
      const path = str(event.data["path"]);
      if (path !== null && contains(path, cwd)) followSet.add(task);
      return false;
    }
    if (event.type === "task.status" && event.data["session"] === session) followSet.add(task);
    if (event.session === session) return false;
    return followSet.has(task) && isInboxEvent(event);
  };

  const flush = async (task: string): Promise<void> => {
    const entry = pending.get(task);
    if (entry === undefined) return;
    pending.delete(task);
    if (stopped) return;
    let text = inboxMessage(task, entry.events);
    if (text === "") return;
    if (options.card !== undefined && wantsCard(entry.events)) {
      try {
        const line = await options.card(task);
        if (typeof line === "string" && line !== "") text += `\n${line.replace(ANSI, "").replace(CONTROL, " ").trim()}`;
      } catch { /* a failed card leaves the message unchanged */ }
      if (stopped) return;
    }
    notify(text);
  };

  const enqueue = (event: TaskEvent): void => {
    const task = event.task!;
    const entry = pending.get(task);
    if (entry !== undefined) { entry.events.push(event); return; }
    const timer = setTimeout(() => { void flush(task); }, coalesceMs);
    timer.unref?.();
    pending.set(task, { events: [event], timer });
  };

  return {
    async start() {
      const opened = await openSurfaceStore(root, { readonly: true });
      if (stopped) { await opened.close(); return; }
      store = opened;
      for (const issue of await allIssues(opened)) {
        const worktree = str(issue.metadata["worktree"]);
        if ((worktree !== null && contains(worktree, cwd)) || issue.metadata["agent_session"] === session) followSet.add(issue.id);
      }
      if (stopped) return;
      const cursor = await readCursor(opened.tasksDir, subscriber);
      if (cursor === null) {
        await seedCursor(opened.tasksDir, subscriber, await lastEventSeq(opened.tasksDir));
      } else {
        const missed = (await drainEvents(opened, { query: INBOX_QUERY, subscriber })).filter(accept);
        const brief = inboxBrief(missed);
        if (brief !== null && !stopped) notify(brief);
      }
      if (stopped) return;
      tail = followEvents(opened, {
        query: INBOX_QUERY,
        subscriber,
        onEvent: (event) => { if (!stopped && accept(event)) enqueue(event); },
      });
    },
    follow(ids) {
      for (const id of ids) if (id.trim() !== "") followSet.add(id.trim());
    },
    followed() {
      return [...followSet];
    },
    async stop() {
      stopped = true;
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
      tail?.stop();
      await tail?.done.catch(() => undefined);
      tail = null;
      await store?.close();
      store = null;
    },
  };
};
