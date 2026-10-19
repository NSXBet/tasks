import { mkdtempSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { resolveWorktreePath } from "../src/index.js";

describe("worktree resolver", () => {
  it("defaults to the in-repo .worktrees pool", () => {
    expect(resolveWorktreePath({ repoRoot: "/code/app", name: "demo" })).toEqual({
      path: "/code/app/.worktrees/demo",
      source: "default",
    });
  });

  it("prefers per-task override over config over default", () => {
    // Override is used verbatim as the worktree path — no name appended.
    const input = { repoRoot: "/code/app", name: "demo", dir: "/srv/wt", override: "/tmp/task-dir" };
    expect(resolveWorktreePath(input)).toEqual({ path: "/tmp/task-dir", source: "override" });
    expect(resolveWorktreePath({ ...input, override: null })).toEqual({ path: "/srv/wt/demo", source: "config" });
    expect(resolveWorktreePath({ ...input, override: null, dir: null })).toEqual({ path: "/code/app/.worktrees/demo", source: "default" });
  });

  it("expands {name} and resolves relative config dirs against the repo root", () => {
    expect(resolveWorktreePath({ repoRoot: "/code/app", name: "demo", dir: "/srv/{name}" }).path).toBe("/srv/demo");
    expect(resolveWorktreePath({ repoRoot: "/code/app", name: "demo", dir: "../wt" }).path).toBe("/code/wt/demo");
  });

  it("resolves relative overrides against the repo root", () => {
    expect(resolveWorktreePath({ repoRoot: "/code/app", name: "demo", override: "../per-task" }).path).toBe("/code/per-task");
  });

  it("is pure: no FS mutation of repoRoot, configDir, or override", () => {
    const dir = mkdtempSync(`${tmpdir()}/tk-resolver-`);
    try {
      const before = readdirSync(dir);
      resolveWorktreePath({ repoRoot: dir, name: "demo", dir: dir, override: dir });
      resolveWorktreePath({ repoRoot: dir, name: "demo", dir: "../wt", override: "../task" });
      expect(readdirSync(dir)).toEqual(before);
      expect(existsSync(`${dir}/demo`)).toBe(false);
      expect(existsSync(`${dir}/task`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
