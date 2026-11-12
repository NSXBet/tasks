import { readPrRecord, readReportStat } from '@tasks/domain';
import type { Issue, IssueAttachment, Run } from '@tasks/domain';
import { LEGACY_HUNK_COMMENTS_KEY, REVIEW_LOG_KEY, REVIEW_REGISTRY_KEY, reviewCommentLog, reviewComments } from '../operations/review-comments.js';
import type { EventDraft } from './log.js';

/**
 * Event derivation: the single place event types are decided. The recorder
 * hands every touched issue's before/after state here; nothing else chooses
 * what lands on the wire. Pure — no IO, no clock.
 *
 * `task.pr` (from `metadata.pr`, written only by the `tk pr` verbs — gh is
 * never polled) and `task.report` (from the counts-only `metadata.report`
 * stamp — the stat card data, never a diff) are derived here too; both keys
 * are covered, so they never show up in `task.update.fields`.
 *
 * Per-issue order: created, status, owner, comment(s), evidence, worktree,
 * pr, report, update, deleted.
 */

/**
 * Metadata keys whose changes are carried by a dedicated event (never listed in `task.update.fields`).
 * Built lazily: store.ts → recorder → derive → review-comments → store.ts is an import cycle, so the
 * review-comments constants may not be initialized yet when this module is evaluated.
 */
let covered: ReadonlySet<string> | null = null;
const coveredMetadata = (): ReadonlySet<string> => (covered ??= new Set<string>([
  'agent_session', 'finished_at', 'agent_harness', // task.status (finish)
  'worktree', // task.worktree
  'pr', // task.pr
  'report', // task.report
  REVIEW_REGISTRY_KEY, REVIEW_LOG_KEY, LEGACY_HUNK_COMMENTS_KEY, // task.comment (review)
]));

/** Plain fields compared for `task.update`; status/owner/assignee/branch/comments/timestamps are covered elsewhere or noise. */
const UPDATE_FIELDS = [
  'title', 'description', 'priority', 'type', 'createdBy', 'notes', 'design', 'acceptanceCriteria', 'estimate',
  'specId', 'externalRef', 'dueAt', 'deferUntil', 'parentId', 'sprintId',
] as const satisfies readonly (keyof Issue)[];

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sortedJson = (values: readonly string[]): string => JSON.stringify([...values].sort());
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

const isBlob = (attachment: IssueAttachment): attachment is Extract<IssueAttachment, { kind: 'evidence' | 'inline' }> => 'kind' in attachment;
const attachmentKey = (attachment: IssueAttachment): string => (isBlob(attachment) ? `blob:${attachment.id}` : `path:${attachment.path}`);

const isReviewThreadComment = (comment: Issue['comments'][number]): boolean =>
  comment.wireUnknown['reviewThread'] !== undefined || comment.text.startsWith('[review');

const statusEvents = (before: Issue, after: Issue): EventDraft[] => {
  const session = str(after.metadata['agent_session']);
  const finishedAt = str(after.metadata['finished_at']);
  const finished = finishedAt !== null && finishedAt !== str(before.metadata['finished_at']);
  if (before.status !== after.status) {
    const data: Record<string, unknown> = { from: before.status, to: after.status };
    if (after.status === 'ready-to-review' && finished) Object.assign(data, { session, finishedAt });
    return [{ task: after.id, type: 'task.status', data }];
  }
  if (finished && after.status === 'ready-to-review') {
    return [{ task: after.id, type: 'task.status', data: { from: after.status, to: after.status, session, finishedAt, refinish: true } }];
  }
  return [];
};

const ownerEvents = (before: Issue, after: Issue): EventDraft[] => {
  const events: EventDraft[] = [];
  if (before.owner !== after.owner) events.push({ task: after.id, type: 'task.owner', data: { field: 'owner', from: before.owner, to: after.owner } });
  if (before.assignee !== after.assignee) events.push({ task: after.id, type: 'task.owner', data: { field: 'assignee', from: before.assignee, to: after.assignee } });
  return events;
};

const commentEvents = (before: Issue, after: Issue): EventDraft[] => {
  const events: EventDraft[] = [];
  const known = new Set(before.comments.map((comment) => comment.id));
  for (const comment of after.comments) {
    if (known.has(comment.id) || isReviewThreadComment(comment)) continue;
    events.push({ task: after.id, type: 'task.comment', data: { kind: 'note', comment: comment.id, author: comment.author, body: comment.text } });
  }
  const log = reviewCommentLog(after.metadata);
  const previous = reviewCommentLog(before.metadata);
  const top = previous.length === 0 ? 0 : previous[previous.length - 1]!.n;
  const fresh = log.filter((entry) => entry.n > top);
  if (fresh.length === 0) return events;
  const cards = new Map(reviewComments(after).comments.map((card) => [card.id, card]));
  for (const entry of fresh) {
    const card = cards.get(entry.commentId);
    events.push({
      task: after.id,
      type: 'task.comment',
      data: {
        kind: 'review', comment: entry.commentId, from: entry.from, to: entry.to, actor: entry.actor, file: entry.file, line: entry.line,
        location: card?.location ?? null, author: card?.author ?? null, body: card?.body ?? null,
      },
    });
  }
  return events;
};

