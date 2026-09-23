import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const executable = join(process.cwd(), "packages/cli/src/tk.ts");
const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-runtime-")); workspaces.push(value); return value; }
function run(directory: string, args: readonly string[]): { readonly stdout: string; readonly stderr: string; readonly status: number } { const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdout: "pipe", stderr: "pipe" }); return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode }; }
function json<T>(directory: string, args: readonly string[]): T { const result = run(directory, [...args, "--json"]); expect(result.status, result.stderr).toBe(0); return JSON.parse(result.stdout) as T; }
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

interface RuntimeRowWire { readonly id: string; readonly kind: string; readonly label: string | null; readonly pid: number; readonly subscriptions: readonly string[] }
interface ActivityRowWire { readonly at: string; readonly runtime_id: string; readonly kind: string; readonly detail: string }
interface InboxEntryWire { readonly run_id: string; readonly issue_id: string; readonly agent_id: string | null; readonly state: string; readonly trigger: string; readonly unread: boolean }
interface RunWire { readonly id: string; readonly trigger: string; readonly state: string }

/** First NDJSON frame from a watch child, or rejects after the timeout. */
async function firstFrame(child: Bun.Subprocess<"pipe", "pipe", "pipe">, timeoutMs = 10_000): Promise<string> {
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("timed out waiting for watch frame");
    const timer = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), remaining));
    const chunk = await Promise.race([reader.read(), timer]);
    if (chunk === "timeout") throw new Error("timed out waiting for watch frame");
    if (chunk.done) throw new Error("watch child exited before ready frame");
    buffer += decoder.decode(chunk.value, { stream: true });
    const newline = buffer.indexOf("\n");
    if (newline >= 0) return buffer.slice(0, newline);
  }
}

/**
 * Polls until fn returns a defined value, or throws after the timeout.
 * Integration exception: these tests drive a real spawned watch child whose
 * ticks run on the OS clock, so no deterministic fake timer applies.
 */
async function until<T>(fn: () => T | undefined, timeoutMs = 15_000, stepMs = 250): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await Bun.sleep(stepMs);
  }
}

function spawnWatch(directory: string, intervalMs: number): Bun.Subprocess<"pipe", "pipe", "pipe"> {
  return Bun.spawn([process.execPath, executable, "-C", directory, "watch", "--interval", String(intervalMs)], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
}

async function stopWatch(child: Bun.Subprocess<"pipe", "pipe", "pipe">): Promise<void> {
  child.stdin.end();
  await child.exited;
}

describe("tk runtime registry", () => {
  it("lists the live watch child while it runs and clears it on exit", async () => {
    const directory = workspace();
    json(directory, ["init"]);
    const child = spawnWatch(directory, 250);
    try {
      const ready = JSON.parse(await firstFrame(child)) as { type: string };
      expect(ready.type).toBe("ready");
      const row = await until(() => (json<readonly RuntimeRowWire[]>(directory, ["runtime", "list"])[0]));
      expect(row.kind).toBe("watch");
      expect(row.pid).toBe(child.pid);
      expect(row.heartbeat_at.length).toBeGreaterThan(0);
      const activity = json<readonly ActivityRowWire[]>(directory, ["runtime", "activity", "--limit", "5"]);
      expect(activity.some((entry) => entry.kind === "started")).toBe(true);
      expect(activity.every((entry) => entry.runtime_id === row.id)).toBe(true);
    } finally {
      await stopWatch(child);
    }
    expect(json<readonly RuntimeRowWire[]>(directory, ["runtime", "list"])).toEqual([]);
  });
});

describe("tk inbox", () => {
  it("marks runs read and archived via markers", async () => {
    const directory = workspace();
    json(directory, ["init"]);
    const issue = json<{ id: string }>(directory, ["create", "inbox fodder"]);
    const runId = `${issue.id}-run-1`;
    // Seed a queued run through the status-move path: assign + move to in_progress.
    json(directory, ["agent", "create", "reviewer"]);
    json(directory, ["assign", issue.id, "reviewer"]);
    json(directory, ["set-state", issue.id, "in_progress"]);
    const before = json<readonly InboxEntryWire[]>(directory, ["inbox"]);
    expect(before.map((entry) => [entry.run_id, entry.unread])).toEqual([[runId, true]]);
    const read = json<{ read_at: Record<string, string>; archived: Record<string, true> }>(directory, ["inbox", "read", runId]);
    expect(Object.keys(read.read_at)).toEqual([runId]);
    expect(json<readonly InboxEntryWire[]>(directory, ["inbox"])[0]!.unread).toBe(false);
    json(directory, ["inbox", "archive", runId]);
    expect(json<readonly InboxEntryWire[]>(directory, ["inbox"])).toEqual([]);
    expect(json<readonly InboxEntryWire[]>(directory, ["inbox", "--all"])).toHaveLength(1);
  });
});

describe("wakeup end-to-end", () => {
  it("wakes an expired deferred issue through the watch child and surfaces it in the inbox", async () => {
    const directory = workspace();
    json(directory, ["init"]);
    const agent = json<{ id: string }>(directory, ["agent", "create", "reviewer"]);
    const issue = json<{ id: string }>(directory, ["create", "wake me"]);
    json(directory, ["assign", issue.id, agent.id]);
    json(directory, ["set-state", issue.id, "deferred"]);
    json(directory, ["defer", issue.id, "2026-01-01T00:00:00Z"]);
    const child = spawnWatch(directory, 250);
    try {
      await firstFrame(child);
      const entry = await until(() => json<readonly InboxEntryWire[]>(directory, ["inbox"]).find((candidate) => candidate.trigger === "wakeup"));
      expect(entry.issue_id).toBe(issue.id);
      expect(entry.agent_id).toBe(agent.id);
      expect(entry.state).toBe("queued");
      expect(entry.unread).toBe(true);
      const wakeupRun = await until(() => json<readonly RunWire[]>(directory, ["runs", "--issue", issue.id]).find((candidate) => candidate.trigger === "wakeup"));
      expect(wakeupRun.state).toBe("queued");
      const shown = json<readonly { status: string; defer_until: string | null }[]>(directory, ["show", issue.id])[0]!;
      expect(shown.status).toBe("open");
      expect(shown.defer_until).toBeNull();
    } finally {
      await stopWatch(child);
    }
  });
});
