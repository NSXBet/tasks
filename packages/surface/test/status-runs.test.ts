import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSchema, agentId, runId, type Agent, type Issue, type Run } from "@tasks/domain";
import { createSurface } from "../src/index.js";
import { diffOnce } from "../src/watch/core.js";
import type { WatchSubscription } from "../src/watch/protocol.js";
import type { IssueUnitOfWork } from "@tasks/application";

const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-status-runs-")); workspaces.push(value); return value; }
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

/** store.transact wraps the uow Result, so run reads need a double unwrap. */
async function runsOf(surface: { store: { transact: (work: (uow: IssueUnitOfWork) => Promise<unknown>) => Promise<unknown> } }, id: string): Promise<readonly Run[] | null> {
  const outer = await surface.store.transact(async (uow) => uow.listRuns(id as never)) as { ok: boolean; value: { ok: boolean; value: readonly Run[] } | null };
  return outer.ok && outer.value.ok ? outer.value.value : null;
}

function agent(name: string): Agent {
  const at = new Date();
  return AgentSchema.parse({ id: agentId(name), name, description: "", owner: null, runtime: null, access: "workspace", mode: "default", status: "online", archivedAt: null, createdAt: at, updatedAt: at });
}

function run(id: string, issueId: string, state: Run["state"]): Run {
  const at = new Date();
  return { id: runId(id), issueId: issueId as Issue["id"], agentId: agentId("reviewer"), trigger: "manual", state, startedAt: null, closedAt: null, messages: [], usage: { tokens: null, cost: null }, createdAt: at, updatedAt: at, wireUnknown: {} };
}

describe("status-driven run side effects", () => {
  it("queues a run when an assigned issue moves open -> in_progress", async () => {
    const root = workspace();
    const surface = await createSurface({ root });
    const created = await surface.create({ title: "assigned work" });
    if (!created.ok) throw created.error;
    await surface.store.transact(async (uow) => uow.saveAgent(agent("reviewer")));
    const assigned = await surface.update(created.value.id, { assignee: "reviewer" });
    expect(assigned.ok).toBe(true);
    const moved = await surface.status(created.value.id, { status: "in_progress" });
    expect(moved.ok).toBe(true);
    const runs = await runsOf(surface, created.value.id);
    expect((runs ?? []).map((value) => ({ id: value.id, state: value.state, agentId: value.agentId, trigger: value.trigger })))
      .toEqual([{ id: `${created.value.id}-run-1`, state: "queued", agentId: agentId("reviewer"), trigger: "status-move" }]);
    // Re-moving to in_progress does not queue a second run.
    const again = await surface.status(created.value.id, { status: "open" });
    expect(again.ok).toBe(true);
    const third = await surface.status(created.value.id, { status: "in_progress" });
    expect(third.ok).toBe(true);
    const requeued = await runsOf(surface, created.value.id);
    expect(requeued ?? []).toHaveLength(1);
    await surface.store.close();
  });

  it("does not queue runs for issues without an agent assignee", async () => {
    const root = workspace();
    const surface = await createSurface({ root });
    const created = await surface.create({ title: "plain work" });
    if (!created.ok) throw created.error;
    const moved = await surface.status(created.value.id, { status: "in_progress" });
    expect(moved.ok).toBe(true);
    const runs = await runsOf(surface, created.value.id);
    expect(runs ?? []).toEqual([]);
    await surface.store.close();
  });

  it("finalizes the active run when moving to ready-to-review, rejected and archived", async () => {
    const root = workspace();
    const surface = await createSurface({ root });
    await surface.store.transact(async (uow) => uow.saveAgent(agent("reviewer")));
    const start = async (title: string) => {
      const created = await surface.create({ title });
      if (!created.ok) throw created.error;
      await surface.update(created.value.id, { assignee: "reviewer" });
      const moved = await surface.status(created.value.id, { status: "in_progress" });
      expect(moved.ok).toBe(true);
      return created.value.id;
    };
    const reviewId = await start("review me");
    const review = await surface.status(reviewId, { status: "ready-to-review" });
    expect(review.ok).toBe(true);
    const reviewRuns = await runsOf(surface, reviewId);
    expect((reviewRuns ?? []).map((value) => ({ state: value.state, closedAt: value.closedAt !== null })))
      .toEqual([{ state: "in_review", closedAt: true }]);

    const rejectedId = await start("reject me");
    const rejected = await surface.status(rejectedId, { status: "rejected" });
    expect(rejected.ok).toBe(true);
    const rejectedRuns = await runsOf(surface, rejectedId);
    expect((rejectedRuns ?? []).map((value) => value.state)).toEqual(["failed"]);

    const archivedId = await start("archive me");
    const archived = await surface.status(archivedId, { status: "archived" });
    expect(archived.ok).toBe(true);
    const archivedRuns = await runsOf(surface, archivedId);
    expect((archivedRuns ?? []).map((value) => value.state)).toEqual(["cancelled"]);
    await surface.store.close();
  });

  it("finalizes nothing when a status move lands on a runless assigned issue", async () => {
    const root = workspace();
    const surface = await createSurface({ root });
    await surface.store.transact(async (uow) => uow.saveAgent(agent("reviewer")));
    const created = await surface.create({ title: "no active run" });
    if (!created.ok) throw created.error;
    await surface.update(created.value.id, { assignee: "reviewer" });
    const rejected = await surface.status(created.value.id, { status: "rejected" });
    expect(rejected.ok).toBe(true);
    const runs = await runsOf(surface, created.value.id);
    expect(runs ?? []).toEqual([]);
    await surface.store.close();
  });

  it("closes in_review runs as done when the issue closes", async () => {
    const root = workspace();
    const surface = await createSurface({ root });
    await surface.store.transact(async (uow) => uow.saveAgent(agent("reviewer")));
    const created = await surface.create({ title: "close with review" });
    if (!created.ok) throw created.error;
    await surface.update(created.value.id, { assignee: "reviewer" });
    await surface.status(created.value.id, { status: "in_progress" });
    await surface.status(created.value.id, { status: "ready-to-review" });
    const closed = await surface.status(created.value.id, { status: "closed" });
    expect(closed.ok).toBe(true);
    const runs = await runsOf(surface, created.value.id);
    expect((runs ?? []).map((value) => value.state)).toEqual(["done"]);
    await surface.store.close();
  });
});

