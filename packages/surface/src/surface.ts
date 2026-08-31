import { openSurfaceStore, type SurfaceOptions, type SurfaceStore } from './store.js';
import { rootFrom } from './discover.js';

export * from './errors.js';
export * from './store.js';
export * from './envelope.js';
export type { CreateInput } from './operations/create.js';
export * from './operations/query.js';
export * from './operations/mutate.js';
export * from './operations/deps.js';
export * from './operations/comments.js';
export * from './operations/views.js';
export * from './watch/protocol.js';

import { createIssue, type CreateInput } from './operations/create.js';
import {
  showIssue, listIssues, readyIssues, blockedIssues, searchIssues, queryIssues,
  staleIssues, orphanIssues, childrenOf, epicView, currentId, type ListOptions,
} from './operations/query.js';
import {
  updateIssue, changeStatus, deferIssue, undeferIssue, claimIssue, assignIssue,
  setPriority, addLabel, removeLabel, appendNote, markDuplicate, markSuperseded,
  closeMany, renameIssue, deleteIssues, type UpdatePatch, type StatusChange,
} from './operations/mutate.js';
import { depList, depAdd, depRemove, link, type DependencyRow } from './operations/deps.js';
import { addComment, commentsOf } from './operations/comments.js';
import {
  allIssues, counts, stats, boardTree, dependencyGraph, duplicatePairs,
  lintIssues, currentIssue,
} from './operations/views.js';
import type { WatchSubscription } from './watch/protocol.js';
import { spawnWatchChild, type WatchHandle } from './watch/core.js';

/**
 * Watch child entry script shipped next to the surface (bundled into the
 * extension's dist; for the CLI it is the surface package's own bin).
 */
const WATCH_SCRIPT = new URL('./watch/child-entry.js', import.meta.url).pathname;

/**
 * The typed Tasks surface: one factory consumed by the tk CLI and the pi/omp
 * extension. Every method returns wire-JSON-safe values and surfaces errors as
 * `SurfaceError` (never throws across the boundary; thrown `MessageError`s
 * inside transactions are classified first).
 */
export interface TasksSurface {
  readonly store: SurfaceStore;

  // create
  create(input: CreateInput): ReturnType<typeof createIssue>;
  // query
  show(id: string): ReturnType<typeof showIssue>;
  list(options?: ListOptions): ReturnType<typeof listIssues>;
  ready(options?: ListOptions & { readonly claim?: boolean }): ReturnType<typeof readyIssues>;
  blocked(): ReturnType<typeof blockedIssues>;
  search(text: string): ReturnType<typeof searchIssues>;
  query(expression: string): ReturnType<typeof queryIssues>;
  stale(days: number): ReturnType<typeof staleIssues>;
  orphans(): ReturnType<typeof orphanIssues>;
  children(id: string): ReturnType<typeof childrenOf>;
  epic(id: string): ReturnType<typeof epicView>;
  current(): ReturnType<typeof currentId>;
  currentId(): ReturnType<typeof currentId>;
  // mutate
  update(id: string, patch: UpdatePatch): ReturnType<typeof updateIssue>;
  status(id: string, change: StatusChange): ReturnType<typeof changeStatus>;
  defer(id: string, until?: string): ReturnType<typeof deferIssue>;
  undefer(id: string): ReturnType<typeof undeferIssue>;
  claim(id: string): ReturnType<typeof claimIssue>;
  assign(id: string, assignee: string): ReturnType<typeof assignIssue>;
  priority(id: string, priority: number): ReturnType<typeof setPriority>;
  labelAdd(id: string, label: string): ReturnType<typeof addLabel>;
  labelRemove(id: string, label: string): ReturnType<typeof removeLabel>;
  note(id: string, body: string): ReturnType<typeof appendNote>;
  duplicate(id: string, canonical: string): ReturnType<typeof markDuplicate>;
  supersede(id: string, replacement: string): ReturnType<typeof markSuperseded>;
  closeMany(ids: readonly string[], reason?: string): ReturnType<typeof closeMany>;
  rename(from: string, to: string): ReturnType<typeof renameIssue>;
  delete(ids: readonly string[]): ReturnType<typeof deleteIssues>;
  // deps
  depList(id: string, direction?: 'up' | 'down'): ReturnType<typeof depList>;
  depAdd(id: string, target: string, type?: string): ReturnType<typeof depAdd>;
  depRemove(id: string, target: string, type?: string): ReturnType<typeof depRemove>;
  link(id1: string, id2: string, type?: string): ReturnType<typeof link>;
  // comments
  comment(id: string, body: string): ReturnType<typeof addComment>;
  comments(id: string): ReturnType<typeof commentsOf>;
  // views
  all(): ReturnType<typeof allIssues>;
  counts(): ReturnType<typeof counts>;
  stats(): ReturnType<typeof stats>;
  tree(options: TreeOptionsShim): ReturnType<typeof boardTree>;
  graph(): ReturnType<typeof dependencyGraph>;
  duplicates(minSimilarity?: number): ReturnType<typeof duplicatePairs>;
  lint(options?: Parameters<typeof lintIssues>[1]): ReturnType<typeof lintIssues>;
  // watch
  watch(subscription: WatchSubscription): WatchHandle;
}

