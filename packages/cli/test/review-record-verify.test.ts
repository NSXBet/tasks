import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentLine, DEFAULT_WEB_BASE, detectHarness, HARNESS_REGISTRY, type HarnessEntry } from "@tasks/domain";
import { registerRuntime, WEB_DEFAULT_PORT, WEB_RUNTIME_ID } from "@tasks/surface";

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const dirs: string[] = [];
function scratch(): string { const value = mkdtempSync(join(tmpdir(), "tk-record-verify-")); dirs.push(value); return value; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

/** Blank the session/harness env so a suite running inside omp/codex/cursor does not leak into assertions. */
const HERMETIC_ENV = { TK_SESSION: "", TK_HARNESS: "", PI_SESSION_ID: "", CODEX_THREAD_ID: "", CURSOR_AGENT: "", CURSOR_CONVERSATION_ID: "", NO_COLOR: "1" } as const;
function run(directory: string, args: readonly string[], env: Readonly<Record<string, string>> = {}): { readonly stdout: string; readonly stderr: string; readonly status: number } {
  const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...HERMETIC_ENV, ...env } });
  return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode };
}
function json<T>(directory: string, args: readonly string[], env: Readonly<Record<string, string>> = {}): T {
  const result = run(directory, [...args, "--json"], env);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as T;
}
function human(directory: string, args: readonly string[], env: Readonly<Record<string, string>> = {}): string {
  const result = run(directory, args, env);
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}
function git(directory: string, ...args: readonly string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
  return new TextDecoder().decode(result.stdout);
}
const commit = (directory: string, message: string, ...paths: readonly string[]) => {
  git(directory, "add", ...paths);
  git(directory, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", message);
};

interface Worked { readonly repo: string; readonly worktree: string; readonly id: string; readonly branch: string; readonly base: string }

/** git repo + tk workspace; one issue entered via `tk work` with two commits (a.txt, b.txt). */
function workedWithTwoCommits(parent?: string): Worked {
  const repo = realpathSync(scratch());
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "base.txt"), "base\n");
  git(repo, "add", ".");
  git(repo, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "init");
  json(repo, ["init", "--prefix", "tk"]);
  const issue = json<{ id: string }>(repo, ["create", "record probe", ...(parent === undefined ? [] : ["--parent", parent])]);
  const worked = json<{ id: string; path: string; branch: string; base: string }>(repo, ["work", issue.id]);
  writeFileSync(join(worked.path, "a.txt"), "a\n");
  commit(worked.path, "first change", "a.txt");
  writeFileSync(join(worked.path, "b.txt"), "b\n");
  commit(worked.path, "second change", "b.txt");
  return { repo, worktree: worked.path, id: issue.id, branch: worked.branch, base: worked.base };
}

