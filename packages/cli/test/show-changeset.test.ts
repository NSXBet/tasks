import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const dirs: string[] = [];
function scratch(): string { const value = mkdtempSync(join(tmpdir(), "tk-show-chg-")); dirs.push(value); return value; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

function run(directory: string, args: readonly string[]): { readonly stdout: string; readonly stderr: string; readonly status: number } {
  const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdout: "pipe", stderr: "pipe" });
  return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode };
}
function json<T>(directory: string, args: readonly string[]): T {
  const result = run(directory, [...args, "--json"]);
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
function workedWorkspace(seedFiles: Readonly<Record<string, string>> = {}): { repo: string; worktree: string; id: string; base: string } {
  const repo = realpathSync(scratch());
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "base.txt"), "base\n");
  for (const [name, content] of Object.entries(seedFiles)) writeFileSync(join(repo, name), content);
  git(repo, "add", ".");
  git(repo, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "init");
  json(repo, ["init", "--prefix", "tk"]);
  const issue = json<{ id: string }>(repo, ["create", "changeset probe"]);
  const worked = json<{ id: string; path: string; branch: string; base: string }>(repo, ["work", issue.id]);
  return { repo, worktree: worked.path, id: issue.id, base: worked.base };
}

describe("tk show lazy changeset derivation (CHG-01)", () => {
  it("lists commits and changed files derived from the branch vs pinned base", () => {
    const { repo, worktree, id } = workedWorkspace();
    writeFileSync(join(worktree, "a.txt"), "a\n");
    commit(worktree, "first commit", "a.txt");
    writeFileSync(join(worktree, "b.txt"), "b\n");
    commit(worktree, "second commit", "b.txt");
    const wire = json<readonly Record<string, unknown>[]>(repo, ["show", id])[0]!;
    const changeset = wire["changeset"] as Record<string, unknown>;
    expect((changeset["commits"] as readonly Record<string, unknown>[]).length).toBe(2);
    expect(((changeset["commits"] as readonly Record<string, unknown>[])[0] as Record<string, unknown>)["subject"]).toBe("second commit");
    expect((changeset["files"] as readonly Record<string, unknown>[]).map((file) => (file as Record<string, unknown>)["path"])).toEqual(["a.txt", "b.txt"]);
    expect(changeset["counts"]).toEqual({ additions: 2, deletions: 0 });
    const human = run(repo, ["show", id]);
    expect(human.stdout).toContain("COMMITS (2)");
    expect(human.stdout).toContain("second commit");
    expect(human.stdout).toContain("FILES (2)");
  });

  it("re-derives live on every read — a third commit changes the next show (no caching)", () => {
    const { repo, worktree, id } = workedWorkspace();
    writeFileSync(join(worktree, "a.txt"), "a\n");
    commit(worktree, "first commit", "a.txt");
    writeFileSync(join(worktree, "b.txt"), "b\n");
    commit(worktree, "second commit", "b.txt");
    expect(((json<readonly Record<string, unknown>[]>(repo, ["show", id])[0]!["changeset"] as Record<string, unknown>)["commits"] as readonly unknown[]).length).toBe(2);
    writeFileSync(join(worktree, "c.txt"), "c\n");
    commit(worktree, "third commit", "c.txt");
    expect(((json<readonly Record<string, unknown>[]>(repo, ["show", id])[0]!["changeset"] as Record<string, unknown>)["commits"] as readonly unknown[]).length).toBe(3);
  });

  it("task without tk work keeps the plain shape (no commits/files keys) and exits 0", () => {
    const repo = realpathSync(scratch());
    git(repo, "init", "-q", "-b", "main");
    git(repo, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "init");
    json(repo, ["init", "--prefix", "tk"]);
    const issue = json<{ id: string }>(repo, ["create", "unworked"]);
    const wire = json<readonly Record<string, unknown>[]>(repo, ["show", issue.id])[0]!;
    expect(wire["changeset"]).toEqual({ base: null });
    const human = run(repo, ["show", issue.id]);
    expect(human.status).toBe(0);
    expect(human.stdout).not.toContain("COMMITS");
    expect(human.stdout).not.toContain("FILES (");
  });

  it("deleted-branch decay: show still exits 0 with no COMMITS/FILES sections", () => {
    const { repo, worktree, id } = workedWorkspace();
    git(worktree, "checkout", "--detach");
    git(repo, "worktree", "remove", worktree);
    git(repo, "branch", "-D", `tk/${id}`);
    const wire = json<readonly Record<string, unknown>[]>(repo, ["show", id])[0]!;
    expect(wire["changeset"]).toEqual({ base: expect.any(String) });
    expect((wire["changeset"] as Record<string, unknown>)["commits"]).toBeUndefined();
    const human = run(repo, ["show", id]);
    expect(human.status).toBe(0);
    expect(human.stdout).not.toContain("COMMITS");
  });

  it("base-pinned stability: commits on main after branch-cut never leak into the shown changeset", () => {
    const { repo, worktree, id } = workedWorkspace();
    writeFileSync(join(worktree, "a.txt"), "a\n");
    commit(worktree, "branch work", "a.txt");
    writeFileSync(join(repo, "later.txt"), "later\n");
    commit(repo, "main advances", "later.txt");
    const wire = json<readonly Record<string, unknown>[]>(repo, ["show", id])[0]!;
    const changeset = wire["changeset"] as Record<string, unknown>;
    expect((changeset["commits"] as readonly unknown[]).length).toBe(1);
    expect((changeset["files"] as readonly Record<string, unknown>[]).map((file) => (file as Record<string, unknown>)["path"])).toEqual(["a.txt"]);
  });

  it("rename edge: one entry with the git-emitted code and the destination path", () => {
    const { repo, worktree, id } = workedWorkspace({ "old.txt": "old\n" });
    git(worktree, "mv", "old.txt", "new.txt");
    commit(worktree, "rename", "-A");
    const files = (json<readonly Record<string, unknown>[]>(repo, ["show", id])[0]!["changeset"] as Record<string, unknown>)["files"] as readonly Record<string, unknown>[];
    const rename = files.filter((file) => (file["path"] as string).includes(".txt"));
    expect(rename.length).toBe(1); // one entry: git-emitted R code with the destination path
    expect(rename[0]!["path"]).toBe("new.txt");
    expect((rename[0]!["status"] as string).startsWith("R")).toBe(true);
  });

  it("binary edge: additions stay 0 for the binary while files gains status A", () => {
    const { repo, worktree, id } = workedWorkspace();
    writeFileSync(join(worktree, "blob.bin"), "a\x00b\x00c");
    commit(worktree, "add binary", "blob.bin");
    const changeset = json<readonly Record<string, unknown>[]>(repo, ["show", id])[0]!["changeset"] as Record<string, unknown>;
    expect(changeset["counts"]).toEqual({ additions: 0, deletions: 0 });
    expect((changeset["files"] as readonly Record<string, unknown>[])[0]).toEqual({ path: "blob.bin", status: "A" });
  });
});

// D-03 scoping guard: `grep "deriveChangeset" packages/cli/src/tk.ts | grep -v "import"`
// must yield exactly ONE non-import line — the show dispatch call site (currently
// tk.ts ~line 1100). 02-02's finish wiring adds a second call site deliberately;
// update this comment and the gate together when it lands.
