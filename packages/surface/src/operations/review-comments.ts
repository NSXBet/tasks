import type { Issue } from '@tasks/domain';
import { issueId } from '@tasks/domain';
import type { SurfaceStore } from '../store.js';
import { getOrThrow } from '../store.js';
import { MessageError } from '../errors.js';

/**
 * The per-task review comment store, seen from the surface.
 *
 * One store per task: `metadata.reviewThreads` (written by @tasks/review's
 * task-store adapter, same record). Each entry is one comment-with-replies and
 * carries its location as data: `filePath` + `line`/`endLine`, or an evidence
 * target (`filePath: "evidence:<id>"` with `evidenceId`). Status is
 * open | sent | resolved | dismissed. This module owns the lifecycle rules
 * (transitions, batched send, counts) so the RPC verbs and the review adapter
 * share one implementation; it edits raw JSON and preserves unknown fields.
 *
 * Every transition appends to `metadata.reviewCommentLog` (monotonic `n`), the
 * durable source the watch loop turns into `task.comment` events — so no
 * transition is lost between polls.
 */

export type ReviewCommentStatus = 'open' | 'sent' | 'resolved' | 'dismissed';
export const REVIEW_COMMENT_STATUSES: readonly ReviewCommentStatus[] = ['open', 'sent', 'resolved', 'dismissed'];
export const REVIEW_REGISTRY_KEY = 'reviewThreads';
export const REVIEW_LOG_KEY = 'reviewCommentLog';
/**
 * Metadata key written by the removed Hunk sync command: a string[] of Hunk
 * comment ids, each mirrored as a task comment `hunk-<id>` with text
 * `[hunk <file>:<line|?>[ (old)]] <summary>`. Read once here, imported into
 * {@link REVIEW_REGISTRY_KEY}, then deleted — never written again.
 */
export const LEGACY_HUNK_COMMENTS_KEY = 'hunkComments';
/** Log entries kept per task; older transitions are already delivered to any live watcher. */
const LOG_CAP = 500;

export const isReviewCommentStatus = (value: unknown): value is ReviewCommentStatus =>
  typeof value === 'string' && (REVIEW_COMMENT_STATUSES as readonly string[]).includes(value);

/** One transition record in the log. */
export interface ReviewCommentLogEntry {
  readonly n: number;
  readonly commentId: string;
  readonly from: ReviewCommentStatus | null;
  readonly to: ReviewCommentStatus;
  readonly actor: string | null;
  readonly at: string;
  readonly file: string | null;
  readonly line: number | null;
}

/** The card an agent receives: location, author, body. */
export interface ReviewCommentCard {
  readonly id: string;
  /** `file:line`, `file:line-endLine`, `file`, or `evidence:<id>`. */
  readonly location: string;
  readonly file: string;
  readonly line: number | null;
  readonly endLine: number | null;
  readonly evidence: string | null;
  readonly author: string;
  readonly body: string;
  readonly status: ReviewCommentStatus;
  readonly replies: number;
}

export interface ReviewCommentCounts {
  readonly total: number;
  readonly open: number;
  readonly sent: number;
  readonly resolved: number;
  readonly dismissed: number;
  /** open + sent: still needs an answer (the `N` in `N open · K ✓`). */
  readonly unresolved: number;
  /** Rendered `N open · K ✓` (K = resolved). */
  readonly label: string;
  /** True when at least one comment exists and none is unresolved (resolved or dismissed only). */
  readonly allResolved: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const rawThreads = (metadata: Readonly<Record<string, unknown>>): Record<string, unknown>[] => {
  const registry = metadata[REVIEW_REGISTRY_KEY];
  if (!isObject(registry) || !Array.isArray(registry['threads'])) return [];
  return registry['threads'].filter(isObject);
};

/** Status of a raw record; legacy `resolved: true` records read as resolved. */
const statusOf = (record: Record<string, unknown>): ReviewCommentStatus =>
  isReviewCommentStatus(record['status']) ? record['status'] : record['resolved'] === true ? 'resolved' : 'open';

/** Body stored on the root comment, minus the `[review file:line] ` prefix. */
const bodyOf = (issue: Issue, record: Record<string, unknown>): { body: string; author: string } => {
  const root = issue.comments.find((comment) => comment.id === record['rootCommentId']);
  if (root === undefined) return { body: '', author: 'review' };
  return { body: root.text.replace(/^\[(?:review|hunk) [^\]]*\] /, ''), author: root.author };
};

