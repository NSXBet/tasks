import { issueId } from '@tasks/domain';
import type { SurfaceStore } from '../store.js';
import { getOrThrow } from '../store.js';
import { MessageError } from '../errors.js';

export const addComment = (store: SurfaceStore, id: string, body: string) => store.transact(async (uow) => {
  if (body === '') throw new MessageError('comment requires body');
  await getOrThrow(uow, id);
  const added = await uow.addComment(issueId(id), store.actor, body);
  if (!added.ok) throw new MessageError('comment failed');
  return getOrThrow(uow, id);
});

export const commentsOf = (store: SurfaceStore, id: string) => store.transact(async (uow) => getOrThrow(uow, id));
