/**
 * Server-side review data for tk web (step 10): derives the live changeset the
 * same way `tk show` does (CHG-01 — read live, never cached), serves the raw
 * diff patch, guards worktree file IO, and bridges comment threads through the
 * task-store ReviewCommentStore seam from @tasks/review.
 *
 * The live patch is the worktree's working tree vs the pinned base when the
 * worktree exists (so uncommitted edits show up — the same contract as the TUI
 * review source), falling back to `base...branch` on the workspace root.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readPrRecord, type IssueAttachment, type Metadata, type PrRecord } from "@tasks/domain";
import { bunRunner, gitBranchHead, gitDiffPatch, gitDirtyCount, gitShowFile, type ProcessRunner } from "@tasks/git";
import {
  deriveChangeset,
  readChangesetBase,
  readChangesetSnapshot,
  type ChangesetCommit,
  type ChangesetCounts,
  type ChangesetFile,
  type SessionRow,
  type SurfaceStore,
} from "@tasks/surface";
import {
  reviewThreadCounts,
  taskStoreCommentStore,
  type AppendReplyInput,
  type CreateThreadInput,
  type ReviewThread,
  type ReviewThreadList,
  type SetResolvedInput,
  type ReviewCommentStatus,
  type ReviewSendResult,
  type ReviewThreadCounts,
} from "@tasks/review";
import {
  artifactGroups,
  changesTree,
  docBlocks,
  minimapBars,
  patchFileStats,
  threadLocation,
  type ArtifactGroups,
  type ChangesRow,
  type MinimapBar,
  type PatchFileStat,
} from "@tasks/review/taskview";

/** The fields this module needs off the issue wire (`issue.show` / board rows). */
export interface ReviewIssueLike {
  readonly id: string;
  readonly branch?: unknown;
  readonly metadata?: Metadata | null;
  readonly attachments?: readonly IssueAttachment[] | null;
}

export interface ReviewPayload {
  readonly id: string;
  readonly branch: string | null;
  readonly worktree: string | null;
  readonly base: string | null;
  readonly head: string | null;
  readonly commits: readonly ChangesetCommit[];
  readonly files: readonly ChangesetFile[];
  readonly counts: ChangesetCounts;
  /** Unified patch: worktree working tree vs base (live worktree) or base...branch; null when there is nothing to diff. */
  readonly patch: string | null;
  readonly patchError: string | null;
  /** Blob evidence on the task (`tk attach --evidence`), rendered in the diff flow as comment targets (09-07, D-06). */
  readonly evidence: readonly ReviewEvidence[];
}

/** One blob attachment the diff flow shows as an `evidence:<id>` comment target. */
export interface ReviewEvidence {
  readonly id: string;
  readonly name: string;
  readonly mime: string;
}

/** `ev-` + 6 base36 chars — the AttachmentId shape; anything else never reaches a URL or element id. */
const EVIDENCE_ID = /^ev-[a-z0-9]{6}$/;

/** Blob attachments (id + mime) off the issue wire; path attachments and malformed rows are skipped. */
const evidenceOf = (issue: ReviewIssueLike): readonly ReviewEvidence[] => {
  const attachments = Array.isArray(issue.attachments) ? issue.attachments : [];
  const out: ReviewEvidence[] = [];
  for (const attachment of attachments) {
    const row = attachment as { id?: unknown; name?: unknown; mime?: unknown };
    if (typeof row.id !== "string" || !EVIDENCE_ID.test(row.id) || typeof row.mime !== "string" || row.mime === "") continue;
    out.push({ id: row.id, name: typeof row.name === "string" && row.name !== "" ? row.name : row.id, mime: row.mime });
  }
  return out;
};

/** Object ids only — frozen metadata must never reach git as an option. */
const SHA = /^[0-9a-f]{7,64}$/;

const metadataOf = (issue: ReviewIssueLike): Metadata => {
  const raw = issue.metadata;
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
};

/** The recorded worktree path from `tk work`, or null when the task has none. */
export const worktreeOf = (issue: ReviewIssueLike): string | null => {
  const raw = metadataOf(issue)["worktree"];
  return typeof raw === "string" && raw !== "" ? raw : null;
};

/**
 * Unified diff text: working tree vs base inside a live worktree (uncommitted
 * edits included), else `base...branch` on the repo root.
 */
