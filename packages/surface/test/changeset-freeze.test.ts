import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freezeChangesetUow, readChangesetBase, readChangesetSnapshot, type ChangesetFrozen } from "../src/index.js";
import { createSurface } from "../src/index.js";
import type { IssueUnitOfWork } from "@tasks/application";
import { bunRunner } from "@tasks/git";

const dirs: string[] = [];
function workspace(): string { const dir = mkdtempSync(join(tmpdir(), "tk-freeze-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

/** Real git repo with a `task/x` branch one commit ahead of main. */
function seededRepo(): string {
  const dir = workspace();
  const git = (args: readonly string[]) => execSync(`git ${args.join(" ")}`, { cwd: dir, stdio: "pipe" });
  git(["init", "-b", "main"]);
  git(["config", "user.email", "t@t"]); git(["config", "user.name", "t"]);
  // Keep the tk store db out of git: `git add .` / checkout must never touch it.
  writeFileSync(join(dir, ".gitignore"), "*\n");
  git(["add", "-f", ".gitignore"]);
  writeFileSync(join(dir, "base.txt"), "base\n");
  git(["add", "-f", "base.txt"]); git(["commit", "-m", "'base'"]);
  git(["checkout", "-b", "task/x"]);
  writeFileSync(join(dir, "work.txt"), "hello\n");
  git(["add", "-f", "work.txt"]); git(["commit", "-m", "'do work'"]);
  return dir;
}

/** Creates the issue and stamps the `tk work`-produced record (branch + pinned base). */
async function worked(surface: Awaited<ReturnType<typeof createSurface>>, id: string, metadata: Record<string, unknown> = {}): Promise<void> {
  // UpdatePatch drops metadata, so persist the `tk work` state via uow.save.
  const outer = await surface.store.transact(async (uow: IssueUnitOfWork) => {
    const page = await uow.list({ limit: 100_000 });
    if (!page.ok) throw new Error("list failed");
    const found = page.value.items.find((item) => item.id === id);
    if (found === undefined) throw new Error("missing issue");
    const next = { ...found, branch: "task/x", metadata: { ...found.metadata, ...metadata, changeset: { base: "main" } }, updatedAt: new Date() };
    const saved = await uow.save(next);
    if (!saved.ok) throw new Error("save failed");
  });
  if (!outer.ok) throw new Error("transact failed");
}

describe("freezeChangesetUow (CHG-02)", () => {
  it("refuses to freeze for any non-closed next status", async () => {
    const surface = await createSurface({ root: seededRepo() });
    const created = await surface.create({ title: "f" });
    if (!created.ok) throw created.error;
    await worked(surface, created.value.id);
    const result = await surface.store.transact(async (uow) => {
      const issue = (await uow.list({ limit: 100_000 })).value!.items[0]!;
      return freezeChangesetUow(uow, { cwd: surface.store.root }, issue, "in_progress");
    }) as unknown as { ok: boolean; value: ChangesetFrozen | null };
    expect(result.ok).toBe(true);
    expect(result.value).toBeNull();
    await surface.store.close();
  });

  it("freezes the full tuple from live git output exactly once; later closes never re-freeze", async () => {
    const root = seededRepo();
    const surface = await createSurface({ root });
    const created = await surface.create({ title: "f" });
    if (!created.ok) throw created.error;
    await worked(surface, created.value.id);
    const closed = await surface.status(created.value.id, { status: "closed" });
    if (!closed.ok) throw closed.error;
    const frozen = readChangesetSnapshot(closed.value.metadata);
    expect(frozen).not.toBeNull();
    expect(frozen!.base).toBe("main");
    expect(frozen!.head).toBe(execSync("git rev-parse task/x", { cwd: root, stdio: "pipe" }).toString().trim());
    expect(frozen!.commits.map((c) => c.subject)).toEqual(["do work"]);
    expect(frozen!.files.map((f) => f.path)).toEqual(["work.txt"]);
    expect(frozen!.counts).toEqual({ additions: 1, deletions: 0 });
    // Decay the world: branch gains a commit and is then deleted — the record must not move.
    execSync("git checkout task/x && echo more >> work.txt && git add . && git commit -m later && git checkout main && git branch -D task/x", { cwd: root, stdio: "pipe" });
    const reopened = await surface.status(created.value.id, { status: "open" });
    if (!reopened.ok) throw reopened.error;
    const reclosed = await surface.status(created.value.id, { status: "closed" });
    if (!reclosed.ok) throw reclosed.error;
    expect(readChangesetSnapshot(reclosed.value.metadata)).toEqual(frozen);
    await surface.store.close();
  });

  it("branch-less close freezes nothing (no changeset key merged)", async () => {
    const surface = await createSurface({ root: seededRepo() });
    const created = await surface.create({ title: "plain" });
    if (!created.ok) throw created.error;
    const closed = await surface.status(created.value.id, { status: "closed" });
    if (!closed.ok) throw closed.error;
    expect(closed.value.status).toBe("closed");
    expect(readChangesetSnapshot(closed.value.metadata)).toBeNull();
    expect(readChangesetBase(closed.value.metadata)).toBeNull();
    await surface.store.close();
  });

  it("worked-but-unfrozen metadata keeps only the base record on the finish path (FIN-01 never freezes)", async () => {
    const surface = await createSurface({ root: seededRepo() });
    const created = await surface.create({ title: "f" });
    if (!created.ok) throw created.error;
    await worked(surface, created.value.id);
    const finished = await surface.finish(created.value.id, "s1");
    if (!finished.ok) throw finished.error;
    expect(finished.value.status).toBe("ready-to-review");
    expect(readChangesetBase(finished.value.metadata)).toEqual({ base: "main", head: null });
    expect(readChangesetSnapshot(finished.value.metadata)).toBeNull();
    await surface.store.close();
  });
});
