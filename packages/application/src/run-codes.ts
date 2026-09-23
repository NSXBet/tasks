import type { IssueUnitOfWork } from './ports/issue-repository.js';
import type { IssueId, Run, RunId } from '@tasks/domain';
import { runId } from '@tasks/domain';
import { err, ok, type Result } from './result.js';

/** Run ids derive from the issue: `<issueId>-run-<n>` with n starting at 1. */
export const runCodeFor = (issueId: IssueId, sequence: number): RunId =>
  runId(`${issueId}-run-${sequence}`);

/** Allocates the next run id for an issue inside the caller's transaction. */
export const nextRunId = async (uow: IssueUnitOfWork, issueId: IssueId): Promise<Result<RunId>> => {
  const existing = await uow.listRuns(issueId);
  if (!existing.ok) return err(existing.error);
  const sequence = existing.value.reduce((max, run) => Math.max(max, Number(run.id.slice(issueId.length + 5)) || 0), 0) + 1;
  return ok(runCodeFor(issueId, sequence));
};

/** A run is active while it may still change state on its own: queued or running. */
export const isActiveRunState = (state: Run['state']): boolean => state === 'queued' || state === 'running';

/** Most recent active run for an issue, if any; ties broken by id for determinism. */
export const activeRun = (runs: readonly Run[]): Run | null => {
  const candidates = runs.filter((run) => isActiveRunState(run.state));
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, run) => (run.updatedAt > latest.updatedAt || (run.updatedAt.getTime() === latest.updatedAt.getTime() && run.id > latest.id) ? run : latest));
};