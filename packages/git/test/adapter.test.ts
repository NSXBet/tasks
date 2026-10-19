import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bunRunner,
  gitCurrentBranch,
  gitDefaultBranch,
  gitMergeBase,
  gitToplevel,
  gitWorktreeAdd,
  gitWorktreeList,
  gitWorktreeRemove,
  mainWorktreeRoot,
  type ProcessRunner,
} from "../src/index.js";

const dirs: string[] = [];
function repo(): string { const dir = mkdtempSync(join(tmpdir(), "tk-git-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

/** In-memory runner for deterministic adapter tests. */
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

describe("git adapter commands", () => {
  it("enumerates every spawn inside the adapter and parses through it", async () => {
    const runner = fakeRunner({
      "git rev-parse --show-toplevel": "/repo",
      "git rev-parse --abbrev-ref HEAD": "main",
      "git worktree list --porcelain": "worktree /repo/.git\nHEAD abc\nbranch refs/heads/main\n\n",
    });
    expect(await gitToplevel("/repo", runner)).toBe("/repo");
    expect(await gitCurrentBranch("/repo", runner)).toBe("main");
    expect(await gitWorktreeList("/repo", runner)).toMatchObject([{ branch: "main" }]);
    expect(runner.commands.every((command) => command[0] === "git")).toBe(true);
  });

  it("gitDefaultBranch: keeps origin/HEAD when the remote is not behind the local default", async () => {
    // Diverged (is-ancestor fails) → remote stays the integration anchor.
    const diverged = fakeRunner({
      "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main",
      "git rev-parse --verify --quiet main": "sha1",
    });
    expect(await gitDefaultBranch("/repo", diverged)).toBe("origin/main");
    // No remote HEAD → plain local candidate.
    const localOnly = fakeRunner({ "git rev-parse --verify --quiet main": "sha1" });
    expect(await gitDefaultBranch("/repo", localOnly)).toBe("main");
  });

  it("surfaces non-zero exits as { code, stderr } verbatim instead of a success-shaped default", async () => {
    const runner: ProcessRunner = {
      async run() {
        return { stdout: "", stderr: "fatal: not a git repository", code: 128 };
      },
    };
    // Documented-nullable probes (rev-parse) return null on non-zero.
    expect(await gitToplevel("/nowhere", runner)).toBeNull();
    expect(await gitCurrentBranch("/nowhere", runner)).toBeNull();
    expect(await gitMergeBase("/nowhere", "a", "b", runner)).toBeNull();
    // Command functions carrying outcomes carry code+stderr verbatim — no command
    // function converts non-zero into a success-shaped default.
    const add = await gitWorktreeAdd("/nowhere", "/tmp/x", "nope", true, runner);
    expect(add).toEqual({ ok: false, stderr: "fatal: not a git repository" });
    const remove = await gitWorktreeRemove("/nowhere", "/tmp/x", true, runner);
    expect(remove).toEqual({ ok: false, stderr: "fatal: not a git repository" });
  });

  it("reports structured failure outcomes instead of throwing", async () => {
    const dir = repo();
    const outcome = await gitWorktreeAdd(dir, join(dir, "..", "missing"), "nope");
    expect(outcome.ok).toBe(false);
  });
});

describe("git integration", () => {
  it("anchors the default branch to the local line when origin/HEAD is stale (phase-02 UAT issue 2)", async () => {
    const origin = repo();
    const og = (...args: readonly string[]) => Bun.spawnSync(["git", ...args], { cwd: origin, stdout: "pipe", stderr: "pipe" });
    og("init", "-q", "--initial-branch=main");
    og("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--allow-empty", "-m", "init");
    const clone = repo();
    const cg = (...args: readonly string[]) => Bun.spawnSync(["git", ...args], { cwd: clone, stdout: "pipe", stderr: "pipe" });
    expect(cg("clone", "--quiet", origin, clone).exitCode).toBe(0);
    // In sync: origin/HEAD keeps precedence.
    expect(await gitDefaultBranch(clone)).toBe("origin/main");
    // Local commit left unpulled (the reweld scenario: origin/main behind local main).
    expect(cg("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--allow-empty", "-m", "local ahead").exitCode).toBe(0);
    expect(await gitDefaultBranch(clone)).toBe("main");
  });

  it("creates, lists, and removes a worktree end to end", async () => {
    const dir = repo();
    const git = (...args: readonly string[]) => Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    git("init", "-q");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--allow-empty", "-m", "init");
    const toplevel = await gitToplevel(dir);
    expect(toplevel).not.toBeNull();
    expect(await gitDefaultBranch(dir)).not.toBeNull();
    expect(await gitMergeBase(dir, "HEAD", "HEAD")).not.toBeNull();
    const target = join(dir, "..", "linked");
    expect((await gitWorktreeAdd(dir, target, "linked")).ok).toBe(true);
    const entries = await gitWorktreeList(dir);
    expect(entries.map((entry) => entry.branch)).toContain("linked");
    expect(mainWorktreeRoot(join(dir, ".git"))).toBe(dir);
    expect((await gitWorktreeRemove(dir, target, false)).ok).toBe(true);
  });

  it("bunRunner aborts cleanly on cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await bunRunner.run(["git", "rev-parse", "HEAD"], process.cwd(), controller.signal);
    expect(result.code).not.toBe(0);
  });
});
