import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSchema, agentId, runId, type Agent, type Issue, type Run } from "@tasks/domain";
import { createSurface, runWatchLoop, type WatchEvent } from "../src/index.js";
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
  /** Integration exception: the loop runs on the OS clock against a real workspace; waits are bounded polls. */
  async function until(fn: () => boolean, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!fn()) {
      if (Date.now() > deadline) throw new Error("timed out waiting for condition");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it("delivers run.changed from the log with from/to payloads, honoring kinds and ids", async () => {
    const root = workspace();
    const surface = await createSurface({ root });
    const watched = await surface.create({ title: "watched" });
    const other = await surface.create({ title: "other" });
    if (!watched.ok || !other.ok) throw new Error("create failed");
    await surface.store.transact(async (uow) => uow.saveAgent(agent("reviewer")));
    const events: WatchEvent[] = [];
    const idsOnly: WatchEvent[] = [];
    let stopping = false;
    const loops = [
      runWatchLoop(surface.store, { kinds: ["run.changed"], interval: 250 }, (event) => events.push(event), () => stopping),
      runWatchLoop(surface.store, { kinds: ["run.changed"], ids: [watched.value.id], interval: 250 }, (event) => idsOnly.push(event), () => stopping),
    ];
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const base = run(`${watched.value.id}-run-1`, watched.value.id, "queued");
      await surface.store.transact(async (uow) => uow.saveRun(base));
      await surface.store.transact(async (uow) => uow.saveRun({ ...base, state: "running" }));
      await surface.store.transact(async (uow) => uow.saveRun({ ...base, state: "running" }));
      await surface.store.transact(async (uow) => uow.saveRun(run(`${other.value.id}-run-1`, other.value.id, "queued")));
      await until(() => events.length >= 3 && idsOnly.length >= 2);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(events.map((event) => [event.issueId, event.data?.runId, event.data?.from ?? null, event.data?.to])).toEqual([
        [watched.value.id, `${watched.value.id}-run-1`, null, "queued"],
        [watched.value.id, `${watched.value.id}-run-1`, "queued", "running"],
        [other.value.id, `${other.value.id}-run-1`, null, "queued"],
      ]);
      expect(idsOnly.map((event) => event.data?.to)).toEqual(["queued", "running"]);
    } finally {
      stopping = true;
      await Promise.all(loops);
      await surface.store.close();
    }
  });
});
