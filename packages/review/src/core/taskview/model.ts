/**
 * The shared task-view model.
 *
 * The TUI task view and the web task view both draw the same rail (changes
 * tree, minimap), the same artifact list and the same commentable doc blocks.
 * Every one of those is derived here from plain inputs — a `git diff --patch`
 * text, the task's attachments, its review threads, a markdown source — so the
 * two surfaces show the same files, counts and comment targets.
 *
 * Type-only imports keep the module browser-safe: the web island and the web
 * server load it through the `@tasks/review/taskview` subpath without pulling
 * storage, fs or git code.
 */
import type { IssueAttachment, IssueBlobAttachment } from "@tasks/domain";
import type { ReviewThread, ReviewThreadPlacement } from "../review/commentStore.js";

/** One `@@ … @@` hunk: its header line and its +/- body line counts. */
export interface PatchHunkStat {
  readonly header: string;
  readonly additions: number;
  readonly deletions: number;
}

/** Git-style status letter of a changed file. */
export type PatchFileStatus = "A" | "M" | "D" | "R";

/** One file of a patch. Binary files carry zero counts and no hunks. */
export interface PatchFileStat {
  readonly path: string;
  readonly status: PatchFileStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: readonly PatchHunkStat[];
}

/** One row of the changes tree: a directory (`name` ends in `/`) or a file. */
export interface ChangesRow {
  readonly kind: "dir" | "file";
  readonly depth: number;
  readonly name: string;
  /** Directory path without trailing slash, or the file path. */
  readonly path: string;
  /** File status letter; null on directories. */
  readonly status: string | null;
  readonly needsReview: boolean;
}

/** One minimap bar: a hunk, sized relative to the largest hunk, and where it jumps to. */
export interface MinimapBar {
  readonly path: string;
  readonly hunkIndex: number;
  /** In (0, 1]; the largest hunk is 1. */
  readonly size: number;
  readonly tone: "add" | "del";
}

// ---------------------------------------------------------------------------
// patchFileStats

const unquote = (raw: string): string => {
  const value = raw.trim();
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
};

/** Strips a `a/` / `b/` prefix from a `---`/`+++` side; null for `/dev/null`. */
const sidePath = (raw: string): string | null => {
  const value = unquote(raw.replace(/\t.*$/, ""));
  if (value === "/dev/null") return null;
  return value.startsWith("a/") || value.startsWith("b/") ? value.slice(2) : value;
};

/** Best-effort `b/` path from a `diff --git a/X b/Y` header (fallback when no `+++`/`---` line follows, e.g. binary). */
const headerPath = (line: string): string => {
  const rest = line.slice("diff --git ".length);
  const marker = rest.lastIndexOf(" b/");
  if (marker >= 0) return unquote(rest.slice(marker + 3));
  return unquote(rest).replace(/^a\//, "");
};

interface FileDraft {
  headerPath: string;
  oldPath: string | null;
  newPath: string | null;
  renameTo: string | null;
  status: PatchFileStatus;
  additions: number;
  deletions: number;
  hunks: { header: string; additions: number; deletions: number }[];
  inHunk: boolean;
}

const finish = (draft: FileDraft): PatchFileStat => ({
  path: draft.renameTo ?? (draft.status === "D" ? draft.oldPath : draft.newPath) ?? draft.newPath ?? draft.oldPath ?? draft.headerPath,
  status: draft.status,
  additions: draft.additions,
  deletions: draft.deletions,
  hunks: draft.hunks.map(({ header, additions, deletions }) => ({ header, additions, deletions })),
});

/**
 * Parses a `git diff --patch` text into one entry per file — the single parse
 * the TUI and web rails both read. Single linear pass with per-line prefix
 * checks (no whole-text regex), so huge patches stay linear.
 */
export function patchFileStats(patch: string | null): readonly PatchFileStat[] {
  if (!patch) return [];
  const files: PatchFileStat[] = [];
  let draft: FileDraft | null = null;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (draft) files.push(finish(draft));
      draft = { headerPath: headerPath(line), oldPath: null, newPath: null, renameTo: null, status: "M", additions: 0, deletions: 0, hunks: [], inHunk: false };
      continue;
    }
    if (!draft) continue;
    if (draft.inHunk) {
      const hunk = draft.hunks[draft.hunks.length - 1];
      if (line.startsWith("@@")) {
        // falls through to the header branch below
      } else if (line.startsWith("+")) {
        draft.additions += 1;
        if (hunk) hunk.additions += 1;
        continue;
      } else if (line.startsWith("-")) {
        draft.deletions += 1;
        if (hunk) hunk.deletions += 1;
        continue;
      } else {
        continue;
      }
    }
    if (line.startsWith("@@")) {
      draft.inHunk = true;
      draft.hunks.push({ header: line, additions: 0, deletions: 0 });
    } else if (line.startsWith("new file mode")) {
      draft.status = "A";
    } else if (line.startsWith("deleted file mode")) {
      draft.status = "D";
    } else if (line.startsWith("rename to ")) {
      draft.status = "R";
      draft.renameTo = unquote(line.slice("rename to ".length));
    } else if (line.startsWith("--- ")) {
      draft.oldPath = sidePath(line.slice(4));
    } else if (line.startsWith("+++ ")) {
      draft.newPath = sidePath(line.slice(4));
    }
  }
  if (draft) files.push(finish(draft));
  return files;
}

