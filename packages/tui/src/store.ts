import type { Issue } from "@tasks/domain";
import { createSurface, type TasksSurface, type WatchEvent } from "@tasks/surface";

/**
 * Board model derived once per refresh: the TUI never re-queries the store
 * for every render. Counts come from the same full page the watcher uses,
 * so the list and the counters never disagree.
 */
export interface Board {
  readonly issues: readonly Issue[];
  readonly currentId: string | null;
  /** Slug of the workspace's single active sprint; null when no focus bucket. */
  readonly activeSprintId: string | null;
  readonly counts: { readonly open: number; readonly inProgress: number; readonly readyToReview: number; readonly blocked: number; readonly closed: number; readonly archived: number };
  readonly fetchedAt: Date;
}

export const isBlocked = (issue: Issue, all: readonly Issue[]): boolean =>
  issue.dependencies.some((edge) =>
    edge.type === "blocks" && all.some((other) => other.id === edge.target && other.status !== "closed"));

export const isReady = (issue: Issue, all: readonly Issue[]): boolean =>
  issue.status === "open"
  && (issue.deferUntil === null || issue.deferUntil <= new Date())
  && !isBlocked(issue, all);

export const buildBoard = (issues: readonly Issue[], currentId: string | null, activeSprintId: string | null = null): Board => {
  const tally = (predicate: (issue: Issue) => boolean): number => issues.filter(predicate).length;
  return {
    issues,
    currentId,
    activeSprintId,
    counts: {
      open: tally((issue) => issue.status === "open"),
      inProgress: tally((issue) => issue.status === "in_progress"),
      readyToReview: tally((issue) => issue.status === "ready-to-review"),
      blocked: tally((issue) => isBlocked(issue, issues) && issue.status !== "closed"),
      closed: tally((issue) => issue.status === "closed"),
      archived: tally((issue) => issue.status === "archived"),
    },
    fetchedAt: new Date(),
  };
};

export type FilterKind = "all" | "ready" | "open" | "in_progress" | "ready-to-review" | "closed" | "mine" | "sprint" | "archived";

/** Archived issues stay loaded but out of every default view; only the icebox tab surfaces them. */
const notArchived = (issue: Issue): boolean => issue.status !== "archived";

export const applyFilter = (board: Board, filter: FilterKind, actor: string): readonly Issue[] => {
  const issues = board.issues;
  switch (filter) {
    case "ready": return issues.filter((issue) => notArchived(issue) && isReady(issue, issues));
    case "open": return issues.filter((issue) => notArchived(issue) && issue.status === "open");
    case "in_progress": return issues.filter((issue) => notArchived(issue) && issue.status === "in_progress");
    case "ready-to-review": return issues.filter((issue) => notArchived(issue) && issue.status === "ready-to-review");
    case "closed": return issues.filter((issue) => notArchived(issue) && issue.status === "closed");
    case "mine": return issues.filter((issue) => notArchived(issue) && issue.assignee === actor);
    case "sprint": return issues.filter((issue) => notArchived(issue) && board.activeSprintId !== null && issue.sprintId === board.activeSprintId);
    case "archived": return issues.filter((issue) => issue.status === "archived");
    default: return issues.filter(notArchived);
  }
};

/** What the list pane shows: filter plus fuzzy search over id/title/desc/labels. */
export const visibleIssues = (board: Board, filter: FilterKind, search: string, actor: string): readonly Issue[] => {
  const base = applyFilter(board, filter, actor);
  if (search === "") return base;
  const term = search.toLowerCase();
  return base.filter((issue) =>
    [issue.id, issue.title, issue.description, ...issue.labels].join(" ").toLowerCase().includes(term));
};

/** Board change signature: cheap dirty check between poll ticks. */
export const boardSignature = (board: Board): string =>
  JSON.stringify(board.counts) + `|${board.issues.length}|${Math.max(-1, ...board.issues.map((issue) => issue.updatedAt.getTime()))}`;

