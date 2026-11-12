import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  gitAddSync,
  gitConfigGetSync,
  gitConfigSetSync,
  gitConfigUnsetSync,
  gitDiffCachedNamesSync,
  gitIsTrackedSync,
  spawnSyncRunner,
} from "../src/index.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "tk-git-sync-"));
  dirs.push(dir);
  const run = (...args: string[]): void => {
    const result = spawnSyncRunner.runSync(["git", ...args], dir);
    if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  };
  run("init", "-q");
  run("config", "user.email", "t@example.com");
  run("config", "user.name", "t");
  run("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "tracked.txt"), "a\n");
  run("add", "tracked.txt");
  run("commit", "-q", "-m", "init");
  return dir;
}

describe("sync git commands", () => {
  it("config set/get/unset round-trips", () => {
    const cwd = repo();
    expect(gitConfigGetSync("tasks.role", { cwd }).ok).toBe(false);
    expect(gitConfigSetSync("tasks.role", "maintainer", { cwd }).ok).toBe(true);
    const got = gitConfigGetSync("tasks.role", { cwd });
    expect(got.ok).toBe(true);
    expect(got.stdout.trim()).toBe("maintainer");
    expect(gitConfigUnsetSync("tasks.role", { cwd }).ok).toBe(true);
    expect(gitConfigGetSync("tasks.role", { cwd }).ok).toBe(false);
  });

  it("gitIsTrackedSync distinguishes tracked from untracked files", () => {
    const cwd = repo();
    writeFileSync(join(cwd, "untracked.txt"), "b\n");
    expect(gitIsTrackedSync("tracked.txt", { cwd }).ok).toBe(true);
    expect(gitIsTrackedSync("untracked.txt", { cwd }).ok).toBe(false);
  });

  it("gitAddSync stages a file that gitDiffCachedNamesSync then lists", () => {
    const cwd = repo();
    writeFileSync(join(cwd, "new.txt"), "c\n");
    expect(gitAddSync("new.txt", { cwd }).ok).toBe(true);
    const staged = gitDiffCachedNamesSync(".", { cwd });
    expect(staged.ok).toBe(true);
    expect(staged.stdout.split("\n")).toContain("new.txt");
    expect(gitDiffCachedNamesSync(".", { cwd, diffFilter: "D" }).stdout.trim()).toBe("");
  });

  it("honors the env passed per call", () => {
    const cwd = repo();
    gitConfigSetSync("tasks.role", "maintainer", { cwd });
    const env = { ...process.env, GIT_DIR: join(cwd, "no-such-git-dir") };
    expect(gitConfigGetSync("tasks.role", { cwd }).ok).toBe(true);
    expect(gitConfigGetSync("tasks.role", { cwd, env }).ok).toBe(false);
  });
});
