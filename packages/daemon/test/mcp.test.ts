import net from "node:net";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mcpToolName, VERB_TABLE } from "@tasks/rpc";
import { daemonSocketPath, startDaemon } from "../src/index";
import { cleanStaleSocket } from "../src/socket";

const workspaces: string[] = [];
const workspace = async (): Promise<string> => {
  const root = mkdtempSync(join(tmpdir(), "tk-mcp-"));
  mkdirSync(join(root, ".beads"), { recursive: true });
  workspaces.push(root);
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "../../cli/src/tk.ts"), "-C", root, "init", "--json"], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  return root;
};
beforeEach(() => {
  process.env["TKD_SOCKET"] = join(tmpdir(), `tkd-mcp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
});
afterEach(async () => {
  await cleanStaleSocket(daemonSocketPath()).catch(() => {});
  delete process.env["TKD_SOCKET"];
  while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true });
});

/** Raw ndjson wire: send frames, await the frame answering a given id. */
const wire = async (path: string) => {
  const socket = net.connect(path);
  await new Promise<void>((resolve, reject) => socket.once("connect", resolve).once("error", reject));
  const frames: any[] = [];
  const waiters: Array<() => void> = [];
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (line.trim() !== "") frames.push(JSON.parse(line));
    }
    for (const wake of waiters.splice(0)) wake();
  });
  const request = async (frame: object, match: (f: any) => boolean): Promise<any> => {
    socket.write(`${JSON.stringify(frame)}\n`);
    const deadline = Date.now() + 5000;
    for (;;) {
      const hit = frames.find(match);
      if (hit !== undefined) return hit;
      if (Date.now() > deadline) throw new Error(`timeout waiting for reply; got ${JSON.stringify(frames)}`);
      await new Promise<void>((resolve) => { waiters.push(resolve); setTimeout(resolve, 50); });
    }
  };
  return {
    socket,
    frames,
    rpc: (frame: object & { id: string }) => request({ v: 2, ...frame }, (f) => f.id === frame.id && "ok" in f),
    mcp: (id: number, method: string, params: object = {}, modern = true) =>
      request(
        { jsonrpc: "2.0", id, method, params: modern ? { ...params, _meta: META } : params },
        (f) => f.jsonrpc === "2.0" && f.id === id,
      ),
    close: () => socket.destroy(),
  };
};
const META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };

describe("tkd MCP", () => {
  it("(a) bind then server/discover answers DiscoverResult", async () => {
    const root = await workspace();
    const handle = await startDaemon({ idleMs: 0 });
    const c = await wire(handle.socketPath);
    try {
      const bound = await c.rpc({ id: "b", method: "transport.bind", params: { root } });
      expect(bound.ok).toBe(true);
      const reply = await c.mcp(1, "server/discover");
      expect(reply.result.supportedVersions).toContain("2026-07-28");
      expect(reply.result.capabilities.tools).toBeDefined();
    } finally {
      c.close();
      await handle.stop();
    }
  });

  it("(b) tools/list: one sorted tool per verb with resultType, ttlMs, cacheScope", async () => {
    const root = await workspace();
    const handle = await startDaemon({ idleMs: 0 });
    const c = await wire(handle.socketPath);
    try {
      await c.rpc({ id: "b", method: "transport.bind", params: { root } });
      const reply = await c.mcp(2, "tools/list");
      const names = reply.result.tools.map((t: { name: string }) => t.name);
      expect(names).toEqual(Object.keys(VERB_TABLE).map(mcpToolName).sort());
      expect(reply.result.resultType).toBe("complete");
      expect(typeof reply.result.ttlMs).toBe("number");
      expect(reply.result.cacheScope).toBeDefined();
      const create = reply.result.tools.find((t: { name: string }) => t.name === "issue_create");
      expect(create.inputSchema.properties.root.type).toBe("string");
      expect(create.inputSchema.properties.title).toBeDefined();
      expect(create.description.length).toBeGreaterThan(0);
    } finally {
      c.close();
      await handle.stop();
    }
  });

  it("(c) tools/call issue_create is visible to a parallel RPC connection", async () => {
    const root = await workspace();
    const handle = await startDaemon({ idleMs: 0 });
    const c = await wire(handle.socketPath);
    const other = await wire(handle.socketPath);
    try {
      await c.rpc({ id: "b", method: "transport.bind", params: { root } });
      const reply = await c.mcp(3, "tools/call", { name: "issue_create", arguments: { title: "via mcp" } });
      expect(reply.result.resultType).toBe("complete");
      expect(reply.result.isError).toBe(false);
      const parsed = JSON.parse(reply.result.content[0].text);
      expect(reply.result.structuredContent).toEqual(parsed);
      expect(parsed.id).toMatch(/^tk-/);
      const got = await other.rpc({ id: "g", method: "issue.show", root, params: { id: parsed.id } });
      expect(got.ok).toBe(true);
      expect(got.value.title).toBe("via mcp");
    } finally {
      c.close();
      other.close();
      await handle.stop();
    }
  });

  it("per-call root argument works without bind", async () => {
    const root = await workspace();
    const handle = await startDaemon({ idleMs: 0 });
    const c = await wire(handle.socketPath);
    try {
      const reply = await c.mcp(4, "tools/call", { name: "issue_create", arguments: { title: "override", root } });
      expect(reply.result.isError).toBe(false);
    } finally {
      c.close();
      await handle.stop();
    }
  });

  it("(d) a legacy initialize connection gets InitializeResult and can call tools", async () => {
    const root = await workspace();
    const handle = await startDaemon({ idleMs: 0 });
    const c = await wire(handle.socketPath);
    try {
      await c.rpc({ id: "b", method: "transport.bind", params: { root } });
      const init = await c.mcp(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "legacy", version: "0" } }, false);
      expect(init.result.protocolVersion).toBe("2025-06-18");
      expect(init.result.serverInfo.name).toBe("tk");
      expect(init.result.capabilities.tools).toBeDefined();
      c.socket.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
      const reply = await c.mcp(2, "tools/call", { name: "issue_create", arguments: { title: "legacy" } }, false);
      expect(reply.result.isError).toBe(false);
      expect(JSON.parse(reply.result.content[0].text).id).toMatch(/^tk-/);
    } finally {
      c.close();
      await handle.stop();
    }
  });

  it("(e) no bind and no root argument yields isError root_invalid", async () => {
    await workspace();
    const handle = await startDaemon({ idleMs: 0 });
    const c = await wire(handle.socketPath);
    try {
      const reply = await c.mcp(5, "tools/call", { name: "issue_create", arguments: { title: "x" } });
      expect(reply.result.isError).toBe(true);
      expect(reply.result.content[0].text).toContain("root_invalid");
      expect(reply.error).toBeUndefined();
    } finally {
      c.close();
      await handle.stop();
    }
  });

  it("(f) RPC frames on another connection are unaffected and protocols do not mix", async () => {
    const root = await workspace();
    const handle = await startDaemon({ idleMs: 0 });
    const mcp = await wire(handle.socketPath);
    const rpc = await wire(handle.socketPath);
    try {
      await mcp.rpc({ id: "b", method: "transport.bind", params: { root } });
      await mcp.mcp(1, "tools/list");
      const hello = await rpc.rpc({ id: "h", method: "hello" });
      expect(hello.ok).toBe(true);
      const created = await rpc.rpc({ id: "c", method: "issue.create", root, params: { title: "rpc" } });
      expect(created.ok).toBe(true);
      // An RPC frame sent after the connection chose MCP is ignored.
      mcp.socket.write(`${JSON.stringify({ v: 2, id: "late", method: "hello" })}\n`);
      const after = await mcp.mcp(6, "tools/list");
      expect(after.result.tools.length).toBeGreaterThan(0);
      expect(mcp.frames.some((f) => f.id === "late")).toBe(false);
    } finally {
      mcp.close();
      rpc.close();
      await handle.stop();
    }
  });
});
