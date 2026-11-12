import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { IssueAttachment } from "@tasks/domain";
import type { ReviewCommentStatus, ReviewThread } from "../review/commentStore";
import {
  artifactGroups,
  changesTree,
  docBlocks,
  isDocPath,
  minimapBars,
  needsReview,
  patchFileStats,
  threadLocation,
  type PatchFileStat,
} from "./model";

const git = (cwd: string, ...args: string[]): string => {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString();
};

const write = (root: string, path: string, content: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};

let repo = "";
let patch = "";

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "tk-taskview-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  git(repo, "config", "commit.gpgsign", "false");
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  write(repo, "src/a.ts", `${lines.join("\n")}\n`);
  write(repo, "src/middleware/auth.ts", "export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\nexport const e = 5;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "base");
  // src/a.ts: hunk 1 near the top replaces one line with three (+3/-1); hunk 2 near the bottom adds one (+1/-0).
  const edited = [...lines];
  edited.splice(1, 1, "two-a", "two-b", "two-c");
  edited.push("line 31");
  write(repo, "src/a.ts", `${edited.join("\n")}\n`);
  // auth.ts: delete four lines, add one (+1/-4).
  write(repo, "src/middleware/auth.ts", "export const a = 1;\nexport const z = 0;\n");
  write(repo, "src/new.ts", "export const fresh = true;\n");
  git(repo, "add", "-N", "src/new.ts");
  patch = git(repo, "diff", "--patch", "HEAD");
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

const thread = (filePath: string, status: ReviewCommentStatus, evidenceId?: string): ReviewThread => ({
  id: `t-${Math.random().toString(36).slice(2)}`,
  filePath,
  ...(evidenceId === undefined ? {} : { evidenceId }),
  status,
  resolved: status === "resolved",
  comments: [{ id: "c1", body: "x", author: "me", createdAt: "2026-01-01T00:00:00Z" }],
});

describe("patchFileStats over a real git patch", () => {
  test("modified file with two hunks", () => {
    const stats = patchFileStats(patch);
    const a = stats.find((file) => file.path === "src/a.ts");
    expect(a).toBeDefined();
    expect(a?.status).toBe("M");
    expect(a?.additions).toBe(4);
    expect(a?.deletions).toBe(1);
    expect(a?.hunks.map(({ additions, deletions }) => ({ additions, deletions }))).toEqual([
      { additions: 3, deletions: 1 },
      { additions: 1, deletions: 0 },
    ]);
    expect(a?.hunks[0]?.header.startsWith("@@ -")).toBe(true);
  });

  test("intent-to-add file is A; paths come in patch order", () => {
    const stats = patchFileStats(patch);
    expect(stats.map((file) => file.path)).toEqual(["src/a.ts", "src/middleware/auth.ts", "src/new.ts"]);
    const fresh = stats.find((file) => file.path === "src/new.ts");
    expect(fresh?.status).toBe("A");
    expect(fresh?.additions).toBe(1);
    expect(stats.find((file) => file.path === "src/middleware/auth.ts")).toMatchObject({ status: "M", additions: 1, deletions: 4 });
  });

  test("deleted, renamed and binary files", () => {
    const synthetic = [
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "index 1111111..0000000",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-a",
      "-b",
      "diff --git a/old/name.ts b/new/name.ts",
      "similarity index 90%",
      "rename from old/name.ts",
      "rename to new/name.ts",
      "index 2222222..3333333 100644",
      "--- a/old/name.ts",
      "+++ b/new/name.ts",
      "@@ -1 +1 @@ fn",
      "-x",
      "+y",
      "diff --git a/img.png b/img.png",
      "index 4444444..5555555 100644",
      "Binary files a/img.png and b/img.png differ",
      "",
    ].join("\n");
    const stats = patchFileStats(synthetic);
    expect(stats).toEqual([
      { path: "gone.ts", status: "D", additions: 0, deletions: 2, hunks: [{ header: "@@ -1,2 +0,0 @@", additions: 0, deletions: 2 }] },
      { path: "new/name.ts", status: "R", additions: 1, deletions: 1, hunks: [{ header: "@@ -1 +1 @@ fn", additions: 1, deletions: 1 }] },
      { path: "img.png", status: "M", additions: 0, deletions: 0, hunks: [] },
    ]);
  });

  test("empty and null patches", () => {
    expect(patchFileStats("")).toEqual([]);
    expect(patchFileStats(null)).toEqual([]);
  });
});

describe("changesTree", () => {
  test("directory and file rows in path order, all needing review", () => {
    const files = patchFileStats(patch).filter((file) => file.path !== "src/a.ts" && file.path !== "src/new.ts");
    const retry: PatchFileStat = { path: "src/uploader/retry.ts", status: "M", additions: 1, deletions: 0, hunks: [] };
    const rows = changesTree([...files, retry], []);
    expect(rows.map(({ kind, depth, name, status, needsReview }) => ({ kind, depth, name, status, needsReview }))).toEqual([
      { kind: "dir", depth: 0, name: "src/", status: null, needsReview: true },
      { kind: "dir", depth: 1, name: "middleware/", status: null, needsReview: true },
      { kind: "file", depth: 2, name: "auth.ts", status: "M", needsReview: true },
      { kind: "dir", depth: 1, name: "uploader/", status: null, needsReview: true },
      { kind: "file", depth: 2, name: "retry.ts", status: "M", needsReview: true },
    ]);
    expect(rows[2]?.path).toBe("src/middleware/auth.ts");
    expect(rows[1]?.path).toBe("src/middleware");
  });

  test("directories come before files at each level", () => {
    const rows = changesTree(patchFileStats(patch), []);
    expect(rows.map((row) => row.name)).toEqual(["src/", "middleware/", "auth.ts", "a.ts", "new.ts"]);
  });

  test("settled threads clear a file; a directory stays only if a sibling needs review", () => {
    const files: PatchFileStat[] = [
      { path: "src/x/one.ts", status: "M", additions: 1, deletions: 0, hunks: [] },
      { path: "src/y/two.ts", status: "M", additions: 1, deletions: 0, hunks: [] },
      { path: "src/y/three.ts", status: "M", additions: 1, deletions: 0, hunks: [] },
    ];
    const threads = [
      thread("src/x/one.ts", "resolved"),
      thread("src/x/one.ts", "dismissed"),
      thread("src/y/two.ts", "resolved"),
      thread("src/y/three.ts", "sent"),
    ];
    const byPath = new Map(changesTree(files, threads).map((row) => [row.path, row.needsReview]));
    expect(byPath.get("src/x/one.ts")).toBe(false);
    expect(byPath.get("src/x")).toBe(false);
    expect(byPath.get("src/y/two.ts")).toBe(false);
    expect(byPath.get("src/y/three.ts")).toBe(true);
    expect(byPath.get("src/y")).toBe(true);
    expect(byPath.get("src")).toBe(true);
  });

  test("needsReview: open thread keeps it, no thread keeps it", () => {
    expect(needsReview("a.ts", [])).toBe(true);
    expect(needsReview("a.ts", [thread("a.ts", "open")])).toBe(true);
    expect(needsReview("a.ts", [thread("a.ts", "resolved"), thread("b.ts", "open")])).toBe(false);
  });
});

describe("minimapBars", () => {
  test("one bar per hunk in file order, sized to the largest hunk, toned by balance", () => {
    const bars = minimapBars(patchFileStats(patch));
    expect(bars.map(({ path, hunkIndex, tone }) => ({ path, hunkIndex, tone }))).toEqual([
      { path: "src/a.ts", hunkIndex: 0, tone: "add" },
      { path: "src/a.ts", hunkIndex: 1, tone: "add" },
      { path: "src/middleware/auth.ts", hunkIndex: 0, tone: "del" },
      { path: "src/new.ts", hunkIndex: 0, tone: "add" },
    ]);
    for (const bar of bars) {
      expect(bar.size).toBeGreaterThan(0);
      expect(bar.size).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...bars.map((bar) => bar.size))).toBe(1);
  });

  test("sizes 10 and 5 → 1 and 0.5", () => {
    const files: PatchFileStat[] = [
      { path: "a", status: "M", additions: 15, deletions: 0, hunks: [{ header: "@@", additions: 8, deletions: 2 }, { header: "@@", additions: 1, deletions: 4 }] },
    ];
    expect(minimapBars(files)).toEqual([
      { path: "a", hunkIndex: 0, size: 1, tone: "add" },
      { path: "a", hunkIndex: 1, size: 0.5, tone: "del" },
    ]);
  });

  test("no hunks → []", () => {
    expect(minimapBars([])).toEqual([]);
    expect(minimapBars([{ path: "b.png", status: "M", additions: 0, deletions: 0, hunks: [] }])).toEqual([]);
  });
});

