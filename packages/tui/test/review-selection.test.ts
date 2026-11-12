import { describe, expect, test } from "bun:test";
import { createHunkDiffFilesFromPatch } from "@tasks/review/opentui";
import { hunkPatchTexts, reviewSelectionText } from "../src/review/selection.js";

const patch = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " const v1 = 1;",
  "-const v2 = 2;",
  "+const v2 = 20; // FIRST",
  " const v3 = 3;",
  "@@ -20,3 +20,3 @@",
  " const v20 = 20;",
  "-const v21 = 21;",
  "+const v21 = 210; // SECOND",
  " const v22 = 22;",
  "",
].join("\n");

const file = createHunkDiffFilesFromPatch(patch, "t")[0]!;

describe("review selection text", () => {
  test("hunkPatchTexts splits one string per @@ hunk, headers excluded", () => {
    const hunks = hunkPatchTexts(file);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.startsWith("@@ -1,3 +1,3 @@")).toBe(true);
    expect(hunks[0]).toContain("+const v2 = 20; // FIRST");
    expect(hunks[0]).not.toContain("SECOND");
    expect(hunks[1]!.startsWith("@@ -20,3 +20,3 @@")).toBe(true);
    expect(hunks[1]).toContain("+const v21 = 210; // SECOND");
    expect(hunks.join("\n")).not.toContain("+++ b/src/a.ts");
    expect(hunks.join("\n")).not.toContain("diff --git");
  });

  test("a patchless file has no hunks", () => {
    expect(hunkPatchTexts({ ...file, patch: undefined })).toEqual([]);
    expect(hunkPatchTexts({ ...file, patch: "Binary files a/x.png and b/x.png differ\n" })).toEqual([]);
  });

  test("reviewSelectionText joins the range, swaps reversed bounds, and falls back to the whole patch", () => {
    const [first, second] = hunkPatchTexts(file);
    expect(reviewSelectionText(file, 0, 1)).toBe(`${first}\n${second}`);
    expect(reviewSelectionText(file, 1, 0)).toBe(`${first}\n${second}`);
    expect(reviewSelectionText(file, 1, 1)).toBe(second!);
    expect(reviewSelectionText(file, null, null)).toBe(file.patch ?? "");
  });
});
