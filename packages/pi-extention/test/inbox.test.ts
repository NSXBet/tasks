import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import tasksExtension from "../src/index.ts";
import { createInbox, inboxMessage, sanitize } from "../src/inbox.ts";

/**
 * The agent inbox end to end: a fake pi host loads the extension, a second
 * actor writes through real spawned `tk` processes, and the session's
 * followUp messages are observed. Integration exception: the tail runs on
 * fs.watch and the OS clock, so no fake timer applies. Every test gets its own
 * workspace; children get an explicit env without the agent's
 * TK_SESSION/PI_SESSION_ID/TK_EVENTS; the repo's own .tasks/ is never touched.
 */
const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const workspaces: string[] = [];
const loaded: FakePi[] = [];
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ["TK_SESSION", "PI_SESSION_ID", "TK_EVENTS", "TK_INBOX", "USER"] as const;

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  delete process.env["PI_SESSION_ID"]; delete process.env["TK_EVENTS"]; delete process.env["TK_INBOX"];
  process.env["TK_SESSION"] = "s-agent";
  process.env["USER"] = "agent";
});
afterEach(async () => {
  while (loaded.length) await loaded.pop()!.fire("session_shutdown");
  for (const key of ENV_KEYS) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
  while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true });
});

function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !["TK_SESSION", "PI_SESSION_ID", "TK_EVENTS", "TK_HARNESS", "TK_INBOX"].includes(key)) env[key] = value;
  return { ...env, NO_COLOR: "1", USER: "reviewer", ...extra };
}
const REVIEWER = { TK_SESSION: "s-review" };
function tk(directory: string, args: readonly string[], extra: Record<string, string> = REVIEWER, input?: string): string {
  const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdin: input === undefined ? undefined : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe", env: cleanEnv(extra) });
  const stderr = new TextDecoder().decode(result.stderr);
  expect(result.exitCode, stderr).toBe(0);
  return new TextDecoder().decode(result.stdout);
}
const create = (directory: string, title: string): string => (JSON.parse(tk(directory, ["create", title, "--json"])) as { id: string }).id;

/** Workspace with task T whose worktree is `<root>/wt/T` (the agent's cwd) and task U (not followed by cwd). */
function workspace(): { root: string; cwd: string; t: string; u: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tk-inbox-")));
  workspaces.push(root);
  tk(root, ["init", "--prefix", "tk"]);
  const t = create(root, "T");
  const u = create(root, "U");
  const cwd = join(root, "wt", "T");
  mkdirSync(cwd, { recursive: true });
  tk(root, ["update", t, "--set-metadata", `worktree=${join(root, "wt")}`]);
  tk(root, ["update", t, "--status", "in-progress"]);
  tk(root, ["update", u, "--status", "in-progress"]);
  return { root, cwd, t, u };
}

/** Adds open review comments `c1`, `c2` to a task by import (import writes no events). */
function addOpenComments(root: string, id: string): void {
  const wire = (JSON.parse(tk(root, ["export", "--json"])) as Record<string, unknown>[]).find((issue) => issue["id"] === id)!;
  const at = wire["created_at"];
  const comment = (cid: string, text: string) => ({ id: cid, issue_id: id, author: "alice", text, created_at: at });
  wire["metadata"] = { ...(wire["metadata"] as Record<string, unknown>), reviewThreads: { version: 1, threads: [
    { id: "c1", filePath: "src/a.ts", line: 4, status: "open", rootCommentId: "tkr-c1", replyCommentIds: [] },
    { id: "c2", filePath: "evidence:shot", evidenceId: "shot", status: "open", rootCommentId: "tkr-c2", replyCommentIds: [] },
  ] } };
  wire["comments"] = [comment("tkr-c1", "[review src/a.ts:4] fix this"), comment("tkr-c2", "[review evidence:shot] wrong \u001b[31mcolour\u001b[0m")];
  wire["comment_count"] = 2;
  tk(root, ["import", "--json"], REVIEWER, JSON.stringify(wire));
}

