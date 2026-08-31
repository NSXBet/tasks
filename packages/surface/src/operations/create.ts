import { randomBytes } from 'node:crypto';
import type { DependencyEdge, Issue, Metadata } from '@tasks/domain';
import { dependencyTarget, issueDescription, issueId, issuePriority, issueTitle } from '@tasks/domain';
import type { IssueUnitOfWork } from '@tasks/application';
import type { SurfaceStore } from '../store.js';
import { writeCurrentId } from '../store.js';
import { MessageError } from '../errors.js';

/** bd-style collision-resistant issue IDs: <prefix>-<base36 hash>, short like bd (bd-0t0, bd-45g). */
const generateId = (): string => randomBytes(6).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x');
/** Start at 3 chars (like bd), grow on collision pressure. */
const idLength = (taken: number): number => (taken < 50 ? 3 : taken < 1_000 ? 4 : 6);

export interface CreateInput {
  readonly title: string;
  readonly description?: string;
  readonly status?: string;
  readonly priority?: number;
  readonly type?: string;
  readonly owner?: string | null;
  readonly assignee?: string | null;
  readonly due?: string | null;
  readonly deferUntil?: string | null;
  readonly parent?: string;
  readonly labels?: readonly string[];
  readonly notes?: string | null;
  readonly design?: string | null;
  readonly acceptanceCriteria?: string | null;
  readonly estimate?: number | null;
  readonly specId?: string | null;
  readonly externalRef?: string | null;
  readonly branch?: string | null;
  readonly metadata?: Metadata;
  /** `<type>:<target>` or bare `<target>` (type defaults to `blocks`). */
  readonly deps?: readonly string[];
}

const parseDate = (value: string | undefined | null): Date | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '' || value === 'null') return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new MessageError(`invalid date: ${value}`);
  return date;
};

const splitDep = (entry: string): { readonly type: string; readonly target: string } => {
  const separator = entry.indexOf(':');
  // External targets are `external:<project>:<capability>`; only split the
  // first colon for non-external entries (CLI parity).
  if (separator <= 0 || entry.startsWith('external:')) return { type: 'blocks', target: entry };
  return { type: entry.slice(0, separator), target: entry.slice(separator + 1) };
};

const assertSaved = (outcome: { readonly ok: boolean }, what: string): void => {
  if (!outcome.ok) throw new MessageError(`${what} failed`);
};

const addEdges = async (uow: IssueUnitOfWork, issue: Issue, deps: readonly string[], now: Date, actor: string): Promise<void> => {
  for (const entry of deps) {
    const { type, target } = splitDep(entry);
    const edge: DependencyEdge = {
      issueId: issue.id,
      target: dependencyTarget(target),
      type,
      createdAt: now,
      createdBy: actor,
      metadata: {},
      wireUnknown: {},
    };
    assertSaved(await uow.addDependency(edge), `dependency ${entry}`);
  }
};

export const createIssue = async (store: SurfaceStore, input: CreateInput) => {
  if (input.title === undefined || input.title === '') throw new MessageError('create requires title');
  return store.transact(async (uow) => {
    const page = await uow.list({ limit: 100_000 });
    if (!page.ok) throw new MessageError('could not read existing ids');
    const existing = new Set<string>(page.value.items.map((issue) => issue.id as string));
    const length = idLength(existing.size);
    let candidate = `${store.prefix}-${generateId().slice(0, length)}`;
    let attempts = 0;
    while (existing.has(candidate)) {
      attempts += 1;
      if (attempts > 20) throw new MessageError('could not allocate unique issue id');
      candidate = `${store.prefix}-${generateId().slice(0, length)}`;
    }
    const now = new Date();
    const issue: Issue = {
      id: issueId(candidate),
      title: issueTitle(input.title),
      description: issueDescription(input.description ?? ''),
      status: input.status ?? 'open',
      priority: issuePriority(input.priority ?? 2),
      type: input.type ?? 'task',
      owner: input.owner ?? null,
      assignee: input.assignee ?? null,
      createdBy: store.actor,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      closedAt: null,
      dueAt: parseDate(input.due) ?? null,
      deferUntil: parseDate(input.deferUntil) ?? null,
      parentId: input.parent === undefined ? null : issueId(input.parent),
      labels: [...(input.labels ?? [])],
      notes: input.notes ?? null,
      design: input.design ?? null,
      acceptanceCriteria: input.acceptanceCriteria ?? null,
      estimate: input.estimate ?? null,
      specId: input.specId ?? null,
      externalRef: input.externalRef ?? null,
      branch: input.branch ?? null,
      metadata: input.metadata ?? {},
      wireUnknown: {},
      dependencies: [],
      dependencyCount: 0,
      dependentCount: 0,
      comments: [],
      commentCount: 0,
    };
    assertSaved(await uow.save(issue), 'save');
    await addEdges(uow, issue, input.deps ?? [], now, store.actor);
    const made = await uow.findById(issue.id);
    if (!made.ok || made.value === null) throw new MessageError('reload after create failed');
    await writeCurrentId(store.tasksDir, made.value.id);
    return made.value;
  });
};
