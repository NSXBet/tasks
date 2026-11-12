import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const executable = join(import.meta.dir, "../src/tk.ts");
const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-events-")); workspaces.push(value); return value; }
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

/** Explicit child env: never inherit the parent's session or event knobs. */
function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== "TK_SESSION" && key !== "PI_SESSION_ID" && key !== "TK_EVENTS") env[key] = value;
  return { ...env, USER: "events-tester", ...extra };
}
function run(directory: string, args: readonly string[], extra: Record<string, string> = {}): { readonly stdout: string; readonly stderr: string; readonly status: number } {
  const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdout: "pipe", stderr: "pipe", env: cleanEnv(extra) });
  return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode };
}
function ok(directory: string, args: readonly string[], extra: Record<string, string> = {}): string { const result = run(directory, args, extra); expect(result.status, result.stderr).toBe(0); return result.stdout; }
interface Line { readonly seq: number; readonly host: string; readonly ts: string; readonly task?: string; readonly type: string; readonly actor: string; readonly session?: string; readonly data: Record<string, unknown> }
const logPath = (dir: string): string => join(dir, ".tasks", "events.jsonl");
function lines(dir: string): Line[] { return readFileSync(logPath(dir), "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Line); }

describe("tk writes append to .tasks/events.jsonl", () => {
  it("init alone leaves no log", () => {
    const dir = workspace();
    ok(dir, ["init"]);
    expect(existsSync(logPath(dir))).toBe(false);
  });

  it("update --status appends one task.status line with a gap-free seq", () => {
    const dir = workspace();
    ok(dir, ["init"]);
    const id = (JSON.parse(ok(dir, ["create", "A", "--json"])) as { id: string }).id;
    ok(dir, ["update", id, "--status", "in-progress"]);
    const all = lines(dir);
    const last = all[all.length - 1]!;
    expect(last).toMatchObject({ type: "task.status", task: id, actor: "events-tester", host: hostname(), data: { from: "open", to: "in-progress" } });
    expect(new Date(last.ts).toISOString()).toBe(last.ts);
    expect("session" in last).toBe(false);
    expect(all.map((line) => line.seq)).toEqual(all.map((_, index) => index + 1));
    expect(all[0]).toMatchObject({ type: "task.created", task: id });
  });

  it("TK_SESSION stamps session on the line", () => {
    const dir = workspace();
    ok(dir, ["init"]);
    const id = (JSON.parse(ok(dir, ["create", "A", "--json"])) as { id: string }).id;
    ok(dir, ["update", id, "--status", "in-progress"], { TK_SESSION: "s-1" });
    const last = lines(dir).at(-1)!;
    expect(last.session).toBe("s-1");
  });

  it("approvals and plain comments are on the wire; a failed command appends nothing", () => {
    const dir = workspace();
    ok(dir, ["init"]);
    const id = (JSON.parse(ok(dir, ["create", "A", "--json"])) as { id: string }).id;
    ok(dir, ["update", id, "--status", "approved"]);
    ok(dir, ["comment", id, "looks good"]);
    const before = lines(dir).length;
    expect(run(dir, ["update", id, "--priority", "9"]).status).not.toBe(0);
    expect(run(dir, ["update", "tk-nope", "--status", "open"]).status).not.toBe(0);
    const all = lines(dir);
    expect(all.length).toBe(before);
    expect(all.find((line) => line.type === "task.status")).toMatchObject({ data: { from: "open", to: "approved" } });
    expect(all.find((line) => line.type === "task.comment")).toMatchObject({ data: { kind: "note", author: "events-tester", body: "looks good" } });
  });
});
