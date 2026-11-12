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

const commit = (cwd: string, args: string) => execSync(`git -c user.name=t -c user.email=t@t ${args}`, { cwd, stdio: "pipe" }).toString().trim();

/** Repo where tk/abc's commit(s) landed on main via cherry-pick (rebase-merge)
 *  after main advanced, so the branch is never an ancestor of main. With
 *  `partial`, the branch carries a second commit that never reaches main. */
function cherryPicked(partial = false): Repo & { readonly pin: string } {
  const fixture = repo(false);
  const pin = commit(fixture.root, "rev-parse main");
  if (partial) {
    writeFileSync(join(fixture.worktree, "extra.txt"), "extra\n");
    commit(fixture.worktree, "add -f extra.txt");
    commit(fixture.worktree, "commit -m extra");
  }
  writeFileSync(join(fixture.root, "main.txt"), "main\n");
  commit(fixture.root, "add main.txt");
  commit(fixture.root, "commit -m main-advance");
  commit(fixture.root, `cherry-pick ${partial ? "tk/abc~1" : "tk/abc"}`);
  return { ...fixture, pin };
}

describe("gitIsMergedToBase", () => {
  it("is true for a fast-forward merge and false for an unmerged branch", async () => {
    const merged = repo(true);
    const unmerged = repo(false);
    expect(await gitIsMergedToBase(merged.root, "main", merged.branch)).toBe(true);
    expect(await gitIsMergedToBase(unmerged.root, "main", unmerged.branch)).toBe(false);
  });

  it("is true for a rebase/cherry-pick merge with no ancestry", async () => {
    const fixture = cherryPicked();
    const ancestry = (() => { try { execSync("git merge-base --is-ancestor tk/abc main", { cwd: fixture.root, stdio: "pipe" }); return true; } catch { return false; } })();
    expect(ancestry).toBe(false);
    expect(await gitIsMergedToBase(fixture.root, "main", fixture.branch)).toBe(true);
  });

  it("follows the default-branch tip when the base is a pinned SHA older than the merge", async () => {
    const fixture = repo(false);
    const pin = commit(fixture.root, "rev-parse main");
    expect(await gitIsMergedToBase(fixture.root, pin, fixture.branch)).toBe(false);
    commit(fixture.root, "merge --no-ff --no-edit tk/abc");
    expect(await gitIsMergedToBase(fixture.root, pin, fixture.branch)).toBe(true);
    const picked = cherryPicked();
    expect(await gitIsMergedToBase(picked.root, picked.pin, picked.branch)).toBe(true);
  });

  it("is false when only some of the branch's commits reached the base", async () => {
    const fixture = cherryPicked(true);
    expect(await gitIsMergedToBase(fixture.root, "main", fixture.branch)).toBe(false);
    expect(await gitIsMergedToBase(fixture.root, fixture.pin, fixture.branch)).toBe(false);
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
    expect(again).toMatchObject({ pruned: false, alreadyPruned: true, reason: "already pruned" });
    const dry = await pruneClosedWorktree(repo1.root, { path: repo1.worktree, branch: repo1.branch, base: "main", dryRun: true });
    expect(dry).toMatchObject({ pruned: false, prunable: false, alreadyPruned: true, reason: "already pruned" });
  });

  it("removes the worktree and branch of a rebase-merged branch that git branch -d refuses", async () => {
    const fixture = cherryPicked();
    const safeDelete = (() => { try { execSync("git branch -d tk/abc", { cwd: fixture.root, stdio: "pipe" }); return true; } catch { return false; } })();
    expect(safeDelete).toBe(false); // still checked out in the worktree, and not an ancestor of HEAD
    const outcome = await pruneClosedWorktree(fixture.root, { path: fixture.worktree, branch: fixture.branch, base: "main" });
    expect(outcome).toMatchObject({ pruned: true, removedWorktree: true, removedBranch: true });
    expect(await gitBranchExists(fixture.root, fixture.branch)).toBe(false);
    expect(existsSync2(fixture.worktree)).toBe(false);
  });

  it("refuses a partially merged branch and keeps it", async () => {
    const fixture = cherryPicked(true);
    const outcome = await pruneClosedWorktree(fixture.root, { path: fixture.worktree, branch: fixture.branch, base: fixture.pin });
    expect(outcome.pruned).toBe(false);
    expect(outcome.reason).toContain("not fully merged");
    expect(await gitBranchExists(fixture.root, fixture.branch)).toBe(true);
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
