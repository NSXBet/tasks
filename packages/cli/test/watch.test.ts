import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `tk watch` spec modes (--until / --drain / --follow) over .tasks/events.jsonl.
 * Integration exception: these tests drive real spawned tk processes whose
 * waits run on the OS clock and fs.watch, so no fake timer applies. Every
 * test gets its own workspace and an explicit env without the agent's
 * TK_SESSION/PI_SESSION_ID/TK_EVENTS (the default subscriber derives from
 * TK_SESSION); leftover children are killed in afterEach.
 */
const executable = join(import.meta.dir, "../src/tk.ts");
const workspaces: string[] = [];
const children: Bun.Subprocess[] = [];
function workspace(): string { const value = realpathSync(mkdtempSync(join(tmpdir(), "tk-watch-"))); workspaces.push(value); return value; }
afterEach(() => {
  while (children.length) { const child = children.pop()!; try { child.kill("SIGKILL"); } catch { /* gone */ } }
  while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true });
});

function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== "TK_SESSION" && key !== "PI_SESSION_ID" && key !== "TK_EVENTS" && key !== "TK_HARNESS") env[key] = value;
  return { ...env, USER: "watch-tester", ...extra };
}
interface Ran { readonly stdout: string; readonly stderr: string; readonly status: number }
function run(directory: string, args: readonly string[], extra: Record<string, string> = {}): Ran {
  const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdout: "pipe", stderr: "pipe", env: cleanEnv(extra) });
  return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode };
}
function ok(directory: string, args: readonly string[], extra: Record<string, string> = {}): string { const result = run(directory, args, extra); expect(result.status, result.stderr).toBe(0); return result.stdout; }
const create = (directory: string, title: string): string => (JSON.parse(ok(directory, ["create", title, "--json"])) as { id: string }).id;

interface Line { readonly seq: number; readonly task?: string; readonly type: string; readonly data: Record<string, unknown> }
const parseLines = (text: string): Line[] => text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Line);
const logLines = (directory: string): Line[] => parseLines(readFileSync(join(directory, ".tasks", "events.jsonl"), "utf8"));
const cursorOf = (directory: string, name: string): number | undefined => {
  const file = JSON.parse(readFileSync(join(directory, ".tasks", "cursors.json"), "utf8")) as { subscribers: Record<string, Record<string, number>> };
  return file.subscribers[name]?.[hostname()];
};

