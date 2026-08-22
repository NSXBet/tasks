import type { Issue, IssueDescription, IssueId, IssuePriority, IssueStatus, IssueTitle, IssueType, DependencyTarget, DependencyType, Metadata } from '@tasks/domain';
import type { Result } from '../result.js';

export interface CreateIssueInput {
  readonly title: IssueTitle; readonly description: IssueDescription; readonly priority: IssuePriority; readonly type: IssueType;
  readonly owner?: string | null; readonly assignee?: string | null; readonly createdBy?: string | null; readonly dueAt?: Date | null; readonly deferUntil?: Date | null; readonly parentId?: IssueId | null;
  readonly labels?: readonly string[]; readonly notes?: string | null; readonly design?: string | null; readonly acceptanceCriteria?: string | null; readonly estimate?: number | null; readonly specId?: string | null; readonly externalRef?: string | null; readonly metadata?: Metadata;
}
export interface UpdateIssueInput {
  readonly id: IssueId; readonly expectedUpdatedAt?: Date; readonly title?: IssueTitle; readonly description?: IssueDescription; readonly priority?: IssuePriority; readonly type?: IssueType; readonly owner?: string | null; readonly assignee?: string | null; readonly dueAt?: Date | null; readonly deferUntil?: Date | null; readonly parentId?: IssueId | null; readonly labels?: readonly string[]; readonly notes?: string | null; readonly design?: string | null; readonly acceptanceCriteria?: string | null; readonly estimate?: number | null; readonly specId?: string | null; readonly externalRef?: string | null; readonly metadata?: Metadata;
}
export interface DependencyInput { readonly issueId: IssueId; readonly target: DependencyTarget; readonly type: DependencyType; readonly createdBy?: string | null; readonly metadata?: Metadata; }
export interface CommentInput { readonly issueId: IssueId; readonly author: string; readonly text: string; }
export interface ChangeIssueStatusInput { readonly id: IssueId; readonly status: IssueStatus; readonly expectedUpdatedAt?: Date; }
export interface ClaimReadyIssueInput { readonly id: IssueId; readonly assignee: string; readonly expectedUpdatedAt?: Date; }
export interface CreateIssueUseCase { execute(input: CreateIssueInput): Promise<Result<Issue>>; }
export interface UpdateIssueUseCase { execute(input: UpdateIssueInput): Promise<Result<Issue>>; }
export interface GetIssueUseCase { execute(id: IssueId): Promise<Result<Issue | null>>; }
export interface ChangeIssueStatusUseCase { execute(input: ChangeIssueStatusInput): Promise<Result<Issue>>; }
export interface AddDependencyUseCase { execute(input: DependencyInput): Promise<Result<void>>; }
export interface AddCommentUseCase { execute(input: CommentInput): Promise<Result<void>>; }
export interface ClaimReadyIssueUseCase { execute(input: ClaimReadyIssueInput): Promise<Result<Issue>>; }
