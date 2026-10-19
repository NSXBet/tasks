/**
 * The storage seam for review threads.
 *
 * The review component must not know about task stores, issue metadata, or
 * comment records. It needs exactly one capability: threads of comments
 * anchored to a diff line, with resolve state, durable across launches. This
 * module names that capability as an interface plus the pure vocabulary
 * (thread shapes, registry codec, merge policy) any storage backend feeds it.
 *
 * Backends live above this seam — see `app/taskStoreCommentStore.ts` for the
 * task-store adapter. Core consumes the interface only.
 */

/** Which side of the diff a thread hangs on. */
export type ReviewCommentSide = "old" | "new";

/** The one diff line a thread is anchored to. */
export interface ReviewThreadPlacement {
  readonly filePath: string;
  readonly line?: number;
  readonly side?: ReviewCommentSide;
}

export interface ReviewThreadComment {
  readonly id: string;
  readonly body: string;
  readonly author: string;
  /** ISO 8601 instant. */
  readonly createdAt: string;
  /** ISO 8601 instant when the body last changed; absent for untouched comments. */
  readonly editedAt?: string;
}

export interface ReviewThread extends ReviewThreadPlacement {
  readonly id: string;
  readonly resolved: boolean;
  /** ISO 8601 instant; present exactly when resolved. */
  readonly resolvedAt?: string;
  readonly resolvedBy?: string;
  readonly comments: readonly ReviewThreadComment[];
}

export interface CreateThreadInput extends ReviewThreadPlacement {
  readonly body: string;
  readonly author?: string;
}

export interface AppendReplyInput {
  readonly body: string;
  readonly author?: string;
}

export interface SetResolvedInput {
  readonly resolved: boolean;
  readonly actor?: string;
}

export interface ReviewThreadList {
  readonly threads: readonly ReviewThread[];
  /** True only when at least one thread exists and every thread is resolved. */
  readonly allResolved: boolean;
}

/** The whole capability review consumers are granted over comment storage. */
export interface ReviewCommentStore {
  createThread(issueId: string, input: CreateThreadInput): Promise<ReviewThread>;
  appendReply(issueId: string, threadId: string, input: AppendReplyInput): Promise<ReviewThread>;
  /** Rewrites one comment's body inside an existing thread. */
  editThreadComment(issueId: string, threadId: string, commentId: string, body: string): Promise<ReviewThread>;
  /** Flips (or clears) a thread's resolve state. */
  setThreadResolved(issueId: string, threadId: string, input: SetResolvedInput): Promise<ReviewThread>;
  listThreads(issueId: string): Promise<ReviewThreadList>;
}

export class ReviewCommentStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ReviewCommentStoreError";
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/** Every thread resolved and at least one thread present. */
export function reviewAllThreadsResolved(threads: readonly ReviewThread[]): boolean {
  return threads.length > 0 && threads.every((thread) => thread.resolved);
}

/**
 * Thread registry persisted by the backend in whatever durable side record it
 * owns (task-store issue metadata here). The codec is pure and defensive: a
 * malformed record is skipped rather than trusted.
 */
export const reviewThreadRegistryKey = "reviewThreads";

export interface ReviewThreadRecord {
  readonly id: string;
  readonly filePath: string;
  readonly line?: number;
  readonly side?: ReviewCommentSide;
  readonly rootCommentId: string;
  readonly replyCommentIds: readonly string[];
  readonly resolved: boolean;
  readonly resolvedAt?: string;
  readonly resolvedBy?: string;
  readonly editedAtByCommentId: Readonly<Record<string, string>>;
}

export interface ReviewThreadRegistry {
  readonly version: 1;
  readonly threads: readonly ReviewThreadRecord[];
}

/** The JSON vocabulary a backend metadata bag accepts; the seam stays decoupled from tk's schema lib. */
export type ReviewJsonValue = null | boolean | number | string | readonly ReviewJsonValue[] | { readonly [key: string]: ReviewJsonValue };

/** The registry in its storable form, ready to drop into a metadata value. */
export type SerializedReviewThreadRegistry = { readonly [key: string]: ReviewJsonValue };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

const asPlacement = (record: Record<string, unknown>): Omit<ReviewThreadRecord, "id" | "rootCommentId" | "replyCommentIds" | "resolved" | "editedAtByCommentId"> | null => {
  const filePath = asString(record.filePath);
  if (!filePath) return null;
  const line = typeof record.line === "number" && Number.isInteger(record.line) && record.line > 0 ? record.line : undefined;
  const side = record.side === "old" || record.side === "new" ? record.side : undefined;
  return { filePath, line, side };
};

