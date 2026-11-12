import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSurface, readEvents, readRuntimeRegistry, runWatchLoop, type TasksSurface, type WatchEvent, type WatchSubscription } from "../src/index.js";
import { parseWatchArgs } from "../src/watch/protocol.js";

const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-watch-")); workspaces.push(value); return value; }
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; };
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Integration exception: the loop wakes on the OS clock / fs.watch against a
 * real temp workspace, so waits are bounded polls rather than fake timers.
 */
async function until<T>(fn: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await delay(20);
  }
}

interface Running { readonly events: WatchEvent[]; stop(): Promise<void> }
function start(surface: TasksSurface, subscription: WatchSubscription): Running {
  const events: WatchEvent[] = [];
  let stopping = false;
  const done = runWatchLoop(surface.store, subscription, (event) => events.push(event), () => stopping);
  return { events, stop: async () => { stopping = true; await done; } };
}

async function fixture(): Promise<{ root: string; surface: TasksSurface; a: string; b: string }> {
  const root = workspace();
  const surface = await createSurface({ root, actor: "alice" });
  const a = unwrap(await surface.create({ title: "a", labels: ["ui"] })).id;
  const b = unwrap(await surface.create({ title: "b" })).id;
  return { root, surface, a, b };
}

describe("runWatchLoop over the event log", () => {
  it("delivers a surface status change as task.status within 1s, with no replay of the existing log", async () => {
    const { root, surface, a } = await fixture();
    const watch = start(surface, { interval: 2000 });
    try {
      await delay(500);
      expect(watch.events).toEqual([]);
      const startedAt = Date.now();
      unwrap(await surface.status(a, { status: "in-progress" }));
      const event = await until(() => watch.events.find((candidate) => candidate.kind === "task.status"), 1000);
      expect(Date.now() - startedAt).toBeLessThan(1000);
      expect(event).toMatchObject({ kind: "task.status", issueId: a, data: { from: "open", to: "in-progress", actor: "alice" } });
      const line = (await readEvents(join(root, ".tasks"))).find((candidate) => candidate.type === "task.status")!;
      expect(event.seq).toBe(line.seq);
      expect(event.at).toBe(line.ts);
      expect(event.counts).toEqual({ open: 2, blocked: 0, readyToReview: 0 });
    } finally {
      await watch.stop();
      await surface.store.close();
    }
  });

  it("filters by legacy alias kinds, spec kinds, ids and label", async () => {
    const { surface, a, b } = await fixture();
    const legacy = start(surface, { kinds: ["issue.status_changed"], interval: 250 });
    const comments = start(surface, { kinds: ["task.comment"], interval: 250 });
    const onlyB = start(surface, { ids: [b], interval: 250 });
    const ui = start(surface, { label: "ui", interval: 250 });
    try {
      await delay(100);
      unwrap(await surface.status(a, { status: "in-progress" }));
      unwrap(await surface.status(b, { status: "in-progress" }));
      await until(() => (legacy.events.length >= 2 && onlyB.events.length >= 1 && ui.events.length >= 1 ? true : undefined));
      await delay(300);
      expect(legacy.events.map((event) => [event.kind, event.issueId])).toEqual([["task.status", a], ["task.status", b]]);
      expect(comments.events).toEqual([]);
      expect(onlyB.events.map((event) => event.issueId)).toEqual([b]);
      expect(ui.events.map((event) => event.issueId)).toEqual([a]);
    } finally {
      await Promise.all([legacy.stop(), comments.stop(), onlyB.stop(), ui.stop()]);
      await surface.store.close();
    }
  });

  it("replays every existing line in order with after: 0", async () => {
    const { root, surface, a, b } = await fixture();
    const watch = start(surface, { after: 0, interval: 250 });
    try {
      const log = await readEvents(join(root, ".tasks"));
      await until(() => (watch.events.length >= log.length ? true : undefined));
      expect(watch.events.map((event) => [event.seq, event.kind, event.issueId])).toEqual([[1, "task.created", a], [2, "task.created", b]]);
    } finally {
      await watch.stop();
      await surface.store.close();
    }
  });

  it("registers one watch runtime row while running and removes it after stop", async () => {
    const { root, surface } = await fixture();
    const tasksDir = join(root, ".tasks");
    const watch = start(surface, { interval: 250 });
    let live: readonly { kind: string }[] = [];
    for (let i = 0; i < 100 && live.length === 0; i += 1) {
      live = await readRuntimeRegistry(tasksDir);
      if (live.length === 0) await delay(20);
    }
    expect(live.map((row) => row.kind)).toEqual(["watch"]);
    await watch.stop();
    expect(await readRuntimeRegistry(tasksDir)).toEqual([]);
    await surface.store.close();
  });
});

describe("parseWatchArgs", () => {
  it("parses --after alongside kinds/ids/label/interval", () => {
    expect(parseWatchArgs(["--kinds", "issue.created,task.comment", "--ids", "tk-a", "--label", "ui", "--interval", "500", "--after", "7"]))
      .toEqual({ kinds: ["issue.created", "task.comment"], ids: ["tk-a"], label: "ui", interval: 500, after: 7 });
    expect(parseWatchArgs(["--after", "-1"])).toEqual({});
  });
});

describe("watch child", () => {
  it("exits 2 when no workspace exists", async () => {
    const missing = join(tmpdir(), `tk-watch-missing-${Date.now()}`);
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/watch/child-entry.ts"), missing], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
    const code = await child.exited;
    expect(code).toBe(2);
  });
});