const diffPatch = async (
  repoRoot: string,
  worktree: string | null,
  base: string,
  branch: string,
  runner: ProcessRunner,
): Promise<string | null> => {
  if (worktree !== null) {
    try {
      if ((await stat(worktree)).isDirectory()) {
        const text = await gitDiffPatch(worktree, base, null, { fullIndex: true }, runner);
        if (text !== null) return text;
      }
    } catch { /* worktree gone; fall through to the branch-ref diff */ }
  }
  return gitDiffPatch(repoRoot, base, branch, { fullIndex: true }, runner);
};

/**
 * The live review payload for one issue: changeset (commits/files/counts) via
 * deriveChangeset, head via gitBranchHead, plus the raw patch. Never throws —
 * missing pieces degrade to null so the page can render what it has.
 */
export const reviewPayloadFor = async (
  root: string,
  issue: ReviewIssueLike,
  runner: ProcessRunner = bunRunner,
): Promise<ReviewPayload> => ({ ...(await changesetPayloadFor(root, issue, runner)), evidence: evidenceOf(issue) });

const changesetPayloadFor = async (
  root: string,
  issue: ReviewIssueLike,
  runner: ProcessRunner,
): Promise<Omit<ReviewPayload, "evidence">> => {
  const branch = typeof issue.branch === "string" && issue.branch !== "" ? issue.branch : null;
  const baseRecord = readChangesetBase(metadataOf(issue));
  if (branch === null || baseRecord === null) {
    return { id: issue.id, branch, worktree: worktreeOf(issue), base: baseRecord?.base ?? null, head: null, commits: [], files: [], counts: { additions: 0, deletions: 0 }, patch: null, patchError: null };
  }
  const base = baseRecord.base;
  const payload = await deriveChangeset({ cwd: root }, base, branch, runner);
  if (payload === null && (await gitBranchHead(root, branch, runner)) === null) {
    // Branch gone (closed + pruned): fall back to the snapshot frozen at close.
    // The frozen head SHA stays reachable once merged, so the patch re-derives.
    const frozen = readChangesetSnapshot(metadataOf(issue));
    if (frozen !== null && SHA.test(frozen.base) && SHA.test(frozen.head)) {
      const text = await gitDiffPatch(root, frozen.base, frozen.head, { fullIndex: true }, runner);
      return {
        id: issue.id, branch, worktree: worktreeOf(issue), base: frozen.base, head: frozen.head,
        commits: frozen.commits, files: frozen.files, counts: frozen.counts,
        patch: text,
        patchError: text === null ? "frozen snapshot head is no longer reachable; patch unavailable" : null,
      };
    }
  }
  const head = await gitBranchHead(root, branch, runner);
  const worktree = worktreeOf(issue);
  const patch = payload === null ? null : await diffPatch(root, worktree, base, branch, runner);
  return {
    id: issue.id,
    branch,
    worktree,
    base,
    head,
    commits: payload?.commits ?? [],
    files: payload?.files ?? [],
    counts: payload?.counts ?? { additions: 0, deletions: 0 },
    patch,
    patchError: payload === null ? "changeset derivation failed (missing branch or base?)" : null,
  };
};

/* ------------------------------------------------------------------ */
/* Task view (09-06) — one server-side model for the web task page.      */
/* ------------------------------------------------------------------ */

/** WORKSPC rail tab: the worktree contract made visible. */
export interface TaskViewWorkspace {
  readonly branch: string | null;
  readonly base: string | null;
  readonly worktree: string | null;
  /**
   * Short label for the worktree chip / WORKSPC row (09-11): repo-relative
   * when under the workspace root (TUI `displayPath`), else the
   * `.worktrees/<name>` tail, else the absolute path. Null without a worktree.
   */
  readonly worktreeLabel: string | null;
  readonly host: string;
  /** `git status --porcelain` entries in the worktree; null without a worktree or when git fails. */
  readonly dirty: number | null;
  /**
   * The task's PR mirror (11-05, D-01): `metadata.pr` validated by
   * `readPrRecord` (http(s) url only), or null before `tk pr create` / `open pr`.
   */
  readonly pr: PrRecord | null;
}