// ---------------------------------------------------------------------------
// Pure graph helpers. All operate on a full board page; they never re-query
// the store, so views and metrics can never disagree with each other.
// ---------------------------------------------------------------------------

export type DepDirection = "up" | "down";

/** One rendered row of a dependency tree. `prefix` carries tree connectors. */
export interface TreeRow {
  readonly id: string;
  readonly depth: number;
  readonly prefix: string;
  /** Edge closes a cycle back into the current path. */
  readonly cycle: boolean;
  /** Node already rendered elsewhere in this tree. */
  readonly reference: boolean;
  readonly blocked: boolean;
}

const dependentsOf = (issues: readonly Issue[]): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const issue of issues) map.set(issue.id, []);
  for (const issue of issues) {
    for (const edge of issue.dependencies) {
      if (edge.type !== "blocks") continue;
      map.get(edge.target)?.push(issue.id);
    }
  }
  return map;
};

/**
 * Dependency tree around `rootId`: direction "up" walks blockers
 * (prerequisites), "down" walks dependents. Cycles become `(cycle)` rows,
 * repeated subtrees become `(ref)` rows. Depth-capped like beads_viewer.
 */
export const dependencyTree = (issues: readonly Issue[], rootId: string, direction: DepDirection, maxDepth = 3): readonly TreeRow[] => {
  const byId = new Map<string, Issue>(issues.map((issue) => [issue.id, issue]));
  const root = byId.get(rootId);
  if (root === undefined) return [];
  const neighbors = (issue: Issue): readonly Issue[] => {
    if (direction === "up") {
      return issue.dependencies
        .filter((edge) => edge.type === "blocks")
        .flatMap((edge) => { const other = byId.get(edge.target); return other === undefined ? [] : [other]; });
    }
    return (dependentsOf(issues).get(issue.id) ?? []).flatMap((id) => { const other = byId.get(id); return other === undefined ? [] : [other]; });
  };
  const rows: TreeRow[] = [{ id: root.id, depth: 0, prefix: "", cycle: false, reference: false, blocked: isBlocked(root, issues) }];
  const visited = new Set<string>([root.id]);
  const walk = (issue: Issue, depth: number, prefix: string, path: ReadonlySet<string>): void => {
    if (depth >= maxDepth) return;
    const kids = neighbors(issue);
    kids.forEach((kid, index) => {
      const last = index === kids.length - 1;
      const onPath = path.has(kid.id);
      const seen = visited.has(kid.id);
      rows.push({
        id: kid.id,
        depth: depth + 1,
        prefix: prefix + (last ? "└─ " : "├─ "),
        cycle: onPath,
        reference: seen && !onPath,
        blocked: isBlocked(kid, issues),
      });
      if (onPath || seen) return;
      visited.add(kid.id);
      walk(kid, depth + 1, prefix + (last ? "   " : "│  "), new Set(path).add(kid.id));
    });
  };
  walk(root, 0, "", new Set([root.id]));
  return rows;
};

/** Longest downstream chain through non-closed issues, per issue (memoized). */
export const chainLengths = (issues: readonly Issue[]): ReadonlyMap<string, number> => {
  const openIds = new Set<string>(issues.filter((issue) => issue.status !== "closed").map((issue) => issue.id));
  const dependents = dependentsOf(issues);
  const memo = new Map<string, number>();
  const measure = (id: string, stack: ReadonlySet<string>): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (stack.has(id)) return 1;
    let best = 0;
    const next = new Set(stack);
    next.add(id);
    for (const child of dependents.get(id) ?? []) {
      if (!openIds.has(child)) continue;
      best = Math.max(best, measure(child, next));
    }
    const value = best + 1;
    memo.set(id, value);
    return value;
  };
  for (const issue of issues) measure(issue.id, new Set());
  return memo;
};

