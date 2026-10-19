import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitBranchExists, gitIsMergedToBase, gitWorktreeList, pruneClosedWorktree } from "../src/index.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

interface Repo { readonly root: string; readonly worktree: string; readonly branch: string; }
/** Repo with main + a worktree on tk/abc holding one unmerged-by-default commit. */
function repo(merged: boolean): Repo {
  const root = mkdtempSync(join(tmpdir(), "tk-prune-"));
  dirs.push(root);
  const git = (args: readonly string[]) => execSync(`git ${args.join(" ")}`, { cwd: root, stdio: "pipe" });
  git(["init", "-q", "-b", "main"]);
  git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "base"]);
  git(["worktree", "add", "-b", "tk/abc", ".worktrees/abc"]);
  const worktree = join(root, ".worktrees", "abc");
  writeFileSync(join(worktree, "w.txt"), merged ? "done\n" : "wip\n");
  execSync(`git add -f w.txt && git -c user.name=t -c user.email=t@t commit -m work`, { cwd: worktree, stdio: "pipe" });
  if (merged) git(["merge", "--no-edit", "--ff", "tk/abc"]);
  return { root, worktree, branch: "tk/abc" };
}

describe("gitIsMergedToBase", () => {
  it("is true only when the branch is an ancestor of the base", async () => {
    const merged = repo(true);
    const unmerged = repo(false);
    expect(await gitIsMergedToBase(merged.root, "main", merged.branch)).toBe(true);
    expect(await gitIsMergedToBase(unmerged.root, "main", unmerged.branch)).toBe(false);
  });
});

describe("pruneClosedWorktree", () => {
  it("removes a merged, clean worktree and its branch", async () => {
    const repo1 = repo(true);
    const outcome = await pruneClosedWorktree(repo1.root, { path: repo1.worktree, branch: repo1.branch, base: "main" });
    expect(outcome).toMatchObject({ pruned: true, removedWorktree: true, removedBranch: true });
    expect(await gitBranchExists(repo1.root, repo1.branch)).toBe(false);
    expect(await gitWorktreeList(repo1.root)).toHaveLength(1); // main only
  });

  it("refuses an unmerged branch and removes nothing", async () => {
    const repo1 = repo(false);
    const outcome = await pruneClosedWorktree(repo1.root, { path: repo1.worktree, branch: repo1.branch, base: "main" });
    expect(outcome.pruned).toBe(false);
    expect(outcome.reason).toContain("not fully merged");
    expect(await gitBranchExists(repo1.root, repo1.branch)).toBe(true);
  });

  it("refuses a dirty worktree", async () => {
    const repo1 = repo(true);
    writeFileSync(join(repo1.worktree, "dirty.txt"), "x\n");
    const outcome = await pruneClosedWorktree(repo1.root, { path: repo1.worktree, branch: repo1.branch, base: "main" });
    expect(outcome.pruned).toBe(false);
    expect(outcome.reason).toContain("uncommitted");
  });

  it("refuses without a pinned base", async () => {
    const repo1 = repo(true);
    const outcome = await pruneClosedWorktree(repo1.root, { path: repo1.worktree, branch: repo1.branch, base: null });
    expect(outcome.pruned).toBe(false);
    expect(outcome.reason).toContain("no pinned base");
  });

  it("dry-run reports eligibility without removing anything", async () => {
    const repo1 = repo(true);
    const outcome = await pruneClosedWorktree(repo1.root, { path: repo1.worktree, branch: repo1.branch, base: "main", dryRun: true });
    expect(outcome).toMatchObject({ prunable: true, pruned: false, removedWorktree: false, removedBranch: false });
    expect(await gitBranchExists(repo1.root, repo1.branch)).toBe(true);
    expect(existsSync2(repo1.worktree)).toBe(true);
  });

  it("is idempotent when the worktree and branch are already gone", async () => {
    const repo1 = repo(true);
    await pruneClosedWorktree(repo1.root, { path: repo1.worktree, branch: repo1.branch, base: "main" });
    const again = await pruneClosedWorktree(repo1.root, { path: repo1.worktree, branch: repo1.branch, base: "main" });
    expect(again.pruned).toBe(false);
    expect(again.reason).toBeUndefined();
  });

  it("runs the pre_end hook from the worktree before removal and vetoes on failure", async () => {
    const repo1 = repo(true);
    const sentinel = join(repo1.root, ".hook-ran");
    const ok = await pruneClosedWorktree(repo1.root, { path: repo1.worktree, branch: repo1.branch, base: "main", preEnd: `touch "${sentinel}"` });
    expect(ok.pruned).toBe(true);
    expect(existsSync2(sentinel)).toBe(true);
    const repo2 = repo(true);
    const vetoed = await pruneClosedWorktree(repo2.root, { path: repo2.worktree, branch: repo2.branch, base: "main", preEnd: "exit 3" });
    expect(vetoed.pruned).toBe(false);
    expect(vetoed.reason).toContain("pre_end hook failed");
  });
});

function existsSync2(path: string): boolean { try { execSync(`test -e "${path}"`); return true; } catch { return false; } }
