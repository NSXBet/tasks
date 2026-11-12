/** WORKSPC `commit` (11-05, D-04): guarded, tracked + staged only, never pushed, restamps metadata.report. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { IssueUnitOfWork } from "@tasks/application";
import { bunRunner, type ProcessRunner } from "@tasks/git";
import { commitWorktree, createSurface, storeTransact, type ReportStamp } from "../src/index.js";

const dirs: string[] = [];
function temp(prefix: string): string { const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix))); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();

/** Main repo on `main` with one commit; a linked worktree on `tk/x` one commit ahead. */
function fixture(): { root: string; worktree: string; base: string } {
  const root = temp("tk-commit-");
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  git(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, ".gitignore"), ".tasks/\n");
  writeFileSync(join(root, "base.txt"), "base\n");
  git(root, "add", ".gitignore", "base.txt");
  git(root, "commit", "-m", "base");
  const base = git(root, "rev-parse", "HEAD");
  const worktree = join(temp("tk-commit-wt-"), "wt");
  git(root, "worktree", "add", "-b", "tk/x", worktree);
  writeFileSync(join(worktree, "work.txt"), "hello\n");
  git(worktree, "add", "work.txt");
  git(worktree, "commit", "-m", "do work");
  return { root, worktree, base };
}

function recordingRunner(): ProcessRunner & { argv: string[][] } {
  const argv: string[][] = [];
  return { argv, run(command, cwd, signal, options) { argv.push([...command]); return bunRunner.run(command, cwd, signal, options); } };
}

async function setup(metadata: (fx: ReturnType<typeof fixture>) => Record<string, unknown> = (fx) => ({ worktree: fx.worktree })) {
  const fx = fixture();
  const surface = await createSurface({ root: fx.root });
  const created = await surface.create({ title: "commit me" });
  if (!created.ok) throw created.error;
  const id = created.value.id;
  const outer = await surface.store.transact(async (uow: IssueUnitOfWork) => {
    const found = await uow.findById(id as never);
    if (!found.ok || found.value === null) throw new Error("missing issue");
    const saved = await uow.save({ ...found.value, branch: "tk/x", metadata: { ...found.value.metadata, ...metadata(fx), changeset: { base: fx.base } }, updatedAt: new Date() });
    if (!saved.ok) throw new Error("save failed");
  });
  if (!outer.ok) throw new Error("seed failed");
  const runner = recordingRunner();
  const deps = { cwd: fx.root, transact: storeTransact(surface.store), runner };
  const read = async () => {
    const shown = await surface.show(id);
    if (!shown.ok) throw shown.error;
    return shown.value;
  };
  return { ...fx, surface, id, runner, deps, read };
}

const commitArgv = (argv: readonly string[][]) => argv.filter((command) => command[1] === "commit");

describe("commitWorktree (11-05)", () => {
  it("commits tracked + staged changes only; restamps metadata.report; never pushes/amends/skips hooks", async () => {
    const t = await setup();
    writeFileSync(join(t.worktree, "work.txt"), "hello\nmore\n");
    writeFileSync(join(t.worktree, "staged.txt"), "staged\n");
    git(t.worktree, "add", "staged.txt");
    writeFileSync(join(t.worktree, "loose.txt"), "untracked\n");
    const result = await commitWorktree(t.deps, t.id, "wip: tracked");
    expect(result.id).toBe(t.id);
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.sha).toBe(git(t.worktree, "rev-parse", "HEAD"));
    expect(git(t.worktree, "log", "-1", "--format=%s")).toBe("wip: tracked");
    const names = git(t.worktree, "show", "--name-only", "--format=", "HEAD").split("\n");
    expect(names.sort()).toEqual(["staged.txt", "work.txt"]);
    expect(git(t.worktree, "status", "--porcelain")).toBe("?? loose.txt");
    const after = await t.read();
    const report = after.metadata["report"] as ReportStamp;
    expect(report.head).toBe(result.sha);
    expect(report.changes.commits).toBe(2);
    expect(result.report?.head).toBe(result.sha);
    const flat = t.runner.argv.flat();
    for (const banned of ["push", "--amend", "--no-verify", "-n", "--allow-empty"]) expect(flat).not.toContain(banned);
    expect(commitArgv(t.runner.argv)).toEqual([["git", "commit", "--all", "--message=wip: tracked"]]);
    await t.surface.store.close();
  });

  it("an empty / whitespace / control-only message refuses before any git commit", async () => {
    const t = await setup();
    writeFileSync(join(t.worktree, "work.txt"), "changed\n");
    for (const message of ["", "   \n\t ", "\u0001\u0002"]) await expect(commitWorktree(t.deps, t.id, message)).rejects.toThrow("commit message is empty");
    expect(commitArgv(t.runner.argv)).toEqual([]);
    await t.surface.store.close();
  });

  it("a missing worktree directory refuses with the tk work hint", async () => {
    const t = await setup();
    rmSync(t.worktree, { recursive: true, force: true });
    await expect(commitWorktree(t.deps, t.id, "m")).rejects.toThrow(`no worktree for ${t.id} — run tk work ${t.id}`);
    expect(commitArgv(t.runner.argv)).toEqual([]);
    await t.surface.store.close();
  });

  it("a task with no recorded worktree refuses", async () => {
    const t = await setup(() => ({}));
    await expect(commitWorktree(t.deps, t.id, "m")).rejects.toThrow(`no worktree for ${t.id}`);
    await t.surface.store.close();
  });

  it("a worktree switched to another branch refuses", async () => {
    const t = await setup();
    git(t.worktree, "checkout", "-b", "other");
    writeFileSync(join(t.worktree, "work.txt"), "changed\n");
    await expect(commitWorktree(t.deps, t.id, "m")).rejects.toThrow("worktree is on other, not tk/x — refusing to commit");
    expect(commitArgv(t.runner.argv)).toEqual([]);
    await t.surface.store.close();
  });

  it("only untracked changes → nothing to commit, record unchanged", async () => {
    const t = await setup();
    writeFileSync(join(t.worktree, "loose.txt"), "untracked\n");
    const before = await t.read();
    const head = git(t.worktree, "rev-parse", "HEAD");
    await expect(commitWorktree(t.deps, t.id, "m")).rejects.toThrow(`nothing to commit in ${t.id}'s worktree — untracked files are never added; git add them first`);
    expect(git(t.worktree, "rev-parse", "HEAD")).toBe(head);
    const after = await t.read();
    expect(after.metadata["report"]).toEqual(before.metadata["report"]);
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    await t.surface.store.close();
  });

  it("a record pointing at the main checkout refuses; no commit", async () => {
    const t = await setup((fx) => ({ worktree: fx.root }));
    git(t.root, "checkout", "-b", "tk/y");
    writeFileSync(join(t.root, "base.txt"), "changed\n");
    await expect(commitWorktree(t.deps, t.id, "m")).rejects.toThrow(`${t.id}'s worktree is the main checkout — refusing to commit`);
    expect(commitArgv(t.runner.argv)).toEqual([]);
    expect(git(t.root, "status", "--porcelain")).toBe("M base.txt");
    await t.surface.store.close();
  });

  it("storeTransact rethrows the original MessageError text", async () => {
    const t = await setup();
    await expect(t.deps.transact(async () => { throw new Error("boom: original"); })).rejects.toThrow("boom: original");
    await t.surface.store.close();
  });
});
