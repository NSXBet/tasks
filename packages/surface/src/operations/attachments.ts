import { readFile } from 'node:fs/promises';
import { isAbsolute, basename, resolve } from 'node:path';
import type { Issue, IssueBlobAttachment } from '@tasks/domain';
import { isBlobAttachment } from '@tasks/domain';
import { ensureLfsAttributes, guessMime, newBlobId, openBlobStore, readWorkspaceConfig } from '@tasks/workspace';
import { err, ok, type IssueUnitOfWork, type Result } from '@tasks/application';
import type { SurfaceStore } from '../store.js';
import { getOrThrow } from '../store.js';
import { MessageError } from '../errors.js';

/** Workspace paths the blob ops need; both CLI and SurfaceStore can supply these. */
export interface BlobContext {
  readonly root: string;
  readonly tasksDir: string;
}

/**
 * Blob-backed attachment operations. Bytes go to the configured blob backend
 * (fs default / s3 / postgres); the issue stores only `{kind, id, name, mime,
 * size, sha256}` refs, so they round-trip every storage adapter unchanged.
 *
 * Replace semantics are slug identity: re-attaching a file whose display name
 * matches an existing entry of the same kind reuses its blob id — the file
 * content is replaced in place, no duplicates accumulate.
 */
const attachBlobsCore = async (uow: IssueUnitOfWork, ctx: BlobContext, id: string, paths: readonly string[], kind: IssueBlobAttachment['kind']): Promise<Result<Issue>> => {
  const issue = await getOrThrow(uow, id);
  if (paths.length === 0) return err({ kind: 'validation', message: 'attach requires at least one file' });
  const config = await readWorkspaceConfig(ctx.tasksDir);
  const blobs = await openBlobStore({ tasksDir: ctx.tasksDir, config });
  if ((config.attachments?.store ?? 'fs') === 'fs' && (config.attachments?.lfs ?? true)) {
    await ensureLfsAttributes(ctx.root);
  }
  const byName = new Map<string, IssueBlobAttachment>();
  for (const raw of paths) {
    const path = isAbsolute(raw) ? raw : resolve(ctx.root, raw);
    const name = basename(path);
    const bytes = new Uint8Array(await readFile(path));
    const prior = issue.attachments.find((attachment): attachment is IssueBlobAttachment => isBlobAttachment(attachment) && attachment.kind === kind && attachment.name === name);
    const meta = await blobs.put(bytes, { id: prior?.id ?? newBlobId(), name, mime: guessMime(name) });
    byName.set(name, { kind, id: meta.id, name: meta.name, mime: meta.mime, size: meta.size, sha256: meta.sha256, metadata: {}, wireUnknown: {} });
  }
  const replaced = new Set(byName.keys());
  const keep = issue.attachments.filter(attachment => !(isBlobAttachment(attachment) && attachment.kind === kind && replaced.has(attachment.name)));
  const next: Issue = { ...issue, attachments: [...keep, ...byName.values()], updatedAt: new Date() };
  const saved = await uow.save(next);
  if (!saved.ok) return saved;
  return ok(next);
};

/** Remove a blob entry by blob id or exact display name; deletes the stored bytes too. Path attachments are unaffected. */
const detachBlobCore = async (uow: IssueUnitOfWork, ctx: BlobContext, id: string, ref: string): Promise<Result<Issue>> => {
  const issue = await getOrThrow(uow, id);
  const target = issue.attachments.find((attachment): attachment is IssueBlobAttachment => isBlobAttachment(attachment) && (attachment.id === ref || attachment.name === ref));
  if (target === undefined) return ok(issue);
  const config = await readWorkspaceConfig(ctx.tasksDir);
  const blobs = await openBlobStore({ tasksDir: ctx.tasksDir, config });
  await blobs.delete(target.id);
  const next: Issue = { ...issue, attachments: issue.attachments.filter(attachment => attachment !== target), updatedAt: new Date() };
  const saved = await uow.save(next);
  if (!saved.ok) return saved;
  return ok(next);
};

/** Attach files as evidence entries (`tk attach`). */
export const attachEvidence = (store: SurfaceStore, id: string, paths: readonly string[]) => store.transact(async (uow) => unwrapBlob(await attachBlobsCore(uow, { root: store.root, tasksDir: store.tasksDir }, id, paths, 'evidence')));

/** Attach files as inline-comment images (`tk comment --image`, ingest rewrites). */
export const attachInline = (store: SurfaceStore, id: string, paths: readonly string[]) => store.transact(async (uow) => unwrapBlob(await attachBlobsCore(uow, { root: store.root, tasksDir: store.tasksDir }, id, paths, 'inline')));

/** Remove a blob entry; no-op when absent. */
export const detachBlob = (store: SurfaceStore, id: string, ref: string) => store.transact(async (uow) => unwrapBlob(await detachBlobCore(uow, { root: store.root, tasksDir: store.tasksDir }, id, ref)));

const unwrapBlob = (outcome: Result<Issue>): Issue => {
  if (!outcome.ok) throw new MessageError(outcome.error.kind === 'validation' ? outcome.error.message : 'blob operation failed');
  return outcome.value;
};

/** Uow-level forms for CLI-style callers that already hold a transaction. */
export const attachEvidenceUow = async (uow: IssueUnitOfWork, ctx: BlobContext, id: string, paths: readonly string[]): Promise<Issue> => {
  const outcome = await attachBlobsCore(uow, ctx, id, paths, 'evidence');
  return unwrapBlob(outcome);
};
export const detachBlobUow = async (uow: IssueUnitOfWork, ctx: BlobContext, id: string, ref: string): Promise<Issue> => unwrapBlob(await detachBlobCore(uow, ctx, id, ref));
