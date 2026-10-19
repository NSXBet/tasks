/**
 * Server-side review data for tk web (step 10): derives the live changeset the
 * same way `tk show` does (CHG-01 — read live, never cached), serves the raw
 * diff patch, guards worktree file IO, and bridges comment threads through the
 * task-store ReviewCommentStore seam from @tasks/review.
 *
 * All git work happens in the issue's worktree when one exists (so uncommitted
 * edits show up), falling back to the workspace root via the branch ref.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { Metadata } from "@tasks/domain";
import { bunRunner, gitBranchHead, type ProcessRunner } from "@tasks/git";
import {
  deriveChangeset,
  readChangesetBase,
  type ChangesetCommit,
  type ChangesetCounts,
  type ChangesetFile,
  type SurfaceStore,
} from "@tasks/surface";
import {
  taskStoreCommentStore,
  type AppendReplyInput,
  type CreateThreadInput,
  type ReviewThread,
  type ReviewThreadList,
  type SetResolvedInput,
} from "@tasks/review";

/** The fields this module needs off the issue wire (`issue.show` / board rows). */
export interface ReviewIssueLike {
  readonly id: string;
  readonly branch?: unknown;
  readonly metadata?: Metadata | null;
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
  /** Unified patch for base...HEAD; null when there is nothing to diff. */
  readonly patch: string | null;
  readonly patchError: string | null;
}

const metadataOf = (issue: ReviewIssueLike): Metadata => {
  const raw = issue.metadata;
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
};

/** The recorded worktree path from `tk work`, or null when the task has none. */
export const worktreeOf = (issue: ReviewIssueLike): string | null => {
  const raw = metadataOf(issue)["worktree"];
  return typeof raw === "string" && raw !== "" ? raw : null;
};

const run = async (cwd: string, args: string[], runner: ProcessRunner): Promise<string | null> => {
  const result = await runner.run(args, cwd);
  return result.code === 0 ? result.stdout : null;
};

/** Unified diff text for base...head; prefers the worktree checkout so uncommitted edits appear. */
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
        const text = await run(worktree, ["git", "diff", "--patch", "--full-index", `${base}...HEAD`], runner);
        if (text !== null) return text;
      }
    } catch { /* worktree gone; fall through to the branch-ref diff */ }
  }
  return run(repoRoot, ["git", "diff", "--patch", "--full-index", `${base}...${branch}`], runner);
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
): Promise<ReviewPayload> => {
  const branch = typeof issue.branch === "string" && issue.branch !== "" ? issue.branch : null;
  const baseRecord = readChangesetBase(metadataOf(issue));
  if (branch === null || baseRecord === null) {
    return { id: issue.id, branch, worktree: worktreeOf(issue), base: baseRecord?.base ?? null, head: null, commits: [], files: [], counts: { additions: 0, deletions: 0 }, patch: null, patchError: null };
  }
  const base = baseRecord.base;
  const payload = await deriveChangeset({ cwd: root }, base, branch, runner);
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

export const writeWorktreeFile = async (
  root: string,
  issue: ReviewIssueLike,
  relativePath: string,
  contents: string,
): Promise<FileGuardOutcome<{ readonly absolutePath: string }>> => {
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
  };
};

/** Narrow a parsed JSON body to the string fields thread inputs need. */
export const threadInputFrom = (body: Record<string, unknown>): CreateThreadInput | null => {
  const filePath = body["filePath"];
  if (typeof filePath !== "string" || filePath === "") return null;
  const text = body["body"];
  if (typeof text !== "string" || text === "") return null;
  const side = body["side"];
  const line = body["line"];
  return {
    filePath,
    body: text,
    ...(typeof line === "number" && Number.isFinite(line) && line > 0 ? { line: Math.floor(line) } : {}),
    ...(side === "old" || side === "new" ? { side } : {}),
  };
};

export type { ReviewThread, ReviewThreadList };