/** A spawned watcher with stdout/stderr collected as they arrive. */
function spawnWatch(directory: string, args: readonly string[], extra: Record<string, string> = {}): { child: Bun.Subprocess<"pipe", "pipe", "pipe">; out: () => string; err: () => string; finished: Promise<number> } {
  const child = Bun.spawn([process.execPath, executable, "-C", directory, "watch", ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: cleanEnv(extra) });
  children.push(child);
  let stdout = ""; let stderr = "";
  const decoder = new TextDecoder();
  const pump = async (stream: ReadableStream<Uint8Array>, sink: (text: string) => void): Promise<void> => { for await (const chunk of stream) sink(decoder.decode(chunk, { stream: true })); };
  const outDone = pump(child.stdout, (text) => { stdout += text; });
  const errDone = pump(child.stderr, (text) => { stderr += text; });
  const finished = (async () => { const code = await child.exited; await Promise.all([outDone, errDone]); return code; })();
  return { child, out: () => stdout, err: () => stderr, finished };
}
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out: ${what}`)), ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}
async function until<T>(fn: () => T | undefined, ms: number, what: string): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) { const value = fn(); if (value !== undefined) return value; if (Date.now() > deadline) throw new Error(`timed out: ${what}`); await Bun.sleep(50); }
}

describe("tk watch --until (tracer)", () => {
  it("returns when another process approves, and stores the subscriber cursor", async () => {
    const dir = workspace();
    ok(dir, ["init"]);
    const id = create(dir, "T");
    ok(dir, ["update", id, "--status", "in-progress"]);
    const watcher = spawnWatch(dir, [id, "--until", "status=approved", "--timeout", "10s", "--json", "--as", "a1"]);
    await Bun.sleep(300);
    const started = Date.now();
    ok(dir, ["update", id, "--status", "approved"]);
    const code = await within(watcher.finished, 4000, "watcher exit");
    expect(code, watcher.err()).toBe(0);
    expect(Date.now() - started).toBeLessThan(2500);
    const out = parseLines(watcher.out());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "task.status", task: id, data: { to: "approved" } });
    expect(cursorOf(dir, "a1")).toBe(out[0]!.seq);
  }, 15_000);

  it("exits 124 with a message when nothing matches before the timeout", async () => {
    const dir = workspace();
    ok(dir, ["init"]);
    const id = create(dir, "T");
    ok(dir, ["update", id, "--status", "in-progress"]);
    const watcher = spawnWatch(dir, [id, "--until", "status=approved", "--timeout", "1s", "--json", "--as", "a1"]);
    const code = await within(watcher.finished, 5000, "timeout exit");
    expect(code).toBe(124);
    expect(watcher.err()).toContain("no matching event within");
    expect(watcher.out()).toBe("");
  }, 10_000);

  it("fails on an unknown task id and on an invalid query", () => {
    const dir = workspace();
    ok(dir, ["init"]);
    const missing = run(dir, ["watch", "tk-nope", "--until", "status=approved", "--timeout", "1s"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("issue not found: tk-nope");
    const invalid = run(dir, ["watch", "--until", "colour=red", "--timeout", "1s"]);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("invalid watch query");
    const both = run(dir, ["watch", "--until", "status=approved", "--drain"]);
    expect(both.status).toBe(1);
    expect(both.stderr).toContain("choose one of --until, --drain, --follow");
  });
});

describe("tk watch --drain", () => {
  it("drains from 0 for a fresh subscriber, then only the offline gap; --peek keeps the cursor", () => {
    const dir = workspace();
    ok(dir, ["init"]);
    const a = create(dir, "A");
    ok(dir, ["update", a, "--status", "in-progress"]);
    ok(dir, ["comment", a, "hello"]);
    const all = logLines(dir);
    expect(all.length).toBe(3);
    const first = parseLines(ok(dir, ["watch", "--drain", "--json", "--as", "d1"]));
    expect(first.map((line) => line.seq)).toEqual(all.map((line) => line.seq));
    expect(parseLines(ok(dir, ["watch", "--drain", "--json", "--as", "d1"]))).toEqual([]);
    ok(dir, ["update", a, "--status", "ready-to-review"]);
    ok(dir, ["update", a, "--title", "A2"]);
    const gap = parseLines(ok(dir, ["watch", "--drain", "--json", "--as", "d1", "--peek"]));
    expect(gap).toHaveLength(2);
    const again = parseLines(ok(dir, ["watch", "--drain", "--json", "--as", "d1"]));
    expect(again.map((line) => line.seq)).toEqual(gap.map((line) => line.seq));
    expect(cursorOf(dir, "d1")).toBe(logLines(dir).at(-1)!.seq);
    // Human output is one line per event.
    ok(dir, ["comment", a, "line\u001b[31m red"]);
    const human = ok(dir, ["watch", "--drain", "--as", "d1"]).trim().split("\n");
    expect(human).toHaveLength(1);
    expect(human[0]).toMatch(new RegExp(`^#\\d+ \\d\\d:\\d\\d:\\d\\d ${a} task\\.comment `));
    expect(human[0]).not.toContain("\u001b");
  });

  it("positional ids restrict the drain to those tasks", () => {
    const dir = workspace();
    ok(dir, ["init"]);
    const a = create(dir, "A"); const b = create(dir, "B"); const c = create(dir, "C");
    ok(dir, ["update", c, "--status", "in-progress"]);
    const lines = parseLines(ok(dir, ["watch", a, b, "--drain", "--json", "--as", "d2"]));
    expect(lines.length).toBe(2);
    expect(new Set(lines.map((line) => line.task))).toEqual(new Set([a, b]));
  });
});

describe("tk watch --follow", () => {
  it("two concurrent followers both see every event; SIGTERM ends each at exit 0 with its cursor at the last seq", async () => {
    const dir = workspace();
    ok(dir, ["init"]);
    const id = create(dir, "T");
    const f1 = spawnWatch(dir, ["--follow", "type=task.status", "--json", "--as", "f1"]);
    const f2 = spawnWatch(dir, ["--follow", "type=task.status", "--json", "--as", "f2"]);
    await Bun.sleep(600);
    for (const status of ["in-progress", "ready-to-review", "approved"]) ok(dir, ["update", id, "--status", status]);
    const expected = logLines(dir).filter((line) => line.type === "task.status").map((line) => line.seq);
    expect(expected).toHaveLength(3);
    for (const follower of [f1, f2]) {
      await until(() => (parseLines(follower.out()).length >= 3 ? true : undefined), 2500, "follower output");
      expect(parseLines(follower.out()).map((line) => line.seq)).toEqual(expected);
    }
    f1.child.kill("SIGTERM"); f2.child.kill("SIGTERM");
    expect(await within(f1.finished, 3000, "f1 exit")).toBe(0);
    expect(await within(f2.finished, 3000, "f2 exit")).toBe(0);
    expect(cursorOf(dir, "f1")).toBe(expected[2]);
    expect(cursorOf(dir, "f2")).toBe(expected[2]);
  }, 15_000);

  it("ends when the stdin pipe closes", async () => {
    const dir = workspace();
    ok(dir, ["init"]);
    const follower = spawnWatch(dir, ["--follow", "", "--as", "f3"]);
    await Bun.sleep(400);
    follower.child.stdin.end();
    expect(await within(follower.finished, 3000, "eof exit")).toBe(0);
  }, 10_000);
});

