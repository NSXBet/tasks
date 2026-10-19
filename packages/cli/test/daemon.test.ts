import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-daemon-")); workspaces.push(value); return value; }
function run(directory: string, args: readonly string[]): { readonly stdout: string; readonly stderr: string; readonly status: number } { const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdout: "pipe", stderr: "pipe" }); return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode }; }
function json<T>(directory: string, args: readonly string[]): T { const result = run(directory, [...args, "--json"]); expect(result.status, result.stderr).toBe(0); return JSON.parse(result.stdout) as T; }
afterEach(() => {
  while (workspaces.length) {
    const value = workspaces.pop()!;
    run(value, ["daemon", "stop"]);
    rmSync(value, { recursive: true, force: true });
  }
});

interface DaemonStatusWire { readonly running: boolean; readonly root: string; readonly socketPath?: string; readonly pid?: number; readonly connections?: number; readonly event_subscriptions?: number }
interface StartWire { readonly started: boolean; readonly alreadyRunning: boolean; readonly pid: number }
interface StopWire { readonly stopped: boolean; readonly running: boolean; readonly pid?: number }
interface RestartWire { readonly restarted: boolean; readonly stoppedPid: number | null; readonly pid: number }

/** Integration exception: the daemon is a real spawned OS process, so polling the OS clock is the only honest readiness check. */
async function until(fn: () => boolean, timeoutMs = 15_000, stepMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fn()) return;
    if (Date.now() > deadline) throw new Error("timed out waiting for daemon state");
    await Bun.sleep(stepMs);
  }
}

const isUp = (directory: string): boolean => json<DaemonStatusWire>(directory, ["daemon", "status"]).running === true;
const isDown = (directory: string): boolean => json<DaemonStatusWire>(directory, ["daemon", "status"]).running === false;

describe("tk daemon status", () => {
  it("reports absence before anything is started, with --quiet exiting 1", () => {
    const directory = workspace();
    json(directory, ["init"]);
    const down = run(directory, ["daemon", "status", "--quiet"]);
    expect(down.status).toBe(1);
    const wire = json<DaemonStatusWire>(directory, ["daemon", "status"]);
    expect(wire.running).toBe(false);
    expect(wire.root).toBe(directory);
    expect(wire.socketPath).toContain("tkd");
  });
});

describe("tk daemon start / stop", () => {
  it("starts, pings the same pid, no-ops a second start, then stops", async () => {
    const directory = workspace();
    json(directory, ["init"]);
    try {
      const started = json<StartWire>(directory, ["daemon", "start"]);
      expect(started.started).toBe(true);
      expect(started.alreadyRunning).toBe(false);
      expect(started.pid).toBeGreaterThan(0);
      await until(() => isUp(directory));
      const status = json<DaemonStatusWire>(directory, ["daemon", "status"]);
      expect(status.pid).toBe(started.pid);
      expect(status.root).toBe(directory);
      expect(status.connections).toBe(0);
      expect(status.event_subscriptions).toBe(0);

      const again = json<StartWire>(directory, ["daemon", "start"]);
      expect(again.started).toBe(false);
      expect(again.alreadyRunning).toBe(true);
      expect(again.pid).toBe(started.pid);

      const stopped = json<StopWire>(directory, ["daemon", "stop"]);
      expect(stopped.stopped).toBe(true);
      expect(stopped.pid).toBe(started.pid);
      await until(() => isDown(directory));

      const gone = json<StopWire>(directory, ["daemon", "stop"]);
      expect(gone.stopped).toBe(false);
      expect(gone.running).toBe(false);
    } finally {
      run(directory, ["daemon", "stop"]);
    }
  });
});

describe("tk daemon restart", () => {
  it("replaces the pid and reports the old one", async () => {
    const directory = workspace();
    json(directory, ["init"]);
    try {
      const started = json<StartWire>(directory, ["daemon", "start"]);
      await until(() => isUp(directory));
      const restarted = json<RestartWire>(directory, ["daemon", "restart"]);
      expect(restarted.restarted).toBe(true);
      expect(restarted.stoppedPid).toBe(started.pid);
      expect(restarted.pid).not.toBe(started.pid);
      await until(() => json<DaemonStatusWire>(directory, ["daemon", "status"]).pid === restarted.pid);
    } finally {
      run(directory, ["daemon", "stop"]);
    }
  });
});
