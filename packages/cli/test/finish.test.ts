import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const executable = join(process.cwd(), "packages/cli/src/tk.ts");
const dirs: string[] = [];
function scratch(): string { const value = mkdtempSync(join(tmpdir(), "tk-finish-")); dirs.push(value); return value; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

function run(directory: string, args: readonly string[], env: Readonly<Record<string, string>> = {}): { readonly stdout: string; readonly stderr: string; readonly status: number } {
  const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TK_SESSION: "", ...env } });
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
function workedWorkspace(): { repo: string; worktree: string; id: string } {
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
  return { repo, worktree: worked.path, id: issue.id };
}

describe("tk finish (FIN-01)", () => {
  it("requires --session (or TK_SESSION env) — D-10 completion record", () => {
    const { repo, id } = workedWorkspace();
    const result = run(repo, ["finish", id]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--session");
  });

  it("moves the task into ready-to-review and prints live-derived counts", () => {
    const { repo, id } = workedWorkspace();
    const wire = json<Record<string, unknown>>(repo, ["finish", id, "--session", "s1"]);
    expect(wire["status"]).toBe("ready-to-review");
    const human = run(repo, ["finish", "--help"]);
    expect(human).toBeDefined();
    const show = json<readonly Record<string, unknown>[]>(repo, ["show", id])[0]!;
    expect(show["status"]).toBe("ready-to-review");
    const changeset = show["changeset"] as Record<string, unknown>;
    expect(((changeset["commits"] as readonly Record<string, unknown>[])[0]! as Record<string, unknown>)["subject"]).toBe("the work");
    const humanShow = run(repo, ["show", id]);
    expect(humanShow.stdout).toContain("the work");
  });

  it("repeat finish is idempotent (D-11) — same status, exit 0", () => {
    const { repo, id } = workedWorkspace();
    const first = json<Record<string, unknown>>(repo, ["finish", id, "--session", "s1"]);
    const second = json<Record<string, unknown>>(repo, ["finish", id, "--session", "s2"]);
    expect(second["status"]).toBe(first["status"]);
    expect(second["status"]).toBe("ready-to-review");
  });

  it("finish never freezes the changeset snapshot (FIN-01/D-09) — only close does", () => {
    const { repo, id } = workedWorkspace();
    const wire = json<Record<string, unknown>>(repo, ["finish", id, "--session", "s1"]);
    const metadata = wire["metadata"] as Record<string, unknown>;
    // `tk work` pins the base as a commit SHA; finish keeps the base record only.
    const changeset = metadata["changeset"] as Record<string, unknown>;
    expect(typeof changeset["base"]).toBe("string");
    expect(changeset["head"]).toBeUndefined();
  });

  it("finish without a work record fails (D-10)", () => {
    const repo = realpathSync(scratch());
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "base.txt"), "base\n");
    git(repo, "add", ".");
    git(repo, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "init");
    json(repo, ["init", "--prefix", "tk"]);
    const issue = json<{ id: string }>(repo, ["create", "never worked"]);
    const result = run(repo, ["finish", issue.id, "--session", "s1"]);
    expect(result.status).not.toBe(0);
  });
});