/**
 * The worktree's short label (09-11), mirroring the TUI's `displayPath`:
 * `relative(root, path)` when it stays under root; otherwise the
 * `.worktrees/<name>` tail (e.g. a `/tmp` vs `/private/tmp` mismatch);
 * otherwise the path as given.
 */
export const worktreeLabel = (root: string, path: string | null): string | null => {
  if (path === null) return null;
  const rel = relative(root, path);
  if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
  const at = path.lastIndexOf("/.worktrees/");
  return at >= 0 ? path.slice(at + 1) : path;
};

/** One COMMENTS preview row; `first` is the first line of the opening comment with the stored `[review …]` prefix stripped. */
export interface TaskViewCommentRow {
  readonly id: string;
  readonly author: string;
  readonly first: string;
  /** `path:line[-end]`, `path (file)` or `evidence:<id>`. */
  readonly location: string;
  /** Repo-relative file path for file/line threads (the artifact-view link); null for evidence. */
  readonly filePath: string | null;
  readonly status: string;
}

export interface TaskViewPayload {
  readonly stats: readonly PatchFileStat[];
  readonly changes: readonly ChangesRow[];
  readonly minimap: readonly MinimapBar[];
  readonly artifacts: ArtifactGroups;
  readonly sessions: readonly SessionRow[];
  readonly workspace: TaskViewWorkspace;
  readonly comments: { readonly counts: ReviewThreadCounts; readonly rows: readonly TaskViewCommentRow[] };
}

/** Same rule as the island's displayBody and the TUI diff: the store prefixes bodies with `[review <loc>] `. */
const REVIEW_PREFIX = /^\[review [^\]]*\]\s*/;

const commentRow = (thread: ReviewThread): TaskViewCommentRow => {
  const opening = thread.comments[0];
  const location = threadLocation(thread);
  const evidence = thread.evidenceId !== undefined || thread.filePath.startsWith("evidence:");
  const span = thread.line === undefined
    ? (evidence ? "" : " (file)")
    : `:${thread.line}${thread.endLine !== undefined && thread.endLine !== thread.line ? `-${thread.endLine}` : ""}`;
  return {
    id: thread.id,
    author: opening?.author ?? "",
    first: (opening?.body ?? "").replace(REVIEW_PREFIX, "").split("\n")[0] ?? "",
    location: location + span,
    filePath: evidence ? null : thread.filePath,
    status: thread.status,
  };
};

/**
 * The task-view payload (`GET /api/review/:id/taskview`): changes tree,
 * minimap and per-file stats from the same working-tree patch as
 * `/api/review/:id`, typed artifact groups, the SESSIONS rows, the WORKSPC
 * facts and the COMMENTS preview — all through `@tasks/review/taskview`, the
 * model the TUI reads too. Never throws on a task without a branch: the
 * patch is null and every list is empty.
 */
export const taskViewFor = async (
  root: string,
  issue: ReviewIssueLike,
  threads: readonly ReviewThread[],
  sessions: readonly SessionRow[],
  runner: ProcessRunner = bunRunner,
): Promise<TaskViewPayload> => {
  const payload = await reviewPayloadFor(root, issue, runner);
  const stats = patchFileStats(payload.patch);
  const worktree = worktreeOf(issue);
  let dirty: number | null = null;
  if (worktree !== null) {
    try {
      if ((await stat(worktree)).isDirectory()) dirty = await gitDirtyCount(worktree, runner);
    } catch { /* worktree gone */ }
  }
  return {
    stats,
    changes: changesTree(stats, threads),
    minimap: minimapBars(stats),
    artifacts: artifactGroups(Array.isArray(issue.attachments) ? issue.attachments : [], stats, threads),
    sessions,
    workspace: { branch: payload.branch, base: payload.base, worktree, worktreeLabel: worktreeLabel(root, worktree), host: hostname(), dirty, pr: readPrRecord(metadataOf(issue)) },
    comments: { counts: reviewThreadCounts(threads), rows: threads.map(commentRow) },
  };
};

/* ------------------------------------------------------------------ */
/* Worktree file IO — guarded reads/writes under the worktree root.     */
/* ------------------------------------------------------------------ */

export interface FileGuardError {
  readonly kind: "no_worktree" | "escape" | "missing";
  readonly message: string;
}

