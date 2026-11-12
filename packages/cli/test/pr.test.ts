/**
 * `tk pr` (PR-01, D-01) end to end. Never touches GitHub: a fake `gh`
 * (fixtures/gh) is first on PATH and logs its argv; `origin` is a local bare
 * repo, so the push is real but offline.
 */
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const fixture = join(import.meta.dir, "fixtures/gh");
const dirs: string[] = [];
function scratch(): string { const value = mkdtempSync(join(tmpdir(), "tk-pr-")); dirs.push(value); return value; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

const HERMETIC_ENV = { TK_SESSION: "", TK_HARNESS: "", TK_GH: "", PI_SESSION_ID: "", CODEX_THREAD_ID: "", CURSOR_AGENT: "", CURSOR_CONVERSATION_ID: "", GH_TOKEN: "", GITHUB_TOKEN: "" } as const;
const URL = "https://github.com/acme/app/pull/7";

interface Env { readonly repo: string; readonly worktree: string; readonly id: string; readonly branch: string; readonly origin: string; readonly ghDir: string; readonly log: string; readonly env: Record<string, string> }

function git(directory: string, ...args: readonly string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
  return new TextDecoder().decode(result.stdout);
}
const commit = (directory: string, message: string, ...paths: readonly string[]) => {
  git(directory, "add", ...paths);
  git(directory, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", message);
};

function run(e: Env, args: readonly string[], extra: Readonly<Record<string, string>> = {}): { readonly stdout: string; readonly stderr: string; readonly status: number } {
  const result = Bun.spawnSync([process.execPath, executable, "-C", e.repo, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...HERMETIC_ENV, ...e.env, ...extra } });
  return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode };
}
function json<T>(e: Env, args: readonly string[], extra: Readonly<Record<string, string>> = {}): T {
  const result = run(e, [...args, "--json"], extra);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as T;
}
const ghLog = (e: Env): string[] => (existsSync(e.log) ? readFileSync(e.log, "utf8").split("\n").filter((line) => line !== "") : []);

/** Repo with `main`, bare `origin`, a worked task with one commit, and the fake gh first on PATH. */
function setup(): Env {
  const root = realpathSync(scratch());
  const repo = join(root, "repo"); const origin = join(root, "origin.git"); const bin = join(root, "bin"); const ghDir = join(root, "gh-state");
  for (const dir of [repo, bin, ghDir]) mkdirSync(dir);
  git(root, "init", "-q", "--bare", origin);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "base.txt"), "base\n");
  commit(repo, "init", "base.txt");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "origin", "main");
  copyFileSync(fixture, join(bin, "gh")); chmodSync(join(bin, "gh"), 0o755);
  const log = join(root, "gh.log");
  const env = { PATH: `${bin}:${process.env["PATH"] ?? ""}`, FAKE_GH_DIR: ghDir, FAKE_GH_LOG: log };
  const partial = { repo, worktree: "", id: "", branch: "", origin, ghDir, log, env };
  json(partial, ["init", "--prefix", "tk"]);
  const issue = json<{ id: string }>(partial, ["create", "PR probe", "--description", "Adds a.\n\nSecond paragraph."]);
  const worked = json<{ path: string; branch: string }>(partial, ["work", issue.id]);
  writeFileSync(join(worked.path, "a.txt"), "a\n");
  commit(worked.path, "the work", "a.txt");
  return { ...partial, worktree: worked.path, id: issue.id, branch: worked.branch };
}

type PrJson = { id: string; op?: string; pr: { number: number; url: string; state: string } | null };
const metadataOf = (e: Env): Record<string, unknown> => (json<readonly { metadata: Record<string, unknown> }[]>(e, ["show", e.id])[0]!.metadata);

describe("tk pr create (tracer)", () => {
  it("pushes the branch, opens through gh, records {number,url,state} and restamps the report", () => {
    const e = setup();
    const out = json<PrJson>(e, ["pr", "create", e.id]);
    expect(out).toEqual({ id: e.id, op: "create", pr: { number: 7, url: URL, state: "open" } });
    expect(git(e.repo, "ls-remote", "origin", e.branch)).toContain(`refs/heads/${e.branch}`);
    const created = ghLog(e).filter((line) => line.startsWith("pr create"));
    expect(created).toHaveLength(1);
    expect(created[0]).toContain(`--head ${e.branch}`);
    expect(created[0]).toContain("--base main");
    expect(created[0]).toContain("--title=PR probe");
    expect(created[0]).toContain(`tk: ${e.id}`);
    expect(created[0]).not.toContain("diff --git");
    const metadata = metadataOf(e);
    expect(metadata["pr"]).toEqual(out.pr);
    expect((metadata["report"] as { changes: { commits: number } }).changes.commits).toBe(1);
  });

  it("human output names the PR", () => {
    const e = setup();
    const human = run(e, ["pr", "create", e.id], { NO_COLOR: "1" });
    expect(human.status, human.stderr).toBe(0);
    expect(human.stdout).toContain(`✓ PR #7 open for ${e.id} — ${URL}`);
  });
});

