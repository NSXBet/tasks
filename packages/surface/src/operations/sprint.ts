import type { Issue, Sprint } from '@tasks/domain';
import { SprintSchema, sprintId, sprintSlug } from '@tasks/domain';
import type { SurfaceStore } from '../store.js';
import { getOrThrow } from '../store.js';
import { MessageError } from '../errors.js';

const now = (): Date => new Date();
const changed = (issue: Issue, patch: Partial<Issue>): Issue => ({ ...issue, ...patch, updatedAt: now() });

const assertSaved = (outcome: { readonly ok: boolean }, what: string): void => {
  if (!outcome.ok) throw new MessageError(`${what} failed`);
};

/** The active sprint, or null when the workspace has no focus bucket. */
export const activeSprint = async (uow: Parameters<Parameters<SurfaceStore['transact']>[0]>[0]): Promise<Sprint | null> => {
  const sprints = await uow.listSprints();
  if (!sprints.ok) throw new MessageError('sprint list failed');
  return sprints.value.find((sprint) => sprint.status === 'active') ?? null;
};

/** All sprints; the single-active invariant makes "current" derivable from this list. */
export const listSprints = (store: SurfaceStore) => store.transact(async (uow) => {
  const result = await uow.listSprints();
  if (!result.ok) throw new MessageError('sprint list failed');
  return result.value;
});

export interface SprintStartOutcome {
  readonly sprint: Sprint;
  /** Sprints the start completed (the previous focus). */
  readonly closed: readonly Sprint[];
  /** Issues moved by the start: to backlog, or into the new sprint with `carry`. */
  readonly moved: readonly string[];
}

/**
 * Create and activate a sprint. Completing the previous active sprint in the
 * same transaction enforces the single-active invariant; its issues go to the
 * backlog unless `carry` moves them into the new focus.
 */
export const startSprint = (store: SurfaceStore, name: string, options: { readonly carry?: boolean } = {}) => store.transact(async (uow): Promise<SprintStartOutcome> => {
  const trimmed = name.trim();
  if (trimmed === '') throw new MessageError('sprint start requires a name');
  const id = sprintSlug(trimmed);
  const existing = await uow.findSprint(id);
  if (existing.ok && existing.value !== null) throw new MessageError(`sprint already exists: ${id}`);
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  const sprints = await uow.listSprints();
  if (!sprints.ok) throw new MessageError('sprint list failed');
  const closed: Sprint[] = [];
  const moved: string[] = [];
  for (const active of sprints.value.filter((sprint) => sprint.status === 'active')) {
    const completed = SprintSchema.parse({ ...active, status: 'completed', completedAt: now(), updatedAt: now() });
    assertSaved(await uow.saveSprint(completed), `sprint ${active.id} close`);
    closed.push(completed);
    for (const issue of page.value.items.filter((candidate) => candidate.sprintId === active.id)) {
      const next = changed(issue, { sprintId: options.carry === true ? id : null });
      assertSaved(await uow.save(next), `issue ${issue.id} move`);
      moved.push(issue.id);
    }
  }
  const timestamp = now();
  const sprint = SprintSchema.parse({ id, name: trimmed, status: 'active', completedAt: null, createdAt: timestamp, updatedAt: timestamp, wireUnknown: {} });
  assertSaved(await uow.saveSprint(sprint), 'sprint save');
  return { sprint, closed, moved };
});

/** Complete the active sprint; its unfinished issues return to the backlog. */
export const closeSprint = (store: SurfaceStore) => store.transact(async (uow) => {
  const active = await activeSprint(uow);
  if (active === null) throw new MessageError('no active sprint');
  const completed = SprintSchema.parse({ ...active, status: 'completed', completedAt: now(), updatedAt: now() });
  assertSaved(await uow.saveSprint(completed), 'sprint close');
  const page = await uow.list({ limit: 100_000 });
  if (!page.ok) throw new MessageError('list failed');
  const moved: string[] = [];
  for (const issue of page.value.items.filter((candidate) => candidate.sprintId === active.id)) {
    assertSaved(await uow.save(changed(issue, { sprintId: null })), `issue ${issue.id} move`);
    moved.push(issue.id);
  }
  return { sprint: completed, moved };
});

/** Move an issue into the active sprint (no-op when already there). */
export const sprintAdd = (store: SurfaceStore, raw: string) => store.transact(async (uow) => {
  const active = await activeSprint(uow);
  if (active === null) throw new MessageError('no active sprint — start one first');
  const issue = await getOrThrow(uow, raw);
  if (issue.sprintId === active.id) return issue;
  const result = changed(issue, { sprintId: active.id });
  assertSaved(await uow.save(result), 'save');
  return result;
});

/** Move an issue back to the backlog (no-op when not in a sprint). */
export const sprintRemove = (store: SurfaceStore, raw: string) => store.transact(async (uow) => {
  const issue = await getOrThrow(uow, raw);
  if (issue.sprintId === null) return issue;
  const result = changed(issue, { sprintId: null });
  assertSaved(await uow.save(result), 'save');
  return result;
});

/** Move an issue into a named sprint (any status — focus is the user's call). */
export const sprintMove = (store: SurfaceStore, raw: string, target: string) => store.transact(async (uow) => {
  const parsed = sprintId(target);
  const sprint = await uow.findSprint(parsed);
  if (!sprint.ok || sprint.value === null) throw new MessageError(`sprint not found: ${target}`);
  const issue = await getOrThrow(uow, raw);
  if (issue.sprintId === parsed) return issue;
  const result = changed(issue, { sprintId: parsed });
  assertSaved(await uow.save(result), 'save');
  return result;
});
