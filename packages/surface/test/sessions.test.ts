import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSchema, agentId, runId, type Agent, type Issue, type Run } from "@tasks/domain";
import { createSurface, finishIssueUow } from "../src/index.js";
import type { IssueUnitOfWork } from "@tasks/application";

const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-sessions-")); workspaces.push(value); return value; }
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

type Surface = Awaited<ReturnType<typeof createSurface>>;

function agent(name: string): Agent {
  const at = new Date();
  return AgentSchema.parse({ id: agentId(name), name, description: "", owner: null, runtime: null, access: "workspace", mode: "default", status: "online", archivedAt: null, createdAt: at, updatedAt: at });
}

/** Puts an issue in the `tk work`-produced state (branch + pinned changeset base) so finish accepts it. */
async function worked(surface: Surface, id: string): Promise<void> {
  const outer = await surface.store.transact(async (uow: IssueUnitOfWork) => {
    const found = await uow.findById(id as Issue["id"]);
    if (!found.ok || found.value === null) throw new Error("missing issue");
    const next: Issue = { ...found.value, branch: "task/x", metadata: { ...found.value.metadata, changeset: { base: "main" } }, updatedAt: new Date() };
    const saved = await uow.save(next);
    if (!saved.ok) throw new Error("save failed");
  });
  if (!outer.ok) throw new Error("transact failed");
}

async function runsOf(surface: Surface, id: string): Promise<readonly Run[]> {
  const outer = await surface.store.transact(async (uow) => uow.listRuns(id as Issue["id"]));
  return outer.ok && outer.value.ok ? outer.value.value : [];
}

describe("surface.taskSessions (D-02)", () => {
  it("lists the stored run and the tk finish session record, newest first", async () => {
    const surface = await createSurface({ root: workspace() });
    const created = await surface.create({ title: "session work" });
    if (!created.ok) throw created.error;
    const id = created.value.id;
    await worked(surface, id);
    await surface.store.transact(async (uow) => uow.saveAgent(agent("reviewer")));
    expect((await surface.update(id, { assignee: "reviewer" })).ok).toBe(true);
    expect((await surface.status(id, { status: "in_progress" })).ok).toBe(true);

    const finishedAt = new Date(Date.now() + 60_000);
    const finished = await surface.store.transact(async (uow) => finishIssueUow(uow, { cwd: surface.store.root }, id, "s1", finishedAt, "codex"));
    if (!finished.ok) throw finished.error;

    const [run] = await runsOf(surface, id);
    expect(run).toBeDefined();
    const rows = await surface.taskSessions(id);
    expect(rows).toEqual([
      { id: "session:s1", state: "done", label: "codex · session s1", updatedAt: finishedAt.toISOString() },
      { id: run!.id, state: run!.state, label: "reviewer", updatedAt: run!.updatedAt.toISOString() },
    ]);
    await surface.store.close();
  });

  it("labels a run by its first message (capped at 80 chars), sorted by updatedAt descending", async () => {
    const surface = await createSurface({ root: workspace() });
    const created = await surface.create({ title: "messages" });
    if (!created.ok) throw created.error;
    const id = created.value.id;
    const older = new Date("2026-01-01T00:00:00.000Z");
    const newer = new Date("2026-02-01T00:00:00.000Z");
    const base = (rid: string, at: Date): Run => ({ id: runId(rid), issueId: id as Issue["id"], agentId: null, trigger: "manual", state: "failed", startedAt: null, closedAt: null, messages: [], usage: { tokens: null, cost: null }, createdAt: at, updatedAt: at, wireUnknown: {} });
    await surface.store.transact(async (uow) => {
      await uow.saveRun(base(`${id}-run-1`, older));
      await uow.saveRun({ ...base(`${id}-run-2`, newer), messages: [{ at: newer, kind: "note", text: "x".repeat(200) }] });
    });
    const rows = await surface.taskSessions(id);
    expect(rows.map((row) => row.id)).toEqual([`${id}-run-2`, `${id}-run-1`]);
    expect(rows[0]!.label).toHaveLength(80);
    expect(rows[1]!.label).toBe("manual");
    await surface.store.close();
  });

  it("returns [] for a task with no runs and no finish record, and for unknown ids", async () => {
    const surface = await createSurface({ root: workspace() });
    const created = await surface.create({ title: "quiet" });
    if (!created.ok) throw created.error;
    expect(await surface.taskSessions(created.value.id)).toEqual([]);
    expect(await surface.taskSessions("tk-nope")).toEqual([]);
    expect(await surface.taskSessions("not an id!")).toEqual([]);
    await surface.store.close();
  });
});
