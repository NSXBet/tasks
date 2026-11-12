import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendEvents, matchesEvent, normalizeKinds, parseEventQuery, readCursor, seedCursor, tailEvents, toWatchEvent,
  withTasks, writeCursor, type TaskEvent, type TaskOwnership,
} from "../src/index.js";

const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-events-read-")); workspaces.push(value); return value; }
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

const line = (over: Partial<TaskEvent> & Pick<TaskEvent, "type">): TaskEvent => ({
  seq: 1, host: "h", ts: "2026-11-11T00:00:00.000Z", task: "tk-1", actor: "yuri", data: {}, ...over,
});
const ctx = { me: "yuri" };

describe("parseEventQuery / matchesEvent", () => {
  it("status=,task= matches only that task's task.status to the status", async () => {
    const query = parseEventQuery("status=ready-to-review,task=tk-1");
    expect(await matchesEvent(line({ type: "task.status", data: { from: "in-progress", to: "ready-to-review" } }), query, ctx)).toBe(true);
    expect(await matchesEvent(line({ type: "task.status", task: "tk-2", data: { to: "ready-to-review" } }), query, ctx)).toBe(false);
    expect(await matchesEvent(line({ type: "task.status", data: { to: "closed" } }), query, ctx)).toBe(false);
    expect(await matchesEvent(line({ type: "task.created", data: { status: "ready-to-review" } }), query, ctx)).toBe(false);
    expect(await matchesEvent(line({ type: "task.comment", data: { to: "ready-to-review" } }), query, ctx)).toBe(false);
  });

  it("type= alternatives, actor=, and owner=me on task.owner", async () => {
    const types = parseEventQuery("type=task.comment|task.status");
    expect(await matchesEvent(line({ type: "task.comment" }), types, ctx)).toBe(true);
    expect(await matchesEvent(line({ type: "task.status" }), types, ctx)).toBe(true);
    expect(await matchesEvent(line({ type: "task.update" }), types, ctx)).toBe(false);
    const actor = parseEventQuery("actor=yuri");
    expect(await matchesEvent(line({ type: "task.update" }), actor, ctx)).toBe(true);
    expect(await matchesEvent(line({ type: "task.update", actor: "bob" }), actor, ctx)).toBe(false);
    const owner = parseEventQuery("owner=me");
    expect(await matchesEvent(line({ type: "task.owner", data: { field: "owner", from: null, to: "yuri" } }), owner, ctx)).toBe(true);
    expect(await matchesEvent(line({ type: "task.owner", data: { field: "owner", from: "yuri", to: "bob" } }), owner, ctx)).toBe(false);
  });

  it("mine uses ctx.ownerOf (owner or assignee), cached per call", async () => {
    const calls: string[] = [];
    const table: Record<string, TaskOwnership> = { "tk-1": { owner: "yuri", assignee: null }, "tk-2": { owner: "bob", assignee: "yuri" }, "tk-3": { owner: "bob", assignee: null } };
    const ownerOf = async (task: string): Promise<TaskOwnership | null> => { calls.push(task); return table[task] ?? null; };
    const mine = parseEventQuery("mine,owner=me");
    expect(await matchesEvent(line({ type: "task.comment", task: "tk-1" }), mine, { me: "yuri", ownerOf })).toBe(true);
    expect(calls).toEqual(["tk-1"]);
    expect(await matchesEvent(line({ type: "task.comment", task: "tk-2" }), parseEventQuery("mine"), { me: "yuri", ownerOf })).toBe(true);
    expect(await matchesEvent(line({ type: "task.comment", task: "tk-3" }), parseEventQuery("mine"), { me: "yuri", ownerOf })).toBe(false);
    expect(await matchesEvent(line({ type: "task.comment", task: "tk-9" }), parseEventQuery("mine"), { me: "yuri", ownerOf })).toBe(false);
    expect(await matchesEvent(line({ type: "task.comment" }), parseEventQuery("mine"), { me: "yuri" })).toBe(false);
  });

  it("rejects unknown keys, tolerates whitespace, empty matches everything", async () => {
    expect(() => parseEventQuery("colour=red")).toThrow("invalid watch query: colour=red");
    expect(() => parseEventQuery("task=")).toThrow("invalid watch query: task=");
    expect(() => parseEventQuery("bogus")).toThrow("invalid watch query: bogus");
    expect(parseEventQuery("  task=tk-1 ,  type=task.status ").clauses).toEqual([{ key: "task", values: ["tk-1"] }, { key: "type", values: ["task.status"] }]);
    expect(await matchesEvent(line({ type: "task.deleted" }), parseEventQuery(""), ctx)).toBe(true);
  });

  it("withTasks ANDs a task= clause for positional ids", async () => {
    const query = withTasks("type=task.status", ["tk-1", "tk-2"]);
    expect(query.clauses).toEqual([{ key: "type", values: ["task.status"] }, { key: "task", values: ["tk-1", "tk-2"] }]);
    expect(await matchesEvent(line({ type: "task.status", task: "tk-2" }), query, ctx)).toBe(true);
    expect(await matchesEvent(line({ type: "task.status", task: "tk-3" }), query, ctx)).toBe(false);
    expect(withTasks(parseEventQuery("mine"), [])).toEqual({ clauses: [{ key: "mine" }] });
  });
});