export const reviewCommentLog = (metadata: Readonly<Record<string, unknown>>): readonly ReviewCommentLogEntry[] => {
  const raw = metadata[REVIEW_LOG_KEY];
  if (!Array.isArray(raw)) return [];
  const entries: ReviewCommentLogEntry[] = [];
  for (const entry of raw) {
    if (!isObject(entry) || typeof entry['n'] !== 'number' || typeof entry['commentId'] !== 'string' || !isReviewCommentStatus(entry['to'])) continue;
    entries.push({
      n: entry['n'],
      commentId: entry['commentId'],
      from: isReviewCommentStatus(entry['from']) ? entry['from'] : null,
      to: entry['to'],
      actor: typeof entry['actor'] === 'string' ? entry['actor'] : null,
      at: typeof entry['at'] === 'string' ? entry['at'] : '',
      file: typeof entry['file'] === 'string' ? entry['file'] : null,
      line: typeof entry['line'] === 'number' ? entry['line'] : null,
    });
  }
  return entries;
};

/** Metadata with one transition appended to the log (pure). */
export const appendReviewCommentLog = (
  metadata: Readonly<Record<string, unknown>>,
  entry: Omit<ReviewCommentLogEntry, 'n'>,
): Record<string, unknown> => {
  const log = reviewCommentLog(metadata);
  const n = (log.length === 0 ? 0 : log[log.length - 1]!.n) + 1;
  return { ...metadata, [REVIEW_LOG_KEY]: [...log, { n, ...entry }].slice(-LOG_CAP) };
};

const locationOf = (record: Record<string, unknown>): { file: string; line: number | null; endLine: number | null; evidence: string | null; label: string } => {
  const file = typeof record['filePath'] === 'string' ? record['filePath'] : '';
  const evidence = typeof record['evidenceId'] === 'string' ? record['evidenceId'] : null;
  const line = typeof record['line'] === 'number' ? record['line'] : null;
  const endLine = typeof record['endLine'] === 'number' && line !== null && record['endLine'] > line ? record['endLine'] : null;
  const label = evidence !== null ? `evidence:${evidence}` : line === null ? file : endLine === null ? `${file}:${line}` : `${file}:${line}-${endLine}`;
  return { file, line, endLine, evidence, label };
};

/** Counts for a status list; `N open · K ✓` rendering lives here so every view agrees. */
export const countReviewComments = (statuses: readonly ReviewCommentStatus[]): ReviewCommentCounts => {
  const count = (status: ReviewCommentStatus): number => statuses.filter((entry) => entry === status).length;
  const open = count('open');
  const sent = count('sent');
  const resolved = count('resolved');
  const dismissed = count('dismissed');
  const unresolved = open + sent;
  return {
    total: statuses.length, open, sent, resolved, dismissed, unresolved,
    label: `${unresolved} open · ${resolved} ✓`,
    allResolved: statuses.length > 0 && unresolved === 0,
  };
};

/** Legacy root text: `[hunk <file>:<line|?>[ (old)]] `. One anchored regex, no nested quantifiers. */
const LEGACY_HUNK_TEXT = /^\[hunk (.+):(\d+|\?)( \(old\))?\] /;

/**
 * One-time import of comments the removed Hunk sync left under
 * {@link LEGACY_HUNK_COMMENTS_KEY} (pure). Each id whose `hunk-<id>` task
 * comment exists becomes an `open` review thread reusing that comment as its
 * root; placement is parsed from the comment text (non-matching text degrades
 * to a file-level `(hunk)` thread). Existing threads and unknown registry
 * fields are preserved; ids already rooted in a thread are skipped. No log
 * entries are appended — a migration is not a transition. Returns the new
 * metadata (legacy key removed), or null when there is nothing to import.
 */
