import type { Issue } from '@tasks/domain';

import type { TreeNode } from './tree.js';

/**
 * Wire format — the stable JSON contract shared by `tk --json`, `tk export`,
 * and the pi/omp extension surface. Moved verbatim from the CLI presentation
 * layer so every consumer serializes identically.
 */

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

export function issueWire(issue: Issue): Record<string, unknown> {
  return {
    schema_version: 1, _type: "issue", id: issue.id, title: issue.title, description: issue.description,
    status: issue.status, priority: issue.priority, issue_type: issue.type, owner: issue.owner,
    assignee: issue.assignee, created_by: issue.createdBy, created_at: issue.createdAt.toISOString(),
    updated_at: issue.updatedAt.toISOString(), started_at: iso(issue.startedAt), closed_at: iso(issue.closedAt),
    due_at: iso(issue.dueAt), defer_until: iso(issue.deferUntil), parent: issue.parentId, labels: [...issue.labels],
    notes: issue.notes, design: issue.design, acceptance_criteria: issue.acceptanceCriteria, estimated_minutes: issue.estimate,
    spec_id: issue.specId, external_ref: issue.externalRef, branch: issue.branch, metadata: issue.metadata,
    dependencies: issue.dependencies.map((edge) => ({ issue_id: edge.issueId, depends_on_id: edge.target, type: edge.type, created_at: edge.createdAt.toISOString(), created_by: edge.createdBy, metadata: edge.metadata })),
    dependency_count: issue.dependencyCount, dependent_count: issue.dependentCount,
    comments: issue.comments.map((comment) => ({ id: comment.id, issue_id: comment.issueId, author: comment.author, text: comment.text, created_at: comment.createdAt.toISOString() })),
    comment_count: issue.commentCount,
  };
}

export function commentWire(issue: Issue): readonly Record<string, unknown>[] { return issueWire(issue)["comments"] as readonly Record<string, unknown>[]; }

/** JSON-safe nested tree node used by `tk tree --json` and the surface. */
export function treeNodeWire(node: TreeNode): Record<string, unknown> {
  return {
    ...issueWire(node.issue),
    via: node.via,
    ...(node.duplicateOf === null ? {} : { duplicate_of: node.duplicateOf }),
    blocked_by: [...node.blockedBy],
    ...(node.progress === null ? {} : { progress: node.progress }),
    hidden_children: node.hiddenChildren,
    children: node.children.map(treeNodeWire),
  };
}

/**
 * Recommended markdown sections per issue type, for `lint`.
 * Moved from the CLI presentation layer: it is operation policy, not display.
 */
export const LINT_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  bug: ["Steps to Reproduce", "Acceptance Criteria"],
  task: ["Acceptance Criteria"],
  feature: ["Acceptance Criteria"],
  epic: ["Success Criteria"],
  chore: [],
};
