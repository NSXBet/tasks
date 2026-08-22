import type { IssueId } from '@tasks/domain';
/** Generates domain identifiers without exposing strategy. */
export interface IdGenerator { nextIssueId(): IssueId; }
