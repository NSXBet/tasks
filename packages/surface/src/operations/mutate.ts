import type { Issue } from '@tasks/domain';
import { issuePriority, issueTitle, issueDescription, issueId, dependencyTarget } from '@tasks/domain';
import type { SurfaceStore } from '../store.js';
import { getOrThrow, readCurrentId, writeCurrentId } from '../store.js';
import { MessageError } from '../errors.js';

const now = (): Date => new Date();
const changed = (issue: Issue, patch: Partial<Issue>): Issue => ({ ...issue, ...patch, updatedAt: now() });

export interface UpdatePatch {
  readonly title?: string;
  readonly description?: string;
  readonly priority?: number;
  readonly type?: string;
  readonly assignee?: string | null;
  readonly owner?: string | null;
  readonly acceptanceCriteria?: string | null;
  readonly design?: string | null;
  readonly specId?: string | null;
  readonly estimate?: number | null;
  readonly externalRef?: string | null;
  readonly branch?: string | null;
  readonly parent?: string | null;
  readonly notes?: string | null;
  readonly dueAt?: string | null;
  readonly status?: string;
}

const nullableString = (value: string | null | undefined): string | null | undefined => value === '' ? null : value;

const parseDate = (value: string | undefined | null): Date | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '' || value === 'null') return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new MessageError(`invalid date: ${value}`);
  return date;
};

export const updateIssue = (store: SurfaceStore, id: string, patch: UpdatePatch) => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, id);
  const next: Partial<Issue> = {};
  if (patch.title !== undefined) next.title = issueTitle(patch.title);
  if (patch.description !== undefined) next.description = issueDescription(patch.description);
  if (patch.priority !== undefined) next.priority = issuePriority(patch.priority);
  if (patch.type !== undefined) next.type = patch.type;
  if (patch.assignee !== undefined) next.assignee = nullableString(patch.assignee ?? undefined) ?? patch.assignee;
  if (patch.owner !== undefined) next.owner = nullableString(patch.owner ?? undefined) ?? patch.owner;
  if (patch.acceptanceCriteria !== undefined) next.acceptanceCriteria = nullableString(patch.acceptanceCriteria) ?? null;
  if (patch.design !== undefined) next.design = nullableString(patch.design) ?? null;
  if (patch.specId !== undefined) next.specId = nullableString(patch.specId) ?? null;
  if (patch.estimate !== undefined) next.estimate = patch.estimate;
  if (patch.externalRef !== undefined) next.externalRef = nullableString(patch.externalRef) ?? null;
  if (patch.branch !== undefined) next.branch = nullableString(patch.branch) ?? null;
  if (patch.parent !== undefined) next.parentId = patch.parent === null || patch.parent === '' ? null : issueId(patch.parent);
  if (patch.notes !== undefined) next.notes = patch.notes;
  const due = parseDate(patch.dueAt);
  if (due !== undefined) next.dueAt = due;
  if (patch.status !== undefined) next.status = patch.status;
  const result = changed(issue, next);
  const saved = await uow.save(result);
  if (!saved.ok) throw new MessageError('save failed');
  return result;
});

export interface StatusChange {
  readonly status: string;
  readonly reason?: string;
}

/** close/reopen/set-state: sets status plus startedAt/closedAt side effects. */
export const changeStatus = (store: SurfaceStore, id: string, change: StatusChange) => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, id);
  const status = change.status;
  let next = changed(issue, {
    status,
    closedAt: status === 'closed' ? now() : null,
    startedAt: status === 'in_progress' ? issue.startedAt ?? now() : issue.startedAt,
  });
  if (change.reason !== undefined && change.reason !== '') {
    next = { ...next, notes: [issue.notes, change.reason].filter(Boolean).join('\n') };
  }
  const saved = await uow.save(next);
  if (!saved.ok) throw new MessageError('save failed');
  if (status === 'closed' || status === 'open') await writeCurrentId(store.tasksDir, next.id);
  return next;
});

export const deferIssue = (store: SurfaceStore, id: string, until?: string) => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, id);
  const target = until === undefined || until === ''
    ? new Date(Date.now() + 86_400_000)
    : (parseDate(until) ?? new Date(Date.now() + 86_400_000));
  const result = changed(issue, { deferUntil: target, status: 'deferred' });
  const saved = await uow.save(result);
  if (!saved.ok) throw new MessageError('save failed');
  return result;
});

export const undeferIssue = (store: SurfaceStore, id: string) => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, id);
  const result = changed(issue, { deferUntil: null, status: 'open' });
  const saved = await uow.save(result);
  if (!saved.ok) throw new MessageError('save failed');
  return result;
});

export const claimIssue = (store: SurfaceStore, id: string) => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, id);
  const claimed = await uow.claimReady(issue.id, store.actor);
  if (!claimed.ok) throw new MessageError('claim failed: issue not ready or taken');
  await writeCurrentId(store.tasksDir, claimed.value.id);
  return claimed.value;
});

