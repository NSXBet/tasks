import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorktreePath } from "../src/index.js";

const dirs: string[] = [];
function repo(): string { const dir = mkdtempSync(join(tmpdir(), "tk-git-conc-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

describe("concurrent resolveWorktreePath with same name and options", () => {
  it("always returns the identical path — collision resolves deterministically to one winner", async () => {
    const dir = repo();
    const [first, second, third] = await Promise.all([
      resolveWorktreePath({ repoRoot: dir, name: "raced" }),
      resolveWorktreePath({ repoRoot: dir, name: "raced" }),
      resolveWorktreePath({ repoRoot: dir, name: "raced" }),
    ]);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(first.path).toBe(join(dir, ".worktrees", "raced"));
    expect(first.source).toBe("default");
  });
});
