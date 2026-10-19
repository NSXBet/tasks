import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { getOrThrow, openSurfaceStore, type SurfaceStore } from '@tasks/surface';
import type { Issue } from '@tasks/domain';
import { issueDescription, issueId, issuePriority, issueTitle } from '@tasks/domain';
import { parseReviewThreadRegistry } from '../src/core/review/commentStore';
import { taskStoreCommentStore } from '../src/app/taskStoreCommentStore';

const dirs: string[] = [];
const freshRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-review-store-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const createStore = async (): Promise<SurfaceStore> => {
  const root = freshRoot();
  return openSurfaceStore(root, { actor: 'tester' });
};

/** Minimal issue creation through the same transact/uow path surface's create uses. */
const newIssue = async (store: SurfaceStore): Promise<string> => {
  const candidate = `${store.prefix}-${randomBytes(4).toString('hex')}`;
  const now = new Date();
  const issue: Issue = {
    id: issueId(candidate),
    title: issueTitle('review target'),
    description: issueDescription(''),
    status: 'open',
    priority: issuePriority(2),
    type: 'task',
    owner: null,
    assignee: null,
    createdBy: store.actor,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    closedAt: null,
    dueAt: null,
    deferUntil: null,
    parentId: null,
    sprintId: null,
    labels: [],
    notes: null,
    design: null,
    acceptanceCriteria: null,
    estimate: null,
    specId: null,
    externalRef: null,
    branch: null,
    metadata: {},
    attachments: [],
    wireUnknown: {},
    dependencies: [],
    dependencyCount: 0,
    dependentCount: 0,
    comments: [],
    commentCount: 0,
  };
  const outcome = await store.transact(async (uow) => {
    const saved = await uow.save(issue);
    if (!saved.ok) throw new Error(`save failed: ${saved.error.kind}`);
    const made = await uow.findById(issue.id);
    if (!made.ok || made.value === null) throw new Error('reload after create failed');
    return made.value;
  });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value.id;
};

describe('taskStoreCommentStore', () => {
  it('persists a line comment to the task store, visible through the same read the CLI uses', async () => {
    const store = await createStore();
    const id = await newIssue(store);
    const reviews = taskStoreCommentStore(store);

    const thread = await reviews.createThread(id, { filePath: 'src/uploader/retry.ts', line: 12, side: 'new', body: 'this retry loop can spin forever', author: 'reviewer' });

    // The CLI's read path: an ordinary issue comment on the issue itself.
    const outcome = await store.transact((uow) => getOrThrow(uow, id));
    if (!outcome.ok) throw new Error(outcome.error.message);
    const issue = outcome.value;
    const stored = issue.comments.find((comment) => comment.text.includes('this retry loop can spin forever'));
    expect(stored).toBeDefined();
    expect(stored?.author).toBe('reviewer');
    expect(stored?.issueId).toBe(issue.id);
    expect(issue.commentCount).toBe(1);
    expect(issue.comments).toHaveLength(1);
    // Thread registry side record carries the placement and the thread id —
    // decoded with the same codec the component uses.
    const registry = parseReviewThreadRegistry(issue.metadata);
    expect(registry.threads[0]).toMatchObject({
      filePath: 'src/uploader/retry.ts',
      line: 12,
      side: 'new',
      rootCommentId: stored?.id,
    });
    expect(stored?.wireUnknown["reviewThread"]).toBe(thread.id);

    // And the component's own read joins the same stored records.
    const listed = await reviews.listThreads(id);
    expect(listed.threads).toHaveLength(1);
    expect(listed.threads[0]).toMatchObject({ filePath: 'src/uploader/retry.ts', line: 12, side: 'new', resolved: false });
    expect(listed.threads[0]?.comments[0]).toMatchObject({ body: '[review src/uploader/retry.ts:12] this retry loop can spin forever', author: 'reviewer' });
    expect(listed.allResolved).toBe(false);
  });

  it('threads replies and edits onto the root comment', async () => {
    const store = await createStore();
    const id = await newIssue(store);
    const reviews = taskStoreCommentStore(store);

    const thread = await reviews.createThread(id, { filePath: 'a.ts', body: 'root note' });
    const replied = await reviews.appendReply(id, thread.id, { body: 'a reply', author: 'second' });
    expect(replied.comments).toHaveLength(2);
    expect(replied.comments[1]).toMatchObject({ body: '[review reply] a reply', author: 'second' });

    const rootId = thread.comments[0]?.id;
    expect(rootId).toEqual(expect.any(String));
    if (rootId === undefined) return;
    const edited = await reviews.editThreadComment(id, thread.id, rootId, 'root note (fixed)');
    expect(edited.comments[0]).toMatchObject({ body: '[review a.ts] root note (fixed)' });
    expect(edited.comments[0]?.editedAt).toEqual(expect.any(String));
    expect(edited.comments[1]?.editedAt).toBeUndefined();

    // Edits rewrite the stored comment, not just the view.
    const outcome = await store.transact((uow) => getOrThrow(uow, id));
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.value.comments.map((comment) => comment.text)).toContain('[review a.ts] root note (fixed)');
    expect(outcome.value.comments).toHaveLength(2);
  });

  it('tracks resolve state and derives the all-resolved flag', async () => {
    const store = await createStore();
    const id = await newIssue(store);
    const reviews = taskStoreCommentStore(store);

    const first = await reviews.createThread(id, { filePath: 'a.ts', body: 'one' });
    const second = await reviews.createThread(id, { filePath: 'b.ts', line: 3, body: 'two' });

    await reviews.setThreadResolved(id, first.id, { resolved: true, actor: 'yuri' });
    const half = await reviews.listThreads(id);
    expect(half.threads.find((thread) => thread.id === first.id)?.resolved).toBe(true);
    expect(half.threads.find((thread) => thread.id === second.id)?.resolved).toBe(false);
    expect(half.allResolved).toBe(false);

    await reviews.setThreadResolved(id, second.id, { resolved: true });
    const all = await reviews.listThreads(id);
    expect(all.threads.every((thread) => thread.resolved)).toBe(true);
    expect(all.allResolved).toBe(true);
    expect(all.threads.find((thread) => thread.id === first.id)?.resolvedBy).toBe('yuri');

    // Unresolving clears the resolve state.
    await reviews.setThreadResolved(id, first.id, { resolved: false });
    const reopened = await reviews.listThreads(id);
    expect(reopened.allResolved).toBe(false);
    expect(reopened.threads.find((thread) => thread.id === first.id)).toMatchObject({ resolved: false });
  });
});