describe("run.changed watch events", () => {
  it("emits run.changed on state transitions with from/to payloads and prunes deleted runs", async () => {
    const subscription: WatchSubscription = { kinds: ["run.changed"] };
    const state = { lastUpdatedAt: new Map<string, string>(), runWatermarks: new Map<string, string>(), readyHash: null, counts: null };
    const base = run("tk-aaa-run-1", "tk-aaa", "queued");
    const first = await diffOnce(fakeUow([], [base]), subscription, state);
    // First sight only establishes the baseline.
    expect(first.filter((event) => event.kind === "run.changed")).toEqual([]);
    base.state = "running";
    const second = await diffOnce(fakeUow([], [base]), subscription, state);
    const transition = second.find((event) => event.kind === "run.changed");
    expect(transition && { issueId: transition.issueId, data: transition.data }).toEqual({ issueId: "tk-aaa", data: { runId: "tk-aaa-run-1", from: "queued", to: "running" } });
    const third = await diffOnce(fakeUow([], [base]), subscription, state);
    expect(third.filter((event) => event.kind === "run.changed")).toEqual([]);
    const fourth = await diffOnce(fakeUow([], []), subscription, state);
    expect(fourth.filter((event) => event.kind === "run.changed")).toEqual([]);
    expect(state.runWatermarks.has("tk-aaa-run-1")).toBe(false);
  });

  it("respects ids and kinds subscription filters for run events", async () => {
    const subscription: WatchSubscription = { ids: ["tk-bbb"] };
    const state = { lastUpdatedAt: new Map<string, string>(), runWatermarks: new Map<string, string>(), readyHash: null, counts: null };
    const watched = run("tk-bbb-run-1", "tk-bbb", "queued");
    const other = run("tk-ccc-run-1", "tk-ccc", "queued");
    await diffOnce(fakeUow([], [watched, other]), subscription, state);
    watched.state = "done";
    other.state = "done";
    const events = await diffOnce(fakeUow([], [watched, other]), subscription, state);
    const changed = events.filter((event) => event.kind === "run.changed");
    expect(changed.map((event) => event.issueId)).toEqual(["tk-bbb"]);
  });
});

function fakeUow(issues: readonly Issue[], runs: readonly Run[] = []): IssueUnitOfWork {
  return {
    findById: async () => { throw new Error("not used"); },
    save: async () => { throw new Error("not used"); },
    list: async () => ({ ok: true, value: { items: issues, nextCursor: null } }),
    listRuns: async () => ({ ok: true, value: runs }),
    addDependency: async () => { throw new Error("not used"); },
    removeDependency: async () => { throw new Error("not used"); },
  } as unknown as IssueUnitOfWork;
}
