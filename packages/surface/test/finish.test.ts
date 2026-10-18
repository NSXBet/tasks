import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSchema, agentId, type Agent, type Issue, type Run } from "@tasks/domain";
import { finishPolicy, finishIssueUow } from "../src/index.js";
import { createSurface } from "../src/index.js";
import type { IssueUnitOfWork } from "@tasks/application";

const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-finish-")); workspaces.push(value); return value; }
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

async function runsOf(surface: Awaited<ReturnType<typeof createSurface>>, id: string): Promise<readonly Run[]> {
  const outer = await surface.store.transact(async (uow) => uow.listRuns(id as never)) as { ok: boolean; value: { ok: boolean; value: readonly Run[] } | null };
  return outer.ok && outer.value.ok ? outer.value.value : [];
}

/** Puts an issue in the `tk work`-produced state: branch + pinned changeset base. */
async function worked(surface: Awaited<ReturnType<typeof createSurface>>, id: string): Promise<Issue> {
  // UpdatePatch drops metadata, so persist the `tk work` state via uow.save.
  const outer = (await surface.store.transact(async (uow: IssueUnitOfWork) => {
    const page = await uow.list({ limit: 100_000 });
    if (!page.ok) throw new Error("list failed");
    const found = page.value.items.find((item) => item.id === id);
    if (found === undefined) throw new Error("missing issue");
    const next: Issue = { ...found, branch: "task/x", metadata: { ...found.metadata, changeset: { base: "main" } }, updatedAt: new Date() };
    const saved = await uow.save(next);
    if (!saved.ok) throw new Error("save failed");
    return next;
  })) as unknown as { ok: boolean; value: Issue };
  if (!outer.ok) throw new Error("transact failed");
  return outer.value;
}

function agent(name: string): Agent {
  const at = new Date();
  return AgentSchema.parse({ id: agentId(name), name, description: "", owner: null, runtime: null, access: "workspace", mode: "default", status: "online", archivedAt: null, createdAt: at, updatedAt: at });
}

describe("finishPolicy (D-09)", () => {
  const at = new Date();
  const issue = { id: "TSK-1", status: "open", startedAt: null, closedAt: null } as unknown as Issue;

  it("allows only ready-to-review", () => {
    expect(finishPolicy.transition(issue, { from: "open", to: "ready-to-review", at })).toEqual({ allowed: true, startedAt: null, closedAt: null });
  });

  it("denies closed and done targets — finish can never commit a terminal state", () => {
    expect(finishPolicy.transition(issue, { from: "open", to: "closed", at }).allowed).toBe(false);
    expect(finishPolicy.transition(issue, { from: "open", to: "done", at }).allowed).toBe(false);
  });
});

describe("finishIssueUow (FIN-01)", () => {
  it("moves open -> ready-to-review with agent_session and finished_at recorded", async () => {
    const surface = await createSurface({ root: workspace() });
    const created = await surface.create({ title: "finishable" });
    if (!created.ok) throw created.error;
    const issue = await worked(surface, created.value.id);
    const finished = await surface.finish(created.value.id, "s1");
    if (!finished.ok) throw finished.error;
    expect(finished.value.status).toBe("ready-to-review");
    expect(finished.value.closedAt).toBeNull();
    expect(finished.value.metadata["agent_session"]).toBe("s1");
    expect(typeof finished.value.metadata["finished_at"]).toBe("string");
    expect(finished.value.branch).toBe(issue.branch);
    await surface.store.close();
  });

  it("refuses without a branch or pinned changeset base (D-10)", async () => {
    const surface = await createSurface({ root: workspace() });
    const created = await surface.create({ title: "never worked" });
    if (!created.ok) throw created.error;
    const refused = await surface.finish(created.value.id, "s1");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain("tk work");
    await surface.store.close();
  });

  it("re-finish is idempotent on status and re-records the session (D-11)", async () => {
    const surface = await createSurface({ root: workspace() });
    const created = await surface.create({ title: "twice" });
    if (!created.ok) throw created.error;
    await worked(surface, created.value.id);
    const first = await surface.finish(created.value.id, "s1");
    if (!first.ok) throw first.error;
    const second = await surface.finish(created.value.id, "s2");
    if (!second.ok) throw second.error;
    expect(second.value.status).toBe("ready-to-review");
    expect(second.value.metadata["agent_session"]).toBe("s2");
    // D-11 re-records the completion record: finished_at is refreshed, not preserved.
    expect(typeof second.value.metadata["finished_at"]).toBe("string");
    expect(first.value.metadata["finished_at"]).not.toBe(second.value.metadata["finished_at"]);
    await surface.store.close();
  });

  it("finalizes an active run to in_review with closedAt stamped and startedAt preserved", async () => {
    const surface = await createSurface({ root: workspace() });
    const created = await surface.create({ title: "run work" });
    if (!created.ok) throw created.error;
    await worked(surface, created.value.id);
    await surface.store.transact(async (uow) => uow.saveAgent(agent("reviewer")));
    const assigned = await surface.update(created.value.id, { assignee: "reviewer" });
    expect(assigned.ok).toBe(true);
    const moved = await surface.status(created.value.id, { status: "in_progress" });
    expect(moved.ok).toBe(true);
    const before = await runsOf(surface, created.value.id);
    expect(before).toHaveLength(1);
    const finished = await surface.finish(created.value.id, "s1");
    if (!finished.ok) throw finished.error;
    const runs = await runsOf(surface, created.value.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.state).toBe("in_review");
    expect(runs[0]!.closedAt).not.toBeNull();
    expect(runs[0]!.startedAt).toBe(before[0]!.startedAt);
    await surface.store.close();
  });

  it("finishIssueUow refuses an empty session (unit, fake uow)", async () => {
    await expect(finishIssueUow({} as IssueUnitOfWork, { cwd: "/repo" }, "TSK-1", "  ")).rejects.toThrow("non-empty session");
  });
});
