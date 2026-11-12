import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@tasks/rpc";
import { startWebServer, type WebServer } from "../src/server";

/**
 * 10-04 (D-03): the web's two event channels — `GET /events` SSE `task`
 * frames and `GET /api/events` pages — both read the active workspace's
 * `.tasks/events.jsonl`, and a `POST /api/open` repoint moves both.
 */

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const dirs: string[] = [];
const servers: WebServer[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.close().catch(() => {});
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
function workspace(): string { const value = realpathSync(mkdtempSync(join(tmpdir(), "tk-web-events-"))); dirs.push(value); return value; }
/** Child `tk` on a clean env: no inherited session or event switches leak into the log. */
const cleanEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key === "TK_SESSION" || key === "TK_EVENTS") continue;
    env[key] = value;
  }
  return env;
};
function tk<T>(directory: string, args: readonly string[]): T {
  const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args, "--json"], { stdout: "pipe", stderr: "pipe", env: cleanEnv() });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  return JSON.parse(new TextDecoder().decode(result.stdout)) as T;
}
const initWorkspace = (): string => { const root = workspace(); tk(root, ["init", "--prefix", "tk"]); return root; };
const start = async (root: string): Promise<WebServer> => { const server = await startWebServer({ root, port: 0 }); servers.push(server); return server; };
interface LogLine { readonly seq: number; readonly type: string; readonly task?: string; readonly data: Record<string, unknown> }
const logLines = (root: string): LogLine[] =>
  readFileSync(join(root, ".tasks", "events.jsonl"), "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as LogLine);

interface Frame { readonly event: string | null; readonly data: string }
/** Reads SSE frames off GET /events; `next(pred)` resolves with the first matching frame within the deadline. */
const openEvents = async (url: string): Promise<{ next: (pred: (frame: Frame) => boolean, ms?: number) => Promise<{ match: Frame | null; seen: Frame[] }>; close: () => Promise<void> }> => {
  const controller = new AbortController();
  const response = await fetch(`${url}/events`, { signal: controller.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  const next = async (pred: (frame: Frame) => boolean, ms = 5_000): Promise<{ match: Frame | null; seen: Frame[] }> => {
    const seen: Frame[] = [];
    const deadline = Date.now() + ms;
    for (;;) {
      let split: number;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        let event: string | null = null;
        const data: string[] = [];
        for (const line of raw.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("data: ")) data.push(line.slice(6));
        }
        if (event === null && data.length === 0) continue;
        const frame = { event, data: data.join("\n") };
        seen.push(frame);
        if (pred(frame)) return { match: frame, seen };
      }
      const left = deadline - Date.now();
      if (left <= 0) return { match: null, seen };
      pending ??= reader.read();
      const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), left));
      const result = await Promise.race([pending, timeout]);
      if (result === "timeout") return { match: null, seen };
      pending = null;
      if (result.done) return { match: null, seen };
      buffer += decoder.decode(result.value, { stream: true });
    }
  };
  const close = async (): Promise<void> => {
    await reader.cancel().catch(() => {});
    controller.abort();
  };
  return { next, close };
};
interface TaskFrame { readonly seq: number; readonly kind: string; readonly issueId?: string; readonly data?: Record<string, unknown> }
const taskFrame = (pred: (event: TaskFrame) => boolean) => (frame: Frame): boolean => {
  if (frame.event !== "task") return false;
  try { return pred(JSON.parse(frame.data) as TaskFrame); } catch { return false; }
};
const rpc = async (url: string, method: string, params: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(`${url}/api/rpc`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ v: PROTOCOL_VERSION, method, params }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};
interface Page { readonly events: TaskFrame[]; readonly dropped: number; readonly workspace: string }
const page = async (url: string, query: string): Promise<Page> => (await (await fetch(`${url}/api/events?${query}`)).json()) as Page;

