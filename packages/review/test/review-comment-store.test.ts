import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { getOrThrow, openSurfaceStore, type SurfaceStore } from '@tasks/surface';
import type { Issue } from '@tasks/domain';
import { issueDescription, issueId, issuePriority, issueTitle } from '@tasks/domain';
import { reviewCommentLog } from '@tasks/surface';
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

  describe('comment lifecycle (one store, location as data, batched send)', () => {
    const logOf = async (store: SurfaceStore, id: string) => {
      const outcome = await store.transact((uow) => getOrThrow(uow, id));
      if (!outcome.ok) throw new Error(outcome.error.message);
      return reviewCommentLog(outcome.value.metadata);
    };

    it('stores file, line-range, and evidence locations in the same store', async () => {
      const store = await createStore();
      const id = await newIssue(store);
      const reviews = taskStoreCommentStore(store);
      await reviews.createThread(id, { filePath: 'src/a.ts', line: 3, endLine: 6, body: 'range' });
      const evidence = await reviews.createThread(id, { filePath: 'evidence:shot1', evidenceId: 'shot1', body: 'wrong colour', author: 'rev' });
      expect(evidence.evidenceId).toBe('shot1');
      expect(evidence.status).toBe('open');
      const list = await reviews.listThreads(id);
      expect(list.threads).toHaveLength(2);
      expect(list.threads[0]).toMatchObject({ filePath: 'src/a.ts', line: 3, endLine: 6 });
      expect(list.counts.label).toBe('2 open · 0 ✓');
    });

    it('sends open comments as one batch of cards and never re-sends', async () => {
      const store = await createStore();
      const id = await newIssue(store);
      const reviews = taskStoreCommentStore(store);
      await reviews.createThread(id, { filePath: 'src/a.ts', line: 3, body: 'first', author: 'rev' });
      const dismissed = await reviews.createThread(id, { filePath: 'src/b.ts', line: 1, body: 'skip me', author: 'rev' });
      await reviews.createThread(id, { filePath: 'evidence:e1', evidenceId: 'e1', body: 'third', author: 'rev' });
      await reviews.setThreadStatus(id, dismissed.id, 'dismissed');

      const batch = await reviews.sendOpen(id);
      expect(batch.sent.map((card) => [card.location, card.author, card.body])).toEqual([
        ['src/a.ts:3', 'rev', 'first'],
        ['evidence:e1', 'rev', 'third'],
      ]);
      const after = await reviews.listThreads(id);
      expect(after.threads.filter((thread) => thread.status === 'sent')).toHaveLength(2);
      expect(after.counts).toMatchObject({ open: 0, sent: 2, dismissed: 1, unresolved: 2 });
      expect((await reviews.sendOpen(id)).sent).toEqual([]);
      // One summary comment for the whole batch, not one per comment.
      const outcome = await store.transact((uow) => getOrThrow(uow, id));
      if (!outcome.ok) throw new Error(outcome.error.message);
      expect(outcome.value.comments.filter((comment) => comment.text.startsWith('[review sent]'))).toHaveLength(1);
    });

    it('surfaces counts and All resolved; dismissed settles a comment', async () => {
      const store = await createStore();
      const id = await newIssue(store);
      const reviews = taskStoreCommentStore(store);
      const one = await reviews.createThread(id, { filePath: 'a.ts', line: 1, body: 'one' });
      const two = await reviews.createThread(id, { filePath: 'a.ts', line: 2, body: 'two' });
      await reviews.setThreadResolved(id, one.id, { resolved: true });
      let list = await reviews.listThreads(id);
      expect(list.counts.label).toBe('1 open · 1 ✓');
      expect(list.allResolved).toBe(false);
      await reviews.setThreadStatus(id, two.id, 'dismissed');
      list = await reviews.listThreads(id);
      expect(list.allResolved).toBe(true);
      await reviews.setThreadStatus(id, two.id, 'open');
      expect((await reviews.listThreads(id)).allResolved).toBe(false);
      await expect(reviews.setThreadStatus(id, two.id, 'sent')).rejects.toThrow(/sendOpen/);
    });

    it('logs every transition in order for task.comment events', async () => {
      const store = await createStore();
      const id = await newIssue(store);
      const reviews = taskStoreCommentStore(store);
      const thread = await reviews.createThread(id, { filePath: 'a.ts', line: 9, body: 'x' });
      await reviews.sendOpen(id);
      await reviews.setThreadStatus(id, thread.id, 'resolved');
      await reviews.setThreadStatus(id, thread.id, 'resolved'); // no-op: no entry
      await reviews.setThreadStatus(id, thread.id, 'open');
      const log = await logOf(store, id);
      expect(log.map((entry) => [entry.n, entry.from, entry.to])).toEqual([
        [1, null, 'open'], [2, 'open', 'sent'], [3, 'sent', 'resolved'], [4, 'resolved', 'open'],
      ]);
      expect(log[0]).toMatchObject({ file: 'a.ts', line: 9 });
    });
  });
});