interface Sent { readonly text: string; readonly options: unknown }
interface Tool { readonly name: string; execute(id: string, params: unknown, signal?: AbortSignal): Promise<{ content: { text: string }[]; isError?: boolean }> }
interface FakePi {
  readonly sent: Sent[];
  readonly tools: Map<string, Tool>;
  fire(event: string, ctx?: unknown): Promise<void>;
}
function loadExtension(): FakePi {
  const handlers = new Map<string, ((event: unknown, ctx: unknown) => unknown)[]>();
  const sent: Sent[] = [];
  const tools = new Map<string, Tool>();
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    registerTool: (tool: Tool) => { tools.set(tool.name, tool); },
    registerCommand: () => undefined,
    sendUserMessage: (text: string, options: unknown) => { sent.push({ text, options }); },
  };
  tasksExtension(pi as never);
  const fake: FakePi = {
    sent, tools,
    fire: async (event, ctx = {}) => { for (const handler of handlers.get(event) ?? []) await handler({ type: event }, ctx); },
  };
  loaded.push(fake);
  return fake;
}
const sessionCtx = (cwd: string) => ({ cwd, hasUI: false, ui: { setWidget: () => undefined } });
const followUps = (fake: FakePi): string[] => fake.sent.filter((entry) => (entry.options as { deliverAs?: string }).deliverAs === "followUp").map((entry) => entry.text);
async function until<T>(fn: () => T | undefined, ms: number, what: string): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) { const value = fn(); if (value !== undefined) return value; if (Date.now() > deadline) throw new Error(`timed out: ${what}`); await Bun.sleep(50); }
}
const cursorOf = (root: string, name: string): number | undefined => {
  const file = JSON.parse(readFileSync(join(root, ".tasks", "cursors.json"), "utf8")) as { subscribers: Record<string, Record<string, number>> };
  return file.subscribers[name]?.[hostname()];
};
const lastSeq = (root: string): number => {
  const lines = readFileSync(join(root, ".tasks", "events.jsonl"), "utf8").split("\n").filter((line) => line.trim() !== "");
  return (JSON.parse(lines[lines.length - 1]!) as { seq: number }).seq;
};

describe("inbox (tracer)", () => {
  it("delivers a reviewer's sent cards, then the verdict, never the agent's own writes, and stops on shutdown", async () => {
    const { root, cwd, t } = workspace();
    addOpenComments(root, t);
    const pi = loadExtension();
    await pi.fire("session_start", sessionCtx(cwd));

    tk(root, ["comments", "send", t]);
    const cards = await until(() => (followUps(pi).length > 0 ? followUps(pi) : undefined), 5000, "sent cards followUp");
    await Bun.sleep(400);
    expect(followUps(pi)).toHaveLength(1);
    const text = cards[0]!;
    for (const part of [t, "📝 2 review comment(s) sent", "[c1] src/a.ts:4 — alice: fix this", "[c2] evidence:shot — alice: wrong colour", `tk comments resolve ${t}`]) expect(text).toContain(part);
    expect(text).not.toContain("\u001b");

    tk(root, ["update", t, "--status", "approved"]);
    const approved = await until(() => followUps(pi)[1], 5000, "approval followUp");
    expect(approved).toContain("approved");
    expect(approved).toContain(`tk close ${t}`);

    tk(root, ["comment", t, "agent note"], { TK_SESSION: "s-agent" });
    await Bun.sleep(800);
    expect(followUps(pi)).toHaveLength(2);

    await pi.fire("session_shutdown");
    tk(root, ["comment", t, "after shutdown"]);
    await Bun.sleep(800);
    expect(followUps(pi)).toHaveLength(2);
  }, 30_000);

  it("is disabled by TK_INBOX=off", async () => {
    const { root, cwd, t } = workspace();
    process.env["TK_INBOX"] = "off";
    const pi = loadExtension();
    await pi.fire("session_start", sessionCtx(cwd));
    tk(root, ["comment", t, "hello"]);
    await Bun.sleep(800);
    expect(followUps(pi)).toHaveLength(0);
  }, 20_000);
});

describe("inbox drain brief", () => {
  it("briefs what was missed since the cursor, once", async () => {
    const { root, cwd, t, u } = workspace();
    // agent_session follows U; cwd follows T.
    tk(root, ["update", u, "--set-metadata", "agent_session=s-agent"]);
    const first = loadExtension();
    await first.fire("session_start", sessionCtx(cwd));
    expect(cursorOf(root, "pi:s-agent")).toBe(lastSeq(root));
    expect(followUps(first)).toHaveLength(0);
    await first.fire("session_shutdown");

    tk(root, ["comment", t, "please rename"]);
    tk(root, ["update", u, "--status", "approved"]);

    const second = loadExtension();
    await second.fire("session_start", sessionCtx(cwd));
    const brief = followUps(second);
    expect(brief).toHaveLength(1);
    expect(brief[0]!.startsWith("📬 while you were away")).toBe(true);
    expect(brief[0]).toContain(`reviewer on ${t}: please rename`);
    expect(brief[0]).toContain(`tk work ${t}`);
    expect(brief[0]).toContain(`${u} approved`);
    expect(brief[0]).toContain(`tk close ${u}`);
    expect(cursorOf(root, "pi:s-agent")).toBe(lastSeq(root));
    await second.fire("session_shutdown");

    const third = loadExtension();
    await third.fire("session_start", sessionCtx(cwd));
    expect(followUps(third)).toHaveLength(0);
  }, 30_000);

  it("a first-ever session seeds its cursor at the log end without a brief", async () => {
    const { root, cwd, t } = workspace();
    tk(root, ["comment", t, "old news"]);
    const pi = loadExtension();
    await pi.fire("session_start", sessionCtx(cwd));
    expect(followUps(pi)).toHaveLength(0);
    expect(cursorOf(root, "pi:s-agent")).toBe(lastSeq(root));
  }, 20_000);
});

