import type { Issue } from "@tasks/domain";

/** Options for the read-only `tk tree` board view. */
export interface TreeOptions {
  /** Include closed issues. Without this (or --status), closed issues are hidden. */
  readonly all: boolean;
  /** Show only this status; takes precedence over the closed-hidden default. */
  readonly status?: string;
  /** Maximum nesting depth; 1 renders roots only. Undefined means unlimited. */
  readonly depth?: number;
}

export interface TreeProgress {
  readonly closed: number;
  readonly total: number;
}

/** A displayed issue. `via` distinguishes structural nesting from dependency fan-out. */
export interface TreeNode {
  readonly issue: Issue;
  readonly via: "root" | "parent" | "blocks";
  /** Repeated reference to an issue already rendered elsewhere; never has children. */
  readonly duplicateOf: string | null;
  /** Active blocker IDs, ordered by priority. */
  readonly blockedBy: readonly string[];
  /** Closed/total direct subtasks, including hidden closed tasks. */
  readonly progress: TreeProgress | null;
  /** Immediate children omitted because of --depth. */
  readonly hiddenChildren: number;
  readonly children: readonly TreeNode[];
}

export interface IssueTree {
  readonly roots: readonly TreeNode[];
  readonly visible: number;
  readonly hidden: number;
}

const byPriorityThenId = (left: Issue, right: Issue): number =>
  left.priority - right.priority || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

const push = (index: Map<string, Issue[]>, key: string, issue: Issue): void => {
  const entries = index.get(key);
  if (entries === undefined) index.set(key, [issue]);
  else entries.push(issue);
};

/**
 * Builds a deterministic board tree. Parent links render as ordinary children;
 * `blocks` edges fan out from blocker to dependent. A visited marker prevents
 * repeated paths and malformed cycles from expanding indefinitely.
 */
export function buildTree(issues: readonly Issue[], options: TreeOptions): IssueTree {
  const visible = issues.filter((issue) =>
    options.status === undefined ? options.all || issue.status !== "closed" : issue.status === options.status,
  );
  const visibleIds = new Set(visible.map((issue) => issue.id as string));
  const allById = new Map(issues.map((issue) => [issue.id as string, issue]));
  const subtasks = new Map<string, Issue[]>();
  const dependents = new Map<string, Issue[]>();
  const progress = new Map<string, TreeProgress>();
  const statuses = new Map(issues.map((issue) => [issue.id as string, issue.status]));

  for (const issue of issues) {
    if (issue.parentId === null) continue;
    const entry = progress.get(issue.parentId) ?? { closed: 0, total: 0 };
    progress.set(issue.parentId, { closed: entry.closed + (issue.status === "closed" ? 1 : 0), total: entry.total + 1 });
  }
  for (const issue of visible) {
    if (issue.parentId !== null && visibleIds.has(issue.parentId)) push(subtasks, issue.parentId, issue);
    for (const edge of issue.dependencies) {
      if (edge.type === "blocks" && edge.target !== issue.id && visibleIds.has(edge.target)) push(dependents, edge.target, issue);
    }
  }
  for (const index of [subtasks, dependents]) for (const entries of index.values()) entries.sort(byPriorityThenId);

  const blockersOf = (issue: Issue): readonly string[] => issue.dependencies
    .filter((edge) => edge.type === "blocks" && statuses.get(edge.target) !== undefined && statuses.get(edge.target) !== "closed")
    .map((edge) => edge.target as string)
    .sort((left, right) => byPriorityThenId(allById.get(left)!, allById.get(right)!));


  const rootOrder = (left: Issue, right: Issue): number =>
    (left.type === "epic" ? 0 : 1) - (right.type === "epic" ? 0 : 1) || byPriorityThenId(left, right);
  const roots = visible
    .filter((issue) => issue.type === "epic" ? issue.parentId === null || !visibleIds.has(issue.parentId) : (issue.parentId === null || !visibleIds.has(issue.parentId)) && blockersOf(issue).length === 0)
    .sort(rootOrder);

  const seen = new Set<string>();
  const suppressed = new Set<string>();
  const hideDescendants = (issuesToHide: readonly Issue[]): void => {
    const pending = [...issuesToHide];
    while (pending.length > 0) {
      const issue = pending.pop()!;
      if (suppressed.has(issue.id)) continue;
      suppressed.add(issue.id);
      pending.push(...(subtasks.get(issue.id) ?? []), ...(dependents.get(issue.id) ?? []));
    }
  };
  const walk = (issue: Issue, via: TreeNode["via"], depth: number): TreeNode => {
    const id = issue.id as string;
    const blockedBy = blockersOf(issue);
    const issueProgress = progress.get(id) ?? null;
    if (seen.has(id)) return { issue, via, duplicateOf: id, blockedBy, progress: issueProgress, hiddenChildren: 0, children: [] };

    const direct = subtasks.get(id) ?? [];
    const unlocked = dependents.get(id) ?? [];
    const childIssues = [...direct, ...unlocked.filter((candidate) => !direct.some((child) => child.id === candidate.id))];
    seen.add(id);
    if (options.depth !== undefined && depth >= options.depth) {
      hideDescendants(childIssues);
      return { issue, via, duplicateOf: null, blockedBy, progress: issueProgress, hiddenChildren: childIssues.length, children: [] };
    }
    return {
      issue,
      via,
      duplicateOf: null,
      blockedBy,
      progress: issueProgress,
      hiddenChildren: 0,
      children: childIssues.map((child) => walk(child, child.parentId === issue.id ? "parent" : "blocks", depth + 1)),
    };
  };

  const renderedRoots = roots.map((issue) => walk(issue, "root", 1));
  for (const issue of visible.sort(rootOrder)) if (!seen.has(issue.id) && !suppressed.has(issue.id)) renderedRoots.push(walk(issue, "root", 1));
  return { roots: renderedRoots, visible: visible.length, hidden: issues.length - visible.length };
}
