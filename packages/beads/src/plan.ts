import type { Issue, IssueId } from '@tasks/domain';
import type { BeadsIssueRecord } from './records.js';

/** A parent link that points nowhere; persisting it would violate referential integrity. */
export interface DanglingParent { readonly issueId: IssueId; readonly parentId: IssueId; readonly line: number; }
export interface ParentCycle { readonly members: readonly IssueId[] }
export interface IssuePlan {
  /** Save order: every parent precedes its children, so foreign keys always resolve. */
  readonly ordered: readonly BeadsIssueRecord[];
  /** Links detached to stay persistable. Reported, never silently dropped. */
  readonly detached: readonly DanglingParent[];
  readonly cycles: readonly ParentCycle[];
}

const detach = (issue: Issue): Issue => ({ ...issue, parentId: null });

/**
 * Order issues parent-first and quarantine unpersistable parent links.
 *
 * Beads exports are unordered and may reference parents outside the export
 * (filtered exports, deleted parents). `existing` carries IDs already durable
 * in the target so cross-batch links survive.
 */
export function planIssues(records: readonly BeadsIssueRecord[], existing: ReadonlySet<string> = new Set()): IssuePlan {
  const byId = new Map<string, BeadsIssueRecord>();
  for (const record of records) byId.set(record.issue.id, record);

  const detached: DanglingParent[] = [];
  const resolvable = new Map<string, BeadsIssueRecord>();
  for (const record of records) {
    const parent = record.issue.parentId;
    if (parent === null || byId.has(parent) || existing.has(parent)) { resolvable.set(record.issue.id, record); continue; }
    detached.push({ issueId: record.issue.id, parentId: parent, line: record.line });
    resolvable.set(record.issue.id, { ...record, issue: detach(record.issue) });
  }

  const ordered: BeadsIssueRecord[] = [];
  const placed = new Set<IssueId>();
  const cycles: ParentCycle[] = [];
  const visiting = new Set<IssueId>();

  const place = (record: BeadsIssueRecord, trail: readonly IssueId[]): void => {
    const id = record.issue.id;
    if (placed.has(id)) return;
    if (visiting.has(id)) { cycles.push({ members: [...trail.slice(trail.indexOf(id)), id] }); return; }
    visiting.add(id);
    const parent = record.issue.parentId;
    const ancestor = parent === null ? undefined : resolvable.get(parent);
    if (ancestor !== undefined) place(ancestor, [...trail, id]);
    visiting.delete(id);
    if (placed.has(id)) return;
    // A cycle member cannot keep its parent link and still be insertable.
    const cycled = cycles.some((cycle) => cycle.members.includes(id));
    ordered.push(cycled ? { ...record, issue: detach(record.issue) } : record);
    placed.add(id);
  };

  for (const record of records) place(resolvable.get(record.issue.id) ?? record, []);
  return { ordered, detached, cycles };
}
