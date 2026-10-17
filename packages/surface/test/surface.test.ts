import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attachEvidenceUow, createSurface } from "../src/index.js";

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

  it("attaches file paths with metadata, dedupes, and detaches", async () => {
    const root = workspace();
    const surface = await createSurface({ root });
    const created = await surface.create({ title: "with files", attachments: [{ path: "foo.yaml", metadata: { kind: "spec" } }] });
    if (!created.ok) throw created.error;
    expect(created.value.attachments).toEqual([{ path: "foo.yaml", metadata: { kind: "spec" }, wireUnknown: {} }]);
    const again = await surface.attach(created.value.id, "foo.yaml");
    expect(again.ok && again.value.attachments).toHaveLength(1);
    const second = await surface.attach(created.value.id, "notes/plan.md");
    expect(second.ok && second.value.attachments).toHaveLength(2);
    const removed = await surface.detach(created.value.id, "foo.yaml");
    expect(removed.ok && removed.value.attachments.map((attachment) => attachment.path)).toEqual(["notes/plan.md"]);
    const shown = await surface.show(created.value.id);
    expect(shown.ok && shown.value.attachments.map((attachment) => attachment.path)).toEqual(["notes/plan.md"]);
    await surface.store.close();
  });

  it("detaches a blob attachment while comments keep the evidence reference", async () => {
    const root = workspace();
    const surface = await createSurface({ root });
    const created = await surface.create({ title: "with evidence" });
    if (!created.ok) throw created.error;
    const png = join(root, "shot.png");
    await Bun.write(png, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const attached = await surface.store.transact(async (uow) =>
      attachEvidenceUow(uow, { root: surface.store.root, tasksDir: surface.store.tasksDir }, created.value.id, [png]));
    if (!attached.ok) throw attached.error;
    const att = attached.value.attachments[0]!;
    expect(att).toHaveProperty("id");
    expect(att).toHaveProperty("mime", "image/png");

    await surface.comment(created.value.id, `see evidence:${att.id}`);

    const detached = await surface.detachBlob(created.value.id, att.id);
    expect(detached.ok).toBe(true);
    if (!detached.ok) return;
    expect(detached.value.attachments).toHaveLength(0);

    const shown = await surface.show(created.value.id);
    expect(shown.ok && shown.value !== null && shown.value.attachments).toHaveLength(0);
    const comments = await surface.comments(created.value.id);
    expect(comments.ok && comments.value !== null && comments.value.comments.map((comment) => comment.text))
      .toEqual([`see evidence:${att.id}`]);

    const read = await surface.evidenceRead(created.value.id, att.id);
    expect(read.ok && read.value === null).toBe(true);
    await surface.store.close();
  });
});
