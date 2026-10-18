import { describe, expect, it } from "vitest";
import { parseWorktreePorcelain } from "../src/index.js";

describe("git porcelain parsing", () => {
  it("parses entries, branches, and bare worktrees", () => {
    const text = [
      "worktree /repo/.git", "HEAD abc123", "branch refs/heads/main", "",
      "worktree /repo/feature", "HEAD def456", "branch refs/heads/feature", "",
      "worktree /tmp/bare", "HEAD 111222", "bare", "",
    ].join("\n");
    expect(parseWorktreePorcelain(text)).toEqual([
      { path: "/repo/.git", branch: "main", bare: false, locked: false },
      { path: "/repo/feature", branch: "feature", bare: false, locked: false },
      { path: "/tmp/bare", branch: null, bare: true, locked: false },
    ]);
  });

  it("parses detached entries as branchless", () => {
    const text = "worktree /w/detached\nHEAD 999000\ndetached\n\n";
    expect(parseWorktreePorcelain(text)[0]).toMatchObject({ path: "/w/detached", branch: null, bare: false, locked: false });
  });

  it("returns [] for empty and whitespace-only input — always an array, never undefined, never throws", () => {
    for (const text of ["", "   ", "\n\n"]) {
      const parsed = parseWorktreePorcelain(text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(0);
    }
  });

  it("keeps two adjacent identical entries as two distinct records (1:1, no dedupe, no merge)", () => {
    const text = ["worktree A", "branch refs/heads/main", "", "worktree A", "branch refs/heads/main", ""].join("\n");
    const parsed = parseWorktreePorcelain(text);
    expect(parsed.length).toBe(2);
    expect(parsed[0]).toEqual(parsed[1]);
    // Degenerate fixed-format case: identical paths, one bare, one not.
    const degenerate = ["worktree A", "", "worktree A", "bare", ""].join("\n");
    const degenerateParsed = parseWorktreePorcelain(degenerate);
    expect(degenerateParsed.length).toBe(2);
    expect(degenerateParsed[0].bare).toBe(false);
    expect(degenerateParsed[1].bare).toBe(true);
  });

  it("preserves input order verbatim — no sorting", () => {
    const text = [
      "worktree /z/last", "branch refs/heads/zzz", "",
      "worktree /a/first", "branch refs/heads/aaa", "",
      "worktree /m/middle", "branch refs/heads/mmm", "",
    ].join("\n");
    expect(parseWorktreePorcelain(text).map((entry) => entry.path)).toEqual(["/z/last", "/a/first", "/m/middle"]);
  });
});