/** The actual longest dependency chain (ids, head first). */
export const criticalChain = (issues: readonly Issue[]): readonly string[] => {
  const byId = new Map<string, Issue>(issues.map((issue) => [issue.id, issue]));
  const lengths = chainLengths(issues);
  const dependents = dependentsOf(issues);
  let head: string | null = null;
  let best = 0;
  for (const [id, length] of lengths) {
    if (byId.get(id)?.status === "closed") continue;
    if (length > best) { best = length; head = id; }
  }
  if (head === null) return [];
  const chain: string[] = [];
  let current: string | undefined = head ?? undefined;
  const walked = new Set<string>();
  while (current !== undefined && !walked.has(current)) {
    walked.add(current);
    chain.push(current);
    let next: string | undefined;
    let nextLen = 0;
    for (const child of dependents.get(current) ?? []) {
      const len = lengths.get(child) ?? 0;
      if (len > nextLen) { nextLen = len; next = child; }
    }
    current = nextLen > 0 ? next : undefined;
  }
  return chain;
};

/**
 * How many non-closed issues become reachable-for-work if this issue closes:
 * BFS over the dependents graph. This is beads_viewer's "unblocks N" ranking.
 */
export const unblockGains = (issues: readonly Issue[]): ReadonlyMap<string, number> => {
  const openIds = new Set<string>(issues.filter((issue) => issue.status !== "closed").map((issue) => issue.id));
  const dependents = dependentsOf(issues);
  const gains = new Map<string, number>();
  for (const id of openIds) {
    const seen = new Set<string>([id]);
    const queue = [id];
    let reachable = 0;
    while (queue.length > 0) {
      const node = queue.pop()!;
      for (const child of dependents.get(node) ?? []) {
        if (seen.has(child) || !openIds.has(child)) continue;
        seen.add(child);
        reachable += 1;
        queue.push(child);
      }
    }
    gains.set(id, reachable);
  }
  return gains;
};

/**
 * Strongly connected components over the blocks graph (issue → its blockers).
 * One representative cycle path per component larger than a self-loop.
 */
export const detectCycles = (issues: readonly Issue[]): readonly (readonly string[])[] => {
  const ids = new Set<string>(issues.map((issue) => issue.id));
  const blockers = new Map<string, string[]>();
  for (const issue of issues) blockers.set(issue.id, []);
  for (const issue of issues) {
    for (const edge of issue.dependencies) {
      if (edge.type === "blocks" && ids.has(edge.target)) blockers.get(issue.id)!.push(edge.target);
    }
  }
  // Tarjan (recursive; board sizes here are TUI-scale).
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let counter = 0;
  const strongConnect = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of blockers.get(node) ?? []) {
      if (!index.has(next)) {
        strongConnect(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let popped: string;
      do {
        popped = stack.pop()!;
        onStack.delete(popped);
        component.push(popped);
      } while (popped !== node);
      components.push(component);
    }
  };
  for (const issue of issues) if (!index.has(issue.id)) strongConnect(issue.id);
  return components
    .filter((component) => component.length > 1)
    .map((component) => {
      // Extract one concrete cycle path inside the component.
      const members = new Set(component);
      const start = component[0]!;
      const path: string[] = [start];
      const seen = new Set([start]);
      let current = start;
      let closed = false;
      while (!closed) {
        const next = (blockers.get(current) ?? []).find((candidate) => members.has(candidate));
        if (next === undefined) break;
        if (seen.has(next)) { path.push(next); closed = true; break; }
        seen.add(next);
        path.push(next);
        current = next;
      }
      return path.length > 1 && path[0] === path[path.length - 1] ? path : [...component, component[0]!];
    });
};

/** Directed density: local blocks edges over possible edges. */
export const graphDensity = (issues: readonly Issue[]): number => {
  const ids = new Set<string>(issues.map((issue) => issue.id));
  const edges = issues.reduce((total, issue) =>
    total + issue.dependencies.filter((edge) => edge.type === "blocks" && ids.has(edge.target)).length, 0);
  const n = issues.length;
  return n > 1 ? edges / (n * (n - 1)) : 0;
};