export function parseReviewThreadRegistry(metadata: Readonly<Record<string, unknown>>): ReviewThreadRegistry {
  const raw = metadata[reviewThreadRegistryKey];
  if (!isPlainObject(raw) || raw.version !== 1 || !Array.isArray(raw.threads)) return { version: 1, threads: [] };
  const threads: ReviewThreadRecord[] = [];
  for (const entry of raw.threads) {
    if (!isPlainObject(entry)) continue;
    const id = asString(entry.id);
    const rootCommentId = asString(entry.rootCommentId);
    const placement = asPlacement(entry);
    if (!id || !rootCommentId || !placement) continue;
    const replyCommentIds = Array.isArray(entry.replyCommentIds) ? entry.replyCommentIds.filter((value): value is string => typeof value === "string") : [];
    const editedAtByCommentId: Record<string, string> = {};
    if (isPlainObject(entry.editedAtByCommentId)) {
      for (const [commentId, editedAt] of Object.entries(entry.editedAtByCommentId)) {
        if (typeof editedAt === "string") editedAtByCommentId[commentId] = editedAt;
      }
    }
    const resolved = entry.resolved === true;
    threads.push({
      id,
      rootCommentId,
      replyCommentIds,
      resolved,
      resolvedAt: resolved ? asString(entry.resolvedAt) : undefined,
      resolvedBy: resolved ? asString(entry.resolvedBy) : undefined,
      editedAtByCommentId,
      ...placement,
    });
  }
  return { version: 1, threads };
}

export function serializeReviewThreadRegistry(registry: ReviewThreadRegistry): SerializedReviewThreadRegistry {
  return {
    version: 1,
    threads: registry.threads.map((record) => ({
      id: record.id,
      rootCommentId: record.rootCommentId,
      replyCommentIds: [...record.replyCommentIds],
      resolved: record.resolved,
      editedAtByCommentId: { ...record.editedAtByCommentId },
      filePath: record.filePath,
      ...(record.line === undefined ? {} : { line: record.line }),
      ...(record.side === undefined ? {} : { side: record.side }),
      ...(record.resolvedAt === undefined ? {} : { resolvedAt: record.resolvedAt }),
      ...(record.resolvedBy === undefined ? {} : { resolvedBy: record.resolvedBy }),
    })),
  };
}

/**
 * The human-readable comment body stored in the backend, so `tk show` renders
 * review comments like every other comment.
 */
export function formatReviewThreadComment(kind: "root" | "reply", placement: ReviewThreadPlacement, body: string): string {
  if (kind === "reply") return `[review reply] ${body}`;
  const location = placement.line === undefined ? placement.filePath : `${placement.filePath}:${placement.line}`;
  const side = placement.side === "old" ? " (old)" : "";
  return `[review ${location}${side}] ${body}`;
}

/** Minimal structural view of a stored comment the backend feeds the merge. */
export interface StoredCommentRecord {
  readonly id: string;
  readonly author: string;
  readonly text: string;
  readonly createdAt: Date;
  /** ISO 8601 instant when the thread comment was last resolved, if the backend mirrors resolve state onto the record. */
  readonly wire?: Readonly<Record<string, unknown>>;
}

/**
 * Joins persisted registry records with their stored comment records into the
 * component's thread shape. Records whose comments vanished from the backend
 * are skipped; comment bodies are taken from the stored records so edits made
 * outside the review UI stay visible.
 */
export function joinThreadRecords(records: readonly ReviewThreadRecord[], comments: readonly StoredCommentRecord[]): ReviewThread[] {
  const commentById: Record<string, StoredCommentRecord> = {};
  for (const comment of comments) commentById[comment.id] = comment;
  const threads: ReviewThread[] = [];
  for (const record of records) {
    const join = (commentId: string): ReviewThreadComment | null => {
      const comment = commentById[commentId];
      if (!comment) return null;
      const editedAt = record.editedAtByCommentId[commentId];
      return {
        id: comment.id,
        body: comment.text,
        author: comment.author,
        createdAt: comment.createdAt.toISOString(),
        ...(editedAt === undefined ? {} : { editedAt }),
      };
    };
    const root = join(record.rootCommentId);
    if (!root) continue;
    const replies = record.replyCommentIds.map((id) => join(id)).filter((comment): comment is ReviewThreadComment => comment !== null);
    threads.push({
      id: record.id,
      filePath: record.filePath,
      ...(record.line === undefined ? {} : { line: record.line }),
      ...(record.side === undefined ? {} : { side: record.side }),
      resolved: record.resolved,
      ...(record.resolvedAt === undefined ? {} : { resolvedAt: record.resolvedAt }),
      ...(record.resolvedBy === undefined ? {} : { resolvedBy: record.resolvedBy }),
      comments: [root, ...replies],
    });
  }
  return threads;
}