describe("tk watch pickup race (WIRE-03)", () => {
  it("--until status=… returns at once when the task is already in that status", async () => {
    const dir = workspace();
    ok(dir, ["init"]);
    const id = create(dir, "T");
    ok(dir, ["update", id, "--status", "approved"]);
    ok(dir, ["watch", "--drain", "--as", "p1"]);
    const started = Date.now();
    const result = run(dir, ["watch", id, "--until", "status=approved|rejected", "--timeout", "5s", "--json", "--as", "p1"]);
    expect(result.status, result.stderr).toBe(0);
    expect(Date.now() - started).toBeLessThan(4000);
    const [line] = parseLines(result.stdout);
    expect(line).toMatchObject({ type: "task.status", task: id, data: { to: "approved", current: true } });
  });

  it("a stale approval from an earlier round does not match once the task moved on", () => {
    const dir = workspace();
    ok(dir, ["init"]);
    const id = create(dir, "T");
    ok(dir, ["update", id, "--status", "approved"]);
    ok(dir, ["update", id, "--status", "in-progress"]);
    const result = run(dir, ["watch", id, "--until", "status=approved", "--timeout", "500ms", "--as", "fresh"]);
    expect(result.status).toBe(124);
  });

  it("tk finish seeds session:<sid>, so a comment before the first watch is picked up", () => {
    const repo = workspace();
    const git = (...args: string[]): void => { const result = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" }); if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr)); };
    git("init", "-q", "-b", "main");
    writeFileSync(join(repo, "base.txt"), "base\n");
    git("add", "."); git("commit", "-q", "-m", "init");
    ok(repo, ["init", "--prefix", "tk"]);
    const id = create(repo, "finish probe");
    const worked = JSON.parse(ok(repo, ["work", id, "--json"])) as { path: string };
    writeFileSync(join(worked.path, "a.txt"), "a\n");
    const gitIn = (cwd: string, ...args: string[]): void => { const result = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, stdout: "pipe", stderr: "pipe" }); if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr)); };
    gitIn(worked.path, "add", "a.txt"); gitIn(worked.path, "commit", "-q", "-m", "work");
    ok(repo, ["finish", id, "--session", "s9"]);
    const finishLine = logLines(repo).filter((line) => line.task === id && line.type === "task.status").at(-1)!;
    expect(finishLine.data["to"]).toBe("ready-to-review");
    expect(cursorOf(repo, "session:s9")).toBe(finishLine.seq);
    ok(repo, ["comment", id, "fix x"]);
    const result = run(repo, ["watch", id, "--until", "type=task.comment", "--timeout", "3s", "--json"], { TK_SESSION: "s9" });
    expect(result.status, result.stderr).toBe(0);
    const [line] = parseLines(result.stdout);
    expect(line).toMatchObject({ type: "task.comment", task: id, data: { body: "fix x" } });
  }, 20_000);
});

describe("tk watch frame mode (no mode flag)", () => {
  it("still emits a ready frame, then task.* event frames", async () => {
    const dir = workspace();
    ok(dir, ["init"]);
    const watcher = spawnWatch(dir, ["--interval", "250"]);
    const ready = await until(() => parseLines(watcher.out())[0], 5000, "ready frame") as unknown as { type: string };
    expect(ready.type).toBe("ready");
    const id = create(dir, "framed");
    const frame = await until(() => (parseLines(watcher.out()) as unknown as { type: string; event?: { kind: string; issueId?: string } }[]).find((entry) => entry.type === "event"), 5000, "event frame");
    expect(frame.event?.kind).toMatch(/^task\./);
    expect(frame.event?.issueId).toBe(id);
    watcher.child.stdin.end();
    expect(await within(watcher.finished, 3000, "frame exit")).toBe(0);
  }, 15_000);
});
