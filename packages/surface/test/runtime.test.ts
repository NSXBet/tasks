import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSchema, IssueSchema, agentId, issueId, runId, type Agent, type Issue, type Run } from "@tasks/domain";
import type { IssueUnitOfWork } from "@tasks/application";
import { appendActivity, heartbeatRuntime, inboxEntries, markInboxArchived, markInboxRead, readActivity, readInboxMarkers, readRuntimeRegistry, registerRuntime, unregisterRuntime, type RuntimeRow } from "../src/runtime.js";
import { processWakeups, type WakeupState } from "../src/watch/wakeups.js";

const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-runtime-")); workspaces.push(value); return value; }
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

function agent(name: string): Agent {
  const at = new Date();
  return AgentSchema.parse({ id: agentId(name), name, description: "", owner: null, runtime: null, access: "workspace", mode: "default", status: "online", archivedAt: null, createdAt: at, updatedAt: at });
}

function deferredIssue(id: string, assignee: string | null, deferUntil: Date): Issue {
  const createdAt = new Date("2026-01-01T00:00:00Z");
  return IssueSchema.parse({ id: issueId(id), title: id, description: "", status: "deferred", priority: 2, type: "task", owner: null, assignee, createdBy: null, createdAt, updatedAt: createdAt, startedAt: null, closedAt: null, dueAt: null, deferUntil, parentId: null, labels: [], notes: null, design: null, acceptanceCriteria: null, estimate: null, specId: null, externalRef: null, metadata: {}, dependencies: [], dependencyCount: 0, dependentCount: 0, comments: [], commentCount: 0 });
}

function runRow(id: string, issue: string, state: Run["state"]): Run {
  const at = new Date();
  return { id: runId(id), issueId: issueId(issue), agentId: agentId("reviewer"), trigger: "wakeup", state, startedAt: null, closedAt: null, messages: [], usage: { tokens: null, cost: null }, createdAt: at, updatedAt: at, wireUnknown: {} };
}

function fakeUow(issues: readonly Issue[], runs: readonly Run[] = []): { uow: IssueUnitOfWork; saved: Issue[]; queued: Run[] } {
  const saved: Issue[] = [];
  const queued: Run[] = [];
  return {
    saved,
    queued,
    uow: {
      findById: async () => { throw new Error("not used"); },
      save: async (issue: Issue) => { saved.push(issue); return { ok: true, value: issue }; },
      list: async () => ({ ok: true, value: { items: issues, nextCursor: null } }),
      listRuns: async () => ({ ok: true, value: runs }),
      findAgent: async (raw: string) => ({ ok: true, value: raw === agentId("reviewer") ? agent("reviewer") : null }),
      saveRun: async (value: Run) => { queued.push(value); return { ok: true, value }; },
      addDependency: async () => { throw new Error("not used"); },
      removeDependency: async () => { throw new Error("not used"); },
    } as unknown as IssueUnitOfWork,
  };
}

describe("runtime registry", () => {
  const row = (id: string, at: Date): RuntimeRow => ({ id, kind: "watch", label: null, pid: 1234, startedAt: at.toISOString(), heartbeatAt: at.toISOString(), subscriptions: ["kinds=issue.changed"] });

  it("registers, heartbeats, re-registers and unregisters rows on disk", async () => {
    const dir = workspace();
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:01:00Z");
    await registerRuntime(dir, row("watch-1", t0));
    await registerRuntime(dir, row("watch-2", t0));
    // Same id re-registers in place instead of duplicating the row.
    await registerRuntime(dir, { ...row("watch-1", t0), label: "edge" });
    await heartbeatRuntime(dir, "watch-1", t1);
    // Heartbeating an unregistered id is a silent no-op.
    await heartbeatRuntime(dir, "watch-ghost", t1);
    expect(await readRuntimeRegistry(dir)).toEqual([
      row("watch-2", t0),
      { ...row("watch-1", t0), label: "edge", heartbeatAt: t1.toISOString() },
    ]);
    await unregisterRuntime(dir, "watch-1");
    await unregisterRuntime(dir, "watch-ghost");
    expect((await readRuntimeRegistry(dir)).map((entry) => entry.id)).toEqual(["watch-2"]);
  });
});

describe("activity trail", () => {
  it("appends NDJSON rows and applies the newest-last limit", async () => {
    const dir = workspace();
    await appendActivity(dir, { at: "2026-01-01T00:00:00Z", runtimeId: "watch-1", kind: "start", detail: "watching all" });
    await appendActivity(dir, { at: "2026-01-01T00:01:00Z", runtimeId: "watch-1", kind: "wakeup", detail: "tk-aaa fired" });
    const rows = await readActivity(dir);
    expect(rows.map((entry) => entry.kind)).toEqual(["start", "wakeup"]);
    expect((await readActivity(dir, 1)).map((entry) => entry.kind)).toEqual(["wakeup"]);
    expect(await readActivity(dir)).toEqual(rows);
  });
});

