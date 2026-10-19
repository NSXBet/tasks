import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
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

/** Adds a `worktree` block to the workspace config (gw lifecycle hooks). */
function withHooks(repo: string, hooks: Record<string, unknown>): void {
  const configPath = join(repo, ".tasks", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  writeFileSync(configPath, JSON.stringify({ ...config, worktree: hooks }, null, 2));
}

/** Merges the task branch into main so pruning is safe. */
function mergeTaskBranch(repo: string, id: string): void {
  git(repo, "merge", "--no-edit", "-q", `tk/${id}`);
}

describe("worktree lifecycle (gw port)", () => {
  it("fires post_start and post_checkout hooks inside the fresh worktree on tk work", () => {
    const { repo, id } = repoWorkspace();
    const sentinel = join(repo, ".hook-ran");
    withHooks(repo, { postStart: `touch "${join(repo, ".post-start")}"`, postCheckout: `touch "${sentinel}"` });
    const result = json<{ created: boolean; hooks?: string }>(repo, ["work", id]);
    expect(result.created).toBe(true);
    expect(existsSync(sentinel)).toBe(true);
    expect(existsSync(join(repo, ".post-start"))).toBe(true);
  });

  it("reports hook failures as notes without failing tk work", () => {
    const { repo, id } = repoWorkspace();
    withHooks(repo, { postStart: "exit 3" });
    const result = json<{ created: boolean; hooks?: string }>(repo, ["work", id]);
    expect(result.created).toBe(true);
    expect(result.hooks).toContain("post_start");
  });

  it("tk close auto-prunes a merged worktree and deletes the branch", () => {
    const { repo, id } = repoWorkspace();
    const worktree = json<{ path: string }>(repo, ["work", id]).path;
    mergeTaskBranch(repo, id);
    const closed = json<{ metadata: Record<string, unknown> }>(repo, ["close", id]);
    expect(existsSync(worktree)).toBe(false);
    expect((closed.metadata["worktreePruned"] as Record<string, unknown>)["pruned"]).toBe(true);
    const branches = Bun.spawnSync(["git", "branch", "--list", `tk/${id}`], { cwd: repo, stdout: "pipe" });
    expect(new TextDecoder().decode(branches.stdout).trim()).toBe("");
  });

  it("tk close leaves an unmerged worktree in place but still closes", () => {
    const { repo, id } = repoWorkspace();
    const worktree = json<{ path: string }>(repo, ["work", id]).path;
    writeFileSync(join(worktree, "wip.txt"), "");
    git(worktree, "add", "wip.txt");
    git(worktree, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "wip");
    const closed = json<{ metadata: Record<string, unknown>; status: string }>(repo, ["close", id]);
    expect(closed.status).toBe("closed");
    expect(existsSync(worktree)).toBe(true);
    expect((closed.metadata["worktreePruned"] as Record<string, unknown>)["pruned"]).toBe(false);
    expect(((closed.metadata["worktreePruned"] as Record<string, unknown>)["reason"] as string)).toContain("not fully merged");
  });

  it("tk worktree clean dry-runs by default and prunes merged closed worktrees with --yes", () => {
    const { repo, id } = repoWorkspace();
    const worktree = json<{ path: string }>(repo, ["work", id]).path;
    writeFileSync(join(worktree, "wip.txt"), "");
    git(worktree, "add", "wip.txt");
    git(worktree, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "wip");
    json<unknown>(repo, ["close", id]); // unmerged → refused, worktree kept
    mergeTaskBranch(repo, id);
    const dry = json<{ eligible: ReadonlyArray<{ id: string }>; refused: ReadonlyArray<unknown> }>(repo, ["worktree", "clean"]);
    expect(dry.eligible.map((entry) => entry.id)).toEqual([id]);
    expect(dry.refused.length).toBe(0);
    expect(existsSync(worktree)).toBe(true);
    const yes = json<{ removed: ReadonlyArray<{ id: string }>; refused: ReadonlyArray<unknown> }>(repo, ["worktree", "clean", "--yes"]);
    expect(yes.removed.map((entry) => entry.id)).toEqual([id]);
    expect(existsSync(worktree)).toBe(false);
  });
});