const evidenceEvents = (before: Issue, after: Issue): EventDraft[] => {
  const known = new Set(before.attachments.map(attachmentKey));
  return after.attachments
    .filter((attachment) => isBlob(attachment) && attachment.kind === 'evidence' && !known.has(attachmentKey(attachment)))
    .map((attachment) => {
      const blob = attachment as Extract<IssueAttachment, { kind: 'evidence' | 'inline' }>;
      return { task: after.id, type: 'task.evidence' as const, data: { id: blob.id, name: blob.name, mime: blob.mime } };
    });
};

const worktreeEvents = (before: Issue, after: Issue): EventDraft[] => {
  if (same(before.metadata['worktree'], after.metadata['worktree']) && before.branch === after.branch) return [];
  return [{ task: after.id, type: 'task.worktree', data: { path: str(after.metadata['worktree']), branch: after.branch } }];
};

/**
 * `task.pr` when the recorded PR appears (or its number changes: `create`), or its state moves
 * (`close` when it moved to closed, else `state`). A url-only change, an unchanged record and an
 * invalid one (per `readPrRecord`) emit nothing.
 */
const prEvents = (before: Issue, after: Issue): EventDraft[] => {
  const next = readPrRecord(after.metadata);
  if (next === null) return [];
  const prev = readPrRecord(before.metadata);
  let op: 'create' | 'state' | 'close';
  if (prev === null || prev.number !== next.number) op = 'create';
  else if (prev.state !== next.state) op = next.state === 'closed' ? 'close' : 'state';
  else return [];
  return [{ task: after.id, type: 'task.pr', data: { op, number: next.number, url: next.url, state: next.state, head: after.branch } }];
};

/** `task.report` when a valid `metadata.report` stamp is new or its stat/head differ: the stat card data on the wire.
 *  A restamp with unchanged counts and head (only `at` moved, e.g. `tk pr sync`) emits nothing. */
const reportEvents = (before: Issue, after: Issue): EventDraft[] => {
  const next = readReportStat(after.metadata);
  if (next === null) return [];
  const prev = readReportStat(before.metadata);
  if (prev !== null && same(prev.stat, next.stat) && prev.head === next.head) return [];
  return [{ task: after.id, type: 'task.report', data: { changes: next.stat, head: next.head, at: next.at } }];
};

const changedFields = (before: Issue, after: Issue): string[] => {
  const fields: string[] = UPDATE_FIELDS.filter((field) => !same(before[field], after[field]));
  if (sortedJson(before.labels) !== sortedJson(after.labels)) fields.push('labels');
  const edge = (issue: Issue): string[] => issue.dependencies.map((dep) => `${dep.type}:${JSON.stringify(dep.target)}`);
  if (sortedJson(edge(before)) !== sortedJson(edge(after))) fields.push('dependencies');
  // New blob attachments are announced (evidence) or deliberately silent (inline); anything else (removals, path attachments) is an update.
  const afterKeys = new Set(after.attachments.map(attachmentKey));
  const beforeKeys = new Set(before.attachments.map(attachmentKey));
  const removed = [...beforeKeys].some((key) => !afterKeys.has(key));
  const addedPath = after.attachments.some((attachment) => !isBlob(attachment) && !beforeKeys.has(attachmentKey(attachment)));
  if (removed || addedPath) fields.push('attachments');
  const keys = new Set([...Object.keys(before.metadata), ...Object.keys(after.metadata)]);
  for (const key of keys) {
    if (coveredMetadata().has(key)) continue;
    if (!same(before.metadata[key], after.metadata[key])) fields.push(`metadata.${key}`);
  }
  return fields.sort();
};

/** Events for one issue's before/after state within one committed transaction. */
export const deriveIssueEvents = (before: Issue | null, after: Issue | null): EventDraft[] => {
  if (before === null && after === null) return [];
  if (before === null) {
    const created = after!;
    return [{ task: created.id, type: 'task.created', data: { title: created.title, status: created.status, owner: created.owner, assignee: created.assignee } }];
  }
  if (after === null) return [{ task: before.id, type: 'task.deleted', data: { title: before.title } }];
  const fields = changedFields(before, after);
  return [
    ...statusEvents(before, after),
    ...ownerEvents(before, after),
    ...commentEvents(before, after),
    ...evidenceEvents(before, after),
    ...worktreeEvents(before, after),
    ...prEvents(before, after),
    ...reportEvents(before, after),
    ...(fields.length > 0 ? [{ task: after.id, type: 'task.update' as const, data: { fields } }] : []),
  ];
};

/** `run.changed` when a run is new or its state moved; `[]` otherwise. */
export const deriveRunEvent = (before: Run | null, after: Run): EventDraft[] => {
  if (before !== null && before.state === after.state) return [];
  return [{ task: after.issueId, type: 'run.changed', data: { runId: after.id, from: before?.state ?? null, to: after.state } }];
};