export const importLegacyHunkComments = (issue: Pick<Issue, 'metadata' | 'comments'>): Record<string, unknown> | null => {
  const legacy = issue.metadata[LEGACY_HUNK_COMMENTS_KEY];
  if (!Array.isArray(legacy)) return null;
  const existing = rawThreads(issue.metadata);
  const rooted = new Set(existing.map((record) => record['rootCommentId']).filter((value): value is string => typeof value === 'string'));
  const imported: Record<string, unknown>[] = [];
  for (const hunkId of legacy) {
    if (typeof hunkId !== 'string' || hunkId === '') continue;
    const commentId = `hunk-${hunkId}`;
    if (rooted.has(commentId)) continue;
    const root = issue.comments.find((comment) => comment.id === commentId);
    if (root === undefined) continue;
    const match = LEGACY_HUNK_TEXT.exec(root.text);
    const line = match !== null && match[2] !== '?' ? Number(match[2]) : 0;
    imported.push({
      id: commentId,
      filePath: match !== null && match[1] !== '' ? match[1] : '(hunk)',
      ...(Number.isInteger(line) && line > 0 ? { line } : {}),
      ...(match !== null ? { side: match[3] !== undefined ? 'old' : 'new' } : {}),
      rootCommentId: commentId,
      replyCommentIds: [],
      resolved: false,
      status: 'open',
      editedAtByCommentId: {},
    });
    rooted.add(commentId);
  }
  const { [LEGACY_HUNK_COMMENTS_KEY]: _dropped, ...rest } = issue.metadata;
  if (imported.length === 0) return rest;
  const registry = issue.metadata[REVIEW_REGISTRY_KEY];
  return { ...rest, [REVIEW_REGISTRY_KEY]: { ...(isObject(registry) ? registry : {}), version: 1, threads: [...existing, ...imported] } };
};

/**
 * Persist {@link importLegacyHunkComments} inside the caller's transaction on
 * first read; returns the (re-read) issue. A no-op once the legacy key is gone.
 */
export const withLegacyHunkImport = async (uow: Parameters<Parameters<SurfaceStore['transact']>[0]>[0], issue: Issue): Promise<Issue> => {
  const metadata = importLegacyHunkComments(issue);
  if (metadata === null) return issue;
  const saved = await uow.save({ ...issue, metadata: metadata as Issue['metadata'], updatedAt: new Date() });
  if (!saved.ok) throw new MessageError('legacy review comment import failed');
  return getOrThrow(uow, issue.id);
};

/** Every comment of one task as cards, plus counts. Legacy Hunk comments are imported in memory (pure view). */
export const reviewComments = (input: Issue): { readonly comments: readonly ReviewCommentCard[]; readonly counts: ReviewCommentCounts } => {
  const imported = importLegacyHunkComments(input);
  const issue: Issue = imported === null ? input : { ...input, metadata: imported as Issue['metadata'] };
  const comments: ReviewCommentCard[] = [];
  for (const record of rawThreads(issue.metadata)) {
    if (typeof record['id'] !== 'string') continue;
    const where = locationOf(record);
    const { body, author } = bodyOf(issue, record);
    comments.push({
      id: record['id'], location: where.label, file: where.file, line: where.line, endLine: where.endLine, evidence: where.evidence,
      author, body, status: statusOf(record),
      replies: Array.isArray(record['replyCommentIds']) ? record['replyCommentIds'].length : 0,
    });
  }
  return { comments, counts: countReviewComments(comments.map((comment) => comment.status)) };
};

/** Allowed moves: resolved/dismissed may reopen; sent only comes from open via send. */
const canMove = (from: ReviewCommentStatus, to: ReviewCommentStatus): boolean => from !== to && (to !== 'sent' || from === 'open');

/**
 * Metadata with one comment moved to `to` (pure): rewrites status, the
 * `resolved*` mirror fields, `sentAt`, and appends a log entry. Returns null
 * when the comment is unknown or the move is not allowed.
 */
export const transitionReviewComment = (
  metadata: Readonly<Record<string, unknown>>,
  commentId: string,
  to: ReviewCommentStatus,
  actor: string | null,
  at: Date,
): Record<string, unknown> | null => {
  const registry = metadata[REVIEW_REGISTRY_KEY];
  const threads = rawThreads(metadata);
  const record = threads.find((entry) => entry['id'] === commentId);
  if (record === undefined || !isObject(registry)) return null;
  const from = statusOf(record);
  if (!canMove(from, to)) return null;
  const stamp = at.toISOString();
  const next: Record<string, unknown> = { ...record, status: to, resolved: to === 'resolved' };
  delete next['resolvedAt'];
  delete next['resolvedBy'];
  if (to === 'resolved') { next['resolvedAt'] = stamp; if (actor !== null) next['resolvedBy'] = actor; }
  if (to === 'sent') next['sentAt'] = stamp;
  const where = locationOf(record);
  const rewritten = { ...metadata, [REVIEW_REGISTRY_KEY]: { ...registry, threads: threads.map((entry) => (entry === record ? next : entry)) } };
  return appendReviewCommentLog(rewritten, { commentId, from, to, actor, at: stamp, file: where.file === '' ? null : where.file, line: where.line });
};

