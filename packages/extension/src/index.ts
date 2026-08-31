/**
 * Tasks extension — loads under pi AND omp.
 *
 * - Default-export factory (both hosts call it identically).
 * - Types come from @earendil-works/pi-coding-agent (rewritten to host copies
 *   by pi's virtual modules and omp's legacy-pi-compat).
 * - Tool schemas use @sinclair/typebox (also rewritten by both hosts).
 * - Registers: `tasks` (full surface via one tool), `tasks_ready`,
 *   `tasks_watch_start/stop/status`, `/tasks` command, and the
 *   Tasks Watch widget (aboveEditor), copied from the herdr-subagents pattern.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createSurface, type TasksSurface } from "@tasks/surface";
import { WatchManager } from "./watch-manager.js";

type SurfaceOutcome = { ok: true; value: unknown } | { ok: false; error: { kind: string; message: string } };

const toolResult = (text: string, isError = false) => ({
  content: [{ type: "text" as const, text }],
  details: {} as Record<string, never>,
  ...(isError ? { isError: true } : {}),
});

const outcomeText = (outcome: SurfaceOutcome): string => {
  if (outcome.ok) return JSON.stringify(outcome.value, null, 1);
  return `error ${outcome.error.kind}: ${outcome.error.message}`;
};

async function withSurface<T>(root: string, work: (surface: TasksSurface) => Promise<T>): Promise<T> {
  const surface = await createSurface({ root });
  try {
    return await work(surface);
  } finally {
    await surface.store.close();
  }
}

export default function tasksExtension(pi: ExtensionAPI) {
  // Root is captured per session start (worktree-aware via surface discovery).
  let root = process.cwd();
  let surfaceFactory: (() => Promise<TasksSurface>) | null = null;
  let manager: WatchManager | null = null;
  let widgetTimer: ReturnType<typeof setInterval> | null = null;

  const resolveSurface = async (): Promise<TasksSurface> => {
    if (surfaceFactory === null) surfaceFactory = async () => {
      const surface = await createSurface({ root });
      return surface;
    };
    return surfaceFactory();
  };

  const ensureManager = (hasUI: boolean): WatchManager => {
    if (manager !== null) return manager;
    manager = new WatchManager({
      // tk-watch.js ships next to this bundled entry (dist/).
      watchScript: new URL("./tk-watch.js", import.meta.url).pathname,
      root,
      notify: (text) => {
        void pi.sendUserMessage(text, { deliverAs: "followUp" });
      },
      refreshWidget: () => updateWidget(),
      hasUI: () => hasUI,
    });
    return manager;
  };

  const updateWidget = (): void => {
    // Re-render through the captured ui context; see session_start below.
    if (latestCtx === null || !latestCtx.hasUI || manager === null) return;
    if (manager.size === 0) {
      latestCtx.ui.setWidget("tasks-watch", undefined);
      stopWidgetTimer();
      return;
    }
    latestCtx.ui.setWidget("tasks-watch", () => manager!.widgetComponent(), { placement: "aboveEditor" });
    startWidgetTimer();
  };

  const startWidgetTimer = (): void => {
    if (widgetTimer !== null) return;
    widgetTimer = setInterval(() => updateWidget(), 1000);
    // Never keep the process alive on our account.
    widgetTimer.unref?.();
  };

  const stopWidgetTimer = (): void => {
    if (widgetTimer === null) return;
    clearInterval(widgetTimer);
    widgetTimer = null;
  };

  let latestCtx: { hasUI: boolean; ui: { setWidget(key: string, content: undefined | (() => unknown), options?: { placement: "aboveEditor" | "belowEditor" }): void } } | null = null;

  pi.on("session_start", (_event, ctx) => {
    root = ctx.cwd;
    surfaceFactory = null;
    latestCtx = ctx;
    updateWidget();
  });

  pi.on("session_shutdown", () => {
    stopWidgetTimer();
    manager?.stopAll();
    manager = null;
    latestCtx = null;
  });

  // pi-only bonus: skill injection via resources_discover (omp does not fire
  // it; both hosts instead load skills/ from the package manifest).
  pi.on("resources_discover", async () => {
    const skillPath = new URL("../skills/tasks/SKILL.md", import.meta.url).pathname;
    return { skillPaths: [skillPath] };
  });

  // ── tasks: the full surface through one tool ──
  const Op = Type.Union([
    Type.Literal("create"), Type.Literal("quick"), Type.Literal("show"), Type.Literal("list"),
    Type.Literal("ready"), Type.Literal("blocked"), Type.Literal("update"), Type.Literal("close"),
    Type.Literal("reopen"), Type.Literal("defer"), Type.Literal("undefer"), Type.Literal("claim"),
    Type.Literal("assign"), Type.Literal("priority"), Type.Literal("label-add"), Type.Literal("label-rm"),
    Type.Literal("note"), Type.Literal("comment"), Type.Literal("comments"), Type.Literal("dep-add"),
    Type.Literal("dep-rm"), Type.Literal("dep-list"), Type.Literal("link"), Type.Literal("rename"),
    Type.Literal("delete"), Type.Literal("duplicate"), Type.Literal("supersede"), Type.Literal("todo"),
    Type.Literal("todo-done"), Type.Literal("search"), Type.Literal("query"), Type.Literal("history"),
    Type.Literal("counts"), Type.Literal("stats"), Type.Literal("tree"), Type.Literal("graph"),
    Type.Literal("duplicates"), Type.Literal("lint"), Type.Literal("children"), Type.Literal("epic"),
  ]);
  const Id = Type.Optional(Type.String({ description: "Issue id (e.g. tk-abc). Use `--current` semantics via op show without id to read the current pointer." }));

  pi.registerTool({
    name: "tasks",
    label: "Tasks",
    description: [
      "Full Tasks (tk) surface in one tool. Ops:",
      "create(title, description?, type?, priority?, parent?, labels?, deps?[]) → issue",
      "quick(title) → id · show(id) → issue · list(status?, parent?, assignee?, label?, limit?) → issues",
      "ready(claim?) → unblocked issues · blocked() → blocked issues · children(id) · epic(id) → {epic, children, done, eligible}",
      "update(id, title?, description?, priority?, type?, assignee?, owner?, branch?, parent?, notes?, acceptanceCriteria?, design?, specId?, externalRef?, estimate?, dueAt?, status?) → issue",
      "close(id, reason?) · reopen(id) · defer(id, until?) · undefer(id) · claim(id) → issue",
      "assign(id, user) · priority(id, 0-4) · label-add(id, label) · label-rm(id, label) · note(id, text) → issue",
      "comment(id, body) → issue · comments(id) → issue",
      "dep-add(id, target, type?) · dep-rm(id, target) · dep-list(id, direction?) → rows · link(id1, id2)",
      "rename(id, newId) · delete(ids) · duplicate(id, canonical) · supersede(id, replacement)",
      "todo(title) · todo-done(ids) — task-type shortcuts",
      "search(text) · query(expr: 'status=open', 'title~bug') · history(id) → audit entries",
      "counts() · stats() · tree(all?, depth?) · graph() · duplicates() · lint(ids?)",
    ].join("\n"),
    parameters: Type.Object({
      op: Op,
      id: Id,
      ids: Type.Optional(Type.Array(Type.String(), { description: "For delete/todo-done." })),
      title: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      type: Type.Optional(Type.String({ description: "task|bug|feature|epic|chore" })),
      priority: Type.Optional(Type.Number({ minimum: 0, maximum: 4 })),
      parent: Type.Optional(Type.String()),
      labels: Type.Optional(Type.Array(Type.String())),
      deps: Type.Optional(Type.Array(Type.String(), { description: "['blocks:tk-x'] or ['tk-x'] (default blocks)." })),
      assignee: Type.Optional(Type.String()),
      owner: Type.Optional(Type.String()),
      branch: Type.Optional(Type.String()),
      notes: Type.Optional(Type.String()),
      acceptanceCriteria: Type.Optional(Type.String()),
      design: Type.Optional(Type.String()),
      specId: Type.Optional(Type.String()),
      externalRef: Type.Optional(Type.String()),
      estimate: Type.Optional(Type.Number()),
      dueAt: Type.Optional(Type.String({ description: "ISO date for due." })),
      status: Type.Optional(Type.String()),
      reason: Type.Optional(Type.String({ description: "close reason (appended to notes)." })),
      until: Type.Optional(Type.String({ description: "defer until (ISO or blank = +24h)." })),
      label: Type.Optional(Type.String()),
      target: Type.Optional(Type.String({ description: "dep target issue id." })),
      depType: Type.Optional(Type.String({ description: "blocks|relates-to (default blocks)." })),
      newId: Type.Optional(Type.String({ description: "rename target id." })),
      canonical: Type.Optional(Type.String({ description: "duplicate --of id." })),
      replacement: Type.Optional(Type.String({ description: "supersede --with id." })),
      body: Type.Optional(Type.String({ description: "comment/note text." })),
      text: Type.Optional(Type.String({ description: "search text." })),
      expression: Type.Optional(Type.String({ description: "query expression, e.g. status=open" })),
      direction: Type.Optional(Type.Union([Type.Literal("up"), Type.Literal("down")])),
      all: Type.Optional(Type.Boolean({ description: "tree: include closed." })),
      depth: Type.Optional(Type.Number({ description: "tree depth." })),
      limit: Type.Optional(Type.Number()),
      user: Type.Optional(Type.String({ description: "assign user." })),
    }),
    async execute(_id, params) {
      const surface = await resolveSurface();
      try {
        const p = params as Record<string, unknown>;
        const op = p["op"] as string;
        const id = p["id"] as string | undefined;
        const outcome = await withSurface(surface.store.root, async (s): Promise<unknown> => {
          switch (op) {
            case "create": return s.create({
              title: (p["title"] as string | undefined) ?? "",
              ...(p["description"] === undefined ? {} : { description: p["description"] as string }),
              ...(p["type"] === undefined ? {} : { type: p["type"] as string }),
              ...(p["priority"] === undefined ? {} : { priority: p["priority"] as number }),
              ...(p["parent"] === undefined ? {} : { parent: p["parent"] as string }),
              ...(p["labels"] === undefined ? {} : { labels: p["labels"] as readonly string[] }),
              ...(p["deps"] === undefined ? {} : { deps: p["deps"] as readonly string[] }),
              ...(p["assignee"] === undefined ? {} : { assignee: p["assignee"] as string | null }),
              ...(p["owner"] === undefined ? {} : { owner: p["owner"] as string | null }),
              ...(p["dueAt"] === undefined ? {} : { due: p["dueAt"] as string | null }),
              ...(p["estimate"] === undefined ? {} : { estimate: p["estimate"] as number | null }),
              ...(p["acceptanceCriteria"] === undefined ? {} : { acceptanceCriteria: p["acceptanceCriteria"] as string | null }),
              ...(p["design"] === undefined ? {} : { design: p["design"] as string | null }),
              ...(p["specId"] === undefined ? {} : { specId: p["specId"] as string | null }),
              ...(p["externalRef"] === undefined ? {} : { externalRef: p["externalRef"] as string | null }),
              ...(p["branch"] === undefined ? {} : { branch: p["branch"] as string | null }),
              ...(p["notes"] === undefined ? {} : { notes: p["notes"] as string | null }),
            });
            case "quick": {
              const made = await s.create({ title: (p["title"] as string | undefined) ?? "" });
              return made.ok ? made.value.id : made;
            }
            case "show": return id === undefined ? s.current() : s.show(id);
            case "list": return s.list({
              ...(p["status"] === undefined ? {} : { status: p["status"] as string }),
              ...(p["parent"] === undefined ? {} : { parent: p["parent"] as string }),
              ...(p["assignee"] === undefined ? {} : { assignee: p["assignee"] as string }),
              ...(p["label"] === undefined ? {} : { label: p["label"] as string }),
              ...(p["limit"] === undefined ? {} : { limit: p["limit"] as number }),
            });
            case "ready": return s.ready({ ...(p["limit"] === undefined ? {} : { limit: p["limit"] as number }) });
            case "blocked": return s.blocked();
            case "update": return s.update(id ?? "", p as never);
            case "close": return s.status(id ?? "", { status: "closed", ...(p["reason"] === undefined ? {} : { reason: p["reason"] as string }) });
            case "reopen": return s.status(id ?? "", { status: "open" });
            case "defer": return s.defer(id ?? "", p["until"] as string | undefined);
            case "undefer": return s.undefer(id ?? "");
            case "claim": return s.claim(id ?? "");
            case "assign": return s.assign(id ?? "", (p["user"] ?? p["assignee"]) as string);
            case "priority": return s.priority(id ?? "", p["priority"] as number);
            case "label-add": return s.labelAdd(id ?? "", (p["label"] ?? p["labels"]) as string);
            case "label-rm": return s.labelRemove(id ?? "", (p["label"] ?? (p["labels"] as unknown as string)) as string);
            case "note": return s.note(id ?? "", (p["body"] ?? p["notes"]) as string);
            case "comment": return s.comment(id ?? "", (p["body"] ?? p["notes"]) as string);
            case "comments": return s.comments(id ?? "");
            case "dep-add": return s.depAdd(id ?? "", (p["target"] ?? p["parent"]) as string, p["depType"] as string | undefined);
            case "dep-rm": return s.depRemove(id ?? "", (p["target"] ?? p["parent"]) as string);
            case "dep-list": return s.depList(id ?? "", p["direction"] as "up" | "down" | undefined);
            case "link": return s.link(id ?? "", (p["target"] ?? p["parent"]) as string);
            case "rename": return s.rename(id ?? "", (p["newId"] ?? p["title"]) as string);
            case "delete": return s.delete((p["ids"] as readonly string[] | undefined) ?? (id === undefined ? [] : [id]));
            case "duplicate": return s.duplicate(id ?? "", (p["canonical"] ?? p["target"]) as string);
            case "supersede": return s.supersede(id ?? "", (p["replacement"] ?? p["target"]) as string);
            case "todo": return s.create({ title: (p["title"] as string | undefined) ?? "", type: "task" });
            case "todo-done": return s.closeMany((p["ids"] as readonly string[] | undefined) ?? (id === undefined ? [] : [id]), "Completed");
            case "search": return s.search((p["text"] ?? p["title"]) as string);
            case "query": return s.query((p["expression"] ?? p["title"]) as string);
            case "history": return s.show(id ?? "") as never;
            case "counts": return s.counts();
            case "stats": return s.stats();
            case "tree": return s.tree({ all: p["all"] === true, ...(p["depth"] === undefined ? {} : { depth: p["depth"] as number }) });
            case "graph": return s.graph();
            case "duplicates": return s.duplicates();
            case "lint": return s.lint(p["ids"] === undefined ? {} : { ids: p["ids"] as readonly string[] });
            case "children": return s.children(id ?? "");
            case "epic": return s.epic(id ?? "");
            default: return { ok: false, error: { kind: "validation", message: `unknown op: ${op}` } } as never;
          }
        });
        return toolResult(outcomeText(outcome as SurfaceOutcome));
      } catch (error) {
        return toolResult(`tasks ${String((params as Record<string, unknown>)["op"])} failed: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    },
  });

  pi.registerTool({
    name: "tasks_ready",
    label: "Tasks ready",
    description: "List ready (unblocked) task issues. Cheap pointer for 'what next' when idle.",
    parameters: Type.Object({}),
    async execute() {
      return withSurface(root, async (surface) => {
        const ready = await surface.ready();
        return toolResult(outcomeText(ready as SurfaceOutcome));
      });
    },
  });

  // ── watcher tools ──
  const Kinds = Type.Optional(Type.Array(Type.Union([
    Type.Literal("issue.created"), Type.Literal("issue.updated"), Type.Literal("issue.status_changed"),
    Type.Literal("issue.commented"), Type.Literal("issue.deleted"), Type.Literal("ready.changed"),
  ]), { description: "Event kinds to subscribe to (default all)." }));

  pi.registerTool({
    name: "tasks_watch_start",
    label: "Tasks watch start",
    description: "Spawn a workspace watcher. Notifies this session (followUp message, new turn when idle) on each matching change: issue created/updated/deleted, status changes, comments, or the ready set changing. Filters: kinds, ids, label, intervalMs.",
    parameters: Type.Object({ kinds: Kinds as never, ids: Type.Optional(Type.Array(Type.String(), { description: "Only these issue ids." })), label: Type.Optional(Type.String({ description: "Only issues with this label." })), intervalMs: Type.Optional(Type.Number({ description: "Poll interval ms (default 2000, min 250)." })) }),
    async execute(_id, params) {
      const hasUI = latestCtx?.hasUI ?? false;
      const m = ensureManager(hasUI);
      const p = params as Record<string, unknown>;
      const subscription: Record<string, unknown> = {};
      if (p["kinds"] !== undefined) subscription["kinds"] = p["kinds"];
      if (p["ids"] !== undefined) subscription["ids"] = p["ids"];
      if (p["label"] !== undefined) subscription["label"] = p["label"];
      if (p["intervalMs"] !== undefined) subscription["interval"] = p["intervalMs"];
      const watchId2 = m.start(subscription as never);
      updateWidget();
      return toolResult(JSON.stringify({ started: true, watcher: watchId2 }));
    },
  });

  pi.registerTool({
    name: "tasks_watch_stop",
    label: "Tasks watch stop",
    description: "Stop one watcher (by id from tasks_watch_status) or all when id omitted.",
    parameters: Type.Object({ watcher: Type.Optional(Type.String({ description: "Watcher id; omit to stop all." })) }),
    async execute(_id, params) {
      if (manager === null) return toolResult(JSON.stringify({ stopped: 0 }));
      const watcher = (params as Record<string, unknown>)["watcher"] as string | undefined;
      const stopped = manager.stop(watcher);
      updateWidget();
      return toolResult(JSON.stringify({ stopped }));
    },
  });

  pi.registerTool({
    name: "tasks_watch_status",
    label: "Tasks watch status",
    description: "List active watchers with their seq watermark and last event.",
    parameters: Type.Object({}),
    async execute() {
      const rows = manager?.status() ?? [];
      return toolResult(JSON.stringify({ watchers: rows }, null, 1));
    },
  });

  pi.registerCommand("tasks", {
    description: "Show tasks help + watcher status",
    handler: async (_args, ctx) => {
      const rows = manager?.status() ?? [];
      ctx.ui.notify(`tasks: tools tasks/tasks_ready/tasks_watch_* active · watchers: ${rows.length}`, "info");
    },
  });
}
