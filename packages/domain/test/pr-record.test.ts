import { describe, expect, it } from "vitest";
import { normalizePrState, parsePrRecord, prLine, readPrRecord } from "../src/index.js";

const valid = { number: 7, url: "https://github.com/acme/app/pull/7", state: "open" };

describe("pr record (PR-01)", () => {
  it("normalizes gh states and rejects unknown ones", () => {
    expect(normalizePrState("MERGED")).toBe("merged");
    expect(normalizePrState("OPEN")).toBe("open");
    expect(normalizePrState("Closed")).toBe("closed");
    expect(normalizePrState("weird")).toBeNull();
    expect(normalizePrState(1)).toBeNull();
  });

  it("reads a valid metadata.pr and lowercases gh's state", () => {
    expect(readPrRecord({ pr: valid })).toEqual(valid);
    expect(parsePrRecord({ ...valid, state: "MERGED", extra: 1 })).toEqual({ ...valid, state: "merged" });
    expect(readPrRecord({})).toBeNull();
  });

  it("rejects bad numbers, non-http urls and a missing state", () => {
    for (const number of [0, -3, 1.5, "7"]) expect(readPrRecord({ pr: { ...valid, number } })).toBeNull();
    expect(readPrRecord({ pr: { ...valid, url: "javascript:alert(1)" } })).toBeNull();
    expect(readPrRecord({ pr: { ...valid, url: "ftp://x/y" } })).toBeNull();
    expect(readPrRecord({ pr: { number: 7, url: valid.url } })).toBeNull();
    expect(readPrRecord({ pr: [valid] })).toBeNull();
  });

  it("prLine renders the mirror", () => {
    expect(prLine({ number: 7, url: valid.url, state: "open" })).toBe(`PR #7 · open · ${valid.url}`);
  });
});