describe("threadLocation", () => {
  test("evidence id wins, else file path", () => {
    expect(threadLocation({ filePath: "evidence:ev-abc123", evidenceId: "ev-abc123" })).toBe("evidence:ev-abc123");
    expect(threadLocation({ filePath: "src/a.ts", line: 3 })).toBe("src/a.ts");
  });
});

describe("artifactGroups", () => {
  const blob: IssueAttachment = { kind: "evidence", id: "ev-abc123", name: "shot.png", mime: "image/png", size: 10, sha256: "0".repeat(64), metadata: {}, wireUnknown: {} };
  const attachments: IssueAttachment[] = [
    blob,
    { path: "task.md", metadata: {}, wireUnknown: {} },
    { path: "src/a.ts", metadata: {}, wireUnknown: {} },
    { path: "src/new.ts", metadata: {}, wireUnknown: {} },
  ];
  const changed: PatchFileStat[] = [
    { path: "src/a.ts", status: "M", additions: 1, deletions: 0, hunks: [] },
    { path: "src/new.ts", status: "A", additions: 1, deletions: 0, hunks: [] },
  ];

  test("typed counts and groups", () => {
    const result = artifactGroups(attachments, changed, []);
    expect(result.counts).toEqual({ src: 1, edit: 1, new: 1, other: 1 });
    expect(result.groups.map((group) => ({ label: group.label, keys: group.rows.map((row) => row.key) }))).toEqual([
      { label: "IN CHANGES", keys: ["src/a.ts", "src/new.ts"] },
      { label: "UNREFERENCED", keys: ["evidence:ev-abc123", "task.md"] },
    ]);
    const evidence = result.groups[1]?.rows[0];
    expect(evidence).toEqual({ key: "evidence:ev-abc123", kind: "evidence", name: "shot.png", path: null, evidenceId: "ev-abc123", mime: "image/png", status: null, comments: 0 });
    expect(result.groups[0]?.rows[1]).toMatchObject({ kind: "file", name: "new.ts", path: "src/new.ts", evidenceId: null, mime: null, status: "A" });
  });

  test("comment counts: open+sent only, keyed by location", () => {
    const threads = [
      thread("evidence:ev-abc123", "open", "ev-abc123"),
      thread("evidence:ev-abc123", "sent", "ev-abc123"),
      thread("evidence:ev-abc123", "resolved", "ev-abc123"),
      thread("task.md", "open"),
    ];
    const rows = artifactGroups(attachments, changed, threads).groups.flatMap((group) => group.rows);
    expect(rows.find((row) => row.key === "evidence:ev-abc123")?.comments).toBe(2);
    expect(rows.find((row) => row.key === "task.md")?.comments).toBe(1);
    expect(rows.find((row) => row.key === "src/a.ts")?.comments).toBe(0);
  });

  test("empty groups are omitted", () => {
    expect(artifactGroups([blob], [], []).groups.map((group) => group.label)).toEqual(["UNREFERENCED"]);
    expect(artifactGroups([], [], [])).toEqual({ counts: { src: 0, edit: 0, new: 0, other: 0 }, groups: [] });
  });
});