describe("Phase 7 review record — spec verify 1, 6, 7", () => {
  it("item 1 (Product): tk show renders the PR-shaped record and every list is derived", () => {
    const { repo, id, branch } = workedWithTwoCommits();
    const before = json<readonly Record<string, unknown>[]>(repo, ["show", id])[0]!;
    const workKeys = Object.keys((before["metadata"] as Record<string, unknown> | undefined) ?? {});

    const finished = json<Record<string, unknown>>(repo, ["finish", id, "--session", "s1"]);
    expect(finished["status"]).toBe("ready-to-review");

    const out = human(repo, ["show", id]);
    expect(out).toContain("agent omp · session s1 finished");
    expect(out).toContain(`tk review ${id}`);
    expect(out).toContain(`/tasks/${id}`);
    expect(out).toContain("comments 0 · 0 open 0 ✓");
    expect(out).toContain("BRANCH:");
    expect(out).toContain("COMMITS (2)");
    expect(out).toContain("FILES (2)");

    // Derived: the FILES list equals git's own diff of base..branch.
    const wire = json<readonly Record<string, unknown>[]>(repo, ["show", id])[0]!;
    const changeset = wire["changeset"] as Record<string, unknown>;
    const base = (changeset["base"] as string | undefined) ?? (((finished["metadata"] as Record<string, unknown>)["changeset"] as Record<string, unknown>)["base"] as string);
    const gitFiles = git(repo, "diff", "--name-only", `${base}..${branch}`).split("\n").filter(Boolean).sort();
    const shownFiles = (changeset["files"] as readonly Record<string, unknown>[]).map((file) => file["path"] as string).sort();
    expect(shownFiles).toEqual(gitFiles);
    expect(shownFiles).toEqual(["a.txt", "b.txt"]);

    // No agent-supplied lists: the stored metadata is the work record + finish stamps only
    // (11-01: finish also stamps the counts-only, git-derived `report` cache — never a list).
    const metadata = finished["metadata"] as Record<string, unknown>;
    const allowed = new Set([...workKeys, "agent_session", "finished_at", "agent_harness", "changeset", "report"]);
    for (const key of Object.keys(metadata)) expect(allowed.has(key), `unexpected metadata key ${key}`).toBe(true);
    const stored = metadata["changeset"] as Record<string, unknown>;
    expect(typeof stored["base"]).toBe("string");
    expect(stored["files"]).toBeUndefined();
    expect(stored["commits"]).toBeUndefined();
    const report = metadata["report"] as Record<string, unknown>;
    expect(Object.keys(report).sort()).toEqual(["at", "changes", "head"]);
    for (const value of Object.values(report["changes"] as Record<string, unknown>)) expect(typeof value).toBe("number");
  });

  it("item 6 (Registry): omp first; a harness added as data is detected and rendered", () => {
    expect(HARNESS_REGISTRY[0]!.id).toBe("omp");
    const ids = HARNESS_REGISTRY.map((entry) => entry.id);
    expect(ids).toContain("codex");
    expect(ids).toContain("cursor");
    const registry: readonly HarnessEntry[] = [...HARNESS_REGISTRY, { id: "zed", status: "planned", note: "verify", env: ["ZED_SESSION_ID"] }];
    expect(detectHarness({ ZED_SESSION_ID: "z" }, registry)).toBe("zed");
    expect(agentLine({ metadata: { agent_harness: "zed", agent_session: "z1" } })).toContain("agent zed · session z1");
  });

  it("item 6 (Registry) e2e: codex env at finish renders the codex agent line", () => {
    const { repo, id } = workedWithTwoCommits();
    json(repo, ["finish", id, "--session", "s2"], { CODEX_THREAD_ID: "t" });
    expect(human(repo, ["show", id])).toContain("agent codex · session s2");
  });

  it("item 7 (Doors, CLI): show, list, ready, query and children carry both doors with the registered web base", async () => {
    const repo = realpathSync(scratch());
    json(repo, ["init", "--prefix", "tk"]);
    const parent = json<{ id: string }>(repo, ["create", "doors parent"]).id;
    const id = json<{ id: string }>(repo, ["create", "doors child", "--parent", parent]).id;
    await registerRuntime(join(repo, ".tasks"), { id: WEB_RUNTIME_ID, kind: "web", pid: process.pid, port: 5999, url: "http://127.0.0.1:5999", workspace: repo, startedAt: new Date().toISOString() });

    const show = human(repo, ["show", id]);
    expect(show).toContain(`tk review ${id}`);
    expect(show).toContain(`http://127.0.0.1:5999/tasks/${id}`);
    const wire = json<readonly Record<string, unknown>[]>(repo, ["show", id])[0]!;
    expect(wire["review_doors"]).toEqual({ tui: `tk review ${id}`, web: `http://127.0.0.1:5999/tasks/${id}` });

    const commands: readonly (readonly string[])[] = [["list"], ["ready"], ["query", "status=open"], ["children", parent]];
    for (const args of commands) {
      const output = human(repo, args);
      expect(output, args.join(" ")).toContain("http://127.0.0.1:5999/tasks/<id>");
      expect(output, args.join(" ")).toContain("tk review <id>");
    }
  });

  it("item 7 (Doors, web): the served shell carries doors on board cards, list rows and the task modal", () => {
    const html = readFileSync(join(import.meta.dir, "../../web/src/app.html"), "utf8");
    expect(html).toContain("${esc(doorsFor(issue).tui)}");
    expect(html).toMatch(/class="ldoors mono"[^>]*>\$\{esc\(doorsFor\(i\)\.tui\)\}/);
    expect(html).toMatch(/id="mDoors".*\$\{esc\(d\.tui\)\}.*\$\{esc\(d\.web\)\}/);
  });

  it("comments row (D-03): open counts open threads, dismissed settles, all settled reads All resolved", () => {
    const { repo, id } = workedWithTwoCommits();
    json(repo, ["finish", id, "--session", "s1"]);
    const threads = (statuses: readonly string[]) => JSON.stringify({ version: 1, threads: statuses.map((status, index) => ({ id: `t${index + 1}`, status, file: "a.txt", line: index + 1 })) });
    json(repo, ["update", id, "--set-metadata", `reviewThreads=${threads(["open", "resolved", "dismissed"])}`]);
    const mixed = human(repo, ["show", id]);
    expect(mixed).toContain("1 open 1 ✓");
    json(repo, ["update", id, "--set-metadata", `reviewThreads=${threads(["resolved", "dismissed", "resolved"])}`]);
    expect(human(repo, ["show", id])).toContain("All resolved");
  });

  it("drift pin: DEFAULT_WEB_BASE mirrors WEB_DEFAULT_PORT", () => {
    expect(DEFAULT_WEB_BASE).toBe(`http://localhost:${WEB_DEFAULT_PORT}`);
  });
});
