import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { heartbeatRuntime, registerRuntime, readRuntimeRegistry, unregisterRuntime, WEB_RUNTIME_ID, type WatchRuntimeRow } from "../src/runtime";

const tasksDirs: string[] = [];
const tasksDir = (): string => {
  const value = mkdtempSync(join(tmpdir(), "tk-runtime-"));
  tasksDirs.push(value);
  return value;
};
afterEach(() => { while (tasksDirs.length) rmSync(tasksDirs.pop()!, { recursive: true, force: true }); });

describe("runtime registry", () => {
  // A 250ms heartbeat writing from a pre-registration snapshot used to erase
  // the just-registered web row, leaving `tk web stop`/`port` blind to a live
  // server. All mutators run in the daemon's process, so the per-process
  // mutation lock must keep every row through interleaved heartbeats.
  it("keeps concurrently registered rows across interleaved heartbeats", async () => {
    const dir = tasksDir();
    const watch: WatchRuntimeRow = { id: "watch-1", kind: "watch", label: null, pid: 1, startedAt: "t0", heartbeatAt: "t0", subscriptions: ["interval=250"] };
    const second: WatchRuntimeRow = { id: "watch-2", kind: "watch", label: "review", pid: 1, startedAt: "t0", heartbeatAt: "t0", subscriptions: [] };
    await registerRuntime(dir, watch);
    await registerRuntime(dir, second);
    const web = { id: WEB_RUNTIME_ID, kind: "web" as const, pid: 1, port: 21579, url: "http://localhost:21579", workspace: dir, startedAt: "t1" };

    await Promise.all([
      registerRuntime(dir, web),
      ...Array.from({ length: 25 }, (_, index) => heartbeatRuntime(dir, watch.id, new Date(1700000000000 + index * 250))),
    ]);
    await unregisterRuntime(dir, "watch-1");
    await heartbeatRuntime(dir, "watch-1", new Date()); // no-op on the removed row

    const rows = await readRuntimeRegistry(dir);
    expect(rows.map((row) => row.id).sort()).toEqual(["watch-2", "web"]);
    expect(readFileSync(join(dir, "runtime.json"), "utf8")).not.toMatch(/\.tmp/); // atomic rename, no temp litter
  });
});
