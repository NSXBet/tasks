import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CliInput } from "../run/commandInputs";
import { createVcsCatalog } from "../vcs";
// packages/review bundles no VCS adapter; tests register their own fakes.
const STUB_VCS_CATALOG = createVcsCatalog([], "git");
import type { VcsAdapter } from "../vcs/types";
import {
  computeWatchSignature as computeCoreWatchSignature,
  type WatchSignatureContext,
} from "./signature";

const tempDirs: string[] = [];

/** Compute with an empty catalog unless a test supplies another. */
function computeWatchSignature(input: CliInput, context: WatchSignatureContext) {
  return computeCoreWatchSignature(input, {
    vcsCatalog: STUB_VCS_CATALOG,
    ...context,
  });
}

function cleanupTempDirs() {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function createTempDir(prefix: string) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  cleanupTempDirs();
});

describe("computeWatchSignature", () => {
  test("resolves direct files, patch files, and agent sidecars against the supplied cwd", async () => {
    const dir = createTempDir("hunk-watch-files-cwd-");
    writeFileSync(join(dir, "left.ts"), "one\n");
    writeFileSync(join(dir, "right.ts"), "two\n");
    writeFileSync(join(dir, "review.patch"), "patch\n");
    writeFileSync(join(dir, "agent.json"), "{}\n");

    const direct = await computeWatchSignature(
      {
        kind: "diff",
        left: "left.ts",
        right: "right.ts",
        options: { agentContext: "agent.json" },
      },
      { cwd: dir },
    );
    const patch = await computeWatchSignature(
      { kind: "patch", file: "review.patch", options: {} },
      { cwd: dir },
    );

    expect(direct).toContain(join(dir, "left.ts"));
    expect(direct).toContain(join(dir, "right.ts"));
    expect(direct).toContain(join(dir, "agent.json"));
    expect(patch).toContain(join(dir, "review.patch"));
  });

  test("signs a review through an async extension adapter and forwards cancellation", async () => {
    const abort = new AbortController();
    const adapter: VcsAdapter = {
      id: "hg",
      name: "Mercurial",
      detect: () => null,
      operations: {
        "working-tree-diff": {
          load: async () => ({
            repoRoot: "/repo",
            sourceLabel: "/repo",
            title: "hg",
            patchText: "",
          }),
          watchSignature: async (input, { signal }) => {
            expect(signal).toBe(abort.signal);
            await Promise.resolve();
            return `hg:${input.range ?? "working-copy"}`;
          },
        },
      },
    };
    const input = {
      kind: "vcs",
      staged: false,
      options: { mode: "auto", vcs: "hg" },
    } satisfies CliInput;

    expect(
      await computeWatchSignature(input, {
        cwd: process.cwd(),
        signal: abort.signal,
        vcsCatalog: createVcsCatalog([adapter], "demo", []),
      }),
    ).toBe("vcs\n---\nhg:working-copy");
  });

  test("rejects unsupported watch operations before invoking adapter signatures", async () => {
    let signed = false;
    const adapter: VcsAdapter = {
      id: "fake",
      name: "Fake",
      detect: () => null,
      operations: {
        "working-tree-diff": {
          load: async () => ({
            repoRoot: "/repo",
            sourceLabel: "/repo",
            title: "fake",
            patchText: "",
          }),
          watchSignature: async () => {
            signed = true;
            return "fake";
          },
        },
      },
    };

    await expect(
      computeWatchSignature(
        {
          kind: "stash-show",
          options: { mode: "auto", vcs: "fake" },
        },
        { cwd: process.cwd(), vcsCatalog: createVcsCatalog([adapter], "fake", []) },
      ),
    ).rejects.toThrow("Fake does not support stash-show.");
    expect(signed).toBe(false);
  });
});
