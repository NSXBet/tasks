import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bunRunner, detectPackageManager, runPackageManagerSetup, runShellHook, type ProcessResult, type ProcessRunner } from "../src/index.js";

const dirs: string[] = [];
function dir(...lockfiles: readonly string[]): string {
  const value = mkdtempSync(join(tmpdir(), "tk-hooks-"));
  dirs.push(value);
  for (const file of lockfiles) writeFileSync(join(value, file), "");
  return value;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

/** Records every invocation; answers with a fixed result or throws. */
function recordingRunner(answer: ProcessResult | Error): ProcessRunner & { calls: Array<{ command: string[]; cwd: string }> } {
  const calls: Array<{ command: string[]; cwd: string }> = [];
  return {
    calls,
    async run(command, cwd) {
      calls.push({ command: [...command], cwd });
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

describe("detectPackageManager", () => {
  it("follows the locked precedence bun → pnpm → yarn → npm", async () => {
    expect(await detectPackageManager(dir("bun.lock", "package-lock.json"))).toBe("bun");
    expect(await detectPackageManager(dir("bun.lockb"))).toBe("bun");
    expect(await detectPackageManager(dir("pnpm-lock.yaml", "yarn.lock"))).toBe("pnpm");
    expect(await detectPackageManager(dir("yarn.lock", "package-lock.json"))).toBe("yarn");
    expect(await detectPackageManager(dir("package-lock.json"))).toBe("npm");
    expect(await detectPackageManager(dir())).toBeNull();
  });
});

describe("runPackageManagerSetup", () => {
  it("runs exactly `bun install` inside the worktree and reports the manager", async () => {
    const mainRoot = dir("bun.lock");
    const worktree = dir();
    const runner = recordingRunner({ stdout: "", stderr: "", code: 0 });
    expect(await runPackageManagerSetup(worktree, mainRoot, true, runner)).toEqual({ ran: true, ok: true, stderr: "", pm: "bun" });
    expect(runner.calls).toEqual([{ command: ["bun", "install"], cwd: worktree }]);
  });

  it("reports a non-zero exit as a failed run naming the manager", async () => {
    const runner = recordingRunner({ stdout: "", stderr: "boom", code: 1 });
    expect(await runPackageManagerSetup(dir(), dir("yarn.lock"), true, runner)).toEqual({ ran: true, ok: false, stderr: "boom", pm: "yarn" });
  });

  it("never throws when the runner throws (binary missing)", async () => {
    const runner = recordingRunner(new Error("spawn pnpm ENOENT"));
    expect(await runPackageManagerSetup(dir(), dir("pnpm-lock.yaml"), true, runner)).toEqual({ ran: true, ok: false, stderr: "spawn pnpm ENOENT", pm: "pnpm" });
  });

  it("skips without calling the runner when install is disabled or no lockfile exists", async () => {
    const runner = recordingRunner({ stdout: "", stderr: "", code: 0 });
    expect(await runPackageManagerSetup(dir(), dir("bun.lock"), false, runner)).toEqual({ ran: false, ok: true, stderr: "" });
    expect(await runPackageManagerSetup(dir(), dir(), true, runner)).toEqual({ ran: false, ok: true, stderr: "" });
    expect(runner.calls).toEqual([]);
  });
});

describe("runShellHook", () => {
  it("treats a missing or blank command as a no-op success", async () => {
    const runner = recordingRunner({ stdout: "", stderr: "", code: 1 });
    expect(await runShellHook(undefined, dir(), runner)).toEqual({ ok: true, stderr: "" });
    expect(await runShellHook("  ", dir(), runner)).toEqual({ ok: true, stderr: "" });
    expect(runner.calls).toEqual([]);
  });

  it("reports a failing command as not ok", async () => {
    expect((await runShellHook("exit 3", dir(), bunRunner)).ok).toBe(false);
    expect((await runShellHook("true", dir(), bunRunner)).ok).toBe(true);
  });
});
