import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const dirs: string[] = [];
function scratch(): string { const value = mkdtempSync(join(tmpdir(), "tk-finish-")); dirs.push(value); return value; }
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

  it("show renders the agent line from the harness registry, both doors and the comments row", () => {
    const { repo, id } = workedWorkspace();
    run(repo, ["finish", id, "--session", "sess-42", "--harness", "codex"]);
    const out = run(repo, ["show", id]).stdout;
    expect(out).toMatch(/agent codex · session sess-42 finished \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(out).toContain(`tk review ${id}`);
    expect(out).toContain(`/tasks/${id}`);
    expect(out).toContain("comments 0 · 0 open 0 ✓");
    const wire = json<readonly Record<string, unknown>[]>(repo, ["show", id])[0]!;
    expect((wire["review_doors"] as Record<string, string>)["tui"]).toBe(`tk review ${id}`);
  });

  it("detects the harness from the codex session env (D-01, REC-01)", () => {
    const { repo, id } = workedWorkspace();
    const wire = json<Record<string, unknown>>(repo, ["finish", id, "--session", "s1"], { CODEX_THREAD_ID: "t1" });
    expect((wire["metadata"] as Record<string, unknown>)["agent_harness"]).toBe("codex");
    expect(run(repo, ["show", id]).stdout).toMatch(/agent codex · session s1 finished \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it("detects cursor from CURSOR_AGENT (D-01)", () => {
    const { repo, id } = workedWorkspace();
    const wire = json<Record<string, unknown>>(repo, ["finish", id, "--session", "s"], { CURSOR_AGENT: "1" });
    expect((wire["metadata"] as Record<string, unknown>)["agent_harness"]).toBe("cursor");
  });

  it("stores the registry default omp when no harness env is present (D-01)", () => {
    const { repo, id } = workedWorkspace();
    const wire = json<Record<string, unknown>>(repo, ["finish", id, "--session", "s"]);
    expect((wire["metadata"] as Record<string, unknown>)["agent_harness"]).toBe("omp");
    expect(run(repo, ["show", id]).stdout).toContain("agent omp · session s");
  });

  it("precedence: --harness > TK_HARNESS > detected env (D-01)", () => {
    const first = workedWorkspace();
    const viaEnv = json<Record<string, unknown>>(first.repo, ["finish", first.id, "--session", "s"], { CODEX_THREAD_ID: "t1", TK_HARNESS: "cursor" });
    expect((viaEnv["metadata"] as Record<string, unknown>)["agent_harness"]).toBe("cursor");
    const second = workedWorkspace();
    const viaFlag = json<Record<string, unknown>>(second.repo, ["finish", second.id, "--session", "s", "--harness", "omp"], { CODEX_THREAD_ID: "t1", TK_HARNESS: "cursor" });
    expect((viaFlag["metadata"] as Record<string, unknown>)["agent_harness"]).toBe("omp");
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

  it("human finish prints one stat card with both changes-view links and never a diff (PR-02)", () => {
    const { repo, id } = workedWorkspace();
    const result = run(repo, ["finish", id, "--session", "s1"], { NO_COLOR: "1" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("✓ Finished");
    expect(result.stdout).toContain(`Changes · ${id}`);
    expect(result.stdout).toContain("1 commit · +1 −0 · 1 file");
    expect(result.stdout).toContain(`/tasks/${id}/diff`);
    expect(result.stdout).toContain(`tk review ${id}`);
    expect(result.stdout).not.toContain("diff --git");
    expect(result.stdout).not.toContain("@@");
    expect(result.stdout).not.toContain("+a");
  });

  it("finish --json carries the changes view and stamps a counts-only metadata.report (PR-02/PR-03)", () => {
    const { repo, id } = workedWorkspace();
    const wire = json<Record<string, unknown>>(repo, ["finish", id, "--session", "s1"]);
    const changes = wire["changes"] as Record<string, unknown>;
    expect(changes["source"]).toBe("live");
    expect(changes["stale"]).toBe(false);
    expect(changes["stat"]).toEqual({ commits: 1, files: 1, additions: 1, deletions: 0 });
    expect(String((changes["links"] as Record<string, string>)["web"])).toEndWith(`/tasks/${id}/diff`);
    const report = (wire["metadata"] as Record<string, unknown>)["report"] as Record<string, unknown>;
    expect(report["changes"]).toEqual({ commits: 1, files: 1, additions: 1, deletions: 0 });
    expect(String(report["head"])).toMatch(/^[0-9a-f]{40}$/);
  });

  it("the report stamp is a silent cache on the event wire: no task.update for metadata.report", () => {
    const { repo, id } = workedWorkspace();
    json(repo, ["finish", id, "--session", "s1"]);
    const log = join(repo, ".tasks", "events.jsonl");
    expect(existsSync(log)).toBe(true);
    const events = readFileSync(log, "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as { type: string; task?: string; data?: Record<string, unknown> });
    expect(events.some((event) => event.type === "task.status" && event.task === id)).toBe(true);
    const noisy = events.filter((event) => event.type === "task.update" && ((event.data?.["fields"] as readonly string[] | undefined) ?? []).includes("metadata.report"));
    expect(noisy).toEqual([]);
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

describe("tk finish carries the PR (11-03, D-01/D-02)", () => {
  const URL = "https://github.com/acme/app/pull/7";
  /** worked workspace + bare `origin` + the fake gh (fixtures/gh) first on PATH; GH_TOKEN/GITHUB_TOKEN/TK_GH blanked. */
  function withFakeGh(): { repo: string; id: string; log: string; env: Record<string, string> } {
    const { repo, id } = workedWorkspace();
    const root = realpathSync(scratch());
    const origin = join(root, "origin.git"); const bin = join(root, "bin"); const ghDir = join(root, "gh-state");
    mkdirSync(bin); mkdirSync(ghDir);
    git(root, "init", "-q", "--bare", origin);
    git(repo, "remote", "add", "origin", origin);
    git(repo, "push", "-q", "origin", "main");
    copyFileSync(join(import.meta.dir, "fixtures/gh"), join(bin, "gh")); chmodSync(join(bin, "gh"), 0o755);
    const log = join(root, "gh.log");
    return { repo, id, log, env: { PATH: `${bin}:${process.env["PATH"] ?? ""}`, FAKE_GH_DIR: ghDir, FAKE_GH_LOG: log, TK_GH: "", GH_TOKEN: "", GITHUB_TOKEN: "" } };
  }
  const logLines = (log: string): string[] => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((line) => line !== "") : []);

  it("no PR: the stat card is followed by `next: tk pr create <id>` and finish runs no gh", () => {
    const { repo, id, log, env } = withFakeGh();
    const result = run(repo, ["finish", id, "--session", "s1"], { ...env, NO_COLOR: "1" });
    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.split("\n");
    const card = lines.findIndex((line) => line.includes("1 commit · +1 −0 · 1 file"));
    expect(card).toBeGreaterThanOrEqual(0);
    expect(lines.slice(card + 1).join("\n")).toContain(`next: tk pr create ${id}`);
    expect(json<Record<string, unknown>>(repo, ["finish", id, "--session", "s1"], env)["pr"]).toBeNull();
    expect(logLines(log)).toHaveLength(0);
  });

  it("with a PR: the card links it, no next hint, --json carries pr next to changes, zero gh calls", () => {
    const { repo, id, log, env } = withFakeGh();
    json(repo, ["pr", "create", id], env);
    const before = logLines(log).length;
    const human = run(repo, ["finish", id, "--session", "s2"], { ...env, NO_COLOR: "1" });
    expect(human.status, human.stderr).toBe(0);
    expect(human.stdout).toContain(`PR #7 · open · ${URL}`);
    expect(human.stdout).not.toContain("next:");
    const wire = json<Record<string, unknown>>(repo, ["finish", id, "--session", "s2"], env);
    expect(wire["changes"]).toBeDefined();
    expect(wire["pr"]).toEqual({ number: 7, url: URL, state: "open" });
    const changes = run(repo, ["changes", id], { ...env, NO_COLOR: "1" });
    expect(changes.stdout).toContain(`PR #7 · open · ${URL}`);
    expect(changes.stdout).not.toContain("next:");
    expect(logLines(log)).toHaveLength(before);
  });
});
