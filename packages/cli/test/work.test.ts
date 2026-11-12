import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const dirs: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-work-")); dirs.push(value); return value; }
function run(directory: string, args: readonly string[], input?: string, env?: Record<string, string>): { readonly stdout: string; readonly stderr: string; readonly status: number } { const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdin: input === undefined ? undefined : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe", env: env === undefined ? undefined : { ...process.env, ...env } }); return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode }; }
function json<T>(directory: string, args: readonly string[], input?: string, env?: Record<string, string>): T { const result = run(directory, [...args, "--json"], input, env); expect(result.status, result.stderr).toBe(0); return JSON.parse(result.stdout) as T; }
function gitOut(directory: string, ...args: readonly string[]): { readonly stdout: string; readonly code: number } { const result = Bun.spawnSync(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" }); return { stdout: new TextDecoder().decode(result.stdout), code: result.exitCode }; }
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
    // The default in-repo pool is excluded via info/exclude, never .gitignore.
    expect(gitOut(repo, "status", "--porcelain").stdout).not.toContain(".worktrees");
    expect(readFileSync(join(repo, ".git", "info", "exclude"), "utf8")).toContain("/.worktrees/");
  });

  it("leaves info/exclude untouched when .worktrees is already ignored by a committed .gitignore", () => {
    const { repo, id } = repoWorkspace();
    writeFileSync(join(repo, ".gitignore"), ".worktrees\n");
    git(repo, "add", ".gitignore");
    git(repo, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "ignore pool");
    const excludePath = join(repo, ".git", "info", "exclude");
    const before = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : null;
    json(repo, ["work", id]);
    const after = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : null;
    expect(after).toBe(before);
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe(".worktrees\n");
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
    // The branch tk work created for this attempt is rolled back (WR-04).
    expect(gitOut(repo, "rev-parse", "--verify", "--quiet", `refs/heads/tk/${id}`).code).not.toBe(0);
  });

  it("never deletes a pre-existing tk/<id> branch when worktree add fails", () => {
    const { repo, id } = repoWorkspace();
    git(repo, "branch", `tk/${id}`);
    const blocked = join(repo, ".worktrees", `${repo.split("/").pop()}-${id}`);
    mkdirSync(blocked, { recursive: true });
    writeFileSync(join(blocked, "occupied"), "");
    const result = run(repo, ["work", id, "--json"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("already exists");
    expect(gitOut(repo, "rev-parse", "--verify", "--quiet", `refs/heads/tk/${id}`).code).toBe(0);
  });
});

/** Adds a `worktree` block to the workspace config (gw lifecycle hooks). */
function withHooks(repo: string, hooks: Record<string, unknown>): void {
  const configPath = join(repo, ".tasks", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  writeFileSync(configPath, JSON.stringify({ ...config, worktree: hooks }, null, 2));
}

const commitFile = (cwd: string, file: string, message: string): void => {
  writeFileSync(join(cwd, file), `${message}\n`);
  git(cwd, "add", "-f", file);
  git(cwd, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", message);
};
const branchList = (repo: string, branch: string): string => gitOut(repo, "branch", "--list", branch).stdout.trim();
/** Lands the task branch's tip on main by cherry-pick after an unrelated main commit (rebase-merge: no ancestry). */
function rebaseMergeTaskBranch(repo: string, id: string): void {
  commitFile(repo, "unrelated.txt", "main moves on");
  git(repo, "-c", "user.name=test", "-c", "user.email=test@example.com", "cherry-pick", `tk/${id}`);
}

/** Merges the task branch into main so pruning is safe. */
function mergeTaskBranch(repo: string, id: string): void {
  git(repo, "-c", "user.name=test", "-c", "user.email=test@example.com", "merge", "--no-edit", "-q", `tk/${id}`);
}

describe("worktree lifecycle (gw port)", () => {
  it("fires post_start (not post_checkout) inside the fresh worktree when tk work creates tk/<id>", () => {
    const { repo, id } = repoWorkspace();
    const ps = join(repo, ".post-start");
    const pc = join(repo, ".post-checkout");
    withHooks(repo, { postStart: `touch "${ps}"`, postCheckout: `touch "${pc}"` });
    const result = json<{ created: boolean; hooks?: string }>(repo, ["work", id]);
    expect(result.created).toBe(true);
    expect(existsSync(ps)).toBe(true);
    expect(existsSync(pc)).toBe(false);
  });

  it("fires post_checkout when tk work re-provisions a surviving tk/<id>, and neither hook on re-entry", () => {
    const { repo, id } = repoWorkspace();
    const ps = join(repo, ".post-start");
    const pc = join(repo, ".post-checkout");
    withHooks(repo, { post_start: `touch "${ps}"`, post_checkout: `touch "${pc}"` });
    const first = json<{ path: string; created: boolean }>(repo, ["work", id]);
    rmSync(ps, { force: true });
    git(repo, "worktree", "remove", "--force", first.path);
    expect(branchList(repo, `tk/${id}`)).not.toBe("");
    const second = json<{ path: string; created: boolean }>(repo, ["work", id]);
    expect(second.created).toBe(true);
    expect(existsSync(pc)).toBe(true);
    expect(existsSync(ps)).toBe(false);
    rmSync(pc, { force: true });
    const third = json<{ created: boolean }>(repo, ["work", id]);
    expect(third.created).toBe(false);
    expect(existsSync(pc)).toBe(false);
    expect(existsSync(ps)).toBe(false);
  });

  it("installs by default naming the manager on failure, and never installs with install: false", () => {
    const { repo, id } = repoWorkspace();
    commitFile(repo, "bun.lock", "lock");
    const stubDir = mkdtempSync(join(tmpdir(), "tk-work-stub-"));
    dirs.push(stubDir);
    const marker = join(stubDir, "bun-ran");
    writeFileSync(join(stubDir, "bun"), `#!/bin/sh\ntouch "${marker}"\nexit 1\n`, { mode: 0o755 });
    const env = { PATH: `${stubDir}:${process.env["PATH"] ?? ""}` };
    const failed = json<{ created: boolean; hooks?: string }>(repo, ["work", id], undefined, env);
    expect(failed.created).toBe(true);
    expect(failed.hooks).toContain("package install failed (bun)");
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);
    withHooks(repo, { install: false });
    const other = json<{ id: string }>(repo, ["create", "second task"]);
    const skipped = json<{ created: boolean; hooks?: string }>(repo, ["work", other.id], undefined, env);
    expect(skipped.created).toBe(true);
    expect(skipped.hooks).toBeUndefined();
    expect(existsSync(marker)).toBe(false);
  });

  it("honors the spec snake_case post_start key written straight into config.json", () => {
    const { repo, id } = repoWorkspace();
    const configPath = join(repo, ".tasks", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    writeFileSync(configPath, JSON.stringify({ ...config, worktree: { post_start: `touch "${join(repo, ".ps")}"` } }));
    const result = json<{ created: boolean; hooks?: string }>(repo, ["work", id]);
    expect(result.created).toBe(true);
    expect(existsSync(join(repo, ".ps"))).toBe(true);
    expect(result.hooks).toBeUndefined();
  });

  it("reports hook failures as notes without failing tk work", () => {
    const { repo, id } = repoWorkspace();
    withHooks(repo, { postStart: "exit 3" });
    const result = json<{ created: boolean; hooks?: string }>(repo, ["work", id]);
    expect(result.created).toBe(true);
    expect(result.hooks).toContain("post_start");
  });

  it("tk close auto-prunes a merged worktree and deletes the branch, keeping the frozen changeset", () => {
    const { repo, id } = repoWorkspace();
    const work = json<{ path: string; base: string }>(repo, ["work", id]);
    const worktree = work.path;
    commitFile(worktree, "feature.txt", "feature");
    mergeTaskBranch(repo, id);
    const closed = json<{ metadata: Record<string, unknown> }>(repo, ["close", id]);
    expect(existsSync(worktree)).toBe(false);
    expect((closed.metadata["worktreePruned"] as Record<string, unknown>)["pruned"]).toBe(true);
    expect(branchList(repo, `tk/${id}`)).toBe("");
    // Phase 2 snapshot survives the prune: show still carries base/commits/files.
    const shown = json<ReadonlyArray<Record<string, unknown>>>(repo, ["show", id])[0]!;
    const changeset = shown["changeset"] as Record<string, unknown>;
    expect(changeset["base"]).toBe(work.base);
    expect((changeset["commits"] as readonly unknown[]).length).toBeGreaterThan(0);
    expect(JSON.stringify(changeset["files"])).toContain("feature.txt");
  });

  it("tk close prunes a rebase-merged (cherry-picked) worktree and branch", () => {
    const { repo, id } = repoWorkspace();
    const worktree = json<{ path: string }>(repo, ["work", id]).path;
    commitFile(worktree, "feature.txt", "feature");
    rebaseMergeTaskBranch(repo, id);
    const closed = json<{ status: string; metadata: Record<string, unknown> }>(repo, ["close", id]);
    expect(closed.status).toBe("closed");
    expect((closed.metadata["worktreePruned"] as Record<string, unknown>)["pruned"]).toBe(true);
    expect(existsSync(worktree)).toBe(false);
    expect(branchList(repo, `tk/${id}`)).toBe("");
  });

  it("human tk close reports the prune outcome", () => {
    const merged = repoWorkspace();
    const mergedTree = json<{ path: string }>(merged.repo, ["work", merged.id]).path;
    commitFile(mergedTree, "feature.txt", "feature");
    mergeTaskBranch(merged.repo, merged.id);
    const prunedOut = run(merged.repo, ["close", merged.id]);
    expect(prunedOut.status, prunedOut.stderr).toBe(0);
    expect(prunedOut.stdout).toContain("worktree pruned");

    const kept = repoWorkspace();
    const keptTree = json<{ path: string; base: string }>(kept.repo, ["work", kept.id]);
    commitFile(keptTree.path, "wip.txt", "wip");
    const keptOut = run(kept.repo, ["close", kept.id]);
    expect(keptOut.status, keptOut.stderr).toBe(0);
    expect(keptOut.stdout).toContain(`worktree kept: branch tk/${kept.id} is not fully merged into ${keptTree.base}`);

    const bare = repoWorkspace();
    const bareOut = run(bare.repo, ["close", bare.id]);
    expect(bareOut.status, bareOut.stderr).toBe(0);
    expect(bareOut.stdout).not.toContain("worktree");
  }, 60_000);

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

describe("tk worktree clean lifecycle", () => {
  it("lists only live closed-task worktrees, removes each eligible one once, and persists the record", () => {
    const { repo, id: a } = repoWorkspace();
    const b = json<{ id: string }>(repo, ["create", "unmerged"]).id;
    const c = json<{ id: string }>(repo, ["create", "pruned at close"]).id;
    const d = json<{ id: string }>(repo, ["create", "still open"]).id;
    const log = join(repo, "pre-end.log");
    const trees: Record<string, string> = {};
    for (const id of [a, b, c, d]) { trees[id] = json<{ path: string }>(repo, ["work", id]).path; commitFile(trees[id]!, `${id}.txt`, `work ${id}`); }
    mergeTaskBranch(repo, c);
    json(repo, ["close", c]); // pruned at close → never listed again
    expect(existsSync(trees[c]!)).toBe(false);
    json(repo, ["close", a]); // unmerged at close → kept
    json(repo, ["close", b]);
    mergeTaskBranch(repo, a);
    mergeTaskBranch(repo, d); // merged but open → not a candidate
    withHooks(repo, { preEnd: `echo "$PWD" >> "${log}"` });

    type Dry = { dry_run: boolean; eligible: ReadonlyArray<{ id: string }>; refused: ReadonlyArray<{ id: string; reason: string }> };
    const dry = json<Dry>(repo, ["worktree", "clean"]);
    expect(dry.dry_run).toBe(true);
    expect(dry.eligible.map((entry) => entry.id)).toEqual([a]);
    expect(dry.refused.map((entry) => entry.id)).toEqual([b]);
    expect(dry.refused[0]!.reason).toContain("not fully merged");
    expect(json<Dry>(repo, ["worktree", "clean", "--dry-run"])).toEqual(dry);
    expect(existsSync(trees[a]!)).toBe(true);

    const both = run(repo, ["worktree", "clean", "--dry-run", "--yes"]);
    expect(both.status).not.toBe(0);
    expect(both.stderr).toContain("--dry-run and --yes are mutually exclusive");

    type Yes = { removed: ReadonlyArray<{ id: string }>; refused: ReadonlyArray<{ id: string }> };
    const yes = json<Yes>(repo, ["worktree", "clean", "--yes"]);
    expect(yes.removed.map((entry) => entry.id)).toEqual([a]);
    expect(yes.refused.map((entry) => entry.id)).toEqual([b]);
    expect(existsSync(trees[a]!)).toBe(false);
    expect(branchList(repo, `tk/${a}`)).toBe("");
    expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(1);
    const shown = json<ReadonlyArray<Record<string, unknown>>>(repo, ["show", a])[0]!;
    const metadata = (shown["metadata"] ?? shown) as Record<string, unknown>;
    expect((metadata["worktreePruned"] as Record<string, unknown>)["pruned"]).toBe(true);

    const again = json<Yes>(repo, ["worktree", "clean", "--yes"]);
    expect(again.removed).toEqual([]);
    expect(again.refused.map((entry) => entry.id)).toEqual([b]);
    expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(1);
  }, 120_000);
});

describe("tk worktree remove merge guard", () => {
  const create = (repo: string): string => json<{ path: string }>(repo, ["worktree", "create", "demo"]).path;

  it("refuses an unmerged worktree without --force and removes it once merged", () => {
    const { repo } = repoWorkspace();
    const path = create(repo);
    commitFile(path, "demo.txt", "demo");
    const refused = run(repo, ["worktree", "remove", "demo"]);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("not merged into main");
    expect(refused.stderr).toContain("--force");
    expect(existsSync(path)).toBe(true);
    git(repo, "-c", "user.name=test", "-c", "user.email=test@example.com", "merge", "--no-edit", "-q", "demo");
    expect(json<{ removed: boolean }>(repo, ["worktree", "remove", "demo"]).removed).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it("--force removes an unmerged worktree", () => {
    const { repo } = repoWorkspace();
    const path = create(repo);
    commitFile(path, "demo.txt", "demo");
    expect(json<{ removed: boolean }>(repo, ["worktree", "remove", "demo", "--force"]).removed).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it("removes a fresh worktree whose branch has no commits of its own", () => {
    const { repo } = repoWorkspace();
    const path = create(repo);
    expect(json<{ removed: boolean }>(repo, ["worktree", "remove", "demo"]).removed).toBe(true);
    expect(existsSync(path)).toBe(false);
  });
});