describe("follow on touch", () => {
  it("a task shown through the tasks tool is followed", async () => {
    const { root, cwd } = workspace();
    const x = create(root, "X");
    const pi = loadExtension();
    await pi.fire("session_start", sessionCtx(cwd));
    tk(root, ["comment", x, "before follow"]);
    await Bun.sleep(600);
    expect(followUps(pi)).toHaveLength(0);
    const shown = await pi.tools.get("tasks")!.execute("call-1", { op: "show", id: x });
    expect(shown.isError).toBeUndefined();
    tk(root, ["comment", x, "after follow"]);
    const message = await until(() => followUps(pi)[0], 5000, "comment on touched task");
    expect(message).toContain(`reviewer on ${x}: after follow`);
  }, 20_000);
});

describe("tasks_wait", () => {
  it("resolves on another process's approval, times out otherwise, and runs concurrently", async () => {
    const { root, cwd, t, u } = workspace();
    const pi = loadExtension();
    await pi.fire("session_start", sessionCtx(cwd));
    const wait = pi.tools.get("tasks_wait")!;

    const timedOut = JSON.parse((await wait.execute("w0", { ids: [t], query: "status=approved|rejected", timeoutMs: 500 })).content[0]!.text) as Record<string, unknown>;
    expect(timedOut).toEqual({ matched: false, timedOut: true });

    const onT = wait.execute("w1", { ids: [t], query: "status=approved|rejected", timeoutMs: 5000 });
    const onU = wait.execute("w2", { ids: [u], query: "status=approved|rejected", timeoutMs: 5000 });
    await Bun.sleep(300);
    tk(root, ["update", u, "--status", "rejected"]);
    tk(root, ["update", t, "--status", "approved"]);
    const [resultT, resultU] = await Promise.all([onT, onU]);
    const parsedT = JSON.parse(resultT.content[0]!.text) as { matched: boolean; event: { task: string; data: { to: string } } };
    const parsedU = JSON.parse(resultU.content[0]!.text) as { matched: boolean; event: { task: string; data: { to: string } } };
    expect(parsedT).toMatchObject({ matched: true, event: { task: t, data: { to: "approved" } } });
    expect(parsedU).toMatchObject({ matched: true, event: { task: u, data: { to: "rejected" } } });
  }, 20_000);

  it("returns the parser message for an invalid query", async () => {
    const { cwd } = workspace();
    const pi = loadExtension();
    await pi.fire("session_start", sessionCtx(cwd));
    const result = await pi.tools.get("tasks_wait")!.execute("w", { query: "bogus=1" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("invalid watch query");
  }, 20_000);
});

describe("tasks_watch_start", () => {
  it("accepts new and legacy kind names and formats log lines", async () => {
    const { root, cwd, u } = workspace();
    const pi = loadExtension();
    await pi.fire("session_start", sessionCtx(cwd));
    const start = pi.tools.get("tasks_watch_start")!;
    expect((await start.execute("s1", { kinds: ["task.comment"] })).isError).toBeUndefined();
    expect((await start.execute("s2", { kinds: ["issue.commented"] })).isError).toBeUndefined();
    await Bun.sleep(300);
    tk(root, ["comment", u, "watched"]);
    const lines = await until(() => (followUps(pi).length >= 2 ? followUps(pi) : undefined), 5000, "watcher followUps");
    for (const line of lines) expect(line).toContain(`${u} comment — reviewer: watched`);
    await pi.tools.get("tasks_watch_stop")!.execute("s3", {});
  }, 20_000);
});

describe("inboxMessage", () => {
  const event = (type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ seq: 1, host: "h", ts: "2026-11-11T00:00:00Z", task: "tk-a", type, actor: "bob", data, ...extra }) as never;
  it("renders notes, verdicts and strips control characters", () => {
    expect(inboxMessage("tk-a", [event("task.comment", { kind: "note", author: "bob", body: "hi\u001b[2J\u0007 there" })])).toBe("💬 bob on tk-a: hi there\nnext: tk work tk-a");
    expect(inboxMessage("tk-a", [event("task.status", { from: "ready-to-review", to: "rejected" })])).toBe("↩ tk-a rejected — next: tk work tk-a");
    expect(inboxMessage("tk-a", [event("task.status", { from: "ready-to-review", to: "approved" })])).toBe("✅ tk-a approved — next: tk close tk-a");
    expect(sanitize("a\u009b31mb\u001b]0;title\u0007c\u0085d")).toBe("abc d");
  });
});

describe("inbox PR cards and the trailing stat card (11-04)", () => {
  const URL = "https://github.com/acme/app/pull/7";
  const pr = (state: string) => `pr=${JSON.stringify({ number: 7, url: URL, state })}`;
  const REPORT = { changes: { commits: 2, files: 3, additions: 10, deletions: 4 }, head: "a".repeat(40), at: "2026-11-10T00:00:00.000Z" };
  const seedReport = (root: string, id: string) => tk(root, ["update", id, "--set-metadata", `report=${JSON.stringify(REPORT)}`]);
  const CARD = (id: string) => `Changes · ${id}  2 commits · +10 −4 · 3 files  → `;

  it("a PR merged by another actor is one followUp: PR line, next: tk close, then the stale report card", async () => {
    const { root, cwd, t } = workspace();
    seedReport(root, t);
    const pi = loadExtension();
    await pi.fire("session_start", sessionCtx(cwd));
    tk(root, ["update", t, "--set-metadata", pr("merged")], {});
    const message = await until(() => followUps(pi)[0], 5000, "PR followUp");
    await Bun.sleep(400);
    expect(followUps(pi)).toHaveLength(1);
    const lines = message.split("\n");
    expect(lines[0]).toBe(`🔀 PR #7 on ${t} — merged (${URL})`);
    expect(lines[1]).toBe(`next: tk close ${t}`);
    expect(lines[2]).toContain(CARD(t));
    expect(lines[2]).toContain(`/tasks/${t}/diff · tk review ${t}`);
    expect(lines[2]).toContain("stale — from finish report 2026-11-10T00:00:00.000Z");
    expect(message).not.toContain("diff --git");
  }, 20_000);

  it("an approval message ends with the card line; an own-session PR save delivers nothing", async () => {
    const { root, cwd, t } = workspace();
    seedReport(root, t);
    const pi = loadExtension();
    await pi.fire("session_start", sessionCtx(cwd));
    tk(root, ["update", t, "--set-metadata", pr("open")], { TK_SESSION: "s-agent" });
    await Bun.sleep(800);
    expect(followUps(pi)).toHaveLength(0);
    tk(root, ["update", t, "--status", "approved"]);
    const approved = await until(() => followUps(pi)[0], 5000, "approval followUp");
    const lines = approved.split("\n");
    expect(lines[0]).toBe(`✅ ${t} approved — next: tk close ${t}`);
    expect(lines.at(-1)).toContain(CARD(t));
  }, 20_000);

  it("a card that throws still delivers the PR message unchanged", async () => {
    const { root, cwd, t } = workspace();
    const sent: string[] = [];
    const inbox = createInbox({ root, session: "s-agent", cwd, notify: (text) => sent.push(text), coalesceMs: 50, card: async () => { throw new Error("git gone"); } });
    await inbox.start();
    try {
      tk(root, ["update", t, "--set-metadata", pr("closed")], {});
      const message = await until(() => sent[0], 5000, "PR message");
      expect(message).toBe(`🔀 PR #7 on ${t} — closed (${URL})`);
    } finally {
      await inbox.stop();
    }
  }, 20_000);

  it("inboxMessage renders the last PR line after verdicts", () => {
    const event = (type: string, data: Record<string, unknown>) => ({ seq: 1, host: "h", ts: "2026-11-11T00:00:00Z", task: "tk-a", type, actor: "bob", data }) as never;
    expect(inboxMessage("tk-a", [
      event("task.pr", { op: "create", number: 7, url: URL, state: "open" }),
      event("task.pr", { op: "state", number: 7, url: URL, state: "merged" }),
    ])).toBe(`🔀 PR #7 on tk-a — merged (${URL})\nnext: tk close tk-a`);
    expect(inboxMessage("tk-a", [event("task.pr", { op: "create", number: 0, url: URL, state: "open" })])).toBe("");
  });
});
