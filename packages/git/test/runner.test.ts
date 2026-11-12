import { describe, expect, it } from "vitest";
import { bunRunner, nodeRunner, spawnSyncRunner } from "../src/index.js";

describe("nodeRunner", () => {
  it("runs git and returns code 0 with trimmed stdout", async () => {
    const result = await nodeRunner.run(["git", "rev-parse", "--git-common-dir"], process.cwd());
    expect(result.code).toBe(0);
    expect(result.stdout).not.toBe("");
    expect(result.stdout).toBe(result.stdout.trim());
  });

  it("returns the non-zero exit code and stderr on git failure", async () => {
    const result = await nodeRunner.run(["git", "rev-parse", "--verify", "nope-ref"], process.cwd());
    expect(result.code).not.toBe(0);
    expect(result.stderr).not.toBe("");
  });

  it("returns 127 for a missing binary instead of throwing", async () => {
    const result = await nodeRunner.run(["tk-no-such-binary"], process.cwd());
    expect(result.code).toBe(127);
    expect(result.stderr).not.toBe("");
  });

  it("an already-aborted signal yields a non-zero code without throwing", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await nodeRunner.run(["git", "rev-parse", "--git-common-dir"], process.cwd(), controller.signal);
    expect(result.code).not.toBe(0);
  });
});

describe("bunRunner", () => {
  it("agrees with nodeRunner on the common dir", async () => {
    const [bun, node] = await Promise.all([
      bunRunner.run(["git", "rev-parse", "--git-common-dir"], process.cwd()),
      nodeRunner.run(["git", "rev-parse", "--git-common-dir"], process.cwd()),
    ]);
    expect(bun).toEqual(node);
  });
});

describe("spawnSyncRunner", () => {
  it("returns untrimmed stdout and the exit status", () => {
    const result = spawnSyncRunner.runSync(["git", "rev-parse", "--git-common-dir"], process.cwd());
    expect(result.code).toBe(0);
    expect(result.stdout.endsWith("\n")).toBe(true);
  });

  it("returns a non-zero code for a missing binary instead of throwing", () => {
    const result = spawnSyncRunner.runSync(["tk-no-such-binary"], process.cwd());
    expect(result.code).not.toBe(0);
  });
});
