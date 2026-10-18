import { describe, expect, it } from "vitest";
import { deriveChangeset } from "../src/index.js";
import type { ProcessRunner } from "@tasks/git";

function fakeRunner(responses: Readonly<Record<string, string>>): ProcessRunner & { commands: string[][] } {
  const commands: string[][] = [];
  return {
    commands,
    async run(command: readonly string[]) {
      commands.push([...command]);
      const key = command.join(" ");
      return { stdout: (responses[key] ?? "").trim(), stderr: "", code: key in responses ? 0 : 1 };
    },
  };
}

describe("deriveChangeset (surface operation)", () => {
  it("derives commits, files, and counts from the three underlying commands", async () => {
    const runner = fakeRunner({
      "git log --oneline main..feature": "abc111 one\ndef222 two",
      "git diff --numstat main...feature": "10\t2\ta.ts\n1\t1\tb.ts",
      "git diff --name-status main...feature": "M\ta.ts\nA\tb.ts",
    });
    const payload = await deriveChangeset({ cwd: "/repo" }, "main", "feature", runner);
    expect(payload).toEqual({
      commits: [{ sha: "abc111", subject: "one" }, { sha: "def222", subject: "two" }],
      files: [{ path: "a.ts", status: "M" }, { path: "b.ts", status: "A" }],
      counts: { additions: 11, deletions: 3 },
    });
    expect(runner.commands.length).toBe(3);
  });

  it("returns null when any underlying command fails", async () => {
    const runner: ProcessRunner = { async run() { return { stdout: "", stderr: "fatal: bad revision", code: 128 }; } };
    expect(await deriveChangeset({ cwd: "/repo" }, "main", "gone", runner)).toBeNull();
  });

  it("returns null for empty base or branch without running any command", async () => {
    const runner = fakeRunner({ "git log --oneline main..feature": "abc111 one", "git diff --numstat main...feature": "1\t0\ta.ts", "git diff --name-status main...feature": "M\ta.ts" });
    expect(await deriveChangeset({ cwd: "/repo" }, "", "feature", runner)).toBeNull();
    expect(await deriveChangeset({ cwd: "/repo" }, "main", "", runner)).toBeNull();
    expect(runner.commands.length).toBe(0);
  });

  it("never caches: two calls re-run all three commands (D-01)", async () => {
    const runner = fakeRunner({
      "git log --oneline main..feature": "abc111 one",
      "git diff --numstat main...feature": "1\t0\ta.ts",
      "git diff --name-status main...feature": "M\ta.ts",
    });
    const first = await deriveChangeset({ cwd: "/repo" }, "main", "feature", runner);
    const second = await deriveChangeset({ cwd: "/repo" }, "main", "feature", runner);
    expect(first).toEqual(second);
    expect(runner.commands.length).toBe(6);
  });

  it("returns empty arrays (not null) when the branch has no commits or files ahead", async () => {
    const runner = fakeRunner({ "git log --oneline main..feature": "", "git diff --numstat main...feature": "", "git diff --name-status main...feature": "" });
    const payload = await deriveChangeset({ cwd: "/repo" }, "main", "feature", runner);
    expect(payload).toEqual({ commits: [], files: [], counts: { additions: 0, deletions: 0 } });
  });
});
