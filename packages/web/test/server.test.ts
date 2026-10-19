import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@tasks/rpc";
import { readRuntimeRegistry } from "@tasks/surface";
import { PortBusyError, createEventRing, startWebServer } from "../src/server";

const workspaces: string[] = [];
function workspace(): string {
  const value = mkdtempSync(join(tmpdir(), "tk-web-"));
  mkdirSync(join(value, ".beads"), { recursive: true });
  workspaces.push(value);
  return value;
}
const init = async (root: string): Promise<void> => {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "../../cli/src/tk.ts"), "-C", root, "init", "--json"], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
};
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

describe("tk web server", () => {
  it("invokes onStopped when the HTTP /api/stop route tears the server down", async () => {
    const root = workspace();
    await init(root);
    let stopped = 0;
    const server = await startWebServer({ root, port: 0, onStopped: () => { stopped++; } });
    try {
      expect(stopped).toBe(0);
      const ack = await fetch(`${server.url}/api/stop`, { method: "POST" });
      expect(ack.status).toBe(200);
      // The route acks first and tears down on a timer — poll for the hook, then
      // verify the listening socket is actually gone.
      const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
      for (let i = 0; i < 50 && stopped === 0; i++) await delay(20);
      expect(stopped).toBe(1);
      await expect(fetch(`${server.url}/api/board`)).rejects.toThrow();
    } finally {
      await server.close(); // idempotent after a route-driven stop
    }
  });

  it("serves the shell and board API over a fresh workspace", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      const shell = await fetch(`${server.url}/`);
      expect(shell.status).toBe(200);
      expect(shell.headers.get("content-type")).toContain("text/html");
      const body = new TextDecoder().decode(await shell.arrayBuffer());
      expect(body).toContain("<!doctype html");

      const board = await fetch(`${server.url}/api/board`);
      expect(board.status).toBe(200);
      const page = (await board.json()) as { readonly issues: readonly { readonly id: string }[]; readonly actor: string };
      expect(Array.isArray(page.issues)).toBe(true);
      expect(page.actor).toBe(process.env["USER"]);
    } finally {
      await server.close();
    }
  });

  it("serves the review island in the shell and as a bundle", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      const shell = await fetch(`${server.url}/`);
      expect(shell.status).toBe(200);
      const body = new TextDecoder().decode(await shell.arrayBuffer());
      expect(body).toContain('id="reviewView"');
      expect(body).toContain("/assets/review-island.js");
      expect(body).not.toContain("tk-142");

      const bundle = await fetch(`${server.url}/assets/review-island.js`);
      expect(bundle.status).toBe(200);
      expect(bundle.headers.get("content-type")).toContain("text/javascript");
      const js = new TextDecoder().decode(await bundle.arrayBuffer());
      expect(js).toContain("ReviewIsland");
    } finally {
      await server.close();
    }
  });

  it("creates an issue through the API and reads it back on the board", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      const created = await fetch(`${server.url}/api/issue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "web-created", priority: 1 }) });
      expect(created.status).toBe(200);
      const { id } = (await created.json()) as { readonly id: string };
      expect(id).toBeTruthy();

      const board = await fetch(`${server.url}/api/board`);
      const page = (await board.json()) as { readonly issues: readonly { readonly id: string; readonly title: string }[] };
      const match = page.issues.find((issue) => issue.id === id);
      expect(match?.title).toBe("web-created");
    } finally {
      await server.close();
    }
  });

  it("updates status and title on an existing issue through the mutation route", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      const created = await fetch(`${server.url}/api/issue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "mutable" }) });
      const { id } = (await created.json()) as { readonly id: string };

      const updated = await fetch(`${server.url}/api/issue/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "closed", title: "renamed" }) });
      expect(updated.status).toBe(200);

      const board = await fetch(`${server.url}/api/board`);
      const page = (await board.json()) as { readonly issues: readonly { readonly id: string; readonly title: string; readonly status: string }[] };
      const match = page.issues.find((issue) => issue.id === id);
      expect(match?.title).toBe("renamed");
      expect(match?.status).toBe("closed");
    } finally {
      await server.close();
    }
  });

  it("answers 404 JSON for unknown routes", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      const missing = await fetch(`${server.url}/api/nope`);
      expect(missing.status).toBe(404);
      const error = (await missing.json()) as { readonly error: { readonly kind: string } };
      expect(error.error.kind).toBe("not_found");
    } finally {
      await server.close();
    }
  });

  it("refuses the port another tk web server already serves", async () => {
    const root = workspace();
    await init(root);
    const first = await startWebServer({ root, port: 0 });
    try {
      const busyPort = Number(new URL(first.url).port);
      await expect(startWebServer({ root, port: busyPort })).rejects.toThrow(PortBusyError);
    } finally {
      await first.close();
    }
  });

  it("refuses a port squatted by a foreign process instead of binding invisibly", async () => {
    const root = workspace();
    await init(root);
    const squatter = Bun.serve({ port: 0, fetch: () => new Response("not tk") });
    try {
      await expect(startWebServer({ root, port: squatter.port })).rejects.toThrow(PortBusyError);
    } finally {
      squatter.stop(true);
    }
  });

  it("serves POST /api/rpc with the server-injected root", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      const rpc = async (body: unknown): Promise<{ status: number; body: unknown }> => {
        const response = await fetch(`${server.url}/api/rpc`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      };
      const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

      // tk wire envelope: { v, id?, ok, value } | { v, id?, ok:false, error: { kind, message } }.
      const ok = await rpc({ v: PROTOCOL_VERSION, id: "c1", method: "issue.list", params: {} });
      expect(ok.status).toBe(200);
      expect(isObject(ok.body) && ok.body["v"]).toBe(PROTOCOL_VERSION);
      expect(isObject(ok.body) && ok.body["id"]).toBe("c1"); // correlation id echoed
      expect(isObject(ok.body) && ok.body["ok"]).toBe(true);
      // Verb handlers unwrap the surface Result, so value is the issue array itself.
      expect(isObject(ok.body) && Array.isArray(ok.body["value"])).toBe(true);
      const noId = await rpc({ v: PROTOCOL_VERSION, method: "issue.list" });
      expect(isObject(noId.body) && "id" in noId.body).toBe(false);

      expect((await rpc({ v: PROTOCOL_VERSION })).status).toBe(400); // method missing
      expect((await rpc({ method: "issue.list" })).status).toBe(400); // v missing
      expect((await rpc({ v: PROTOCOL_VERSION, method: "issue.list", root: "/elsewhere" })).status).toBe(400); // root injected server-side
      const unknownVerb = await rpc({ v: PROTOCOL_VERSION, method: "issue.undef" });
      expect(unknownVerb.status).toBe(400);
      const unknownVerbError = isObject(unknownVerb.body) ? unknownVerb.body["error"] : undefined;
      expect(isObject(unknownVerbError) && unknownVerbError["kind"]).toBe("method_unknown");
      const badJson = await fetch(`${server.url}/api/rpc`, { method: "POST", body: "{nope" });
      expect(badJson.status).toBe(400);
      const oversized = await fetch(`${server.url}/api/rpc`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ v: PROTOCOL_VERSION, method: "issue.list", params: { pad: "x".repeat(1_048_600) } }),
      });
      expect(oversized.status).toBe(413);
    } finally {
      await server.close();
    }
  });

  it("streams watch events through GET /api/events with a cumulative dropped counter", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      // Mutate through the RPC path itself; the watch loop picks the diff up.
      const created = await fetch(`${server.url}/api/rpc`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ v: PROTOCOL_VERSION, method: "issue.create", params: { title: "ring test" } }),
      });
      expect(created.status).toBe(200);

      // Poll against the real watch loop (async fs diffing) — fake timers can't
      // drive chokidar/the store here, so a bounded poll is the honest wait.
      const delay = (ms: number): Promise<void> => { const p = Promise.withResolvers<void>(); setTimeout(p.resolve, ms); return p.promise; };
      const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
      const eventsPage = async (query: string): Promise<{ events: { seq: number; kind: string }[]; dropped: number }> => {
        const body = await (await fetch(`${server.url}/api/events?${query}`)).json();
        expect(isObject(body)).toBe(true);
        const page = body as { events?: unknown; dropped?: unknown };
        expect(Array.isArray(page.events)).toBe(true);
        expect(typeof page.dropped).toBe("number");
        const events = (page.events as { seq?: unknown; kind?: unknown }[]).map((event) => ({
          seq: typeof event.seq === "number" ? event.seq : -1,
          kind: typeof event.kind === "string" ? event.kind : "",
        }));
        return { events, dropped: page.dropped ?? -1 };
      };

      let events: { seq: number; kind: string }[] = [];
      for (let i = 0; i < 100 && events.length === 0; i++) {
        await delay(50);
        events = (await eventsPage("after=0")).events;
      }
      expect(events.length).toBeGreaterThan(0);
      const seqs = events.map((e) => e.seq);
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs); // host-level monotonic

      // after= skips everything already delivered.
      expect((await eventsPage(`after=${Math.max(...seqs)}`)).events).toEqual([]);

      // kinds filter: only issue.created frames come back.
      const createdOnly = await eventsPage("after=0&kinds=issue.created");
      expect(createdOnly.events.length).toBeGreaterThan(0);
      for (const event of createdOnly.events) expect(event.kind).toBe("issue.created");

      const withCounter = await eventsPage("after=0");
      expect(withCounter.dropped).toBeGreaterThanOrEqual(0);
    } finally {
      await server.close();
    }
  });

  it("drops the oldest events past capacity and counts them in dropped", () => {
    const at = new Date().toISOString();
    const ring = createEventRing({ capacity: 3, ttlMs: 60_000 });
    for (let i = 1; i <= 5; i++) ring.push({ seq: 0, kind: "issue.created", at, issue: { id: `tk-${i}` } });
    const page = ring.query(0);
    expect(page.events.map((e) => e.seq)).toEqual([3, 4, 5]);
    expect(ring.droppedCount()).toBe(2);
    expect(page.dropped).toBe(2);
  });

  it("repoints the live server at another workspace via POST /api/open", async () => {
    const first = workspace();
    await init(first);
    const second = workspace();
    await init(second);
    const server = await startWebServer({ root: first, port: 0 });
    try {
      const status = (await (await fetch(`${server.url}/api/status`)).json()) as { readonly workspace: string; readonly workspaces: readonly string[] };
      expect(status.workspace).toBe(first);
      expect(status.workspaces).toEqual([first]);

      const opened = await fetch(`${server.url}/api/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: second }) });
      expect(opened.status).toBe(200);
      const ack = (await opened.json()) as { readonly ok: boolean; readonly workspace: string; readonly workspaces: readonly string[] };
      expect(ack.ok).toBe(true);
      expect(ack.workspace).toBe(second);
      // The known list now remembers both; the served workspace flipped.
      expect(ack.workspaces).toContain(first);
      expect(ack.workspaces).toContain(second);

      expect(((await fetch(`${server.url}/api/status`)).json() as Promise<{ readonly workspace: string }>)).resolves.toMatchObject({ workspace: second });

      const rejected = await fetch(`${server.url}/api/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "/definitely/not/a/workspace" }) });
      expect(rejected.status).toBe(400);
      const error = (await rejected.json()) as { readonly error: { readonly message: string } };
      expect(error.error.message).toBeTruthy();

      // A subdirectory of a workspace resolves to its enclosing root (CLI-identical discovery).
      const sub = mkdirSync(join(second, "sub"), { recursive: true });
      const viaSub = await fetch(`${server.url}/api/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: sub }) });
      expect(viaSub.status).toBe(200);
      expect(((await viaSub.json()) as { readonly workspace: string }).workspace).toBe(second);

      // The web registry row moves with the server: the new workspace's registry
      // names the live instance, the old one holds nothing — workspace-relative
      // `tk web stop`/`port` must resolve through the serving workspace.
      const moved = (await readRuntimeRegistry(join(second, ".tasks"))).find((row) => row.kind === "web");
      expect(moved?.url).toBe(server.url);
      const stale = (await readRuntimeRegistry(join(first, ".tasks"))).find((row) => row.kind === "web");
      expect(stale).toBeUndefined();
    } finally {
      await server.close();
    }
  });
});