type TreeOptionsShim = Parameters<typeof boardTree>[1];

export const createSurface = async (options: SurfaceOptions = {}): Promise<TasksSurface> => {
  const root = options.root ?? (await rootFrom(process.cwd()));
  if (root === null) throw new Error('no tasks workspace found; run tk init');
  const store = await openSurfaceStore(root, options);
  return {
    store,
    create: (input) => createIssue(store, input),
    show: (id) => showIssue(store, id),
    list: (options) => listIssues(store, options),
    ready: (options) => readyIssues(store, options),
    blocked: () => blockedIssues(store),
    search: (text) => searchIssues(store, text),
    query: (expression) => queryIssues(store, expression),
    stale: (days) => staleIssues(store, days),
    orphans: () => orphanIssues(store),
    children: (id) => childrenOf(store, id),
    epic: (id) => epicView(store, id),
    current: () => currentId(store),
    currentId: () => currentId(store),
    update: (id, patch) => updateIssue(store, id, patch),
    status: (id, change) => changeStatus(store, id, change),
    defer: (id, until) => deferIssue(store, id, until),
    undefer: (id) => undeferIssue(store, id),
    claim: (id) => claimIssue(store, id),
    assign: (id, assignee) => assignIssue(store, id, assignee),
    priority: (id, priority) => setPriority(store, id, priority),
    labelAdd: (id, label) => addLabel(store, id, label),
    labelRemove: (id, label) => removeLabel(store, id, label),
    note: (id, body) => appendNote(store, id, body),
    duplicate: (id, canonical) => markDuplicate(store, id, canonical),
    supersede: (id, replacement) => markSuperseded(store, id, replacement),
    closeMany: (ids, reason) => closeMany(store, ids, reason),
    rename: (from, to) => renameIssue(store, from, to),
    delete: (ids) => deleteIssues(store, ids),
    depList: (id, direction) => depList(store, id, direction),
    depAdd: (id, target, type) => depAdd(store, id, target, type),
    depRemove: (id, target, type) => depRemove(store, id, target, type),
    link: (id1, id2, type) => link(store, id1, id2, type),
    comment: (id, body) => addComment(store, id, body),
    comments: (id) => commentsOf(store, id),
    all: () => allIssues(store),
    counts: () => counts(store),
    stats: () => stats(store),
    tree: (options) => boardTree(store, options),
    graph: () => dependencyGraph(store),
    duplicates: (minSimilarity) => duplicatePairs(store, minSimilarity),
    lint: (options) => lintIssues(store, options),
    watch: (subscription) => spawnWatchChild({ watchScript: WATCH_SCRIPT, root: store.root, subscription, onEvent: () => {} }),
  };
};
