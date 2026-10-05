import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { BlobInput, BlobMeta, BlobStore } from '@tasks/application';
import type { WorkspaceConfig } from './config.js';

export type { BlobInput, BlobMeta, BlobStore };

/** Blob ids match the domain's `AttachmentIdSchema` (`ev-` + 6 base36 chars). */
export const newBlobId = (): string => `ev-${randomBytes(4).toString('hex').slice(0, 6)}`;

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
  '.yaml': 'text/yaml', '.yml': 'text/yaml', '.csv': 'text/csv', '.zip': 'application/zip',
};
export const guessMime = (name: string): string => MIME_BY_EXT[extname(name).toLowerCase()] ?? 'application/octet-stream';
export const isImage = (mime: string): boolean => mime.startsWith('image/');

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

/** Filesystem-safe slug of the display name; collisions inside one blob dir cannot happen because ids differ. */
export const slugFor = (name: string): string => {
  const slug = basename(name).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return slug === '' ? 'file' : slug;
};

/* ------------------------------------------------------------------ */
/* fs backend — `.tasks/attachments/<id>-<slug>.<ext>` + `<id>.json`   */
/* ------------------------------------------------------------------ */

const META_SUFFIX = '.json';

export class FsBlobStore implements BlobStore {
  readonly #dir: string;

  constructor(tasksDir: string) { this.#dir = join(tasksDir, 'attachments'); }

  async put(data: Uint8Array, input: BlobInput): Promise<BlobMeta> {
    await mkdir(this.#dir, { recursive: true });
    const name = basename(input.name);
    await writeFile(this.#dataPath(input.id, name), data);
    const meta: BlobMeta = { id: input.id, name, mime: input.mime, size: data.byteLength, sha256: sha256(data) };
    await writeFile(this.#metaPath(input.id), `${JSON.stringify(meta, null, 2)}\n`);
    return meta;
  }

  async read(id: string): Promise<Uint8Array | null> {
    const meta = await this.meta(id);
    if (meta === null) return null;
    return new Uint8Array(await readFile(this.#dataPath(meta.id, meta.name)));
  }

  async meta(id: string): Promise<BlobMeta | null> {
    try { return JSON.parse(await readFile(this.#metaPath(id), 'utf8')) as BlobMeta; }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw cause; }
  }

  async delete(id: string): Promise<void> {
    const meta = await this.meta(id);
    if (meta === null) return;
    await rm(this.#dataPath(meta.id, meta.name), { force: true });
    await rm(this.#metaPath(id), { force: true });
  }

  #dataPath(id: string, name: string): string { return join(this.#dir, `${id}-${slugFor(name)}${extname(name).toLowerCase()}`); }
  #metaPath(id: string): string { return join(this.#dir, `${id}${META_SUFFIX}`); }
}

/* ------------------------------------------------------------------ */
/* git-lfs bookkeeping (fs backend)                                    */
/* ------------------------------------------------------------------ */

const LFS_BEGIN = '# tk attachments:begin';
const LFS_END = '# tk attachments:end';
const LFS_BLOCK = `${LFS_BEGIN}\n.tasks/attachments/** filter=lfs diff=lfs merge=lfs -text\n${LFS_END}\n`;

/**
 * Idempotently marks `.tasks/attachments/**` as LFS-tracked in the repo-root
 * `.gitattributes`. Only the fs backend needs this; s3/postgres blobs never
 * touch git. `lfs: false` in config opts out.
 */
export async function ensureLfsAttributes(rootDir: string): Promise<void> {
  const path = join(rootDir, '.gitattributes');
  let current = '';
  try { current = await readFile(path, 'utf8'); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
  if (current.includes(LFS_BEGIN)) return;
  const block = current === '' ? LFS_BLOCK : `${current}${current.endsWith('\n') ? '' : '\n'}${LFS_BLOCK}`;
  await writeFile(path, block);
}

/* ------------------------------------------------------------------ */
/* factory                                                             */
/* ------------------------------------------------------------------ */

export interface OpenBlobStoreOptions {
  readonly tasksDir: string;
  readonly config: WorkspaceConfig;
}

/**
 * Opens the configured blob backend. fs is local and synchronous-backed.
 * Static imports cannot work here: s3/postgres adapters are optional
 * cloud/database drivers (workspace packages that must not force their SDK
 * on zero-config installs), so specifiers resolve at runtime — the same
 * lazy-adapter pattern storage.ts uses for storage backends.
 */
export async function openBlobStore(options: OpenBlobStoreOptions): Promise<BlobStore> {
  const attachments = options.config.attachments ?? {};
  switch (attachments.store ?? 'fs') {
    case 'fs': return new FsBlobStore(options.tasksDir);
    case 's3': {
      const { S3BlobStore } = await import('@tasks/s3');
      return new S3BlobStore(attachments.s3 ?? {});
    }
    case 'postgres': {
      const { openPostgresBlobStore } = await import('@tasks/postgres/blob');
      return openPostgresBlobStore(attachments.postgres ?? {});
    }
  }
}

/** Ingest one file from disk: bytes → blob backend → meta. */
export const ingestFile = async (store: BlobStore, path: string): Promise<BlobMeta> =>
  store.put(new Uint8Array(await readFile(path)), { id: newBlobId(), name: basename(path), mime: guessMime(path) });
