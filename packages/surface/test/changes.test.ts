import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Issue } from "@tasks/domain";
import { bunRunner, type ProcessRunner } from "@tasks/git";
import { createSurface, reportStampFor, resolveChanges } from "../src/index.js";

const dirs: string[] = [];
function workspace(): string { const dir = mkdtempSync(join(tmpdir(), "tk-changes-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

const WEB = "http://h:1";
const STAMP_AT = "2026-11-10T00:00:00.000Z";

/** Real git repo with a `task/x` branch one commit (+1 line, 1 file) ahead of main; HEAD back on main. */
function seededRepo(): { root: string; git: (args: string) => string } {
  const root = workspace();
  const git = (args: string): string => execSync(`git ${args}`, { cwd: root, stdio: "pipe" }).toString();
  git("init -b main");
  git("config user.email t@t"); git("config user.name t");
  writeFileSync(join(root, ".gitignore"), "*\n");
  git("add -f .gitignore");
  writeFileSync(join(root, "base.txt"), "base\n");
  git("add -f base.txt"); git("commit -m base");
  git("checkout -b task/x");
  writeFileSync(join(root, "work.txt"), "hello\n");
  git("add -f work.txt"); git("commit -m work");
  git("checkout main");
  return { root, git };
}

/** A real issue shape from the store, then variants built in memory (resolveChanges is a pure read over the issue). */
async function baseIssue(root: string): Promise<Issue> {
  const surface = await createSurface({ root });
  const created = await surface.create({ title: "changes probe" });
  if (!created.ok) throw created.error;
  await surface.store.close();
  return created.value;
}

const throwingRunner: ProcessRunner = { run: () => { throw new Error("no git expected on the closed-snapshot rung"); } } as unknown as ProcessRunner;
const frozen = { base: "main", head: "f".repeat(40), commits: [{ sha: "s1", subject: "a" }, { sha: "s2", subject: "b" }], files: [{ path: "x", status: "A" }], counts: { additions: 5, deletions: 2 } };

describe("resolveChanges — the fallback ladder (PR-03)", () => {
  it("closed + frozen snapshot → snapshot, not stale, zero git calls", async () => {
    const { root } = seededRepo();
    const closedAt = new Date("2026-11-11T00:00:00.000Z");
    const issue: Issue = { ...(await baseIssue(root)), status: "closed", closedAt, branch: "task/x", metadata: { changeset: frozen } };
    const view = await resolveChanges({ cwd: root }, issue, WEB, throwingRunner);
    expect(view).toMatchObject({ source: "snapshot", stale: false, at: closedAt.toISOString(), stat: { commits: 2, files: 1, additions: 5, deletions: 2 } });
    expect(view!.links.web).toBe(`${WEB}/tasks/${issue.id}/diff`);
  });

  it("worked task with a live branch → live", async () => {
    const { root } = seededRepo();
    const issue: Issue = { ...(await baseIssue(root)), status: "in-progress", branch: "task/x", metadata: { changeset: { base: "main" } } };
    const view = await resolveChanges({ cwd: root }, issue, WEB, bunRunner);
    expect(view).toMatchObject({ source: "live", stale: false, at: null, stat: { commits: 1, files: 1, additions: 1, deletions: 0 } });
    const stamp = await reportStampFor({ cwd: root }, issue, bunRunner, new Date(STAMP_AT));
    expect(stamp).toMatchObject({ changes: { commits: 1, files: 1, additions: 1, deletions: 0 }, at: STAMP_AT });
    expect(stamp!.head).toMatch(/^[0-9a-f]{40}$/);
  });

  it("branch deleted + report stamp → report, stale, at from the stamp", async () => {
    const { root, git } = seededRepo();
    git("branch -D task/x");
    const report = { changes: { commits: 1, files: 1, additions: 1, deletions: 0 }, head: "a".repeat(40), at: STAMP_AT };
    const issue: Issue = { ...(await baseIssue(root)), status: "ready-to-review", branch: "task/x", metadata: { changeset: { base: "main" }, report } };
    expect(await reportStampFor({ cwd: root }, issue)).toBeNull();
    const view = await resolveChanges({ cwd: root }, issue, WEB);
    expect(view).toMatchObject({ source: "report", stale: true, at: STAMP_AT, stat: report.changes });
  });

  it("branch deleted, no report, frozen snapshot on a reopened task → snapshot, stale", async () => {
    const { root, git } = seededRepo();
    git("branch -D task/x");
    const issue: Issue = { ...(await baseIssue(root)), status: "open", closedAt: null, branch: "task/x", metadata: { changeset: frozen } };
    const view = await resolveChanges({ cwd: root }, issue, WEB);
    expect(view).toMatchObject({ source: "snapshot", stale: true, stat: { commits: 2, files: 1, additions: 5, deletions: 2 } });
  });

  it("nothing recorded → null", async () => {
    const { root } = seededRepo();
    const issue = await baseIssue(root);
    expect(await resolveChanges({ cwd: root }, issue, WEB)).toBeNull();
  });
});
