import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const dirs: string[] = [];
function scratch(): string { const value = mkdtempSync(join(tmpdir(), "tk-changes-")); dirs.push(value); return value; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

/** Blank the session/harness env so a suite running inside omp/codex/cursor does not leak into assertions. */
const HERMETIC_ENV = { TK_SESSION: "", TK_HARNESS: "", PI_SESSION_ID: "", CODEX_THREAD_ID: "", CURSOR_AGENT: "", CURSOR_CONVERSATION_ID: "" } as const;
function run(directory: string, args: readonly string[], env: Readonly<Record<string, string>> = {}): { readonly stdout: string; readonly stderr: string; readonly status: number } {
  const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...HERMETIC_ENV, ...env } });
  return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode };
}
function json<T>(directory: string, args: readonly string[], env: Readonly<Record<string, string>> = {}): T {
  const result = run(directory, [...args, "--json"], env);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as T;
}
function git(directory: string, ...args: readonly string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
}
const commit = (directory: string, message: string, ...paths: readonly string[]) => {
  git(directory, "add", ...paths);
  git(directory, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", message);
};

/** tk workspace inside a git repo with one commit and one issue, entered via `tk work`. */
function workedWorkspace(): { repo: string; worktree: string; id: string; branch: string } {
  const repo = realpathSync(scratch());
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "base.txt"), "base\n");
  git(repo, "add", ".");
  git(repo, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "init");
  json(repo, ["init", "--prefix", "tk"]);
  const issue = json<{ id: string }>(repo, ["create", "finish probe"]);
  const worked = json<{ id: string; path: string; branch: string; base: string }>(repo, ["work", issue.id]);
  writeFileSync(join(worked.path, "a.txt"), "a\n");
  commit(worked.path, "the work", "a.txt");
  return { repo, worktree: worked.path, id: issue.id, branch: worked.branch };
}

type ChangesJson = { id: string; changes: null | { source: string; stale: boolean; at: string | null; stat: Record<string, number>; links: Record<string, string> } };
const noDiff = (text: string) => { expect(text).not.toContain("diff --git"); expect(text).not.toContain("@@"); };

describe("tk changes (PR-02/PR-03)", () => {
  it("live after finish: stat card and source live", () => {
    const { repo, id } = workedWorkspace();
    json(repo, ["finish", id, "--session", "s1"]);
    const human = run(repo, ["changes", id], { NO_COLOR: "1" });
    expect(human.status, human.stderr).toBe(0);
    expect(human.stdout).toContain(`Changes · ${id}  1 commit · +1 −0 · 1 file`);
    noDiff(human.stdout);
    expect(json<ChangesJson>(repo, ["changes", id]).changes?.source).toBe("live");
  });

  it("branch and worktree gone: falls back to the finish report, stale, in changes and show", () => {
    const { repo, worktree, id, branch } = workedWorkspace();
    json(repo, ["finish", id, "--session", "s1"]);
    git(repo, "worktree", "remove", "--force", worktree);
    git(repo, "branch", "-D", branch);
    const wire = json<ChangesJson>(repo, ["changes", id]);
    expect(wire.changes).toMatchObject({ source: "report", stale: true, stat: { commits: 1, files: 1, additions: 1, deletions: 0 } });
    const human = run(repo, ["changes", id], { NO_COLOR: "1" });
    expect(human.stdout).toContain("stale — from finish report");
    noDiff(human.stdout);
    const show = json<readonly Record<string, unknown>[]>(repo, ["show", id])[0]!;
    expect(show["changeset"]).toEqual({ source: "report", stale: true, counts: { additions: 1, deletions: 0 }, commits: 1, files: 1 });
    const humanShow = run(repo, ["show", id], { NO_COLOR: "1" });
    expect(humanShow.stdout).toContain(`Changes · ${id}  1 commit · +1 −0 · 1 file`);
    expect(humanShow.stdout).toContain("stale — from finish report");
    noDiff(humanShow.stdout);
  });

  it("closed: the frozen snapshot, not stale", () => {
    const { repo, id } = workedWorkspace();
    json(repo, ["finish", id, "--session", "s1"]);
    json(repo, ["close", id]);
    const wire = json<ChangesJson>(repo, ["changes", id]);
    expect(wire.changes).toMatchObject({ source: "snapshot", stale: false, stat: { commits: 1, files: 1, additions: 1, deletions: 0 } });
    noDiff(run(repo, ["changes", id], { NO_COLOR: "1" }).stdout);
  });

  it("never worked: no changes recorded, exit 0, changes null", () => {
    const repo = realpathSync(scratch());
    git(repo, "init", "-q", "-b", "main");
    json(repo, ["init", "--prefix", "tk"]);
    const issue = json<{ id: string }>(repo, ["create", "never worked"]);
    const human = run(repo, ["changes", issue.id], { NO_COLOR: "1" });
    expect(human.status, human.stderr).toBe(0);
    expect(human.stdout).toContain("no changes recorded");
    expect(json<ChangesJson>(repo, ["changes", issue.id]).changes).toBeNull();
  });
});
