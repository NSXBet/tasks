import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { WatchEvent } from "@tasks/surface";
import { openTuiStore } from "../src/store.js";
import { collapseToasts, eventToast, sanitize } from "../src/events.js";
import { createElement } from "react";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../src/app/App.js";
import { waitForFrameText } from "./wait.js";

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const workspaces: string[] = [];
const workspace = (): string => {
  const value = mkdtempSync(join(tmpdir(), "tk-tui-events-"));
  workspaces.push(value);
  return value;
};
afterEach(() => {
  while (workspaces.length) {
    const dir = workspaces.pop()!;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* tmp cleanup best effort */ }
  }
});

/** Explicit child env: never inherit the parent's session or event knobs. */
const cleanEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "TK_SESSION" && key !== "PI_SESSION_ID" && key !== "TK_EVENTS") env[key] = value;
  }
  return { ...env, USER: "tui-events-tester" };
};
const tk = (root: string, args: readonly string[]): string => {
  const result = Bun.spawnSync([process.execPath, executable, "-C", root, ...args], { stdout: "pipe", stderr: "pipe", env: cleanEnv() });
  const stdout = new TextDecoder().decode(result.stdout);
  if (result.exitCode !== 0) throw new Error(`tk ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
  return stdout;
};

const until = async (predicate: () => boolean, timeoutMs: number): Promise<boolean> => {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) return true;
    await Bun.sleep(25);
  }
  return predicate();
};

describe("TuiStore.watch tails events.jsonl (10-05, WIRE-02)", () => {
  test("a CLI write reaches onEvent with the real log event; no replay; stop ends the tail", async () => {
    const root = workspace();
    tk(root, ["init"]);
    const id = (JSON.parse(tk(root, ["create", "watched task", "--json"])) as { id: string }).id;
    tk(root, ["update", id, "--status", "approved"]);
    const store = await openTuiStore(root);
    const events: WatchEvent[] = [];
    const stop = store.watch((event) => { events.push(event); });
    try {
      await Bun.sleep(500);
      expect(events).toEqual([]);

      const started = performance.now();
      tk(root, ["update", id, "--status", "in-progress"]);
      expect(await until(() => events.some((event) => event.kind === "task.status"), 2000)).toBe(true);
      expect(performance.now() - started).toBeLessThan(2000 + 1500); // spawn included
      const status = events.find((event) => event.kind === "task.status")!;
      expect(status).toMatchObject({ kind: "task.status", issueId: id, data: { from: "approved", to: "in-progress", actor: "tui-events-tester" } });
      expect(status.seq).toBeGreaterThan(2);

      stop();
      const seen = events.length;
      tk(root, ["update", id, "--status", "ready-to-review"]);
      await Bun.sleep(700);
      expect(events.length).toBe(seen);
    } finally {
      stop();
      await store.close();
    }
  }, 20000);

  test("writes through store.surface arrive too", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const events: WatchEvent[] = [];
    const stop = store.watch((event) => { events.push(event); });
    try {
      await Bun.sleep(300);
      const created = await store.surface.create({ title: "in-process", priority: 2 });
      if (!created.ok) throw created.error;
      expect(await until(() => events.some((event) => event.kind === "task.created" && event.issueId === created.value.id), 2000)).toBe(true);
    } finally {
      stop();
      await store.close();
    }
  }, 20000);

  test("stop before the tail has started delivers nothing", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const events: WatchEvent[] = [];
    const stop = store.watch((event) => { events.push(event); });
    stop();
    try {
      const created = await store.surface.create({ title: "after stop", priority: 2 });
      if (!created.ok) throw created.error;
      await Bun.sleep(600);
      expect(events).toEqual([]);
    } finally {
      await store.close();
    }
  }, 20000);
});

describe("App repaints and toasts from the log (10-05, WIRE-02/03)", () => {
  test("a CLI status change moves the task and shows the ready-for-review toast", async () => {
    const root = workspace();
    tk(root, ["init"]);
    const id = (JSON.parse(tk(root, ["create", "live board task", "--json"])) as { id: string }).id;
    const store = await openTuiStore(root);
    const setup = await testRender(
      createElement(App, { store, actor: "tester", onQuit: () => {} }),
      { width: 120, height: 24, useThread: false },
    );
    try {
      await waitForFrameText(setup, "live board task");
      await Bun.sleep(300);
      tk(root, ["update", id, "--status", "ready-to-review"]);
      const frame = await waitForFrameText(setup, `${id} ready for review`, 5000);
      expect(frame).toContain(`${id} ready for review`);
      tk(root, ["comment", id, "please \u001b[31mlook"]);
      const note = await waitForFrameText(setup, `${id} · tui-events-tester: please`, 5000);
      expect(note).not.toContain("\u001b");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 30000);
});

const ev = (kind: string, data: Record<string, unknown>, issueId: string | null = "tk-1"): WatchEvent =>
  ({ seq: 1, kind, at: "2026-11-11T00:00:00.000Z", ...(issueId !== null ? { issueId } : {}), data } as unknown as WatchEvent);

describe("eventToast (10-05, WIRE-03)", () => {
  test("status toasts: ready-to-review, approved, rejected; other targets are silent", () => {
    expect(eventToast(ev("task.status", { from: "in-progress", to: "ready-to-review" }))).toBe("tk-1 ready for review");
    expect(eventToast(ev("task.status", { to: "approved" }))).toBe("tk-1 approved");
    expect(eventToast(ev("task.status", { to: "rejected" }))).toBe("tk-1 rejected");
    expect(eventToast(ev("task.status", { to: "in-progress" }))).toBeNull();
    expect(eventToast(ev("task.status", { to: "closed" }))).toBeNull();
  });

  test("note comments: author and body, control/ANSI stripped, body truncated to 60 with an ellipsis", () => {
    expect(eventToast(ev("task.comment", { kind: "note", author: "yuri", body: "fix\u001b[31m x" }))).toBe("tk-1 · yuri: fix x");
    expect(eventToast(ev("task.comment", { kind: "note", author: "ev\u0007il\u009b2J", body: "a\nb\u0000c\u001b]0;title\u0007d" }))).toBe("tk-1 · evil: a bcd");
    const long = eventToast(ev("task.comment", { kind: "note", author: "yuri", body: "x".repeat(200) }))!;
    const body = long.slice("tk-1 · yuri: ".length);
    expect(body.length).toBe(60);
    expect(body.endsWith("…")).toBe(true);
    expect(eventToast(ev("task.comment", { kind: "note", actor: "agent", body: "hi" }))).toBe("tk-1 · agent: hi");
  });

  test("review comments: opened and sent toast; resolved and dismissed are silent", () => {
    expect(eventToast(ev("task.comment", { kind: "review", to: "open", file: "src/a.ts", line: 3 }))).toBe("tk-1 · review comment at src/a.ts:3");
    expect(eventToast(ev("task.comment", { kind: "review", from: "open", to: "sent", file: "src/a.ts", line: 3 }))).toBe("tk-1 · review comment sent");
    expect(eventToast(ev("task.comment", { kind: "review", to: "resolved" }))).toBeNull();
    expect(eventToast(ev("task.comment", { kind: "review", to: "dismissed" }))).toBeNull();
    expect(eventToast(ev("task.comment", { kind: "review", to: "open", file: "src/\u001b[2Ka.ts", line: 3 }))).toBe("tk-1 · review comment at src/a.ts:3");
  });

  test("every other kind is silent", () => {
    for (const kind of ["task.created", "task.owner", "task.update", "task.evidence", "task.worktree", "task.deleted", "run.changed"]) {
      expect(eventToast(ev(kind, { to: "ready-to-review", kind: "note", body: "x" }))).toBeNull();
    }
    expect(eventToast(ev("task.status", { to: "approved" }, null))).toBeNull();
  });

  test("sanitize and collapseToasts", () => {
    expect(sanitize("\u001b[1;31mred\u001b[0m\ttab")).toBe("red tab");
    expect(collapseToasts([])).toBeNull();
    expect(collapseToasts(["a"])).toBe("a");
    expect(collapseToasts(["a", "b", "c"])).toBe("c (+2)");
  });
});
