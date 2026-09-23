import type { AgentId, Issue, Run } from '@tasks/domain';
import { activeRun, nextRunId } from './run-codes.js';
import { err, ok, type Result } from './result.js';
import type { IssueUnitOfWork } from './ports/issue-repository.js';

/** Runs are finalized closed when their state flips terminal. */
const finalizeRun = (uow: IssueUnitOfWork, run: Run, state: Run['state'], at: Date): Promise<Result<void>> =>
  uow.saveRun({ ...run, state, closedAt: at, updatedAt: at });

/** Issue-to-run states mapping status moves onto the active run. */
const FINALIZE_STATUSES: Readonly<Partial<Record<string, Run['state']>>> = { 'ready-to-review': 'in_review', rejected: 'failed', archived: 'cancelled' };

/**
 * Status-driven run side effects: assigning agents and moving work statuses
 * queue and finalize agent runs; failures never fail the committed status change.
 */
export const applyRunSideEffects = async (uow: IssueUnitOfWork, issue: Issue, from: string, to: string, at: Date): Promise<Result<void>> => {
  if (issue.assignee === null) return ok(undefined);
  const agent = await uow.findAgent(issue.assignee as AgentId);
  if (!agent.ok) return err(agent.error);
  if (agent.value === null) return ok(undefined);
  const runs = await uow.listRuns(issue.id);
  if (!runs.ok) return err(runs.error);
  if (to === 'in_progress' && from !== 'in_progress' && activeRun(runs.value) === null) {
    const allocated = await nextRunId(uow, issue.id);
    if (!allocated.ok) return err(allocated.error);
    return await uow.saveRun({ id: allocated.value, issueId: issue.id, agentId: agent.value.id, trigger: 'status-move', state: 'queued', startedAt: null, closedAt: null, messages: [], usage: { tokens: null, cost: null }, createdAt: at, updatedAt: at, wireUnknown: {} });
  }
  const finalized = FINALIZE_STATUSES[to];
  if (finalized !== undefined) {
    const active = activeRun(runs.value);
    if (active === null) return ok(undefined);
    return await finalizeRun(uow, active, finalized, at);
  }
  if (to === 'closed') {
    for (const run of runs.value.filter((run) => run.state === 'in_review')) {
      const closed = await finalizeRun(uow, run, 'done', at);
      if (!closed.ok) return closed;
    }
  }
  return ok(undefined);
};