import type { Issue, IssueId, Run, RunId } from '@tasks/domain';
import type { IssueUnitOfWork, Result } from '@tasks/application';
import type { StorageAdapter } from '@tasks/workspace';
import { appendEvents, type EventDraft } from './log.js';
import { deriveIssueEvents, deriveRunEvent } from './derive.js';

export interface EventLogOptions {
  readonly tasksDir: string;
  readonly actor: string;
  readonly session?: string | undefined;
}

/** Recording state for one transaction: first `before` per touched id, plus the last saved run per id. */
interface Touched {
  readonly issues: Map<string, Issue | null>;
  readonly runs: Map<string, { before: Run | null; after: Run }>;
}

const valueOf = <T>(result: Result<T>): T | null => (result.ok ? result.value : null);

/**
 * A recording view of one transaction's unit of work. Mutators snapshot the
 * touched issue (or run) via the inner `findById`/`findRun` before forwarding;
 * every other member passes straight through, so adapter-specific extras keep
 * working. Only IssueUnitOfWork methods are called — no backend knowledge.
 */
const recordingUow = (uow: IssueUnitOfWork, touched: Touched): IssueUnitOfWork => {
  const snapshot = async (id: IssueId): Promise<void> => {
    const key = id as string;
    if (touched.issues.has(key)) return;
    touched.issues.set(key, valueOf(await uow.findById(id)));
  };
  const overrides: Partial<IssueUnitOfWork> = {
    save: async (issue) => { await snapshot(issue.id); return uow.save(issue); },
    addDependency: async (edge) => { await snapshot(edge.issueId); return uow.addDependency(edge); },
    removeDependency: async (issueId, target, type) => { await snapshot(issueId); return uow.removeDependency(issueId, target, type); },
    addComment: async (issueId, author, text) => { await snapshot(issueId); return uow.addComment(issueId, author, text); },
    delete: async (issueId) => { await snapshot(issueId); return uow.delete(issueId); },
    claimReady: async (id, assignee, expectedUpdatedAt) => { await snapshot(id); return uow.claimReady(id, assignee, expectedUpdatedAt); },
    saveRun: async (run) => {
      const key = run.id as string;
      const known = touched.runs.get(key);
      const before = known !== undefined ? known.before : valueOf(await uow.findRun(run.id as RunId));
      const result = await uow.saveRun(run);
      if (result.ok) touched.runs.set(key, { before, after: run });
      return result;
    },
  };
  return new Proxy(uow, {
    get(target, property) {
      if (typeof property === 'string' && property in overrides) return overrides[property as keyof IssueUnitOfWork];
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
};

/** Drafts for everything touched, read inside the still-open transaction so `after` is this transaction's state. */
const draftsFor = async (uow: IssueUnitOfWork, touched: Touched): Promise<EventDraft[]> => {
  const drafts: EventDraft[] = [];
  for (const [id, before] of touched.issues) {
    const after = valueOf(await uow.findById(id as IssueId));
    drafts.push(...deriveIssueEvents(before, after));
  }
  for (const { before, after } of touched.runs.values()) drafts.push(...deriveRunEvent(before, after));
  return drafts;
};

/**
 * Decorates a StorageAdapter so every committed transaction appends its events
 * to `<tasksDir>/events.jsonl`. MigrationPort members forward unchanged.
 *
 * Emission is advisory: events are appended only after the inner
 * `withinTransaction` returns ok (committed), and any derivation or append
 * failure is swallowed — a log problem must never fail or roll back a write
 * the user already committed. A non-ok result or a throw appends nothing.
 */
export const withEventLog = (adapter: StorageAdapter, options: EventLogOptions): StorageAdapter => {
  const withinTransaction: StorageAdapter['withinTransaction'] = async (work) => {
    let drafts: EventDraft[] = [];
    const outcome = await adapter.withinTransaction(async (uow) => {
      const touched: Touched = { issues: new Map(), runs: new Map() };
      const result = await work(recordingUow(uow, touched));
      if (result.ok && (touched.issues.size > 0 || touched.runs.size > 0)) {
        try { drafts = await draftsFor(uow, touched); } catch { drafts = []; }
      }
      return result;
    });
    if (outcome.ok && drafts.length > 0) {
      try { await appendEvents(options.tasksDir, drafts, { actor: options.actor, session: options.session }); } catch { /* advisory: see header */ }
    }
    return outcome;
  };
  return {
    withinTransaction,
    currentVersion: () => adapter.currentVersion(),
    history: () => adapter.history(),
    migrate: (steps) => adapter.migrate(steps),
    hasPendingMigrations: (steps) => adapter.hasPendingMigrations(steps),
  };
};