describe("docBlocks / isDocPath", () => {
  test("splits on blank lines but not inside a fence", () => {
    const source = "# T\n\npara one\npara two\n\n```ts\na\n\nb\n```\n";
    expect(docBlocks(source)).toEqual([
      { line: 1, endLine: 1, text: "# T" },
      { line: 3, endLine: 4, text: "para one\npara two" },
      { line: 6, endLine: 10, text: "```ts\na\n\nb\n```" },
    ]);
  });

  test("trailing and leading blank lines produce no empty block", () => {
    expect(docBlocks("\n\nhello\n\n\n\n")).toEqual([{ line: 3, endLine: 3, text: "hello" }]);
    expect(docBlocks("")).toEqual([]);
  });

  test("isDocPath", () => {
    expect(isDocPath("task.md")).toBe(true);
    expect(isDocPath("docs/README.MARKDOWN")).toBe(true);
    expect(isDocPath("src/a.ts")).toBe(false);
  });
});

test("the module has only type imports (browser-safe)", () => {
  const source = readFileSync(join(import.meta.dir, "model.ts"), "utf8");
  const runtimeImports = source.split("\n").filter((line) => /^import\b/.test(line) && !/^import type\b/.test(line));
  expect(runtimeImports).toEqual([]);
});

test("reachable as @tasks/review/taskview", async () => {
  const mod = await import("@tasks/review/taskview");
  expect(typeof mod.patchFileStats).toBe("function");
});