// ---------------------------------------------------------------------------
// threads → review state

/** The key every view attaches comments to: `evidence:<id>` for evidence, else the file path. */
export function threadLocation(thread: Pick<ReviewThreadPlacement, "filePath" | "evidenceId">): string {
  return thread.evidenceId !== undefined ? `evidence:${thread.evidenceId}` : thread.filePath;
}

const isLive = (thread: Pick<ReviewThread, "status">): boolean => thread.status === "open" || thread.status === "sent";

/**
 * Whether a target still needs review. The store has no per-file "reviewed"
 * flag, so settled comments are the review signal: true when no thread sits
 * on the location or any thread there is open/sent; false when it has ≥1
 * thread and all are resolved/dismissed.
 */
export function needsReview(location: string, threads: readonly ReviewThread[]): boolean {
  const here = threads.filter((thread) => threadLocation(thread) === location);
  return here.length === 0 || here.some(isLive);
}

// ---------------------------------------------------------------------------
// changesTree

interface DirNode {
  readonly dirs: Map<string, DirNode>;
  readonly files: PatchFileStat[];
}

const emptyDir = (): DirNode => ({ dirs: new Map(), files: [] });
const byName = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * Directory and file rows in path order, directories before files at each
 * level (`src/` → `middleware/` → `auth.ts`). A directory needs review when any
 * file under it does — the spec's folder dot.
 */
export function changesTree(files: readonly PatchFileStat[], threads: readonly ReviewThread[]): readonly ChangesRow[] {
  const root = emptyDir();
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let next = node.dirs.get(part);
      if (!next) {
        next = emptyDir();
        node.dirs.set(part, next);
      }
      node = next;
    }
    node.files.push(file);
  }
  const rows: ChangesRow[] = [];
  const walk = (node: DirNode, prefix: string, depth: number): boolean => {
    let any = false;
    for (const name of [...node.dirs.keys()].sort(byName)) {
      const path = prefix ? `${prefix}/${name}` : name;
      const index = rows.length;
      rows.push({ kind: "dir", depth, name: `${name}/`, path, status: null, needsReview: false });
      const dirty = walk(node.dirs.get(name) as DirNode, path, depth + 1);
      rows[index] = { ...(rows[index] as ChangesRow), needsReview: dirty };
      any ||= dirty;
    }
    for (const file of [...node.files].sort((left, right) => byName(left.path, right.path))) {
      const dirty = needsReview(file.path, threads);
      rows.push({ kind: "file", depth, name: baseName(file.path), path: file.path, status: file.status, needsReview: dirty });
      any ||= dirty;
    }
    return any;
  };
  walk(root, "", 0);
  return rows;
}

// ---------------------------------------------------------------------------
// minimapBars

/** One bar per hunk in file order; size relative to the largest hunk; `add` when additions ≥ deletions. */
export function minimapBars(files: readonly PatchFileStat[]): readonly MinimapBar[] {
  let largest = 0;
  for (const file of files) for (const hunk of file.hunks) largest = Math.max(largest, hunk.additions + hunk.deletions);
  const bars: MinimapBar[] = [];
  for (const file of files) {
    file.hunks.forEach((hunk, hunkIndex) => {
      const weight = hunk.additions + hunk.deletions;
      // A zero-line hunk still gets a visible sliver so the bar stays in (0, 1].
      const size = largest === 0 ? 1 : Math.max(weight, 0.5) / largest;
      bars.push({ path: file.path, hunkIndex, size: Math.min(size, 1), tone: hunk.additions >= hunk.deletions ? "add" : "del" });
    });
  }
  return bars;
}

// ---------------------------------------------------------------------------
// artifactGroups

/** Typed artifact counts the task view reads before anything opens. */
export interface ArtifactCounts {
  readonly src: number;
  readonly edit: number;
  readonly new: number;
  readonly other: number;
}