describe("kind aliases and toWatchEvent", () => {
  it("normalizes legacy names and passes unknown names through", () => {
    expect(normalizeKinds(["issue.updated"])).toEqual(["task.update", "task.owner", "task.evidence", "task.worktree", "task.pr", "task.report"]);
    expect(normalizeKinds(["ready.changed", "counts.changed"])).toEqual(["task.created", "task.status", "task.deleted", "task.update"]);
    expect(normalizeKinds(["issue.created", "task.created", "nope"])).toEqual(["task.created", "nope"]);
    expect(normalizeKinds(undefined)).toBeUndefined();
  });

  it("maps a log line to a WatchEvent with actor/session and the commentId alias", () => {
    const event = toWatchEvent(line({ seq: 9, type: "task.comment", session: "s-1", data: { kind: "review", comment: "c-7", to: "sent" } }));
    expect(event).toEqual({ seq: 9, kind: "task.comment", at: "2026-11-11T00:00:00.000Z", issueId: "tk-1", data: { actor: "yuri", session: "s-1", kind: "review", comment: "c-7", to: "sent", commentId: "c-7" } });
  });
});

describe("cursors.json", () => {
  it("reads null when unset, writes per subscriber and host, seeds only when absent", async () => {
    const dir = join(workspace(), ".tasks");
    expect(await readCursor(dir, "agent-a")).toBeNull();
    await writeCursor(dir, "agent-a", 7);
    expect(JSON.parse(readFileSync(join(dir, "cursors.json"), "utf8"))).toEqual({ version: 1, subscribers: { "agent-a": { [hostname()]: 7 } } });
    await writeCursor(dir, "agent-b", 3);
    expect(await readCursor(dir, "agent-a")).toBe(7);
    expect(await readCursor(dir, "agent-b")).toBe(3);
    expect(await seedCursor(dir, "agent-a", 1)).toBe(7);
    expect(await seedCursor(dir, "agent-c", 2)).toBe(2);
    expect(await readCursor(dir, "agent-a")).toBe(7);
    expect(await readCursor(dir, "agent-c")).toBe(2);
  });

  it("concurrent writers in one process never lose an entry", async () => {
    const dir = join(workspace(), ".tasks");
    await Promise.all(Array.from({ length: 20 }, (_, index) => writeCursor(dir, `agent-${index}`, index)));
    for (let index = 0; index < 20; index += 1) expect(await readCursor(dir, `agent-${index}`)).toBe(index);
  });

  it("malformed cursors.json reads as empty and is replaced on write", async () => {
    const dir = join(workspace(), ".tasks");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "cursors.json"), "{ not json");
    expect(await readCursor(dir, "agent-a")).toBeNull();
    await writeCursor(dir, "agent-a", 4);
    expect(await readCursor(dir, "agent-a")).toBe(4);
  });
});

describe("tailEvents", () => {
  it("starts at the log end, delivers appends, and drops already-seen seqs after a replace", async () => {
    const dir = join(workspace(), ".tasks");
    await appendEvents(dir, [{ task: "tk-1", type: "task.update", data: {} }], { actor: "a" });
    const seen: number[] = [];
    const tail = tailEvents(dir, { onEvents: (batch) => { seen.push(...batch.map((event) => event.seq)); }, pollMs: 50 });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await appendEvents(dir, [{ task: "tk-1", type: "task.status", data: { to: "x" } }, { task: "tk-1", type: "task.update", data: {} }], { actor: "a" });
      for (let i = 0; i < 100 && seen.length < 2; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(seen).toEqual([2, 3]);
      // Replace the file with a shorter log reusing low seqs plus one new line.
      writeFileSync(join(dir, "events.jsonl"), "");
      appendFileSync(join(dir, "events.jsonl"), `${JSON.stringify(line({ seq: 2, type: "task.update" }))}\n${JSON.stringify(line({ seq: 4, type: "task.update" }))}\n`);
      for (let i = 0; i < 100 && seen.length < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(seen).toEqual([2, 3, 4]);
    } finally {
      tail.stop();
      await tail.done;
    }
  });
});