describe("tk pr create flags", () => {
  it("--title and --body override the defaults as single argv tokens", () => {
    const e = setup();
    json(e, ["pr", "create", e.id, "--title", "Custom title", "--body", "Custom body"]);
    const created = ghLog(e).find((line) => line.startsWith("pr create"));
    expect(created).toContain("--title=Custom title --body=Custom body");
  });
});

describe("tk pr — idempotent create, sync, mirror, failures", () => {
  it("a second create refreshes instead of duplicating", () => {
    const e = setup();
    json(e, ["pr", "create", e.id]);
    const again = json<PrJson>(e, ["pr", "create", e.id]);
    expect(again.op).toBe("refresh");
    expect(ghLog(e).filter((line) => line.startsWith("pr create"))).toHaveLength(1);
    expect(ghLog(e).some((line) => line.startsWith("pr view 7"))).toBe(true);
    expect(run(e, ["pr", "create", e.id], { NO_COLOR: "1" }).stdout).toContain("(already open)");
  });

  it("adopts an open PR already on GitHub for the branch", () => {
    const e = setup();
    writeFileSync(join(e.ghDir, "existing"), "");
    const adopted = json<PrJson>(e, ["pr", "create", e.id]);
    expect(adopted).toEqual({ id: e.id, op: "adopt", pr: { number: 7, url: URL, state: "open" } });
    expect(ghLog(e).some((line) => line.startsWith("pr create"))).toBe(false);
    expect(metadataOf(e)["pr"]).toEqual(adopted.pr);
  });

  it("tk pr <id> / tk pr show <id> read the local mirror with zero gh calls", () => {
    const e = setup();
    expect(json<PrJson>(e, ["pr", e.id])).toEqual({ id: e.id, pr: null });
    expect(run(e, ["pr", e.id], { NO_COLOR: "1" }).stdout).toContain(`no PR — run tk pr create ${e.id}`);
    json(e, ["pr", "create", e.id]);
    const before = ghLog(e).length;
    expect(json<PrJson>(e, ["pr", e.id])).toEqual({ id: e.id, pr: { number: 7, url: URL, state: "open" } });
    expect(json<PrJson>(e, ["pr", "show", e.id])).toEqual({ id: e.id, pr: { number: 7, url: URL, state: "open" } });
    expect(run(e, ["pr", e.id], { NO_COLOR: "1" }).stdout).toContain(`PR #7 · open · ${URL}`);
    expect(ghLog(e)).toHaveLength(before);
  });

  it("sync pulls the merged state once; create then refuses", () => {
    const e = setup();
    json(e, ["pr", "create", e.id]);
    writeFileSync(join(e.ghDir, "state"), "MERGED\n");
    const before = ghLog(e).length;
    const synced = json<PrJson>(e, ["pr", "sync", e.id]);
    expect(synced).toEqual({ id: e.id, op: "sync", pr: { number: 7, url: URL, state: "merged" } });
    expect(ghLog(e).slice(before)).toEqual(["pr view 7 --json number,url,state"]);
    expect((metadataOf(e)["pr"] as { state: string }).state).toBe("merged");
    expect(run(e, ["pr", "sync", e.id], { NO_COLOR: "1" }).stdout).toContain(`✓ PR #7 synced for ${e.id} — merged`);
    const refused = run(e, ["pr", "create", e.id]);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("already has PR #7 (merged)");
  });

  it("sync without a PR fails with the create hint", () => {
    const e = setup();
    const result = run(e, ["pr", "sync", e.id]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`no PR on ${e.id} — run tk pr create ${e.id}`);
    expect(ghLog(e)).toHaveLength(0);
  });

  it("gh auth failure and a missing gh are clear and write nothing", () => {
    const e = setup();
    json(e, ["pr", "create", e.id]);
    const before = metadataOf(e)["pr"];
    const auth = run(e, ["pr", "sync", e.id], { FAKE_GH_FAIL: "1" });
    expect(auth.status).not.toBe(0);
    expect(auth.stderr).toContain("gh pr view failed: gh: authentication required");
    expect(metadataOf(e)["pr"]).toEqual(before);
    const missing = run(e, ["pr", "sync", e.id], { TK_GH: "/nonexistent/gh" });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("gh not found");
    expect(metadataOf(e)["pr"]).toEqual(before);
  });

  it("create on an unworked task and an unknown subcommand fail clearly", () => {
    const e = setup();
    const fresh = json<{ id: string }>(e, ["create", "never worked"]);
    const unworked = run(e, ["pr", "create", fresh.id]);
    expect(unworked.status).not.toBe(0);
    expect(unworked.stderr).toContain(`tk pr create needs a worked task — run tk work ${fresh.id} first`);
    const unknown = run(e, ["pr", "bogus", e.id]);
    expect(unknown.status).not.toBe(0);
    expect(unknown.stderr).toContain("unknown pr subcommand: bogus");
    expect(ghLog(e)).toHaveLength(0);
  });

  it("a failed push aborts before any gh call", () => {
    const e = setup();
    git(e.repo, "remote", "set-url", "origin", join(e.repo, "no-such-remote.git"));
    const result = run(e, ["pr", "create", e.id]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("git push failed:");
    expect(ghLog(e)).toHaveLength(0);
    expect(metadataOf(e)["pr"]).toBeUndefined();
  });
});

describe("tk pr merge / close (11-03)", () => {
  const statusOf = (e: Env): string => json<readonly { status: string }[]>(e, ["show", e.id])[0]!.status;

  it("merge runs `gh pr merge 7 --merge`, records merged, keeps branch, worktree and task status", () => {
    const e = setup();
    json(e, ["pr", "create", e.id]);
    const status = statusOf(e);
    const before = ghLog(e).length;
    const out = json<PrJson>(e, ["pr", "merge", e.id]);
    expect(out).toEqual({ id: e.id, op: "merge", pr: { number: 7, url: URL, state: "merged" } });
    const calls = ghLog(e).slice(before);
    expect(calls).toEqual(["pr view 7 --json number,url,state", "pr merge 7 --merge", "pr view 7 --json number,url,state"]);
    expect(calls.join("\n")).not.toContain("--delete-branch");
    expect(calls.join("\n")).not.toContain("--admin");
    expect(git(e.repo, "ls-remote", "origin", e.branch)).toContain(`refs/heads/${e.branch}`);
    expect(existsSync(e.worktree)).toBe(true);
    expect(statusOf(e)).toBe(status);
    expect((metadataOf(e)["pr"] as { state: string }).state).toBe("merged");
  });

  it("merge human output points at tk close; an already-merged PR is a no-op that syncs once", () => {
    const e = setup();
    json(e, ["pr", "create", e.id]);
    const human = run(e, ["pr", "merge", e.id], { NO_COLOR: "1" });
    expect(human.status, human.stderr).toBe(0);
    expect(human.stdout).toContain(`✓ PR #7 merged for ${e.id} — next: tk close ${e.id}`);
    const before = ghLog(e).length;
    const again = json<PrJson>(e, ["pr", "merge", e.id]);
    expect(again).toEqual({ id: e.id, op: "merge", pr: { number: 7, url: URL, state: "merged" } });
    expect(ghLog(e).slice(before)).toEqual(["pr view 7 --json number,url,state"]);
  });

  it("--squash picks the method; more than one method fails before gh", () => {
    const e = setup();
    json(e, ["pr", "create", e.id]);
    const before = ghLog(e).length;
    const both = run(e, ["pr", "merge", e.id, "--squash", "--rebase"]);
    expect(both.status).not.toBe(0);
    expect(both.stderr).toContain("pick one of --merge, --squash, --rebase");
    expect(ghLog(e)).toHaveLength(before);
    json(e, ["pr", "merge", e.id, "--squash"]);
    expect(ghLog(e).filter((line) => line.startsWith("pr merge"))).toEqual(["pr merge 7 --squash"]);
  });

  it("close runs `gh pr close 7`, records closed and keeps the branch", () => {
    const e = setup();
    json(e, ["pr", "create", e.id]);
    const out = json<PrJson>(e, ["pr", "close", e.id]);
    expect(out).toEqual({ id: e.id, op: "close", pr: { number: 7, url: URL, state: "closed" } });
    expect(ghLog(e)).toContain("pr close 7");
    expect(ghLog(e).join("\n")).not.toContain("--delete-branch");
    expect(git(e.repo, "ls-remote", "origin", e.branch)).toContain(`refs/heads/${e.branch}`);
    expect(existsSync(e.worktree)).toBe(true);
    const human = run(e, ["pr", "close", e.id], { NO_COLOR: "1" });
    expect(human.stdout).toContain(`✓ PR #7 closed for ${e.id} (branch kept)`);
    expect(ghLog(e).filter((line) => line.startsWith("pr close"))).toHaveLength(1);
  });

  it("close/merge without a PR fail with the create hint and no gh call", () => {
    const e = setup();
    for (const sub of ["close", "merge"]) {
      const result = run(e, ["pr", sub, e.id]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`no PR on ${e.id} — run tk pr create ${e.id}`);
    }
    expect(ghLog(e)).toHaveLength(0);
  });
});

describe("tk pr on the event wire (11-04: task.pr / task.report)", () => {
  interface Line { readonly seq: number; readonly task?: string; readonly type: string; readonly data: Record<string, unknown> }
  const parse = (text: string): Line[] => text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Line);
  const logOf = (e: Env): Line[] => parse(readFileSync(join(e.repo, ".tasks", "events.jsonl"), "utf8"));
  const noPrUpdate = (e: Env) => {
    for (const line of logOf(e)) {
      if (line.type !== "task.update") continue;
      const fields = (line.data["fields"] as string[] | undefined) ?? [];
      expect(fields).not.toContain("metadata.pr");
      expect(fields).not.toContain("metadata.report");
    }
  };

  it("create appends one task.pr (op create) and one task.report; merge appends task.pr op state; tk watch --drain lists them", () => {
    const e = setup();
    const start = logOf(e).length;
    json(e, ["pr", "create", e.id]);
    const created = logOf(e).slice(start).filter((line) => line.task === e.id);
    const prs = created.filter((line) => line.type === "task.pr");
    expect(prs).toHaveLength(1);
    expect(prs[0]!.data).toEqual({ op: "create", number: 7, url: URL, state: "open", head: e.branch });
    const reports = created.filter((line) => line.type === "task.report");
    expect(reports).toHaveLength(1);
    expect((reports[0]!.data["changes"] as { commits: number }).commits).toBe(1);
    expect(JSON.stringify(reports[0]!.data)).not.toContain("diff --git");
    // pr precedes report within one save.
    expect(created.map((line) => line.type).filter((type) => type === "task.pr" || type === "task.report")).toEqual(["task.pr", "task.report"]);

    const mid = logOf(e).length;
    json(e, ["pr", "merge", e.id]);
    const merged = logOf(e).slice(mid).filter((line) => line.type === "task.pr");
    expect(merged).toHaveLength(1);
    expect(merged[0]!.data).toMatchObject({ op: "state", number: 7, state: "merged" });

    const drained = parse(run(e, ["watch", e.id, "--drain", "--from", "0", "--as", "t1", "--json"]).stdout);
    expect(drained.filter((line) => line.type === "task.pr").map((line) => line.data["op"])).toEqual(["create", "state"]);
    expect(drained.some((line) => line.type === "task.report")).toBe(true);
    const human = run(e, ["watch", e.id, "--drain", "--from", "0", "--as", "t1h"], { NO_COLOR: "1" }).stdout;
    expect(human).toContain("task.pr #7 create open");
    expect(human).toContain("task.report 1 commits +1 −0 1 files");
    noPrUpdate(e);
  });

  it("tk watch --until type=task.pr returns once another process syncs a state change", async () => {
    const e = setup();
    json(e, ["pr", "create", e.id]);
    run(e, ["watch", "--drain", "--as", "t2"]); // the subscriber has seen the create; only new lines count
    const child = Bun.spawn([process.execPath, executable, "-C", e.repo, "watch", e.id, "--until", "type=task.pr", "--timeout", "5s", "--as", "t2", "--json"], {
      stdout: "pipe", stderr: "pipe", env: { ...process.env, ...HERMETIC_ENV, ...e.env },
    });
    await Bun.sleep(400);
    writeFileSync(join(e.ghDir, "state"), "CLOSED\n");
    json(e, ["pr", "sync", e.id]);
    const code = await child.exited;
    const out = parse(await new Response(child.stdout).text());
    expect(code, await new Response(child.stderr).text()).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "task.pr", task: e.id, data: { op: "close", state: "closed" } });
    noPrUpdate(e);
  }, 15_000);
});
