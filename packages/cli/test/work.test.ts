import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const executable = join(process.cwd(), "packages/cli/src/tk.ts");
const dirs: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-work-")); dirs.push(value); return value; }
function run(directory: string, args: readonly string[], input?: string): { readonly stdout: string; readonly stderr: string; readonly status: number } { const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdin: input === undefined ? undefined : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe" }); return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode }; }
function json<T>(directory: string, args: readonly string[], input?: string): T { const result = run(directory, [...args, "--json"], input); expect(result.status, result.stderr).toBe(0); return JSON.parse(result.stdout) as T; }
function git(directory: string, ...args: readonly string[]): void { const result = Bun.spawnSync(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" }); if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`); }
/** A tk workspace inside a git repo with one commit and one imported issue. */
function repoWorkspace(branch = "main"): { readonly repo: string; readonly id: string } {
  const repo = realpathSync(workspace()); // macOS /var → /private/var symlink
  git(repo, "init", "-q", "-b", branch);
  git(repo, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "init");
  json(repo, ["init", "--prefix", "tk"]);
  const issue = json<{ id: string }>(repo, ["create", "ship the thing"]);
  return { repo, id: issue.id };
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("tk work entry", () => {
  it("creates a worktree on tk/<id> at the resolver path and records branch, path, and base", () => {
    const { repo, id } = repoWorkspace();
    const result = json<{ id: string; path: string; branch: string; base: string; created: boolean }>(repo, ["work", id]);
    expect(result).toMatchObject({ id, branch: `tk/${id}`, created: true });
    expect(result.path).toBe(join(repo, ".worktrees", `${repo.split("/").pop()}-${id}`));
    expect(existsSync(result.path)).toBe(true);
    expect(result.base).toMatch(/^[0-9a-f]{40}$/);
    // Evidence rides the task record and both show surfaces.
    const shown = json<ReadonlyArray<Record<string, unknown>>>(repo, ["show", id])[0]!;
    expect(shown["branch"]).toBe(`tk/${id}`);
    expect(shown["worktree"]).toBe(result.path);
    expect((shown["changeset"] as Record<string, unknown>)["base"]).toBe(result.base);
    const human = run(repo, ["show", id]);
    expect(human.stdout).toContain("WORKTREE:");
    expect(human.stdout).toContain("BASE:");
  });

  it("re-enters the same worktree without recreating and never rewrites the pinned base", () => {
    const { repo, id } = repoWorkspace();
    const first = json<{ path: string; base: string; created: boolean }>(repo, ["work", id]);
    expect(first.created).toBe(true);
    // A commit on the integration branch moves merge-base; re-entry must keep the old pin.
    git(repo, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "second");
    const second = json<{ path: string; base: string; created: boolean }>(repo, ["work", id]);
    expect(second).toMatchObject({ path: first.path, base: first.base, created: false });
    const human = run(repo, ["work", id]);
    expect(human.stdout).toContain("existing");
  });

  it("honors the per-task worktree_dir metadata override", () => {
    const { repo, id } = repoWorkspace();
    const grove = mkdtempSync(join(tmpdir(), "tk-work-grove-"));
    dirs.push(grove);
    json<unknown>(repo, ["update", id, "--metadata", JSON.stringify({ worktree_dir: join(grove, "{name}") })]);
    const result = json<{ path: string }>(repo, ["work", id]);
    expect(result.path).toBe(join(grove, `${repo.split("/").pop()}-${id}`));
    expect(existsSync(result.path)).toBe(true);
  });
});

describe("tk work edge handling", () => {
  it("succeeds with an unpinned base when the repo has no default branch", () => {
    const { repo, id } = repoWorkspace("trunk");
    const result = json<{ base: string | null; created: boolean }>(repo, ["work", id]);
    expect(result.base).toBeNull();
    expect(result.created).toBe(true);
    const human = run(repo, ["work", id]);
    expect(human.stdout).toContain("unpinned");
  });

  it("reuses an existing tk/<id> branch that has no worktree yet", () => {
    const { repo, id } = repoWorkspace();
    git(repo, "branch", `tk/${id}`);
    const result = json<{ path: string; branch: string; base: string | null; created: boolean }>(repo, ["work", id]);
    expect(result.branch).toBe(`tk/${id}`);
    expect(result.base).not.toBeNull();
  });

  it("fails with git's message when the placement is unavailable", () => {
    const { repo, id } = repoWorkspace();
    // Pre-create a non-empty directory at the placement git would use; an
    // existing *empty* directory is accepted by git, a dirty one is not.
    const blocked = join(repo, ".worktrees", `${repo.split("/").pop()}-${id}`);
    mkdirSync(blocked, { recursive: true });
    writeFileSync(join(blocked, "occupied"), "");
    const result = run(repo, ["work", id, "--json"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("already exists");
  });
});
