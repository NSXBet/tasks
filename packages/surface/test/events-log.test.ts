import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Issue, Run } from "@tasks/domain";
import { agentId, runId } from "@tasks/domain";
import { appendEvents, createSurface, lastEventSeq, MessageError, readEvents, type TaskEvent } from "../src/index.js";

const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-events-")); workspaces.push(value); return value; }
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

const logOf = (root: string): TaskEvent[] => {
  const path = join(root, ".tasks", "events.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as TaskEvent);
};
const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; };
const draft = (n: number) => ({ task: `tk-${n}`, type: "task.update" as const, data: { fields: ["title"] } });

describe("recorder through createSurface", () => {
  it("every surface mutator appends its event types", async () => {
    const root = workspace();
    const surface = await createSurface({ root, actor: "alice" });
    const a = unwrap(await surface.create({ title: "a" }));
    const b = unwrap(await surface.create({ title: "b" }));
    const mark = () => logOf(root).length;
    const since = (start: number) => logOf(root).slice(start);

    expect(logOf(root).map((event) => [event.type, event.task])).toEqual([["task.created", a.id], ["task.created", b.id]]);
    let start = mark(); unwrap(await surface.status(a.id, { status: "in-progress" }));
    expect(since(start).map((event) => [event.type, event.data])).toEqual([["task.status", { from: "open", to: "in-progress" }]]);
    start = mark(); unwrap(await surface.comment(a.id, "hi"));
    expect(since(start)).toMatchObject([{ type: "task.comment", task: a.id, actor: "alice", data: { kind: "note", body: "hi" } }]);
    start = mark(); unwrap(await surface.assign(a.id, "bob"));
    expect(since(start)).toMatchObject([{ type: "task.owner", data: { field: "assignee", from: null, to: "bob" } }]);
    start = mark(); unwrap(await surface.labelAdd(a.id, "x"));
    expect(since(start)).toMatchObject([{ type: "task.update", data: { fields: ["labels"] } }]);
    start = mark(); unwrap(await surface.depAdd(a.id, b.id));
    expect(since(start)).toMatchObject([{ type: "task.update", task: a.id, data: { fields: ["dependencies"] } }]);
    start = mark(); unwrap(await surface.delete([b.id]));
    expect(since(start).map((event) => [event.type, event.task])).toContainEqual(["task.deleted", b.id]);
    const seqs = logOf(root).map((event) => event.seq);
    expect(seqs).toEqual(seqs.map((_, index) => index + 1));
    await surface.store.close();
  });

  it("a review send appends exactly one sent task.comment per card", async () => {
    const root = workspace();
    const surface = await createSurface({ root });
    const issue = unwrap(await surface.create({ title: "r" }));
    unwrap(await surface.store.transact(async (uow) => {
      const current = unwrap(await uow.findById(issue.id))!;
      const threads = [0, 1].map((index) => ({ id: `t${index}`, filePath: `f${index}.ts`, line: index + 1, rootCommentId: `r${index}`, replyCommentIds: [], status: "open", resolved: false }));
      const comments = threads.map((thread, index) => ({ id: thread.rootCommentId, issueId: issue.id, author: "ann", text: `[review f${index}.ts:${index + 1}] body ${index}`, createdAt: new Date(), wireUnknown: { reviewThread: thread.id } }));
      unwrap(await uow.save({ ...current, metadata: { reviewThreads: { version: 1, threads } }, comments, commentCount: comments.length } as unknown as Issue));
    }));
    const start = logOf(root).length;
    const sent = unwrap(await surface.reviewCommentsSend(issue.id));
    expect(sent.sent).toHaveLength(2);
    const events = logOf(root).slice(start);
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event).toMatchObject({ type: "task.comment", data: { kind: "review", to: "sent" } });
      expect(String(event.data["body"])).not.toBe("");
      expect(String(event.data["location"])).not.toBe("");
    }
    await surface.store.close();
  });

  it("a failed transaction appends nothing; a new run appends run.changed", async () => {
    const root = workspace();
    const surface = await createSurface({ root });
    const issue = unwrap(await surface.create({ title: "x" }));
    const start = logOf(root).length;
    const failed = await surface.store.transact(async (uow) => {
      unwrap(await uow.save({ ...unwrap(await uow.findById(issue.id))!, title: "changed" } as Issue));
      throw new MessageError("boom");
    });
    expect(failed.ok).toBe(false);
    expect(logOf(root).length).toBe(start);
    const at = new Date();
    const run = { id: runId("run-ev-1"), issueId: issue.id, agentId: agentId("reviewer"), trigger: "manual", state: "running", startedAt: null, closedAt: null, messages: [], usage: { tokens: null, cost: null }, createdAt: at, updatedAt: at, wireUnknown: {} } as unknown as Run;
    unwrap(await surface.store.transact(async (uow) => { unwrap(await uow.saveRun(run)); }));
    expect(logOf(root).slice(start)).toMatchObject([{ type: "run.changed", task: issue.id, data: { runId: "run-ev-1", from: null, to: "running" } }]);
    await surface.store.close();
  });
});

