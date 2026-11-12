/**
 * In-view hunk edit (D-03): the pure-ish core behind the diff view's `e`
 * buffer. A hunk's new-side line range comes from the parsed diff metadata;
 * reads and writes go through `guardWorktreePath`, which keeps every write
 * under the worktree root — including through symlinked directories, which
 * the web guard (`packages/web/src/review.ts`) does not check. Mirrored here
 * on purpose: the TUI never imports the web package.
 */
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { HunkDiffFile } from "@tasks/review/opentui";

/** A hunk's new-side lines: 1-based `start`, `count` lines (0 = an insertion point after `start`). */
export interface HunkEditRange {
  readonly start: number;
  readonly count: number;
}

export interface HunkEditError {
  readonly ok: false;
  readonly kind: "escape" | "missing" | "stale";
  readonly message: string;
}

export type GuardOutcome = { readonly ok: true; readonly absolutePath: string } | HunkEditError;
export type ReadOutcome = { readonly ok: true; readonly text: string; readonly eol: "\n" | "\r\n" } | HunkEditError;
export type ApplyOutcome = { readonly ok: true } | HunkEditError;

/** The selected hunk's editable new-side range; null for binary, deleted, or missing hunks. */
export const hunkEditRange = (file: HunkDiffFile, hunkIndex: number): HunkEditRange | null => {
  if (file.isBinary === true || file.metadata.type === "deleted" || file.path === undefined || file.path === "") return null;
  const hunk = file.metadata.hunks[hunkIndex];
  if (hunk === undefined) return null;
  return { start: hunk.additionStart, count: hunk.additionCount };
};

const within = (root: string, candidate: string): boolean => candidate === root || candidate.startsWith(root + sep);

/** realpath of the nearest existing ancestor of `target` (the target itself when it exists). */
const nearestExistingReal = async (target: string): Promise<string | null> => {
  let current = target;
  for (;;) {
    try {
      return await realpath(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
};

/**
 * Resolves a repo-relative path under the worktree root. Refuses empty,
 * absolute, and NUL-containing paths, any `..` escape of `realpath(root)`,
 * and any path whose nearest existing ancestor (or the file itself) resolves
 * through a symlink to outside the root.
 */
export const guardWorktreePath = async (root: string, relativePath: string): Promise<GuardOutcome> => {
  const escape = (message: string): HunkEditError => ({ ok: false, kind: "escape", message });
  if (relativePath === "" || relativePath.startsWith("/") || relativePath.includes("\0")) {
    return escape("path must be repo-relative");
  }
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    return { ok: false, kind: "missing", message: `no worktree at ${root}` };
  }
  const absolutePath = resolve(realRoot, relativePath);
  if (!absolutePath.startsWith(realRoot + sep)) return escape(`path escapes ${realRoot}`);
  const real = await nearestExistingReal(absolutePath);
  if (real === null || !within(realRoot, real)) return escape(`path escapes ${realRoot} through a symlink`);
  return { ok: true, absolutePath };
};

interface FileLines {
  readonly lines: string[];
  readonly eol: "\n" | "\r\n";
  readonly trailing: boolean;
}

const splitFile = (contents: string): FileLines => {
  const eol = contents.includes("\r\n") ? "\r\n" : "\n";
  if (contents === "") return { lines: [], eol, trailing: true };
  const trailing = contents.endsWith(eol);
  const body = trailing ? contents.slice(0, -eol.length) : contents;
  return { lines: body.split(eol), eol, trailing };
};

/** 0-based splice index: line `start` for a real range, just after `start` for an insertion point. */
const regionIndex = (range: HunkEditRange): number => (range.count === 0 ? range.start : range.start - 1);

const regionOf = (file: FileLines, range: HunkEditRange): string | null => {
  const from = regionIndex(range);
  if (from < 0 || from + range.count > file.lines.length) return null;
  return file.lines.slice(from, from + range.count).join("\n");
};

const loadFile = async (root: string, relativePath: string): Promise<{ ok: true; absolutePath: string; file: FileLines } | HunkEditError> => {
  const guard = await guardWorktreePath(root, relativePath);
  if (!guard.ok) return guard;
  try {
    return { ok: true, absolutePath: guard.absolutePath, file: splitFile(await readFile(guard.absolutePath, "utf8")) };
  } catch {
    return { ok: false, kind: "missing", message: `no such file: ${relativePath}` };
  }
};

/** The range's current on-disk text, lines joined with `\n`, plus the file's line ending. */
export const readHunkRegion = async (root: string, relativePath: string, range: HunkEditRange): Promise<ReadOutcome> => {
  const loaded = await loadFile(root, relativePath);
  if (!loaded.ok) return loaded;
  const text = regionOf(loaded.file, range);
  if (text === null) return { ok: false, kind: "stale", message: `${relativePath} no longer has lines ${range.start}-${range.start + range.count - 1}` };
  return { ok: true, text, eol: loaded.file.eol };
};

/**
 * Replaces the range's lines with `next` (split on `\n`; empty = no lines),
 * keeping every other line, the file's line ending, and its trailing-newline
 * state. Refuses with `stale` when the on-disk region no longer equals
 * `original`, so a concurrent writer is never clobbered. Never throws.
 */
export const applyHunkEdit = async (
  root: string,
  relativePath: string,
  range: HunkEditRange,
  original: string,
  next: string,
): Promise<ApplyOutcome> => {
  const loaded = await loadFile(root, relativePath);
  if (!loaded.ok) return loaded;
  const { file } = loaded;
  if (regionOf(file, range) !== original) {
    return { ok: false, kind: "stale", message: `${relativePath} changed since the edit opened` };
  }
  const normalized = next.replace(/\r\n/g, "\n");
  const replacement = normalized === "" ? [] : normalized.split("\n");
  const lines = [...file.lines];
  lines.splice(regionIndex(range), range.count, ...replacement);
  const contents = lines.length === 0 ? "" : lines.join(file.eol) + (file.trailing ? file.eol : "");
  try {
    await writeFile(loaded.absolutePath, contents, "utf8");
    return { ok: true };
  } catch (cause) {
    return { ok: false, kind: "missing", message: `write failed: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
};

/** Largest file the artifact view reads (T-09-11); bigger files render a size note instead. */
export const ARTIFACT_READ_CAP = 2 * 1024 * 1024;

export type GuardedRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: "escape" | "missing" }
  | { readonly ok: false; readonly reason: "too-large"; readonly size: number };

/**
 * Whole-file read for the artifact view, through the same `guardWorktreePath`
 * as hunk edits: an escaping path (`..`, absolute, NUL, symlinked out) is
 * refused before any read; a missing file or root is `missing`; a file over
 * `ARTIFACT_READ_CAP` is `too-large` and is never read. Never throws.
 */
export const readGuardedFile = async (root: string, relPath: string): Promise<GuardedRead> => {
  const guard = await guardWorktreePath(root, relPath);
  if (!guard.ok) return { ok: false, reason: guard.kind === "escape" ? "escape" : "missing" };
  try {
    const info = await stat(guard.absolutePath);
    if (!info.isFile()) return { ok: false, reason: "missing" };
    if (info.size > ARTIFACT_READ_CAP) return { ok: false, reason: "too-large", size: info.size };
    return { ok: true, text: await readFile(guard.absolutePath, "utf8") };
  } catch {
    return { ok: false, reason: "missing" };
  }
};