// ---------------------------------------------------------------------------
// Kanban grouping (pure; shared by the board view and the App key router).
// ---------------------------------------------------------------------------

export interface KanbanColumn {
  readonly key: string;
  readonly title: string;
  readonly statuses: readonly string[];
}

/** Column order: flow left→right; parked only surfaces when non-empty.
 * Titles stay short so box borders keep them at narrow terminal widths. */
export const kanbanColumnDefs: readonly KanbanColumn[] = [
  { key: "open", title: "Open", statuses: ["open"] },
  { key: "in_progress", title: "In Progress", statuses: ["in_progress"] },
  { key: "ready-to-review", title: "Review", statuses: ["ready-to-review"] },
  { key: "closed", title: "Closed", statuses: ["closed"] },
  { key: "parked", title: "Parked", statuses: ["approved", "rejected", "deferred"] },
];

export interface KanbanCard {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly priority: number;
  readonly type: string;
  readonly labels: readonly string[];
  readonly age: Date;
  readonly blocked: boolean;
  readonly comments: number;
}

export interface KanbanGroup extends KanbanColumn {
  readonly cards: readonly KanbanCard[];
}

export const kanbanGroups = (issues: readonly Issue[], now: Date): readonly KanbanGroup[] =>
  kanbanColumnDefs.map((column) => {
    const cards = issues
      .filter((issue) => column.statuses.includes(issue.status))
      .map((issue): KanbanCard => ({
        id: issue.id, title: issue.title, status: issue.status, priority: issue.priority, type: issue.type,
        labels: issue.labels, age: issue.updatedAt, blocked: isBlocked(issue, issues),
        comments: issue.commentCount,
      }))
      .sort((left, right) =>
        left.priority - right.priority || right.age.getTime() - left.age.getTime() || left.id.localeCompare(right.id));
    return { ...column, cards };
  });

/** Issue id under the kanban selection; null when the column has no cards. */
export const kanbanCardAt = (groups: readonly KanbanGroup[], col: number, row: number): string | null =>
  groups[col]?.cards[row]?.id ?? null;

/**
 * Store session: one surface handle plus a resumable refresh function.
 * The surface owns workspace discovery, storage, and all mutations; the TUI
 * layer adds only the full-page board view and a change-detection poll.
 */
export interface TuiStore {
  readonly surface: TasksSurface;
  readonly loadBoard: () => Promise<Board>;
  readonly watch: (onEvent: (event: WatchEvent) => void, intervalMs?: number) => () => void;
  readonly close: () => Promise<void>;
}

const openTuiStore = async (root: string): Promise<TuiStore> => {
  const surface = await createSurface({ root });
  const loadBoard = async (): Promise<Board> => {
    const page = await surface.all();
    if (!page.ok) throw new Error(page.error.message);
    const currentId = await surface.currentId();
    const sprints = await surface.sprintList();
    const activeSprintId = sprints.ok ? sprints.value.find((sprint) => sprint.status === "active")?.id ?? null : null;
    return buildBoard(page.value, currentId, activeSprintId);
  };
  const watch = (onEvent: (event: WatchEvent) => void, intervalMs = 1000): (() => void) => {
    let lastSignature = "";
    let stopping = false;
    const loop = async (): Promise<void> => {
      while (!stopping) {
        try {
          const board = await loadBoard();
          if (boardSignature(board) !== lastSignature) {
            lastSignature = boardSignature(board);
            onEvent({ seq: 0, kind: "issue.updated", at: new Date().toISOString(), counts: board.counts });
          }
        } catch { /* Keep polling through transient storage failures; UI shows a stale mark. */ }
        await Bun.sleep(intervalMs);
      }
    };
    void loop();
    return () => { stopping = true; };
  };
  return { surface, loadBoard, watch, close: () => surface.store.close() };
};

export { openTuiStore };