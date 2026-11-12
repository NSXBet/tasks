import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewPayloadFor } from "../src/review.js";

const git = (cwd: string, ...args: string[]): string => {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString().trim();
};

describe("reviewPayloadFor frozen snapshot", () => {
  test("closed+pruned task renders from the frozen head", () => {
    const root = mkdtempSync(join(tmpdir(), "rv-"));
    git(root, "init", "-q", "-b", "main");
    writeFileSync(join(root, "a.txt"), "1\n");
    git(root, "add", "."); git(root, "commit", "-qm", "base");
    const base = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "-qb", "tk/x");
    writeFileSync(join(root, "a.txt"), "1\n2\n");
    git(root, "commit", "-qam", "change");
    const head = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "-q", "main"); git(root, "merge", "-q", "--no-ff", "tk/x", "-m", "merge"); git(root, "branch", "-d", "tk/x");
    const metadata = { changeset: { base, head, commits: [{ sha: head.slice(0, 7), subject: "change" }], files: [{ path: "a.txt", status: "M" }], counts: { additions: 1, deletions: 0 } } };
    return reviewPayloadFor(root, { id: "x", branch: "tk/x", metadata }).then((p) => {
      expect(p.patchError).toBeNull();
      expect(p.head).toBe(head);
      expect(p.counts.additions).toBe(1);
      expect(p.patch).toContain("+2");
    });
  });
});

describe("reviewPayloadFor frozen guards", () => {
  test("non-sha frozen refs are never passed to git", async () => {
    const root = mkdtempSync(join(tmpdir(), "rv-"));
    git(root, "init", "-q", "-b", "main");
    const metadata = { changeset: { base: "--output=/tmp/x", head: "--output=/tmp/y", commits: [], files: [], counts: { additions: 0, deletions: 0 } } };
    const p = await reviewPayloadFor(root, { id: "x", branch: "tk/gone", metadata });
    expect(p.patch).toBeNull();
    expect(p.patchError).not.toBeNull();
  });
});
