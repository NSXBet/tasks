import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bunRunner, gitBranchHead, gitDiffNameStatus, gitDiffNumstat, gitLogOneline } from "../src/index.js";
import type { ProcessRunner } from "../src/index.js";

const dirs: string[] = [];
function repo(): string { const dir = mkdtempSync(join(tmpdir(), "tk-git-chg-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

function fakeRunner(responses: Readonly<Record<string, string>>): ProcessRunner & { commands: string[][] } {
  const commands: string[][] = [];
  return {
    commands,
    async run(command: readonly string[]) {
      commands.push([...command]);
      const key = command.join(" ");
      return { stdout: (responses[key] ?? "").trim(), stderr: "", code: key in responses ? 0 : 1 };
    },
  };
}

/** Real git repo: new.txt committed on main (rename source in the merge-base tree), then a binary + a rename on feature. */
function seededRepo(): string {
  const dir = repo();
  const git = (args: readonly string[]) => Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  git(["init", "-b", "main"]);
  git(["config", "user.email", "t@t"]); git(["config", "user.name", "t"]);
  writeFileSync(join(dir, "base.txt"), "base\n");
  git(["add", "."]); git(["commit", "-m", "base"]);
  writeFileSync(join(dir, "new.txt"), "one\ntwo\nthree\nfour\nfive\n");
  git(["add", "."]); git(["commit", "-m", "add new file"]);
  git(["checkout", "-b", "feature"]);
  writeFileSync(join(dir, "img.bin"), "a\x00b");
  git(["add", "."]); git(["commit", "-m", "add binary"]);
  git(["mv", "new.txt", "renamed.txt"]);
  writeFileSync(join(dir, "renamed.txt"), "one\ntwo\nthree\nfour\nfive\nsix\n");
  git(["add", "."]); git(["commit", "-m", "rename with edit"]);
  return dir;
}

describe("changeset adapter commands", () => {
  it("gitLogOneline issues the two-dot range (D-01 literal) and parses sha+subject", async () => {
    const runner = fakeRunner({ "git log --oneline v1..feature": "abc123 first\nzzz fix: a b c" });
    expect(await gitLogOneline("/repo", "v1", "feature", runner)).toEqual([
      { sha: "abc123", subject: "first" },
      { sha: "zzz", subject: "fix: a b c" },
    ]);
    expect(runner.commands[0]).toEqual(["git", "log", "--oneline", "v1..feature"]);
  });

  it("gitDiffNumstat / gitDiffNameStatus issue the three-dot form (D-02)", async () => {
    const runner = fakeRunner({
      "git diff --numstat v1...feature": "3\t0\tnew.txt\n-\t-\timg.bin",
      "git diff --name-status v1...feature": "M\tnew.txt\nR90\told.txt\tnew.txt",
    });
    expect(await gitDiffNumstat("/repo", "v1", "feature", runner)).toEqual([
      { additions: 3, deletions: 0, path: "new.txt" },
      { additions: 0, deletions: 0, path: "img.bin" },
    ]);
    expect(await gitDiffNameStatus("/repo", "v1", "feature", runner)).toEqual([
      { status: "M", path: "new.txt" },
      { status: "R90", path: "new.txt" },
    ]);
    expect(runner.commands[0]?.slice(0, 4)).toEqual(["git", "diff", "--numstat", "v1...feature"]);
    expect(runner.commands[1]?.slice(0, 4)).toEqual(["git", "diff", "--name-status", "v1...feature"]);
  });

  it("returns null on command failure (deleted-branch decay)", async () => {
    const runner: ProcessRunner = { async run() { return { stdout: "", stderr: "fatal: bad revision", code: 128 }; } };
    expect(await gitLogOneline("/repo", "base", "gone", runner)).toBeNull();
    expect(await gitDiffNumstat("/repo", "base", "gone", runner)).toBeNull();
    expect(await gitDiffNameStatus("/repo", "base", "gone", runner)).toBeNull();
  });

  it("derives commits and changed files from a live branch, rename + binary included", async () => {
    const dir = seededRepo();
    const log = await gitLogOneline(dir, "main", "feature");
    expect(log!.length).toBe(2);
    expect(log!.map((entry) => entry.sha.length >= 7)).toEqual([true, true]);
    expect(log![0]!.subject).toBe("rename with edit");
    const numstat = await gitDiffNumstat(dir, "main", "feature");
    expect(numstat!.reduce((sum, entry) => sum + entry.additions, 0)).toBe(1); // 1 rename edit; binary `-` parses as 0
    const nameStatus = await gitDiffNameStatus(dir, "main", "feature");
    expect(nameStatus!.some((entry) => entry.path === "renamed.txt" && entry.status.startsWith("R"))).toBe(true);
    expect(nameStatus!.some((entry) => entry.path === "img.bin" && entry.status === "A")).toBe(true);
    expect(bunRunner).toBeDefined();
  });

  it("stays stable when base is pinned and the branch gains no commits (empty arrays, not null)", async () => {
    const dir = seededRepo();
    const log = await gitLogOneline(dir, "HEAD", "feature");
    expect(Array.isArray(log)).toBe(true);
    expect(log!.length).toBe(0);
    const files = await gitDiffNameStatus(dir, "HEAD", "feature");
    expect(Array.isArray(files)).toBe(true);
    expect(files!.length).toBe(0);
  });
});

describe("gitBranchHead (CHG-02 freeze head)", () => {
  it("returns the branch tip sha for a live branch", () => {
    const dir = seededRepo();
    const head = Bun.spawnSync(["git", "rev-parse", "feature"], { cwd: dir, stdout: "pipe" }).stdout.toString().trim();
    expect(head).not.toBe("");
    return gitBranchHead(dir, "feature").then((value) => expect(value).toBe(head));
  });

  it("returns null when the branch does not exist (deleted-branch decay)", async () => {
    const dir = seededRepo();
    expect(await gitBranchHead(dir, "no-such-branch")).toBeNull();
  });
});
