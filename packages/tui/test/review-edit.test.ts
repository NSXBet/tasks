import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createHunkDiffFilesFromPatch } from "@tasks/review/opentui";
import { applyHunkEdit, guardWorktreePath, hunkEditRange, readHunkRegion } from "../src/review/edit.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) {
    try { rmSync(dirs.pop()!, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const tmp = (prefix: string): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

/** A worktree root holding `src/a.ts` with the given contents. */
const worktree = (contents: string): string => {
  const root = tmp("tk-tui-edit-");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), contents);
  return root;
};

const twoHunkPatch = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -3,2 +3,4 @@",
  " l3",
  "+n1",
  "+n2",
  " l4",
  "@@ -8,1 +10,2 @@",
  " l8",
  "+n3",
  "",
].join("\n");

const deletedPatch = [
  "diff --git a/src/gone.ts b/src/gone.ts",
  "deleted file mode 100644",
  "--- a/src/gone.ts",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-x",
  "-y",
  "",
].join("\n");

const lines = (count: number): string => Array.from({ length: count }, (_, index) => `l${index + 1}`).join("\n") + "\n";

describe("hunkEditRange", () => {
  test("reads the new-side range from metadata", () => {
    const [file] = createHunkDiffFilesFromPatch(twoHunkPatch, "t");
    expect(hunkEditRange(file!, 0)).toEqual({ start: 3, count: 4 });
    expect(hunkEditRange(file!, 1)).toEqual({ start: 10, count: 2 });
    expect(hunkEditRange(file!, 2)).toBeNull();
  });

  test("a deleted or binary file has no editable range", () => {
    const [deleted] = createHunkDiffFilesFromPatch(deletedPatch, "t");
    expect(hunkEditRange(deleted!, 0)).toBeNull();
    const [file] = createHunkDiffFilesFromPatch(twoHunkPatch, "t");
    expect(hunkEditRange({ ...file!, isBinary: true }, 0)).toBeNull();
  });
});

describe("guardWorktreePath", () => {
  test("accepts a repo-relative path under realpath(root)", async () => {
    const root = worktree("x\n");
    const outcome = await guardWorktreePath(root, "src/a.ts");
    expect(outcome).toEqual({ ok: true, absolutePath: join(realpathSync(root), "src/a.ts") });
    // A not-yet-existing file under the root is fine too.
    expect((await guardWorktreePath(root, "src/new/b.ts")).ok).toBe(true);
  });

  test.each(["../x", "/etc/passwd", "", "a\0b", "src/../../x"])("refuses %p as an escape", async (path) => {
    const root = worktree("x\n");
    const outcome = await guardWorktreePath(root, path);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.kind).toBe("escape");
  });

  test("refuses a path through a symlinked dir pointing outside the root", async () => {
    const root = worktree("x\n");
    const outside = tmp("tk-tui-outside-");
    writeFileSync(join(outside, "secret.ts"), "secret\n");
    symlinkSync(outside, join(root, "link"));
    for (const path of ["link/secret.ts", "link/new.ts", "link/deep/new.ts"]) {
      const outcome = await guardWorktreePath(root, path);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.kind).toBe("escape");
    }
    const applied = await applyHunkEdit(root, "link/secret.ts", { start: 1, count: 1 }, "secret", "pwned");
    expect(applied.ok).toBe(false);
    expect(readFileSync(join(outside, "secret.ts"), "utf8")).toBe("secret\n");
  });

  test("refuses a file symlink pointing outside the root", async () => {
    const root = worktree("x\n");
    const outside = tmp("tk-tui-outside-");
    writeFileSync(join(outside, "secret.ts"), "secret\n");
    symlinkSync(join(outside, "secret.ts"), join(root, "src/evil.ts"));
    const outcome = await guardWorktreePath(root, "src/evil.ts");
    expect(outcome.ok).toBe(false);
  });
});

describe("readHunkRegion", () => {
  test("returns the 1-based line range and the eol", async () => {
    const root = worktree(lines(6));
    expect(await readHunkRegion(root, "src/a.ts", { start: 3, count: 2 })).toEqual({ ok: true, text: "l3\nl4", eol: "\n" });
  });

  test("count 0 is an empty insertion point", async () => {
    const root = worktree(lines(6));
    expect(await readHunkRegion(root, "src/a.ts", { start: 3, count: 0 })).toEqual({ ok: true, text: "", eol: "\n" });
  });

  test("detects CRLF", async () => {
    const root = worktree("a\r\nb\r\nc\r\n");
    expect(await readHunkRegion(root, "src/a.ts", { start: 2, count: 2 })).toEqual({ ok: true, text: "b\nc", eol: "\r\n" });
  });

  test("a missing file is `missing`", async () => {
    const root = worktree("x\n");
    const outcome = await readHunkRegion(root, "src/nope.ts", { start: 1, count: 1 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.kind).toBe("missing");
  });
});

describe("applyHunkEdit", () => {
  test("replaces exactly the range and keeps every other line", async () => {
    const root = worktree(lines(6));
    const outcome = await applyHunkEdit(root, "src/a.ts", { start: 3, count: 2 }, "l3\nl4", "x3\nx3b\nx4");
    expect(outcome).toEqual({ ok: true });
    expect(readFileSync(join(root, "src/a.ts"), "utf8")).toBe("l1\nl2\nx3\nx3b\nx4\nl5\nl6\n");
  });

  test("keeps a missing trailing newline", async () => {
    const root = worktree("l1\nl2\nl3");
    expect(await applyHunkEdit(root, "src/a.ts", { start: 3, count: 1 }, "l3", "L3")).toEqual({ ok: true });
    expect(readFileSync(join(root, "src/a.ts"), "utf8")).toBe("l1\nl2\nL3");
  });

  test("keeps CRLF line endings", async () => {
    const root = worktree("a\r\nb\r\nc\r\n");
    expect(await applyHunkEdit(root, "src/a.ts", { start: 2, count: 1 }, "b", "B\nB2")).toEqual({ ok: true });
    expect(readFileSync(join(root, "src/a.ts"), "utf8")).toBe("a\r\nB\r\nB2\r\nc\r\n");
  });

  test("inserts at a count-0 insertion point", async () => {
    const root = worktree(lines(3));
    expect(await applyHunkEdit(root, "src/a.ts", { start: 2, count: 0 }, "", "ins")).toEqual({ ok: true });
    expect(readFileSync(join(root, "src/a.ts"), "utf8")).toBe("l1\nl2\nins\nl3\n");
  });

  test("refuses a stale region and leaves the file unchanged", async () => {
    const root = worktree(lines(6));
    const outcome = await applyHunkEdit(root, "src/a.ts", { start: 3, count: 2 }, "l3\nCHANGED", "x");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.kind).toBe("stale");
    expect(readFileSync(join(root, "src/a.ts"), "utf8")).toBe(lines(6));
  });

  test("a missing file is `missing`", async () => {
    const root = worktree("x\n");
    const outcome = await applyHunkEdit(root, "src/nope.ts", { start: 1, count: 1 }, "x", "y");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.kind).toBe("missing");
  });
});
