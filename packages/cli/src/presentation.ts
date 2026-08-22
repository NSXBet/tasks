import type { Issue } from "@tasks/domain";

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;
export function issueWire(issue: Issue): Record<string, unknown> {
  return {
    schema_version: 1, _type: "issue", id: issue.id, title: issue.title, description: issue.description,
    status: issue.status, priority: issue.priority, issue_type: issue.type, owner: issue.owner,
    assignee: issue.assignee, created_by: issue.createdBy, created_at: issue.createdAt.toISOString(),
    updated_at: issue.updatedAt.toISOString(), started_at: iso(issue.startedAt), closed_at: iso(issue.closedAt),
    due_at: iso(issue.dueAt), defer_until: iso(issue.deferUntil), parent: issue.parentId, labels: [...issue.labels],
    notes: issue.notes, design: issue.design, acceptance_criteria: issue.acceptanceCriteria, estimated_minutes: issue.estimate,
    spec_id: issue.specId, external_ref: issue.externalRef, metadata: issue.metadata,
    dependencies: issue.dependencies.map((edge) => ({ issue_id: edge.issueId, depends_on_id: edge.target, type: edge.type, created_at: edge.createdAt.toISOString(), created_by: edge.createdBy, metadata: edge.metadata })),
    dependency_count: issue.dependencyCount, dependent_count: issue.dependentCount,
    comments: issue.comments.map((comment) => ({ id: comment.id, issue_id: comment.issueId, author: comment.author, text: comment.text, created_at: comment.createdAt.toISOString() })),
    comment_count: issue.commentCount,
  };
}
export function commentWire(issue: Issue): readonly Record<string, unknown>[] { return issueWire(issue)["comments"] as readonly Record<string, unknown>[]; }
export function output(value: unknown, json: boolean): void {
  if (json) { console.log(JSON.stringify(value)); return; }
  if (Array.isArray(value)) { for (const item of value) { const record = item as Record<string, unknown>; console.log(`${String(record["id"] ?? "")}\t${String(record["status"] ?? "")}\t${String(record["title"] ?? JSON.stringify(item))}`); } return; }
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}