describe("defer_until wakeups", () => {
  it("undefers an expired issue and queues one wakeup run for its agent", async () => {
    const at = new Date("2026-01-02T00:00:00Z");
    const expiry = new Date("2026-01-01T12:00:00Z");
    const issues = [deferredIssue("tk-aaa", "reviewer", expiry), deferredIssue("tk-bbb", "reviewer", new Date("2026-01-02T12:00:00Z"))];
    const { uow, saved, queued } = fakeUow(issues);
    const fired = await processWakeups(uow, new Map() as WakeupState, at);
    if (!fired.ok) throw fired.error;
    expect(fired.value).toEqual([{ issueId: "tk-aaa", runId: "tk-aaa-run-1" }]);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.id).toBe("tk-aaa");
    expect(saved[0]!.status).toBe("open");
    expect(saved[0]!.deferUntil).toBeNull();
    expect(saved[0]!.updatedAt).toEqual(at);
    expect(issues[1]!.status).toBe("deferred");
    expect(queued.map((value) => ({ id: value.id, agentId: value.agentId, trigger: value.trigger, state: value.state, startedAt: value.startedAt })))
      .toEqual([{ id: "tk-aaa-run-1", agentId: agentId("reviewer"), trigger: "wakeup", state: "queued", startedAt: null }]);
  });

  it("fires without a run for unassigned issues and once per expiry", async () => {
    const at = new Date("2026-01-02T00:00:00Z");
    const expiry = new Date("2026-01-01T12:00:00Z");
    const issues = [deferredIssue("tk-aaa", null, expiry), deferredIssue("tk-bbb", "ghost", expiry)];
    const state = new Map() as WakeupState;
    const first = await processWakeups(fakeUow(issues).uow, state, at);
    if (!first.ok) throw first.error;
    // Unknown assignee (no matching agent row) also fires runless.
    expect(first.value).toEqual([{ issueId: "tk-aaa", runId: null }, { issueId: "tk-bbb", runId: null }]);
    expect([...state.entries()]).toEqual([["tk-aaa", expiry.toISOString()], ["tk-bbb", expiry.toISOString()]]);
    // Second tick at the same expiry: nothing fires again.
    const second = await processWakeups(fakeUow(issues).uow, state, at);
    if (!second.ok) throw second.error;
    expect(second.value).toEqual([]);
    // A new expiry (re-defer) wakes the issue again.
    issues[0] = { ...deferredIssue("tk-aaa", null, new Date("2026-01-01T23:00:00Z")) };
    const third = await processWakeups(fakeUow(issues).uow, state, at);
    if (!third.ok) throw third.error;
    expect(third.value).toEqual([{ issueId: "tk-aaa", runId: null }]);
  });
});

describe("inbox markers and entries", () => {
  it("derives unread-first entries and round-trips read/archive markers", async () => {
    const dir = workspace();
    const older = runRow("tk-aaa-run-1", "tk-aaa", "done");
    const newer = runRow("tk-bbb-run-1", "tk-bbb", "queued");
    newer.updatedAt = new Date("2026-01-01T01:00:00Z");
    older.updatedAt = new Date("2026-01-01T00:00:00Z");
    expect(inboxEntries([older, newer], { readAt: {}, archived: {} }).map((entry) => entry.runId)).toEqual(["tk-bbb-run-1", "tk-aaa-run-1"]);
    expect(inboxEntries([older, newer], { readAt: {}, archived: {} }).every((entry) => entry.unread && !entry.archived)).toBe(true);
    await markInboxRead(dir, "tk-aaa-run-1", new Date("2026-01-01T02:00:00Z"));
    await markInboxArchived(dir, "tk-bbb-run-1");
    const markers = await readInboxMarkers(dir);
    expect(markers).toEqual({ readAt: { "tk-aaa-run-1": "2026-01-01T02:00:00.000Z" }, archived: { "tk-bbb-run-1": true } });
    const entries = inboxEntries([older, newer], markers);
    // Read before archived; unread flips once the marker exists.
    expect(entries.map((entry) => [entry.runId, entry.unread, entry.archived])).toEqual([
      ["tk-aaa-run-1", false, false],
      ["tk-bbb-run-1", true, true],
    ]);
  });
});
