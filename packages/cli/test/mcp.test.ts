import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanStaleSocket, daemonSocketPath, probeDaemon } from "@tasks/daemon";

const executable = join(import.meta.dir, "../src/tk.ts");
const META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
const workspaces: string[] = [];

function workspace(): string {
  const value = realpathSync(mkdtempSync(join(tmpdir(), "tk-mcp-cli-")));
  workspaces.push(value);
  mkdirSync(value, { recursive: true });
  const init = Bun.spawnSync([process.execPath, executable, "-C", value, "init", "--json"], { stdout: "pipe", stderr: "pipe" });
  expect(init.exitCode, new TextDecoder().decode(init.stderr)).toBe(0);
  return value;
}

/** Spawns `tk mcp` and exposes line-oriented stdout. */
function spawnMcp(args: readonly string[], env: Record<string, string | undefined>) {
  const child = Bun.spawn([process.execPath, executable, ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const lines: string[] = [];
  const waiters: Array<() => void> = [];
  let rest = "";
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of child.stdout) {
      rest += decoder.decode(chunk);
      for (let i = rest.indexOf("\n"); i >= 0; i = rest.indexOf("\n")) {
        const line = rest.slice(0, i);
        rest = rest.slice(i + 1);
        if (line !== "") lines.push(line);
      }
      for (const wake of waiters.splice(0)) wake();
    }
    for (const wake of waiters.splice(0)) wake();
  })();
  const send = (message: object): void => { child.stdin.write(`${JSON.stringify(message)}\n`); child.stdin.flush(); };
  const next = async (): Promise<any> => {
    const deadline = Date.now() + 15_000;
    while (lines.length === 0) {
      if (Date.now() > deadline) throw new Error("timed out waiting for an MCP line");
      await new Promise<void>((resolve) => { waiters.push(resolve); setTimeout(resolve, 100); });
    }
    return JSON.parse(lines.shift()!);
  };
  return { child, send, next };
}

beforeEach(() => {
  process.env["TKD_SOCKET"] = join(tmpdir(), `tkd-cli-mcp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
});
afterEach(async () => {
  const status = await probeDaemon().catch(() => null);
  if (status !== null) process.kill(status.pid, "SIGTERM");
  await cleanStaleSocket(daemonSocketPath()).catch(() => {});
  delete process.env["TKD_SOCKET"];
  while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true });
});

const exited = async (child: { exited: Promise<number> }, ms: number): Promise<number | "timeout"> =>
  Promise.race([child.exited, Bun.sleep(ms).then(() => "timeout" as const)]);

describe("tk mcp", () => {
  it("bridges discover, tools/list and tools/call, spawns the daemon, and exits 0 on stdin EOF", async () => {
    const root = workspace();
    const mcp = spawnMcp(["mcp"], { CLAUDE_PROJECT_DIR: root });
    mcp.send({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: META } });
    mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: META } });
    mcp.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "issue_create", arguments: { title: "via tk mcp" }, _meta: META } });
    const discover = await mcp.next();
    expect(discover.id).toBe(1);
    expect(discover.result.supportedVersions).toContain("2026-07-28");
    const list = await mcp.next();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain("issue_create");
    const call = await mcp.next();
    expect(call.result.isError).toBe(false);
    const created = JSON.parse(call.result.content[0].text) as { id: string };

    const shown = Bun.spawnSync([process.execPath, executable, "-C", root, "show", created.id, "--json"], { stdout: "pipe", stderr: "pipe" });
    expect(shown.exitCode, new TextDecoder().decode(shown.stderr)).toBe(0);
    expect((JSON.parse(new TextDecoder().decode(shown.stdout)) as Array<{ title: string }>)[0]?.title).toBe("via tk mcp");
    expect(await probeDaemon()).not.toBeNull();

    mcp.child.stdin.end();
    expect(await exited(mcp.child, 2000)).toBe(0);
  }, 30_000);

  it("serves a legacy initialize over the bridge, with --root taking precedence", async () => {
    const root = workspace();
    const mcp = spawnMcp(["mcp", "--root", root], { CLAUDE_PROJECT_DIR: "/nonexistent-tk-mcp-dir" });
    mcp.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "legacy", version: "0" } } });
    const init = await mcp.next();
    expect(init.id).toBe(1);
    expect(init.result.serverInfo).toBeDefined();
    mcp.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "issue_create", arguments: { title: "legacy via bridge" } } });
    const call = await mcp.next();
    expect(call.result.isError).toBe(false);
    mcp.child.stdin.end();
    expect(await exited(mcp.child, 2000)).toBe(0);
  }, 30_000);

  it("fails with a clear stderr message when no workspace resolves", async () => {
    const bare = realpathSync(mkdtempSync(join(tmpdir(), "tk-mcp-bare-")));
    workspaces.push(bare);
    const result = Bun.spawnSync([process.execPath, executable, "mcp"], { cwd: bare, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, CLAUDE_PROJECT_DIR: "" } });
    expect(result.exitCode).toBe(1);
    expect(new TextDecoder().decode(result.stdout)).toBe("");
    expect(new TextDecoder().decode(result.stderr)).toContain("tk mcp: no tasks workspace");
  });

  it("is listed in help", () => {
    const result = Bun.spawnSync([process.execPath, executable, "mcp", "--help"], { stdout: "pipe", stderr: "pipe" });
    expect(new TextDecoder().decode(result.stdout)).toContain("mcp [--root <path>]");
  });
});
