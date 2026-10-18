/**
 * Completion contract (FIN-01): `finishIssueUow` is the single write path into
 * `ready-to-review`. D-09 pins the vocabulary: finish's only transition target
 * is `ready-to-review` — `closed`/`done` are unreachable by construction, so
 * no snapshot freeze ever rides this path. D-10 requires a completion record
 * (`agent_session` + `finished_at`) merged into metadata; D-11 makes a repeat
 * finish idempotent on status (metadata-only re-record).
 */
import type { Issue, StatusTransitionPolicy } from '@tasks/domain';
import { transitionStatus } from '@tasks/domain';
import { applyRunSideEffects, type IssueUnitOfWork, type Result } from '@tasks/application';
import { getOrThrow, type SurfaceStore } from '../store.js';
import type { SurfaceError } from '../errors.js';
import { MessageError } from '../errors.js';

const now = (): Date => new Date();
const changed = (issue: Issue, patch: Partial<Issue>): Issue => ({ ...issue, ...patch, updatedAt: now() });

/**
 * D-09: finish's transition policy. Accepts only `to: ready-to-review` — the
 * caller cannot smuggle a terminal state through finish — and never stamps
 * `closedAt`.
 */
export const finishPolicy: StatusTransitionPolicy = {
  transition: (issue, transition) =>
    transition.to === 'ready-to-review'
      ? { allowed: true, startedAt: issue.startedAt, closedAt: null }
      : { allowed: false, reason: `finish permits only ready-to-review, never ${transition.to}` },
};

/**
 * `finish`: moves the task to exactly `ready-to-review`, recording the agent
 * session and finish timestamp. Requires a `tk work` record (branch + pinned
 * changeset base) so completion is always tied to a reviewable changeset;
 * already-ready tasks re-record metadata only (D-11). Run side effects fire
 * after the save, matching `changeStatus` ordering.
 */
export const finishIssueUow = async (
  uow: IssueUnitOfWork,
  ctx: { readonly cwd: string },
  id: string,
  session: string,
  at: Date = now(),
): Promise<Issue> => {
  if (session.trim() === '') throw new MessageError('finish requires a non-empty session id');
  // ctx is unused: finish performs no git work (D-09 — no freeze on this path).
  // The parameter is kept for uow-operation signature symmetry (callers pass { cwd }).
  void ctx;
  const issue = await getOrThrow(uow, id);
  const meta = issue.metadata['changeset'];
  const pinned = meta !== null && typeof meta === 'object' && !Array.isArray(meta) && typeof (meta as Record<string, unknown>)['base'] === 'string' && (meta as Record<string, unknown>)['base'] !== '';
  if (issue.branch === null || issue.branch === '' || !pinned)
    throw new MessageError(`finish requires a branch and pinned changeset base (no worktree record for ${id}); run \`tk work ${id}\` first`);
  const record = { agent_session: session, finished_at: at.toISOString() };
  if (issue.status === 'ready-to-review') {
    // D-11: idempotent — status and timestamps untouched, metadata re-recorded.
    const result = changed(issue, { metadata: { ...issue.metadata, ...record } });
    const saved = await uow.save(result);
    if (!saved.ok) throw new MessageError('save failed');
    return result;
  }
  const verdict = transitionStatus(finishPolicy, issue, { from: issue.status, to: 'ready-to-review', at });
  if (!verdict.allowed) throw new MessageError(verdict.reason);
  const result = changed(issue, {
    status: 'ready-to-review',
    startedAt: verdict.startedAt,
    closedAt: verdict.closedAt,
    metadata: { ...issue.metadata, ...record },
  });
  const saved = await uow.save(result);
  if (!saved.ok) throw new MessageError('save failed');
  await applyRunSideEffects(uow, result, issue.status, result.status, at);
  return result;
};

/** Store-level finish: wraps `finishIssueUow` in one transaction over the surface store. */
export type FinishIssueResult = Promise<Result<Issue, SurfaceError>>;
export const finishIssue = (store: SurfaceStore, id: string, session: string): FinishIssueResult =>
  store.transact(async (uow) => finishIssueUow(uow, { cwd: store.root }, id, session));