export const assignIssue = (store: SurfaceStore, id: string, assignee: string) => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, id);
  const result = changed(issue, { assignee });
  const saved = await uow.save(result);
  if (!saved.ok) throw new MessageError('save failed');
  return result;
});

export const setPriority = (store: SurfaceStore, id: string, priority: number) => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, id);
  const result = changed(issue, { priority: issuePriority(priority) });
  const saved = await uow.save(result);
  if (!saved.ok) throw new MessageError('save failed');
  return result;
});

export const addLabel = (store: SurfaceStore, id: string, label: string) => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, id);
  const result = changed(issue, { labels: [...new Set([...issue.labels, label])] });
  const saved = await uow.save(result);
  if (!saved.ok) throw new MessageError('save failed');
  return result;
});

export const removeLabel = (store: SurfaceStore, id: string, label: string) => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, id);
  const result = changed(issue, { labels: issue.labels.filter((value) => value !== label) });
  const saved = await uow.save(result);
  if (!saved.ok) throw new MessageError('save failed');
  return result;
});

export const appendNote = (store: SurfaceStore, id: string, body: string) => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, id);
  const result = changed(issue, { notes: [issue.notes, body].filter(Boolean).join('\n') });
  const saved = await uow.save(result);
  if (!saved.ok) throw new MessageError('save failed');
  return result;
});

export const markDuplicate = (store: SurfaceStore, id: string, canonical: string) => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, id);
  await getOrThrow(uow, canonical);
  const result = changed(issue, { status: 'closed', closedAt: now(), notes: [issue.notes, `Duplicate of ${canonical}`].filter(Boolean).join('\n') });
  const saved = await uow.save(result);
  if (!saved.ok) throw new MessageError('save failed');
  return result;
});

export const markSuperseded = (store: SurfaceStore, id: string, replacement: string) => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, id);
  await getOrThrow(uow, replacement);
  const result = changed(issue, { status: 'closed', closedAt: now(), notes: [issue.notes, `Superseded by ${replacement}`].filter(Boolean).join('\n') });
  const saved = await uow.save(result);
  if (!saved.ok) throw new MessageError('save failed');
  return result;
});

/** `todo done`: close task-type issues with a reason note. */
export const closeMany = (store: SurfaceStore, ids: readonly string[], reason = 'Completed') => store.transact(async (uow) => {
  const results: Issue[] = [];
  for (const raw of ids) {
    const issue = await getOrThrow(uow, raw);
    const result = changed(issue, { status: 'closed', closedAt: now(), notes: [issue.notes, reason].filter(Boolean).join('\n') });
    const saved = await uow.save(result);
    if (!saved.ok) throw new MessageError(`save failed for ${raw}`);
    results.push(result);
  }
  return results;
});

/** `rename`: retarget parents and dependencies referencing the old id. */
export const renameIssue = (store: SurfaceStore, from: string, to: string) => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, from);
  const existing = await uow.findById(issueId(to));
  if (existing.ok && existing.value !== null) throw new MessageError(`issue already exists: ${to}`);
  const saved = await uow.save({ ...issue, id: issueId(to), dependencies: issue.dependencies.map((edge) => ({ ...edge, issueId: issueId(to) })), updatedAt: now() });
  if (!saved.ok) throw new MessageError('save failed');
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  for (const other of page.value.items) {
    if (other.id === issue.id) continue;
    let touched = false;
    let next = other;
    if (other.parentId === issue.id) { next = { ...next, parentId: issueId(to) }; touched = true; }
    for (const edge of other.dependencies.filter((candidate) => candidate.target === issue.id)) {
      const removed = await uow.removeDependency(other.id, dependencyTarget(from), edge.type);
      if (!removed.ok) throw new MessageError('dependency retarget failed');
      const added = await uow.addDependency({ ...edge, target: dependencyTarget(to), issueId: other.id });
      if (!added.ok) throw new MessageError('dependency retarget failed');
    }
    if (touched) {
      const savedOther = await uow.save({ ...next, updatedAt: now() });
      if (!savedOther.ok) throw new MessageError('save failed');
    }
  }
  const deleted = await uow.delete(issue.id);
  if (!deleted.ok) throw new MessageError('delete failed');
  const current = await readCurrentId(store.tasksDir);
  if (current === issue.id) await writeCurrentId(store.tasksDir, issueId(to));
  return { from: issue.id, to: issueId(to) };
});

/** `delete`: remove issues and their references. */
export const deleteIssues = (store: SurfaceStore, ids: readonly string[]) => store.transact(async (uow) => {
  if (ids.length === 0) throw new MessageError('delete requires at least one id');
  for (const raw of ids) await getOrThrow(uow, raw);
  for (const raw of ids) {
    const deleted = await uow.delete(issueId(raw));
    if (!deleted.ok) throw new MessageError(`delete failed for ${raw}`);
  }
  return ids;
});
