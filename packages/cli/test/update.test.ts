import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { brewFormulaFromExecPath, brewUpgradeCommand, binaryTarget, compareVersions, isUpToDate, parseChecksums } from "../src/update.js";
import { VERSION } from "../src/presentation.js";

describe("binaryTarget", () => {
  it("maps supported platform/arch pairs to release asset names", () => {
    expect(binaryTarget("darwin", "arm64")).toBe("tk-darwin-arm64");
    expect(binaryTarget("darwin", "x64")).toBe("tk-darwin-x64");
    expect(binaryTarget("linux", "arm64")).toBe("tk-linux-arm64");
    expect(binaryTarget("linux", "x64")).toBe("tk-linux-x64");
  });

  it("rejects platforms the releases do not cover", () => {
    expect(() => binaryTarget("win32", "x64")).toThrow(/unsupported platform/);
    expect(() => binaryTarget("darwin", "x86")).toThrow(/unsupported platform/);
  });
});

describe("brew detection", () => {
  it("extracts the formula from a Cellar exec path", () => {
    expect(brewFormulaFromExecPath("/opt/homebrew/Cellar/tasks/0.3.0/bin/tk")).toBe("tasks");
    expect(brewFormulaFromExecPath("/usr/local/Cellar/tk/0.1.0/bin/tk")).toBe("tk");
    expect(brewFormulaFromExecPath("/usr/local/bin/tk")).toBeNull();
  });

  it("upgrades the tasks formula, not a raw binary download", () => {
    expect(brewUpgradeCommand("nsxbet/tap/tasks")).toEqual(["brew", "upgrade", "nsxbet/tap/tasks"]);
  });
});

describe("parseChecksums", () => {
  it("parses shasum -a 256 output into a filename map", () => {
    const map = parseChecksums("abc123  tk-darwin-arm64\ndef456  tk-linux-x64\n\n  fed789   tk-darwin-x64  \n");
    expect(map.get("tk-darwin-arm64")).toBe("abc123");
    expect(map.get("tk-linux-x64")).toBe("def456");
    expect(map.get("tk-darwin-x64")).toBe("fed789");
    expect(map.size).toBe(3);
  });

  it("returns an empty map for empty checksum files", () => {
    expect(parseChecksums("\n\n").size).toBe(0);
  });
});

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    const v = (major: number, minor: number, patch: number): readonly [number, number, number] => [major, minor, patch];
    expect(compareVersions(v(0, 3, 0), v(0, 3, 0))).toBe(0);
    expect(compareVersions(v(0, 3, 1), v(0, 3, 0))).toBe(1);
    expect(compareVersions(v(0, 3, 0), v(1, 0, 0))).toBe(-1);
    expect(compareVersions(v(0, 10, 0), v(0, 9, 0))).toBe(1);
  });
});

describe("isUpToDate", () => {
  it("compares stable releases by semver", () => {
    expect(isUpToDate("v0.3.0", "stable")).toBe(true);
    expect(isUpToDate("v0.2.9", "stable")).toBe(true);
    expect(isUpToDate("v0.4.0", "stable")).toBe(false);
  });

  it("falls back to semver when no build ref is baked in", () => {
    // Source checkouts compile without TK_BUILD_REF; a nightly tag sharing
    // the semver core with VERSION is reported current rather than stale.
    expect(isUpToDate("v0.3.0-nightly.20260911.abcdef", "nightly")).toBe(true);
    expect(isUpToDate("v0.4.0-nightly.20260911.abcdef", "nightly")).toBe(false);
  });
});

describe("release integrity", () => {
  it("keeps the CLI VERSION constant in lockstep with package.json", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "package.json"), "utf8")) as { version: string };
    expect(VERSION).toBe(manifest.version);
  });
});