export interface ArtifactRow {
  /** Comment location key: `evidence:<id>` or the path. */
  readonly key: string;
  readonly kind: "evidence" | "file";
  readonly name: string;
  readonly path: string | null;
  readonly evidenceId: string | null;
  readonly mime: string | null;
  /** Change status letter when the path is in the changeset; null otherwise. */
  readonly status: string | null;
  /** open + sent threads on `key`. */
  readonly comments: number;
}

export interface ArtifactGroup {
  readonly label: "IN CHANGES" | "UNREFERENCED";
  readonly rows: readonly ArtifactRow[];
}

export interface ArtifactGroups {
  readonly counts: ArtifactCounts;
  readonly groups: readonly ArtifactGroup[];
}

const isBlob = (attachment: IssueAttachment): attachment is IssueBlobAttachment => "kind" in attachment;

/**
 * Groups the task's artifacts the way the task view lists them.
 *
 * Classification: a blob attachment (`tk evidence` upload) → `other`, keyed
 * `evidence:<id>`, group UNREFERENCED; a path attachment whose path is a
 * changed file → `new` (A) or `edit` (M/R/D), group IN CHANGES; any other path
 * attachment → `src`, group UNREFERENCED. Rows keep attachment order; empty
 * groups are omitted.
 */
export function artifactGroups(
  attachments: readonly IssueAttachment[],
  changed: readonly PatchFileStat[],
  threads: readonly ReviewThread[],
): ArtifactGroups {
  const live = new Map<string, number>();
  for (const thread of threads) {
    if (!isLive(thread)) continue;
    const key = threadLocation(thread);
    live.set(key, (live.get(key) ?? 0) + 1);
  }
  const statusByPath = new Map(changed.map((file) => [file.path, file.status]));
  const counts = { src: 0, edit: 0, new: 0, other: 0 };
  const inChanges: ArtifactRow[] = [];
  const unreferenced: ArtifactRow[] = [];
  for (const attachment of attachments) {
    if (isBlob(attachment)) {
      const key = `evidence:${attachment.id}`;
      counts.other += 1;
      unreferenced.push({ key, kind: "evidence", name: attachment.name, path: null, evidenceId: attachment.id, mime: attachment.mime, status: null, comments: live.get(key) ?? 0 });
      continue;
    }
    const key = attachment.path;
    const status = statusByPath.get(attachment.path) ?? null;
    const row: ArtifactRow = { key, kind: "file", name: baseName(attachment.path), path: attachment.path, evidenceId: null, mime: null, status, comments: live.get(key) ?? 0 };
    if (status === null) {
      counts.src += 1;
      unreferenced.push(row);
    } else {
      if (status === "A") counts.new += 1;
      else counts.edit += 1;
      inChanges.push(row);
    }
  }
  const groups: ArtifactGroup[] = [];
  if (inChanges.length > 0) groups.push({ label: "IN CHANGES", rows: inChanges });
  if (unreferenced.length > 0) groups.push({ label: "UNREFERENCED", rows: unreferenced });
  return { counts, groups };
}

// ---------------------------------------------------------------------------
// docs

/** One commentable doc block; `line`/`endLine` are 1-based and inclusive. */
export interface DocBlock {
  readonly line: number;
  readonly endLine: number;
  readonly text: string;
}

/** True for markdown paths, which the artifact view renders as docs. */
export function isDocPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

const isFence = (line: string): boolean => {
  const trimmed = line.trimStart();
  return trimmed.startsWith("```") || trimmed.startsWith("~~~");
};

/** Splits markdown into blocks on blank lines, never splitting inside a ``` / ~~~ fence. */
export function docBlocks(source: string): readonly DocBlock[] {
  const lines = source.split("\n");
  const blocks: DocBlock[] = [];
  let start = -1;
  let inFence = false;
  const close = (end: number): void => {
    if (start < 0) return;
    blocks.push({ line: start + 1, endLine: end + 1, text: lines.slice(start, end + 1).join("\n") });
    start = -1;
  };
  lines.forEach((line, index) => {
    const blank = line.trim() === "";
    if (blank && !inFence) {
      close(index - 1);
      return;
    }
    if (start < 0) start = index;
    if (isFence(line)) inFence = !inFence;
  });
  // An unterminated fence or a final block without a trailing blank line still closes; trailing blank lines are trimmed.
  let end = lines.length - 1;
  while (end >= start && start >= 0 && (lines[end] ?? "").trim() === "") end -= 1;
  close(end);
  return blocks;
}
