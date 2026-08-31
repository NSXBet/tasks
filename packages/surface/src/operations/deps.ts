import type { Issue } from '@tasks/domain';
import { dependencyTarget, issueId } from '@tasks/domain';
import type { SurfaceStore } from '../store.js';
import { getOrThrow } from '../store.js';
import { MessageError } from '../errors.js';

export interface DependencyRow {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly issue_type: string;
  readonly dependency_type: string;
}

const dependencyType = (type: string): string => (type === 'related' ? 'relates-to' : type);

export const depList = (store: SurfaceStore, id: string, direction: 'up' | 'down' = 'down') => store.transact(async (uow): Promise<readonly DependencyRow[]> => {
  const issue = await getOrThrow(uow, id);
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  const all = page.value.items;
  const edge = (other: Issue, type: string): DependencyRow => ({ id: other.id, title: other.title, status: other.status, issue_type: other.type, dependency_type: dependencyType(type) });
  if (direction === 'up') {
    return all.flatMap((other) => [
      ...other.dependencies.filter((candidate) => candidate.target === issue.id).map((candidate) => edge(other, candidate.type)),
      ...(other.parentId === issue.id ? [edge(other, 'parent-child')] : []),
    ]);
  }
  return [
    ...issue.dependencies.flatMap((candidate) => {
      const other = all.find((item) => item.id === candidate.target);
      return other === undefined ? [] : [edge(other, candidate.type)];
    }),
    ...(issue.parentId === null ? [] : (() => { const parent = all.find((item) => item.id === issue.parentId); return parent === undefined ? [] : [edge(parent, 'parent-child')]; })()),
  ];
});

export const depAdd = (store: SurfaceStore, id: string, target: string, type = 'blocks') => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, id);
  await getOrThrow(uow, target);
  const added = await uow.addDependency({ issueId: issue.id, target: dependencyTarget(target), type, createdAt: new Date(), createdBy: store.actor, metadata: {}, wireUnknown: {} });
  if (!added.ok) throw new MessageError('add dependency failed');
  return getOrThrow(uow, id);
});

export const depRemove = (store: SurfaceStore, id: string, target: string, type?: string) => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, id);
  await getOrThrow(uow, target);
  const removed = await uow.removeDependency(issue.id, dependencyTarget(target), type === 'relates-to' ? 'related' : type);
  if (!removed.ok) throw new MessageError('remove dependency failed');
  return getOrThrow(uow, id);
});

/** `link <id1> <id2>`: id2 blocks id1. */
export const link = (store: SurfaceStore, id1: string, id2: string, type = 'blocks') => depAdd(store, id1, id2, type);
