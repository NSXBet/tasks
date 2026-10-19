/**
 * The task-store-backed implementation of the review component's comment seam.
 *
 * Review threads live entirely inside one issue's own records: the thread
 * registry (placements, reply chains, resolve state) is a side record under
 * `metadata.reviewThreads`, and every thread comment is an ordinary issue
 * comment marked with `wireUnknown.reviewThread`, so `tk show` renders review
 * comments like every other comment and the CLI's existing comment read is
 * the same read this adapter merges from.
 */

import type { Issue } from "@tasks/domain";
import { getOrThrow, type SurfaceStore } from "@tasks/surface";
import {
  ReviewCommentStoreError,
  formatReviewThreadComment,
  joinThreadRecords,
  parseReviewThreadRegistry,
  reviewAllThreadsResolved,
  reviewThreadRegistryKey,
  serializeReviewThreadRegistry,
  type AppendReplyInput,
  type CreateThreadInput,
  type ReviewCommentStore,
  type ReviewThread,
  type ReviewThreadList,
  type ReviewThreadPlacement,
  type ReviewThreadRecord,
  type ReviewThreadRegistry,
  type SetResolvedInput,
  type StoredCommentRecord,
} from "../core/review/commentStore";

/** Root comment marker: `tkr-<threadId>` keeps ids deterministic per thread. */
const threadRootCommentId = (threadId: string): string => `tkr-${threadId}`;

/** Reply marker: `tkr-<threadId>:<n>`; n is the thread's reply ordinal. */
const threadReplyCommentId = (threadId: string, replyIndex: number): string => `tkr-${threadId}:${replyIndex}`;

/** Structural error text for a failed `uow.save`, CLI-parity for not-found. */
const describeSaveFailure = (error: { readonly kind: string; readonly message?: string; readonly id?: string }): string => {
  if (error.kind === "not_found") return `issue not found: ${error.id}`;
  if (error.message !== undefined) return error.message;
  return `storage error (${error.kind})`;
};

/** Build the metadata record for one fresh thread. */
const threadRecord = (threadId: string, placement: ReviewThreadPlacement): ReviewThreadRecord => ({
  id: threadId,
  filePath: placement.filePath,
  ...(placement.line === undefined ? {} : { line: placement.line }),
  ...(placement.side === undefined ? {} : { side: placement.side }),
  rootCommentId: threadRootCommentId(threadId),
  replyCommentIds: [],
  resolved: false,
  editedAtByCommentId: {},
});

/** One comment body this transaction must store or rewrite. */
interface PendingCommentBody {
  readonly id: string;
  readonly body: string;
  readonly author: string;
  /** Thread marker written to `wireUnknown` for brand-new comments. */
  readonly threadId: string;
}

/** The result of one pure registry rewrite. */
interface RegistryRewrite {
  readonly registry: ReviewThreadRegistry;
  readonly commentBodies: readonly PendingCommentBody[];
}

/** Apply one registry rewrite plus its comment bodies in a single transaction. */
const withRegistry = async (store: SurfaceStore, rawIssueId: string, rewrite: (registry: ReviewThreadRegistry, issue: Issue) => RegistryRewrite): Promise<Issue> => {
  const outcome = await store.transact(async (uow) => {
    const issue = await getOrThrow(uow, rawIssueId);
    const planned = rewrite(parseReviewThreadRegistry(issue.metadata), issue);
    const comments = [...issue.comments];
    for (const pending of planned.commentBodies) {
      if (pending.body === "") throw new ReviewCommentStoreError("comment requires body");
      const existing = comments.find((comment) => comment.id === pending.id);
      if (existing === undefined) comments.push({ id: pending.id, issueId: issue.id, author: pending.author, text: pending.body, createdAt: new Date(), wireUnknown: { reviewThread: pending.threadId } });
      else comments[comments.indexOf(existing)] = { ...existing, text: pending.body };
    }
    const saved = await uow.save({
      ...issue,
      metadata: { ...issue.metadata, [reviewThreadRegistryKey]: serializeReviewThreadRegistry(planned.registry) },
      comments,
      commentCount: comments.length,
      updatedAt: new Date(),
    });
    if (!saved.ok) throw new ReviewCommentStoreError(`failed to persist review threads: ${describeSaveFailure(saved.error)}`);
    return getOrThrow(uow, rawIssueId);
  });
  if (!outcome.ok) throw new ReviewCommentStoreError(outcome.error.message);
  return outcome.value;
};

/** Fresh thread id: registry-local uniqueness over a time-plus-random suffix. */
const freshThreadId = (registry: ReviewThreadRegistry): string => {
  const taken = new Set(registry.threads.map((thread) => thread.id));
  for (;;) {
    const candidate = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (!taken.has(candidate)) return candidate;
  }
};

/** One stored task-store comment as the merge input. */
const storedComment = (comment: Issue["comments"][number]): StoredCommentRecord => ({
  id: comment.id,
  author: comment.author,
  text: comment.text,
  createdAt: comment.createdAt,
  wire: comment.wireUnknown,
});

