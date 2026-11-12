import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Issue } from "@tasks/domain";
import { resolveReviewSource } from "../src/review/source.ts";

const git = (cwd: string, ...args: string[]): string => {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString().trim();
};

const issueWith = (branch: string, metadata: Record<string, unknown>): Issue => ({ id: "tk-frz", branch, metadata } as unknown as Issue);

describe("resolveReviewSource frozen snapshot (CHG-02, spec verify 8)", () => {
  test("closed + pruned task (no worktree, branch deleted) renders the frozen base...head diff", async () => {
    const root = mkdtempSync(join(tmpdir(), "tui-frz-"));
    git(root, "init", "-q", "-b", "main");
    writeFileSync(join(root, "a.txt"), "1\n");
    git(root, "add", "."); git(root, "commit", "-qm", "base");
    const base = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "-qb", "tk/tk-frz");
    writeFileSync(join(root, "a.txt"), "1\n2\n");
    git(root, "commit", "-qam", "change");
    const head = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "-q", "main"); git(root, "merge", "-q", "--no-ff", "tk/tk-frz", "-m", "merge"); git(root, "branch", "-d", "tk/tk-frz");
    const changeset = { base, head, commits: [{ sha: head.slice(0, 7), subject: "change" }], files: [{ path: "a.txt", status: "M" }], counts: { additions: 1, deletions: 0 } };
    const source = await resolveReviewSource(issueWith("tk/tk-frz", { changeset }), root);
    expect(source.error).toBeNull();
    expect(source.base).toBe(base);
    expect(source.files.length).toBe(1);
    expect(source.additions).toBe(1);
  });

  test("non-sha frozen refs are never passed to git; falls back to the not-checked-out error", async () => {
    const root = mkdtempSync(join(tmpdir(), "tui-frz-"));
    git(root, "init", "-q", "-b", "main");
    const changeset = { base: "--output=/tmp/x", head: "--output=/tmp/y", commits: [], files: [], counts: { additions: 0, deletions: 0 } };
    const source = await resolveReviewSource(issueWith("tk/gone", { changeset }), root);
    expect(source.files.length).toBe(0);
    expect(source.error).toContain("not checked out");
  });
});