describe('legacy hunk comment import (first read)', () => {
  /** Seed the shape the removed Hunk sync wrote: `metadata.hunkComments` + `hunk-<id>` comments. */
  const seedLegacy = async (store: SurfaceStore): Promise<string> => {
    const id = await newIssue(store);
    const outcome = await store.transact(async (uow) => {
      const issue = await getOrThrow(uow, id);
      const now = new Date();
      const comment = (cid: string, text: string) => ({ id: cid, issueId: issue.id, author: 'hunk', text, createdAt: now, wireUnknown: {} });
      const comments = [comment('hunk-c1', '[hunk src/a.ts:12] fix this'), comment('hunk-c2', '[hunk src/b.ts:? (old)] gone')];
      const saved = await uow.save({ ...issue, metadata: { hunkComments: ['c1', 'c2'] } as Issue['metadata'], comments, commentCount: comments.length });
      if (!saved.ok) throw new Error(`save failed: ${saved.error.kind}`);
    });
    if (!outcome.ok) throw new Error(outcome.error.message);
    return id;
  };

  const persisted = async (store: SurfaceStore, id: string): Promise<Issue> => {
    const outcome = await store.transact((uow) => getOrThrow(uow, id));
    if (!outcome.ok) throw new Error(outcome.error.message);
    return outcome.value;
  };

  it('listThreads shows legacy comments as threads and persists the import', async () => {
    const store = await createStore();
    const id = await seedLegacy(store);
    const reviews = taskStoreCommentStore(store);

    const list = await reviews.listThreads(id);
    expect(list.threads).toHaveLength(2);
    expect(list.threads[0]).toMatchObject({ id: 'hunk-c1', filePath: 'src/a.ts', line: 12, side: 'new', status: 'open' });
    expect(list.threads[0]?.comments[0]).toMatchObject({ body: '[hunk src/a.ts:12] fix this', author: 'hunk' });
    expect(list.threads[1]).toMatchObject({ id: 'hunk-c2', filePath: 'src/b.ts', side: 'old' });
    expect(list.threads[1]?.line).toBeUndefined();

    const issue = await persisted(store, id);
    expect(issue.metadata['hunkComments']).toBeUndefined();
    expect(parseReviewThreadRegistry(issue.metadata).threads.map((thread) => thread.id)).toEqual(['hunk-c1', 'hunk-c2']);
    expect(reviewCommentLog(issue.metadata)).toEqual([]);
    expect(issue.comments).toHaveLength(2);
  });

  it('createThread keeps imported threads and adds the new one without duplicating roots', async () => {
    const store = await createStore();
    const id = await seedLegacy(store);
    const reviews = taskStoreCommentStore(store);

    const created = await reviews.createThread(id, { filePath: 'src/c.ts', line: 1, body: 'new one' });
    const list = await reviews.listThreads(id);
    expect(list.threads.map((thread) => thread.id)).toEqual(['hunk-c1', 'hunk-c2', created.id]);
    const issue = await persisted(store, id);
    expect(issue.comments.filter((comment) => comment.id === 'hunk-c1')).toHaveLength(1);
    expect(issue.comments).toHaveLength(3);
  });

  it('setThreadStatus resolves an imported thread on a never-read legacy task', async () => {
    const store = await createStore();
    const id = await seedLegacy(store);
    const reviews = taskStoreCommentStore(store);

    const resolved = await reviews.setThreadStatus(id, 'hunk-c1', 'resolved');
    expect(resolved).toMatchObject({ id: 'hunk-c1', status: 'resolved', resolved: true });
    const list = await reviews.listThreads(id);
    expect(list.counts.resolved).toBe(1);
    expect(list.counts.open).toBe(1);
  });
});
