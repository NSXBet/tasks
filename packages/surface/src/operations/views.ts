import type { Issue } from '@tasks/domain';
import { issueId } from '@tasks/domain';
import type { SurfaceStore } from '../store.js';
import { readCurrentId } from '../store.js';
import { MessageError } from '../errors.js';
import { buildTree, type IssueTree, type TreeOptions } from '../tree.js';
import { LINT_SECTIONS } from '../envelope.js';

export const allIssues = (store: SurfaceStore) => store.transact(async (uow) => {
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  return page.value.items;
});

export const counts = (store: SurfaceStore) => store.transact(async (uow) => {
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  const all = page.value.items;
  const tally = (key: (issue: Issue) => string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const issue of all) {
      const value = key(issue);
      out[value] = (out[value] ?? 0) + 1;
    }
    return out;
  };
  return { total: all.length, by_status: tally((issue) => issue.status), by_type: tally((issue) => issue.type) };
});

export const stats = (store: SurfaceStore) => store.transact(async (uow) => {
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  const all = page.value.items;
  const blockedIds = new Set(all.filter((issue) => issue.dependencies.some((edge) => edge.type === 'blocks' && all.some((other) => other.id === edge.target && other.status !== 'closed'))).map((issue) => issue.id));
  const tally = (status: string): number => all.filter((issue) => issue.status === status).length;
  return {
    total: all.length,
    open: tally('open'),
    in_progress: tally('in_progress'),
    ready_to_review: tally('ready-to-review'),
    approved: tally('approved'),
    rejected: tally('rejected'),
    blocked: blockedIds.size,
    closed: tally('closed'),
    deferred: tally('deferred'),
    ready: all.filter((issue) => issue.status === 'open' && !blockedIds.has(issue.id) && (issue.deferUntil === null || issue.deferUntil <= new Date())).length,
  };
});

export const boardTree = (store: SurfaceStore, options: TreeOptions) => store.transact(async (uow): Promise<IssueTree> => {
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  return buildTree(page.value.items, options);
});

export const dependencyGraph = (store: SurfaceStore) => store.transact(async (uow) => {
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  const all = page.value.items;
  return {
    nodes: all,
    edges: all.flatMap((issue) => issue.dependencies.map((edge) => ({ from: issue.id, to: edge.target, type: edge.type }))),
  };
});

export const duplicatePairs = (store: SurfaceStore, minSimilarity = 0.6) => store.transact(async (uow) => {
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  const open = page.value.items.filter((issue) => issue.status !== 'closed');
  const tokenize = (text: string): Set<string> => new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((token) => token.length > 3));
  const bags = open.map((issue) => ({ issue, tokens: tokenize(`${issue.title} ${issue.description}`) }));
  const pairs: Array<readonly [Issue, Issue, number]> = [];
  for (let a = 0; a < bags.length; a += 1) {
    for (let b = a + 1; b < bags.length; b += 1) {
      const left = bags[a]!.tokens;
      const right = bags[b]!.tokens;
      if (left.size === 0 || right.size === 0) continue;
      const overlap = [...left].filter((token) => right.has(token)).length;
      const score = overlap / Math.min(left.size, right.size);
      if (score >= minSimilarity) pairs.push([bags[a]!.issue, bags[b]!.issue, score]);
    }
  }
  return pairs;
});

export const lintIssues = (store: SurfaceStore, options: { readonly ids?: readonly string[]; readonly type?: string; readonly status?: string } = {}) => store.transact(async (uow) => {
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  const all = page.value.items;
  const ids = options.ids ?? [];
  const status = options.status ?? 'open';
  const scope = ids.length > 0
    ? all.filter((issue) => ids.includes(issue.id))
    : all.filter((issue) => (status === 'all' || issue.status === status) && (options.type === undefined || issue.type === options.type));
  return scope.flatMap((issue) => {
    const required = LINT_SECTIONS[issue.type] ?? [];
    const body = `${issue.description}\n${issue.acceptanceCriteria ?? ''}`;
    const missing = required.filter((section) => !new RegExp(`##\\s*${section}`, 'i').test(body));
    return missing.length === 0 ? [] : [{ issue, missing }];
  });
});

export const currentIssue = (store: SurfaceStore) => store.transact(async (uow) => {
  const raw = await readCurrentId(store.tasksDir);
  if (raw === null) return null;
  return getOrThrowNull(uow, raw);
});

const getOrThrowNull = async (uow: Parameters<Parameters<SurfaceStore['transact']>[0]>[0], raw: string): Promise<Issue | null> => {
  const found = await uow.findById(issueId(raw));
  if (!found.ok) throw new MessageError('read failed');
  return found.value;
};