export type FileGuardOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: FileGuardError };

/**
 * Resolves a repo-relative path inside the issue's worktree (or the workspace
 * root when there is no worktree), refusing absolute paths and traversal that
 * escapes the root. The returned absolute path is guaranteed to stay under it.
 */
export const guardWorktreePath = (
  root: string,
  issue: ReviewIssueLike,
  relativePath: string,
): FileGuardOutcome<{ readonly absolutePath: string; readonly root: string }> => {
  if (relativePath === "" || relativePath.startsWith("/") || relativePath.includes("\0")) {
    return { ok: false, error: { kind: "escape", message: "path must be repo-relative" } };
  }
  const base = worktreeOf(issue) ?? root;
  const absolutePath = resolve(base, relativePath);
  const rootPrefix = resolve(base) + sep;
  if (!absolutePath.startsWith(rootPrefix)) {
    return { ok: false, error: { kind: "escape", message: `path escapes ${base}` } };
  }
  return { ok: true, value: { absolutePath, root: base } };
};

export const readWorktreeFile = async (
  root: string,
  issue: ReviewIssueLike,
  relativePath: string,
): Promise<FileGuardOutcome<{ readonly contents: string }>> => {
  const guard = guardWorktreePath(root, issue, relativePath);
  if (!guard.ok) return guard;
  try {
    return { ok: true, value: { contents: await readFile(guard.value.absolutePath, "utf8") } };
  } catch {
    return { ok: false, error: { kind: "missing", message: `no such file: ${relativePath}` } };
  }
};

/**
 * The file's exact bytes at the task's pinned changeset base (through
 * `@tasks/git` `gitShowFile`). The path is guarded like a worktree read; a
 * file absent at base (added on the branch) is `missing`.
 */
export const readBaseFile = async (
  root: string,
  issue: ReviewIssueLike,
  relativePath: string,
  runner: ProcessRunner = bunRunner,
): Promise<FileGuardOutcome<{ readonly contents: string }>> => {
  const guard = guardWorktreePath(root, issue, relativePath);
  if (!guard.ok) return guard;
  const base = readChangesetBase(metadataOf(issue))?.base ?? null;
  if (base === null || !SHA.test(base)) return { ok: false, error: { kind: "missing", message: "task has no pinned base" } };
  const contents = await gitShowFile(worktreeOf(issue) ?? root, base, relativePath, runner);
  if (contents === null) return { ok: false, error: { kind: "missing", message: `not at base: ${relativePath}` } };
  return { ok: true, value: { contents } };
};

/**
 * Writes a file inside the task's recorded worktree. Refused (`no_worktree`)
 * when the task has none — a web edit never writes into the main checkout.
 */
export const writeWorktreeFile = async (
  root: string,
  issue: ReviewIssueLike,
  relativePath: string,
  contents: string,
): Promise<FileGuardOutcome<{ readonly absolutePath: string }>> => {
  if (worktreeOf(issue) === null) return { ok: false, error: { kind: "no_worktree", message: `task has no worktree — run tk work ${issue.id}` } };
  const guard = guardWorktreePath(root, issue, relativePath);
  if (!guard.ok) return guard;
  try {
    await mkdir(dirname(guard.value.absolutePath), { recursive: true });
    await writeFile(guard.value.absolutePath, contents, "utf8");
    return { ok: true, value: { absolutePath: guard.value.absolutePath } };
  } catch (cause) {
    return { ok: false, error: { kind: "missing", message: `write failed: ${cause instanceof Error ? cause.message : String(cause)}` } };
  }
};

/* ------------------------------------------------------------------ */
/* Comment threads — the task-store ReviewCommentStore seam.            */
/* ------------------------------------------------------------------ */

/**
 * The comment-thread API the routes use, backed by the task-store seam.
 * Method names map 1:1 onto the ReviewCommentStore capability.
 */
export interface ReviewThreads {
  list(issueId: string): Promise<ReviewThreadList>;
  create(issueId: string, input: CreateThreadInput): Promise<ReviewThread>;
  reply(issueId: string, threadId: string, input: AppendReplyInput): Promise<ReviewThread>;
  editComment(issueId: string, threadId: string, commentId: string, body: string): Promise<ReviewThread>;
  setResolved(issueId: string, threadId: string, input: SetResolvedInput): Promise<ReviewThread>;
  setStatus(issueId: string, threadId: string, status: ReviewCommentStatus): Promise<ReviewThread>;
  sendOpen(issueId: string, only?: readonly string[]): Promise<ReviewSendResult>;
}