/** The unit of work a surface transaction hands its callback (CLI `transaction` uses the same type). */
type ReviewUow = Parameters<Parameters<SurfaceStore['transact']>[0]>[0];

/** Read one task's comments (cards + counts) inside the caller's transaction. */
export const reviewCommentListUow = async (uow: ReviewUow, id: string) => reviewComments(await withLegacyHunkImport(uow, await getOrThrow(uow, id)));

/** Read one task's comments (cards + counts). */
export const reviewCommentList = (store: SurfaceStore, id: string) => store.transact((uow) => reviewCommentListUow(uow, id));

/** {@link reviewCommentSetStatus} inside the caller's transaction, stamping `actor` on the log entry. */
export const reviewCommentSetStatusUow = async (uow: ReviewUow, actor: string, id: string, commentId: string, status: string) => {
  if (!isReviewCommentStatus(status)) throw new MessageError(`invalid comment status: ${status} (expected ${REVIEW_COMMENT_STATUSES.join('|')})`);
  if (status === 'sent') throw new MessageError('comments become sent only through comments.send');
  const issue = await withLegacyHunkImport(uow, await getOrThrow(uow, id));
  const current = rawThreads(issue.metadata).find((entry) => entry['id'] === commentId);
  if (current === undefined) throw new MessageError(`comment not found: ${commentId}`);
  const metadata = transitionReviewComment(issue.metadata, commentId, status, actor, new Date());
  if (metadata !== null) {
    const saved = await uow.save({ ...issue, metadata: metadata as Issue['metadata'], updatedAt: new Date() });
    if (!saved.ok) throw new MessageError('comment status update failed');
  }
  return reviewComments(await getOrThrow(uow, id));
};

/** Move one comment to a status (resolve, dismiss, reopen). `sent` only through {@link reviewCommentSend}. */
export const reviewCommentSetStatus = (store: SurfaceStore, id: string, commentId: string, status: string) =>
  store.transact((uow) => reviewCommentSetStatusUow(uow, store.actor, id, commentId, status));

/** {@link reviewCommentSend} inside the caller's transaction, stamping `actor` on the log and summary comment. */
export const reviewCommentSendUow = async (uow: ReviewUow, actor: string, id: string, only?: readonly string[]) => {
  const issue = await withLegacyHunkImport(uow, await getOrThrow(uow, id));
  const { comments } = reviewComments(issue);
  const batch = comments.filter((comment) => comment.status === 'open' && (only === undefined || only.includes(comment.id)));
  if (batch.length === 0) return { sent: [] as ReviewCommentCard[], counts: reviewComments(issue).counts };
  let metadata: Record<string, unknown> = { ...issue.metadata };
  const now = new Date();
  for (const card of batch) metadata = transitionReviewComment(metadata, card.id, 'sent', actor, now) ?? metadata;
  const text = [`[review sent] ${batch.length} comment${batch.length === 1 ? '' : 's'}`, ...batch.map((card) => `- ${card.location} (${card.author}): ${card.body}`)].join('\n');
  const summary = { id: `tkr-send-${now.getTime().toString(36)}`, issueId: issueId(id), author: actor, text, createdAt: now, wireUnknown: {} };
  const comments2 = [...issue.comments, summary];
  const saved = await uow.save({ ...issue, metadata: metadata as Issue['metadata'], comments: comments2, commentCount: comments2.length, updatedAt: now });
  if (!saved.ok) throw new MessageError('comment send failed');
  const after = reviewComments(await getOrThrow(uow, id));
  return { sent: batch.map((card) => ({ ...card, status: 'sent' as const })), counts: after.counts };
};

/**
 * Explicit batched send: every `open` comment (or just `only`) becomes `sent`
 * in one transaction and is returned as cards `{file:line, author, body}`.
 * One summary issue comment records the batch for `tk show`; nothing is
 * delivered per-comment. A send with nothing open delivers an empty batch.
 */
export const reviewCommentSend = (store: SurfaceStore, id: string, only?: readonly string[]) =>
  store.transact((uow) => reviewCommentSendUow(uow, store.actor, id, only));
