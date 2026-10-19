import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DaemonStartError, connectOrSpawn, daemonSocketPath, probeDaemon, socketAlive, startDaemon } from "../src/index";
import { cleanStaleSocket, delay } from "../src/socket";

const workspaces: string[] = [];
function workspace(): string {
  const value = mkdtempSync(join(tmpdir(), "tk-daemon-"));
  mkdirSync(join(value, ".beads"), { recursive: true });
  workspaces.push(value);
  return value;
}
const init = async (root: string): Promise<void> => {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "../../cli/src/tk.ts"), "-C", root, "init", "--json"], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
};
beforeEach(() => {
  // TKD_SOCKET isolation: every test gets its own socket namespace, and the
  // spawned daemons inherit the env so client and daemon always agree.
  process.env["TKD_SOCKET"] = join(tmpdir(), `tkd-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
});
afterEach(async () => {
  await cleanStaleSocket(daemonSocketPath()).catch(() => {});
  delete process.env["TKD_SOCKET"];
  while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true });
});

describe("tkd daemon", () => {
  it("serves hello and verbs over the socket until stopped", async () => {
    const root = workspace();
    await init(root);
    const handle = await startDaemon({ idleMs: 0 });
    try {
      expect(await socketAlive(handle.socketPath)).toBe(true);

      const client = await connectOrSpawn(root, { spawnTimeoutMs: 2000 });
      const hello = (await client.call("hello")) as { readonly protocol: number; readonly methods: readonly string[] };
      expect(hello.protocol).toBe(2);
      expect(hello.methods).toContain("issue.create");

      const created = (await client.call("issue.create", { title: "via daemon" })) as { readonly id: string };
      expect(created.id).toMatch(/^tk-/);

      // A second independent client sees the same workspace state.
      const second = await connectOrSpawn(root, { spawnTimeoutMs: 2000 });
      const counts = (await second.call("views.counts")) as { readonly total: number };
      expect(counts.total).toBe(1);
      second.close();

      await client.stop(); // daemon.stop verb → in-process shutdown
      await handle.stopped;
      expect(await socketAlive(handle.socketPath)).toBe(false);
    } finally {
      await handle.stop(); // idempotent when already shut down
    }
  });

  it("serves multiple workspaces from one daemon with isolated state", async () => {
    const firstRoot = workspace();
    const secondRoot = workspace();
    await init(firstRoot);
    await init(secondRoot);
    const handle = await startDaemon({ idleMs: 0 });
    try {
      const a = await connectOrSpawn(firstRoot, { spawnTimeoutMs: 2000 });
      const b = await connectOrSpawn(secondRoot, { spawnTimeoutMs: 2000 });
      await a.call("issue.create", { title: "in first" });
      const countsA = (await a.call("views.counts")) as { readonly total: number };
      const countsB = (await b.call("views.counts")) as { readonly total: number };
      expect(countsA.total).toBe(1);
      expect(countsB.total).toBe(0);
      await b.call("issue.create", { title: "in second" });
      expect(((await a.call("views.counts")) as { readonly total: number }).total).toBe(1);
      expect(((await b.call("views.counts")) as { readonly total: number }).total).toBe(1);

      // daemon.ping reports every workspace the daemon currently serves.
      const ping = (await a.call("daemon.ping")) as { readonly roots: readonly string[] };
      expect(ping.roots).toContain(firstRoot);
      expect(ping.roots).toContain(secondRoot);
      a.close();
      b.close();
    } finally {
      await handle.stop();
    }
  });

  it("self-heals a killed daemon: stale socket is replaced by a fresh spawn", async () => {
    const root = workspace();
    await init(root);
    // connectOrSpawn owns the subprocess — SIGKILL must hit a daemon that is
    // not this test, so kill the pid the daemon itself reports.
    const client = await connectOrSpawn(root, { spawnTimeoutMs: 5000, idleMs: 600_000 });
    const socketPath = client.socketPath;
    const daemonPid = ((await client.call("daemon.ping")) as { readonly pid: number }).pid;
    client.close();

    process.kill(daemonPid, "SIGKILL");
    // Integration exception: kernel-async socket teardown surfaces no event
    // here, so poll the real condition (socket dead) instead of guessing a delay.
    const deadline = Date.now() + 5000;
    while ((await socketAlive(socketPath, 250)) && Date.now() < deadline) {
      await delay(25);
    }

    const healed = await connectOrSpawn(root, { spawnTimeoutMs: 5000, idleMs: 5000 });
    try {
      const healedPing = (await healed.call("daemon.ping")) as { readonly pid: number };
      expect(healedPing.pid).not.toBe(daemonPid);
      expect(healed.pid).toBe(healedPing.pid);
      await healed.stop(); // shuts the spawned subprocess down
    } catch (error) {
      await healed.close();
      throw error;
    }
  });

  it("exits on idle with no connections and reports not-running afterwards", async () => {
    // Integration test of the daemon's real idle timer: the await targets the
    // exposed `stopped` event, not a guessed duration — deterministic fake
    // timers cannot drive the daemon's internal setInterval here.
    const root = workspace();
    await init(root);
    const handle = await startDaemon({ idleMs: 300 });
    const client = await connectOrSpawn(root, { spawnTimeoutMs: 2000 });
    client.close(); // drop without stop — daemon should idle-exit
    await handle.stopped;
    expect(await socketAlive(handle.socketPath)).toBe(false);
    expect(await probeDaemon(500)).toBeNull();
  });

  it("refuses to start a second daemon on the same socket", async () => {
    const root = workspace();
    await init(root);
    const first = await startDaemon({ idleMs: 0 });
    try {
      const second = startDaemon({ idleMs: 0 });
      await expect(second).rejects.toBeInstanceOf(DaemonStartError);
      await expect(second).rejects.toMatchObject({ code: "already_running" });
    } finally {
      await first.stop();
    }
    expect(await socketAlive(daemonSocketPath())).toBe(false);
  });

  it("rejects verbs whose root is not a tasks workspace", async () => {
    const handle = await startDaemon({ idleMs: 0 });
    const notAWorkspace = workspace();
    try {
      const client = await connectOrSpawn(notAWorkspace, { spawnTimeoutMs: 2000 });
      try {
        await expect(client.call("views.counts")).rejects.toMatchObject({ wireError: { kind: "root_invalid" } });
      } finally {
        client.close();
      }
    } finally {
      await handle.stop();
    }
  });

  it("streams events.subscribe frames per connection until unsubscribed", async () => {
    const root = workspace();
    await init(root);
    const handle = await startDaemon({ idleMs: 0 });
    const waitFor = async (seen: readonly { readonly kind: string; readonly id: string }[], kind: string, id: string): Promise<void> => {
      const deadline = Date.now() + 5000;
      while (!seen.some((e) => e.kind === kind && e.id === id) && Date.now() < deadline) await delay(25);
    };
    try {
      const seen: { tag: string; kind: string; id: string }[] = [];
      const client = await connectOrSpawn(root, {
        spawnTimeoutMs: 2000,
        onEvent: (tag, event) => { seen.push({ tag, kind: event.kind, id: event.issueId ?? "" }); },
      });
      try {
        await client.call("events.subscribe", { subscription: "w1", root, interval: 250 });

        const created = (await client.call("issue.create", { title: "event me" })) as { readonly id: string };
        await waitFor(seen, "issue.created", created.id);
        expect(seen.some((e) => e.tag === "w1" && e.kind === "issue.created" && e.id === created.id)).toBe(true);

        // Unsubscribe stops delivery for this connection only.
        await client.call("events.unsubscribe", { subscription: "w1" });
        seen.length = 0;
        await client.call("issue.create", { title: "after unsub" });
        await delay(700);
        expect(seen).toEqual([]);

        // A second connection subscribes independently and sees new events.
        const other: string[] = [];
        const second = await connectOrSpawn(root, {
          spawnTimeoutMs: 2000,
          onEvent: (tag) => { other.push(tag); },
        });
        try {
          await second.call("events.subscribe", { subscription: "w2", root, interval: 250 });
          await client.call("issue.create", { title: "only w2" });
          const deadline = Date.now() + 5000;
          while (!other.includes("w2") && Date.now() < deadline) await delay(25);
          // A fresh loop diffs the whole board on its first tick, so every
          // event belongs to w2 — the unsubscribed w1 sees none.
          expect(other.length).toBeGreaterThan(0);
          expect(other.every((tag) => tag === "w2")).toBe(true);
        } finally {
          second.close();
        }
      } finally {
        client.close();
      }
    } finally {
      await handle.stop();
    }
  });

  it("drops the web host after HTTP /api/stop and starts a fresh server afterwards", async () => {
    const root = workspace();
    await init(root);
    const handle = await startDaemon({ idleMs: 0 });
    try {
      const client = await connectOrSpawn(root, { spawnTimeoutMs: 2000 });
      try {
        const started = (await client.call("web.start", { root, port: 0 })) as { readonly url: string };
        expect(((await fetch(`${started.url}/api/board`)).status)).toBe(200);

        // Route-driven stop: the server tears itself down inside the daemon.
        // The host must drop its reference — a stale `hosting: true` here is
        // exactly the phantom that made the next `tk web start` report a URL
        // owned by whatever process grabbed the freed port.
        await fetch(`${started.url}/api/stop`, { method: "POST" });
        const deadline = Date.now() + 5000;
        let status = (await client.call("web.status")) as { readonly hosting: boolean };
        while (status.hosting && Date.now() < deadline) {
          await delay(25);
          status = (await client.call("web.status")) as { readonly hosting: boolean };
        }
        expect(status).toEqual({ hosting: false });

        // The next web.start must boot a genuinely new server, not echo the ghost.
        const restarted = (await client.call("web.start", { root, port: 0 })) as { readonly url: string };
        expect(((await fetch(`${restarted.url}/api/board`)).status)).toBe(200);
      } finally {
        client.close();
      }
    } finally {
      await handle.stop();
    }
  });
});