describe("events.jsonl log", () => {
  it("two processes appending concurrently get seqs 1..100 with no torn lines", async () => {
    const root = workspace();
    const tasksDir = join(root, ".tasks");
    mkdirSync(tasksDir, { recursive: true });
    const logModule = join(import.meta.dir, "../dist/events/log.js");
    const script = join(root, "append.mjs");
    writeFileSync(script, `import { appendEvents } from ${JSON.stringify(logModule)};\nconst [dir, tag] = process.argv.slice(2);\nfor (let i = 0; i < 50; i++) await appendEvents(dir, [{ task: tag + i, type: "task.update", data: { fields: ["title"] } }], { actor: tag });\n`);
    const children = ["a", "b"].map((tag) => Bun.spawn([process.execPath, script, tasksDir, tag], { stdout: "pipe", stderr: "pipe" }));
    const codes = await Promise.all(children.map((child) => child.exited));
    expect(codes).toEqual([0, 0]);
    const raw = readFileSync(join(tasksDir, "events.jsonl"), "utf8");
    const lines = raw.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(100);
    expect(lines.map((line) => (JSON.parse(line) as TaskEvent).seq)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
  });

  it("takes over a stale lock", async () => {
    const tasksDir = join(workspace(), ".tasks");
    const lock = join(tasksDir, "events.lock");
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "pid"), "999999\n");
    const old = new Date(Date.now() - 20_000);
    utimesSync(lock, old, old);
    const started = Date.now();
    const events = await appendEvents(tasksDir, [draft(1)], { actor: "t" });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(events.map((event) => event.seq)).toEqual([1]);
  });

  it("readEvents filters by cursor and both readers ignore a torn trailing line", async () => {
    const tasksDir = join(workspace(), ".tasks");
    expect(await readEvents(tasksDir)).toEqual([]);
    expect(await lastEventSeq(tasksDir)).toBe(0);
    await appendEvents(tasksDir, Array.from({ length: 100 }, (_, index) => draft(index)), { actor: "t", session: "s" });
    expect((await readEvents(tasksDir, { after: 98 })).map((event) => event.seq)).toEqual([99, 100]);
    expect((await readEvents(tasksDir, { after: 0, limit: 3 })).map((event) => event.seq)).toEqual([1, 2, 3]);
    appendFileSync(join(tasksDir, "events.jsonl"), '{"seq":101,"host":"h","ts":"x","type":"task.up');
    expect(await lastEventSeq(tasksDir)).toBe(100);
    expect((await readEvents(tasksDir, { after: 98 })).map((event) => event.seq)).toEqual([99, 100]);
    // The next append re-terminates the torn line and continues the sequence.
    const next = await appendEvents(tasksDir, [draft(101)], { actor: "t" });
    expect(next.map((event) => event.seq)).toEqual([101]);
    expect((await readEvents(tasksDir, { after: 99 })).map((event) => event.seq)).toEqual([100, 101]);
  });
});
