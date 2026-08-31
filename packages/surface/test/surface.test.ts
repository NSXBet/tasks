import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSurface } from "../src/index.js";

const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-surface-")); workspaces.push(value); return value; }
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

describe("tasks surface", () => {
  it("creates, lists, shows and closes issues through the typed surface", async () => {
    const root = workspace();
    const surface = await createSurface({ root });
    const created = await surface.create({ title: "first issue", labels: ["demo"] });
    if (!created.ok) throw created.error;
    expect(created.value.id).toContain("tk-");
    const list = await surface.list();
    expect(list.ok && list.value).toHaveLength(1);
    const shown = await surface.show(created.value.id);
    expect(shown.ok && shown.value !== null && shown.value.title).toBe("first issue");
    const closed = await surface.status(created.value.id, { status: "closed" });
    expect(closed.ok && closed.value.status).toBe("closed");
    await surface.store.close();
  });

  it("classifies missing issues as not_found through the envelope", async () => {
    const root = workspace();
    const surface = await createSurface({ root });
    const shown = await surface.show("tk-doesnotexist");
    expect(shown.ok).toBe(false);
    if (!shown.ok) expect(shown.error.kind).toBe("not_found");
    await surface.store.close();
  });

  it("supports deps, comments and ready workflow", async () => {
    const root = workspace();
    const surface = await createSurface({ root });
    const blocker = await surface.create({ title: "blocker" });
    const blocked = await surface.create({ title: "blocked" });
    if (!blocker.ok || !blocked.ok) throw new Error("create failed");
    await surface.depAdd(blocked.value.id, blocker.value.id);
    const deps = await surface.depList(blocked.value.id);
    expect(deps.ok && deps.value).toHaveLength(1);
    const readyBefore = await surface.ready();
    expect(readyBefore.ok && readyBefore.value.map((issue) => issue.id)).toEqual([blocker.value.id]);
    await surface.comment(blocked.value.id, "waiting on blocker");
    const comments = await surface.comments(blocked.value.id);
    expect(comments.ok && comments.value !== null && comments.value.commentCount).toBe(1);
    await surface.store.close();
  });
});
