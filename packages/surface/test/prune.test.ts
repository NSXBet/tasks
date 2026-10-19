/**
 * Step 11 (gw port) at the surface level: every close transition of an issue
 * with a recorded worktree prunes it, records the outcome in
 * `metadata.worktreePruned`, and never fails the close itself.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSurface, getOrThrow, type IssueUnitOfWork, type TasksSurface } from "../src/index.js";

const dirs: string[] = [];
const git = (cwd: string, args: string) => execSync(`git ${args}`, { cwd, stdio: "pipe" });

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A real git repo with a `.tasks` workspace whose branch is fully merged (or not). */
const seededRepo = (merged: boolean) => {
  const root = mkdtempSync(join(tmpdir(), "tk-prune-"));
  dirs.push(root);
  mkdirSync(join(root, ".tasks"));
  writeFileSync(join(root, ".tasks", "config.json"), `${JSON.stringify({ prefix: "tk", storage: { backend: "file" } })}\n`);
  git(root, "init -q -b main");
  git(root, "-c user.name=t -c user.email=t@t commit --allow-empty -m base");
  const worktree = join(root, ".worktrees", "tk-abc");
  git(root, `worktree add -b tk/abc "${worktree}"`);
  writeFileSync(join(worktree, "w.txt"), "done\n");
  git(worktree, "add -f w.txt");
  git(worktree, "-c user.name=t -c user.email=t@t commit -m work");
  if (merged) git(root, "merge --no-edit --ff tk/abc");
  return { root, worktree };
};

const exists = (path: string) => execSync(`test -e "${path}" && echo yes || echo no`, { encoding: "utf8" }).trim();

const recordWorktree = async (surface: TasksSurface, id: string, worktree: string) => {
  await surface.store.transact(async (uow: IssueUnitOfWork) => {
    const issue = await getOrThrow(uow, id);
    await uow.save({ ...issue, branch: "tk/abc", metadata: { ...issue.metadata, worktree, changeset: { base: "main" } } });
  });
};

describe("pruneIssueWorktree on close", () => {
  it("prunes a merged clean worktree and records the outcome when the issue closes", async () => {
    const { root, worktree } = seededRepo(true);
    const surface = await createSurface({ root });
    const created = await surface.create({ title: "needs pruning" });
    if (!created.ok) throw created.error;
    await recordWorktree(surface, created.value.id, worktree);
    const closed = await surface.status(created.value.id, { status: "closed" });
    if (!closed.ok) throw closed.error;
    const record = closed.value.metadata["worktreePruned"] as { pruned: boolean; removedWorktree: boolean; removedBranch: boolean };
    expect(record).toEqual({ pruned: true, removedWorktree: true, removedBranch: true });
    expect(exists(worktree)).toBe("no");
    expect(execSync(`git -C "${root}" rev-parse --verify refs/heads/tk/abc 2>/dev/null && echo yes || echo no`, { encoding: "utf8" }).trim()).toBe("no");
    await surface.store.close();
  });

  it("refuses an unmerged worktree, records the reason, and still closes", async () => {
    const { root, worktree } = seededRepo(false);
    const surface = await createSurface({ root });
    const created = await surface.create({ title: "dirty close" });
    if (!created.ok) throw created.error;
    await recordWorktree(surface, created.value.id, worktree);
    const closed = await surface.status(created.value.id, { status: "closed" });
    if (!closed.ok) throw closed.error;
    expect(closed.value.status).toBe("closed");
    const record = closed.value.metadata["worktreePruned"] as { pruned: boolean; reason?: string };
    expect(record.pruned).toBe(false);
    expect(record.reason).toContain("not fully merged");
    expect(exists(worktree)).toBe("yes");
    await surface.store.close();
  });

  it("does not touch issues without a recorded worktree", async () => {
    const seeded = seededRepo(true);
    const surface = await createSurface({ root: seeded.root });
    const created = await surface.create({ title: "plain" });
    if (!created.ok) throw created.error;
    const closed = await surface.status(created.value.id, { status: "closed" });
    if (!closed.ok) throw closed.error;
    expect(closed.value.metadata["worktreePruned"]).toBeUndefined();
    await surface.store.close();
  });

  it("leaves non-close transitions alone", async () => {
    const seeded = seededRepo(true);
    const surface = await createSurface({ root: seeded.root });
    const created = await surface.create({ title: "wip" });
    if (!created.ok) throw created.error;
    await recordWorktree(surface, created.value.id, seeded.worktree);
    const started = await surface.status(created.value.id, { status: "in_progress" });
    if (!started.ok) throw started.error;
    expect(started.value.metadata["worktreePruned"]).toBeUndefined();
    expect(exists(seeded.worktree)).toBe("yes");
    await surface.store.close();
  });
});
