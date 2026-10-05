import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import type { BlobInput, BlobMeta, BlobStore } from '@tasks/application';
import { Pool } from 'pg';

/**
 * Blob backend sharing the same PostgreSQL database as the storage adapter.
 * Blobs live in `task_attachment_blobs` (created lazily on first use — the
 * table has no migration because only blob writes need it, and read-only
 * consumers tolerate absence as "not found").
 */
export class PostgresBlobStore implements BlobStore {
  readonly #pool: Pool;
  #tableReady: Promise<void> | undefined;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  /** One-shot DDL; a failed attempt clears the cache so the next call retries. */
  #ensureTable(): Promise<void> {
    this.#tableReady ??= (async () => {
      try {
        await this.#pool.query(
          `CREATE TABLE IF NOT EXISTS task_attachment_blobs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            mime TEXT NOT NULL,
            size INTEGER NOT NULL,
            sha256 TEXT NOT NULL,
            data BYTEA NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )`,
        );
      } catch (cause) {
        this.#tableReady = undefined;
        throw cause;
      }
    })();
    return this.#tableReady;
  }

  async put(data: Uint8Array, input: BlobInput): Promise<BlobMeta> {
    await this.#ensureTable();
    const name = basename(input.name);
    const sha256 = createHash('sha256').update(data).digest('hex');
    const meta: BlobMeta = { id: input.id, name, mime: input.mime, size: data.byteLength, sha256 };
    // Replace-in-place semantics: same id overwrites bytes and meta in one statement.
    await this.#pool.query(
      `INSERT INTO task_attachment_blobs (id, name, mime, size, sha256, data) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, mime = EXCLUDED.mime, size = EXCLUDED.size, sha256 = EXCLUDED.sha256, data = EXCLUDED.data`,
      [meta.id, name, meta.mime, meta.size, meta.sha256, Buffer.from(data)],
    );
    return meta;
  }

  async read(id: string): Promise<Uint8Array | null> {
    await this.#ensureTable();
    const result = await this.#pool.query<{ data: Buffer }>('SELECT data FROM task_attachment_blobs WHERE id = $1', [id]);
    const row = result.rows[0];
    if (row === undefined) return null;
    return new Uint8Array(row.data);
  }

  async meta(id: string): Promise<BlobMeta | null> {
    await this.#ensureTable();
    const result = await this.#pool.query<{ name: string; mime: string; size: number; sha256: string }>(
      'SELECT name, mime, size, sha256 FROM task_attachment_blobs WHERE id = $1',
      [id],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return { id, name: row.name, mime: row.mime, size: row.size, sha256: row.sha256 };
  }

  async delete(id: string): Promise<void> {
    await this.#ensureTable();
    await this.#pool.query('DELETE FROM task_attachment_blobs WHERE id = $1', [id]);
  }
}

/**
 * Builds the blob store from workspace config: `urlEnv` names the env var
 * holding the connection string (DATABASE_URL by default), so credentials
 * never live in `.tasks/config.json`. The pool is owned by the blob store.
 */
export const openPostgresBlobStore = (options: { urlEnv?: string | undefined } = {}): PostgresBlobStore => {
  const urlEnv = options.urlEnv ?? 'DATABASE_URL';
  const connectionString = process.env[urlEnv];
  if (connectionString === undefined || connectionString === '') {
    throw new Error(`attachments.store = postgres requires env ${urlEnv} with a connection string`);
  }
  return new PostgresBlobStore(new Pool({ connectionString }));
};
