/**
 * Completion contract (FIN-01): `finishIssueUow` is the single write path into
 * `ready-to-review`. D-09 pins the vocabulary: finish's only transition target
 * is `ready-to-review` — `closed`/`done` are unreachable by construction, so
 * no snapshot freeze ever rides this path. D-10 requires a completion record
 * (`agent_session` + `finished_at`) merged into metadata; D-11 makes a repeat
 * finish idempotent on status (metadata-only re-record).
 *
 * Phase 11 (PR-03): finish also stores a counts-only `metadata.report =
 * {changes, head, at}` stamp, the cache `resolveChanges` falls back to when
 * the branch is out of reach. It never writes `metadata.changeset.head`, so
 * finish still never freezes (CHG-02). A failed derivation is non-fatal: no
 * `report` key is written and any earlier stamp is kept.
 */
import type { Issue, StatusTransitionPolicy } from '@tasks/domain';
import { transitionStatus } from '@tasks/domain';
import { applyRunSideEffects, type IssueUnitOfWork, type Result } from '@tasks/application';
import { getOrThrow, type SurfaceStore } from '../store.js';
import type { SurfaceError } from '../errors.js';
import { MessageError } from '../errors.js';
import { bunRunner, type ProcessRunner } from '@tasks/git';
import { reportStampFor } from './changes.js';

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
  harness: string | null = null,
  runner: ProcessRunner = bunRunner,
): Promise<Issue> => {
  if (session.trim() === '') throw new MessageError('finish requires a non-empty session id');
  const issue = await getOrThrow(uow, id);
  const meta = issue.metadata['changeset'];
  const pinned = meta !== null && typeof meta === 'object' && !Array.isArray(meta) && typeof (meta as Record<string, unknown>)['base'] === 'string' && (meta as Record<string, unknown>)['base'] !== '';
  if (issue.branch === null || issue.branch === '' || !pinned)
    throw new MessageError(`finish requires a branch and pinned changeset base (no worktree record for ${id}); run \`tk work ${id}\` first`);
  // Counts-only report stamp (PR-03); derivation reads git only, never freezes (D-09).
  const report = await reportStampFor(ctx, issue, runner, at);
  const record = { agent_session: session, finished_at: at.toISOString(), ...(harness !== null && harness.trim() !== '' ? { agent_harness: harness.trim() } : {}), ...(report !== null ? { report } : {}) };
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