/** Threads over a surface's task store (the standard web wiring). */
export const reviewThreads = (store: SurfaceStore): ReviewThreads => {
  const comments = taskStoreCommentStore(store);
  return {
    list: (issueId) => comments.listThreads(issueId),
    create: (issueId, input) => comments.createThread(issueId, input),
    reply: (issueId, threadId, input) => comments.appendReply(issueId, threadId, input),
    editComment: (issueId, threadId, commentId, body) => comments.editThreadComment(issueId, threadId, commentId, body),
    setResolved: (issueId, threadId, input) => comments.setThreadResolved(issueId, threadId, input),
    setStatus: (issueId, threadId, status) => comments.setThreadStatus(issueId, threadId, status),
    sendOpen: (issueId, only) => comments.sendOpen(issueId, only),
  };
};

/** One rendered doc block (09-08, D-05): 1-based inclusive source range + sanitized HTML. */
export interface DocBlockHtml {
  readonly line: number;
  readonly endLine: number;
  readonly html: string;
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", colon: ":", tab: "\t", newline: "\n" };

/** Decodes the entities an attribute value may carry, so `&#106;avascript:` is checked as `javascript:`. */
const decodeEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (match, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? match;
  });

/** http(s), mailto, in-page anchors and relative paths; anything else (javascript:, data:, vbscript:…) is dropped. */
const SAFE_URL = /^(https?:|mailto:|#|\.{0,2}\/|[^:]*$)/i;

/**
 * Removes every `href`/`src` whose (entity-decoded, whitespace/control-stripped)
 * value falls outside SAFE_URL. Bun.markdown emits double-quoted attributes only.
 */
export const scrubDocHtml = (html: string): string =>
  html.replace(/\s(href|src)\s*=\s*"([^"]*)"/gi, (match, _name: string, value: string) => {
    // Browsers ignore ASCII whitespace/control chars inside a scheme (`java\tscript:`), so the check does too.
    const decoded = decodeEntities(value).replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
    return SAFE_URL.test(decoded) ? match : "";
  });

/**
 * A markdown doc as commentable blocks (09-08, D-05): `docBlocks` ranges, each
 * rendered by `Bun.markdown.html` with raw HTML blocks/spans disabled (escaped),
 * then scrubbed of unsafe link/image targets. The only HTML the island injects.
 */
export const renderDocBlocks = (contents: string): readonly DocBlockHtml[] =>
  docBlocks(contents).map((block) => ({
    line: block.line,
    endLine: block.endLine,
    html: scrubDocHtml(Bun.markdown.html(block.text, { noHtmlBlocks: true, noHtmlSpans: true })).trim(),
  }));

/** Narrow a parsed JSON body to the string fields thread inputs need. */
export const threadInputFrom = (body: Record<string, unknown>): CreateThreadInput | null => {
  const evidence = body["evidenceId"];
  const evidenceId = typeof evidence === "string" && evidence !== "" ? evidence.replace(/^evidence:/, "") : undefined;
  const rawPath = body["filePath"];
  const filePath = typeof rawPath === "string" && rawPath !== "" ? rawPath : evidenceId === undefined ? undefined : `evidence:${evidenceId}`;
  if (filePath === undefined) return null;
  const text = body["body"];
  if (typeof text !== "string" || text === "") return null;
  const side = body["side"];
  const line = body["line"];
  return {
    filePath,
    body: text,
    ...(evidenceId === undefined ? {} : { evidenceId }),
    ...(typeof line === "number" && Number.isFinite(line) && line > 0 ? { line: Math.floor(line) } : {}),
    ...(typeof line === "number" && line > 0 && typeof body["endLine"] === "number" && Number.isFinite(body["endLine"]) && Math.floor(body["endLine"]) > Math.floor(line) ? { endLine: Math.floor(body["endLine"]) } : {}),
    ...(side === "old" || side === "new" ? { side } : {}),
  };
};

export type { ReviewThread, ReviewThreadList };