/** Read one issue in a short transaction. */
const readIssue = async (store: SurfaceStore, rawIssueId: string): Promise<Issue> => {
  const outcome = await store.transact(async (uow) => getOrThrow(uow, rawIssueId));
  if (!outcome.ok) throw new ReviewCommentStoreError(outcome.error.message);
  return outcome.value;
};

/** Join one issue's persisted registry with its stored comments. */
const threadList = (issue: Issue): ReviewThreadList => {
  const registry = parseReviewThreadRegistry(issue.metadata);
  const threads = joinThreadRecords(registry.threads, issue.comments.map(storedComment));
  return { threads, allResolved: reviewAllThreadsResolved(threads) };
};

/** The joined thread, or a typed failure when the merge dropped it. */
const requireThread = (issue: Issue, threadId: string): ReviewThread => {
  const thread = threadList(issue).threads.find((entry) => entry.id === threadId);
  if (!thread) throw new ReviewCommentStoreError(`thread ${threadId} vanished from issue ${issue.id}`);
  return thread;
};

/** The registry record for one thread, or a typed failure. */
const requireRecord = (registry: ReviewThreadRegistry, threadId: string): ReviewThreadRecord => {
  const record = registry.threads.find((entry) => entry.id === threadId);
  if (!record) throw new ReviewCommentStoreError(`thread not found: ${threadId}`);
  return record;
};

/** The registry with one thread's record rewritten in place. */
const withThreadRecord = (registry: ReviewThreadRegistry, threadId: string, update: (record: ReviewThreadRecord) => ReviewThreadRecord): ReviewThreadRegistry => ({
  version: 1,
  threads: registry.threads.map((entry) => (entry.id === threadId ? update(entry) : entry)),
});

/** The stored author of one comment, falling back to the review actor. */
const authorOf = (issue: Issue, commentId: string): string => issue.comments.find((entry) => entry.id === commentId)?.author ?? "review";

/**
 * The seam over one open surface store. Every mutation is a single
 * transaction; every read joins the persisted registry with the stored
 * comments so edits made outside the review UI stay visible.
 */
export const taskStoreCommentStore = (store: SurfaceStore): ReviewCommentStore => ({
  async createThread(rawIssueId: string, input: CreateThreadInput): Promise<ReviewThread> {
    const threadId = freshThreadId(parseReviewThreadRegistry((await readIssue(store, rawIssueId)).metadata));
    const issue = await withRegistry(store, rawIssueId, (registry) => ({
      registry: { version: 1, threads: [...registry.threads, threadRecord(threadId, input)] },
      commentBodies: [{
        id: threadRootCommentId(threadId),
        body: formatReviewThreadComment("root", input, input.body),
        author: input.author ?? store.actor,
        threadId,
      }],
    }));
    return requireThread(issue, threadId);
  },

  async appendReply(rawIssueId: string, threadId: string, input: AppendReplyInput): Promise<ReviewThread> {
    const issue = await withRegistry(store, rawIssueId, (registry) => {
      const record = requireRecord(registry, threadId);
      const replyId = threadReplyCommentId(threadId, record.replyCommentIds.length + 1);
      return {
        registry: withThreadRecord(registry, threadId, (entry) => ({ ...entry, replyCommentIds: [...entry.replyCommentIds, replyId] })),
        commentBodies: [{
          id: replyId,
          body: formatReviewThreadComment("reply", record, input.body),
          author: input.author ?? store.actor,
          threadId,
        }],
      };
    });
    return requireThread(issue, threadId);
  },

  async editThreadComment(rawIssueId: string, threadId: string, commentId: string, body: string): Promise<ReviewThread> {
    const issue = await withRegistry(store, rawIssueId, (registry, current) => {
      const record = requireRecord(registry, threadId);
      if (![record.rootCommentId, ...record.replyCommentIds].includes(commentId)) {
        throw new ReviewCommentStoreError(`comment ${commentId} is not part of thread ${threadId}`);
      }
      return {
        registry: withThreadRecord(registry, threadId, (entry) => ({ ...entry, editedAtByCommentId: { ...entry.editedAtByCommentId, [commentId]: new Date().toISOString() } })),
        commentBodies: [{
          id: commentId,
          body: formatReviewThreadComment(commentId === record.rootCommentId ? "root" : "reply", record, body),
          author: authorOf(current, commentId),
          threadId,
        }],
      };
    });
    return requireThread(issue, threadId);
  },

  async setThreadResolved(rawIssueId: string, threadId: string, input: SetResolvedInput): Promise<ReviewThread> {
    const issue = await withRegistry(store, rawIssueId, (registry) => ({
      registry: withThreadRecord(registry, threadId, (entry) => input.resolved
        ? { ...entry, resolved: true, resolvedAt: new Date().toISOString(), resolvedBy: input.actor ?? store.actor }
        : { ...entry, resolved: false, resolvedAt: undefined, resolvedBy: undefined }),
      commentBodies: [],
    }));
    return requireThread(issue, threadId);
  },

  async listThreads(rawIssueId: string): Promise<ReviewThreadList> {
    return threadList(await readIssue(store, rawIssueId));
  },
});
