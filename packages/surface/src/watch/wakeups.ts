import type { IssueUnitOfWork, Result } from '@tasks/application';
import { err, nextRunId, ok } from '@tasks/application';
import type { AgentId, Issue } from '@tasks/domain';

/** Per-expiry wakeup guard: issueId → ISO deferUntil already fired this loop. */
export type WakeupState = Map<string, string>;

/** One fired wakeup; `runId` is null when the issue had no assignee agent. */
export interface WakeupFired {
  readonly issueId: string;
  readonly runId: string | null;
}

/**
 * Fires due defer_until wakeups inside the watch poll tick: every expired
 * deferred issue is undeferred (same fields as surface's undeferIssue) and,
 * when it has an assignee agent, gets one queued run with trigger 'wakeup'.
 * Each issue fires at most once per expiry, enforced by `state`.
 */
export const processWakeups = async (uow: IssueUnitOfWork, state: WakeupState, at: Date): Promise<Result<readonly WakeupFired[]>> => {
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) return err(page.error);
  const now = at.getTime();
  const fired: WakeupFired[] = [];
  for (const issue of page.value.items) {
    if (issue.status !== 'deferred' || issue.deferUntil === null || issue.deferUntil.getTime() > now) continue;
    const expiry = issue.deferUntil.toISOString();
    if (state.get(issue.id) === expiry) continue;
    // Undefer mirrors surface's undeferIssue fields: back to open, no defer date.
    const saved = await uow.save({ ...issue, deferUntil: null, status: 'open', updatedAt: at });
    if (!saved.ok) return err(saved.error);
    state.set(issue.id, expiry);
    if (issue.assignee === null) {
      fired.push({ issueId: issue.id, runId: null });
      continue;
    }
    const agent = await uow.findAgent(issue.assignee as AgentId);
    if (!agent.ok) return err(agent.error);
    if (agent.value === null) {
      fired.push({ issueId: issue.id, runId: null });
      continue;
    }
    const allocated = await nextRunId(uow, issue.id);
    if (!allocated.ok) return err(allocated.error);
    // Same run shape surface's status-move queues, only the trigger differs.
    const queued = await uow.saveRun({
      id: allocated.value, issueId: issue.id, agentId: agent.value.id, trigger: 'wakeup', state: 'queued',
      startedAt: null, closedAt: null, messages: [], usage: { tokens: null, cost: null },
      createdAt: at, updatedAt: at, wireUnknown: {},
    });
    if (!queued.ok) return err(queued.error);
    fired.push({ issueId: issue.id, runId: allocated.value });
  }
  return ok(fired);
};