describe("web event wire (10-04)", () => {
  it("a CLI status change reaches GET /events as an `event: task` frame from the log tail", async () => {
    const root = initWorkspace();
    const { id } = tk<{ id: string }>(root, ["create", "tail me"]);
    const server = await start(root);
    const events = await openEvents(server.url);
    try {
      tk(root, ["update", id, "--status", "in-progress"]);
      const { match, seen } = await events.next(taskFrame((e) => e.kind === "task.status" && e.issueId === id), 2_000);
      expect(match, JSON.stringify(seen)).not.toBeNull();
      const event = JSON.parse(match!.data) as TaskFrame;
      expect(event.data?.["to"]).toBe("in-progress");
      const line = logLines(root).find((l) => l.type === "task.status" && l.task === id && l.data["to"] === "in-progress");
      expect(line).toBeDefined();
      expect(event.seq).toBe(line!.seq);

      // A write through the server's own RPC rides the same stream.
      const updated = await rpc(server.url, "issue.update", { id, title: "renamed in web" });
      expect(updated.status).toBe(200);
      const own = await events.next(taskFrame((e) => e.kind === "task.update" && e.issueId === id), 2_000);
      expect(own.match, JSON.stringify(own.seen)).not.toBeNull();
    } finally {
      await events.close();
    }
  });

  it("the shell is driven by the stream: a `task` listener, debounced refresh, review toasts, no board poll", async () => {
    const root = initWorkspace();
    const server = await start(root);
    const shell = await (await fetch(server.url)).text();
    expect(shell).toContain('addEventListener("task"');
    expect(shell).toContain("setTimeout(flushTaskBurst, 100)");
    expect(shell).not.toContain("setInterval(refresh");
    for (const text of ["ready for review", "approved`", "rejected`", "review comment at", "review comment${n === 1 ? \"\" : \"s\"} sent"]) expect(shell).toContain(text);
    // Reconnect reconciles once; the stale dot follows the stream, not a poll.
    expect(shell).toContain("events.onerror");
    expect(shell).toContain("if (streamDropped) { streamDropped = false; void refresh(); }");
    // The 05-01 frames are untouched.
    expect(shell).toContain('events.onmessage = (m) => { if (m.data === "reload") location.reload(); };');
    expect(shell).toContain('events.addEventListener("review"');
  });

  it("serves GET /api/events straight from the active workspace's log", async () => {
    const root = initWorkspace();
    const { id } = tk<{ id: string }>(root, ["create", "paged"]);
    tk(root, ["update", id, "--status", "in-progress"]);
    tk(root, ["comment", id, "a note"]);
    const lines = logLines(root);
    expect(lines.length).toBe(3);
    const server = await start(root);

    const all = await page(server.url, "after=0");
    expect(all.dropped).toBe(0);
    expect(all.workspace).toBe(root);
    expect(all.events.map((e) => e.seq)).toEqual(lines.map((l) => l.seq));
    expect(all.events.map((e) => e.kind)).toEqual(["task.created", "task.status", "task.comment"]);
    expect((await page(server.url, `after=${lines[1]!.seq}`)).events.map((e) => e.seq)).toEqual([lines[2]!.seq]);
    for (const kinds of ["task.status", "issue.status_changed"]) {
      const filtered = await page(server.url, `after=0&kinds=${kinds}`);
      expect(filtered.events.map((e) => e.kind)).toEqual(["task.status"]);
    }
    expect((await fetch(`${server.url}/api/events?after=-1`)).status).toBe(400);
  });

  it("caps an /api/events page at 512 events", async () => {
    const root = initWorkspace();
    const tasksDir = join(root, ".tasks");
    // Synthesize a long log through the real appender (one CLI process per line would be minutes).
    const { appendEvents } = await import("@tasks/surface");
    const drafts = Array.from({ length: 600 }, (_, i) => ({ type: "task.update" as const, task: `tk-${i}`, data: { fields: ["title"] } }));
    await appendEvents(tasksDir, drafts, { actor: "test" });
    const server = await start(root);
    const first = await page(server.url, "after=0");
    expect(first.events.length).toBe(512);
    expect(first.events[0]!.seq).toBe(1);
    expect(first.events[511]!.seq).toBe(512);
    const rest = await page(server.url, "after=512");
    expect(rest.events.map((e) => e.seq)).toEqual(Array.from({ length: 88 }, (_, i) => 513 + i));
  });

  it("follows POST /api/open: both channels move to the new workspace and drop the old one", async () => {
    const a = initWorkspace();
    const b = initWorkspace();
    const { id: inA } = tk<{ id: string }>(a, ["create", "task in A"]);
    const { id: inB } = tk<{ id: string }>(b, ["create", "task in B"]);
    const server = await start(a);
    let events = await openEvents(server.url);
    try {
      const opened = await fetch(`${server.url}/api/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: b }) });
      expect(opened.status).toBe(200);
      // The page reloads on the repoint's `data: reload`; the test reconnects after it like the page does.
      const reload = await events.next((frame) => frame.event === null && frame.data === "reload");
      expect(reload.match).not.toBeNull();
      await events.close();
      events = await openEvents(server.url);

      const beforeA = logLines(a).length;
      tk(a, ["update", inA, "--status", "in-progress"]);
      expect(logLines(a).length).toBe(beforeA + 1);
      tk(b, ["update", inB, "--status", "in-progress"]);
      const { match, seen } = await events.next(taskFrame((e) => e.kind === "task.status" && e.issueId === inB), 2_000);
      expect(match, JSON.stringify(seen)).not.toBeNull();
      // Nothing from A rode the stream before B's frame.
      expect(seen.filter(taskFrame((e) => e.issueId === inA))).toEqual([]);

      const listed = await page(server.url, "after=0");
      expect(listed.workspace).toBe(b);
      expect(listed.events.some((e) => e.issueId === inA)).toBe(false);
      expect(listed.events.some((e) => e.kind === "task.status" && e.issueId === inB)).toBe(true);

      // tasks-qliz: /api/rpc writes land in the active workspace after the repoint.
      const viaRpc = await rpc(server.url, "issue.update", { id: inB, title: "renamed after repoint" });
      expect(viaRpc.status, JSON.stringify(viaRpc.body)).toBe(200);
      const rpcFrame = await events.next(taskFrame((e) => e.kind === "task.update" && e.issueId === inB), 2_000);
      expect(rpcFrame.match, JSON.stringify(rpcFrame.seen)).not.toBeNull();
      expect(logLines(a).some((l) => l.type === "task.update")).toBe(false);
    } finally {
      await events.close();
    }
  });
});
