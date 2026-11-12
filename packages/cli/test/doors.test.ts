import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerRuntime, WEB_RUNTIME_ID } from "@tasks/surface";

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const dirs: string[] = [];
function scratch(): string { const value = mkdtempSync(join(tmpdir(), "tk-doors-")); dirs.push(value); return value; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

function run(directory: string, args: readonly string[]): { readonly stdout: string; readonly stderr: string; readonly status: number } {
  const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
  return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode };
}
function json<T>(directory: string, args: readonly string[]): T {
  const result = run(directory, [...args, "--json"]);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as T;
}
function human(directory: string, args: readonly string[]): string {
  const result = run(directory, args);
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

/** Workspace with a parent, a child (--parent) blocked by a separate blocker, and an agent-assigned issue. */
function seeded(): { repo: string; parent: string; child: string; blocker: string; agent: string } {
  const repo = realpathSync(scratch());
  json(repo, ["init", "--prefix", "tk"]);
  const parent = json<{ id: string }>(repo, ["create", "doors parent"]).id;
  const child = json<{ id: string }>(repo, ["create", "doors child", "--parent", parent]).id;
  const blocker = json<{ id: string }>(repo, ["create", "doors blocker"]).id;
  json(repo, ["dep", "add", child, blocker]);
  const agent = json<{ id: string }>(repo, ["agent", "create", "Doorman"]).id;
  json(repo, ["create", "doors assigned", "--assignee", agent]);
  return { repo, parent, child, blocker, agent };
}

describe("review doors footer on list-family commands (D-02)", () => {
  it("prints the registered web base and tk review on every listing", async () => {
    const { repo, parent, agent } = seeded();
    await registerRuntime(join(repo, ".tasks"), { id: WEB_RUNTIME_ID, kind: "web", pid: process.pid, port: 5999, url: "http://127.0.0.1:5999", workspace: repo, startedAt: new Date().toISOString() });
    const commands: readonly (readonly string[])[] = [
      ["list"], ["ready"], ["query", "status=open"], ["children", parent], ["search", "doors"], ["blocked"], ["stale", "--days", "0"], ["agent", "issues", agent],
    ];
    for (const args of commands) {
      const output = human(repo, args);
      expect(output, args.join(" ")).toContain("http://127.0.0.1:5999/tasks/<id>");
      expect(output, args.join(" ")).toContain("tk review <id>");
      expect(output, args.join(" ")).not.toContain("localhost:21579");
    }
  });

  it("falls back to the default web base with no registered web runtime", () => {
    const { repo } = seeded();
    expect(human(repo, ["list"])).toContain("http://localhost:21579/tasks/<id>");
  });

  it("keeps --json free of the doors footer", async () => {
    const { repo } = seeded();
    const result = run(repo, ["search", "doors", "--json"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("tk review <id>");
  });
});
