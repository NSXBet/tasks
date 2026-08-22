import type { DependencyEdge, DependencyTarget, DependencyType, Issue, IssueId, IssueStatus } from '@tasks/domain';
import type { Result } from '../result.js';

export interface IssueQuery { readonly status?: IssueStatus; readonly limit?: number; readonly cursor?: IssueId; }
export interface AuditEntry { readonly id: number; readonly issueId: IssueId; readonly action: string; readonly at: Date; readonly actor: string | null; readonly data: Record<string, unknown>; }
export interface IssuePage { readonly items: readonly Issue[]; readonly nextCursor: IssueId | null; }
/** Transaction-scoped persistence contract. No adapter errors cross boundary. */
export interface IssueUnitOfWork {
  findById(id: IssueId): Promise<Result<Issue | null>>;
  save(issue: Issue): Promise<Result<void>>;
  list(query: IssueQuery): Promise<Result<IssuePage>>;
  addDependency(edge: DependencyEdge): Promise<Result<void>>;
  removeDependency(issueId: IssueId, target: DependencyTarget, type?: DependencyType): Promise<Result<void>>;
  addComment(issueId: IssueId, author: string, text: string): Promise<Result<void>>;
  history(issueId: IssueId): Promise<Result<readonly AuditEntry[]>>;
  /** Atomically verify ready state and claim. `conflict` means lost race/not-ready. */
  claimReady(id: IssueId, assignee: string, expectedUpdatedAt?: Date): Promise<Result<Issue>>;
}
/** Opens one transaction and gives work only its transaction-bound repository. */
export interface UnitOfWork {
  withinTransaction<T>(work: (uow: IssueUnitOfWork) => Promise<Result<T>>): Promise<Result<T>>;
}
/** Compatibility alias; do not use outside migration path. */
export type IssueRepository = IssueUnitOfWork;
