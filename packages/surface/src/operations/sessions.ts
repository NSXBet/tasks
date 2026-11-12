import { IssueIdSchema, agentRecord, type Run, type RunState } from '@tasks/domain';
import type { SurfaceStore } from '../store.js';
import { MessageError, appErrorMessage } from '../errors.js';

/**
 * One row of a task's SESSIONS tab: a stored agent run, or the `tk finish`
 * session record (`agent_session` / `finished_at` / `agent_harness`).
 * `label` is plain agent-written text capped at {@link SESSION_LABEL_MAX} chars.
 */
export interface SessionRow {
  readonly id: string;
  readonly state: RunState;
  readonly label: string;
  /** ISO timestamp; rows are ordered by it, newest first. */
  readonly updatedAt: string;
}

export const SESSION_LABEL_MAX = 80;

const cap = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SESSION_LABEL_MAX ? flat.slice(0, SESSION_LABEL_MAX) : flat;
};

const runLabel = (run: Run): string => {
  const message = run.messages.find((entry) => entry.text.trim() !== '');
  return cap(message?.text ?? run.agentId ?? run.trigger);
};

/**
 * The agent runs on one task, newest first: stored runs (`uow.listRuns(issueId)`)
 * plus the `tk finish` session record. Unknown or malformed ids give `[]`.
 * Read-only; touches neither git nor the network.
 */
export const taskSessions = async (store: SurfaceStore, id: string): Promise<readonly SessionRow[]> => {
  const parsed = IssueIdSchema.safeParse(id);
  if (!parsed.success) return [];
  const issueId = parsed.data;
  const read = await store.transact(async (uow) => {
    const issue = await uow.findById(issueId);
    if (!issue.ok) throw new MessageError(appErrorMessage(issue.error));
    if (issue.value === null) return null;
    const runs = await uow.listRuns(issueId);
    if (!runs.ok) throw new MessageError(appErrorMessage(runs.error));
    return { issue: issue.value, runs: runs.value };
  });
  if (!read.ok) throw new MessageError(read.error.message);
  if (read.value === null) return [];
  const { issue, runs } = read.value;
  const sessionRows: SessionRow[] = [];
  const record = agentRecord(issue);
  if (record !== null) {
    sessionRows.push({
      id: `session:${record.session}`,
      state: record.finishedAt === null ? 'running' : 'done',
      label: cap(`${record.harness} · session ${record.session}`),
      updatedAt: record.finishedAt ?? issue.updatedAt.toISOString(),
    });
  }
  const runRows = runs.map((run): SessionRow => ({ id: run.id, state: run.state, label: runLabel(run), updatedAt: run.updatedAt.toISOString() }));
  // Stable sort; the finish record goes first on a tie (it is the latest word on the task).
  return [...sessionRows, ...runRows].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
};
