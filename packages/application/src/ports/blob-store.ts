/**
 * Blob storage port for evidence/inline attachments. Issue records only ever
 * carry `{id, name, mime, size, sha256}` refs — the bytes live in a backend
 * (filesystem, S3-compatible, postgres). Refs are backend-agnostic, so an
 * issue round-trips through any storage adapter regardless of where its blobs
 * sit. Backends implement this structurally; they never generate ids — the
 * caller supplies one so replace-in-place stays a caller decision.
 */

/** Caller-provided descriptor for one blob write. `id` is always explicit. */
export interface BlobInput {
  /** Stable attachment id (`ev-` + 6 base36 chars); an existing id replaces in place. */
  readonly id: string;
  /** Original file name, used for display and the backend key/file layout. */
  readonly name: string;
  /** MIME type sniffed by the caller; stored verbatim for renderers. */
  readonly mime: string;
}

import type { BlobMeta } from '@tasks/domain';
export type { BlobMeta };

export interface BlobStore {
  /** Writes bytes; an existing id replaces bytes and meta atomically. */
  put(data: Uint8Array, input: BlobInput): Promise<BlobMeta>;
  /** Returns the stored bytes or null when the id is unknown. */
  read(id: string): Promise<Uint8Array | null>;
  /** Returns the reference meta or null when the id is unknown. */
  meta(id: string): Promise<BlobMeta | null>;
  /** Deletes bytes and meta; no-op when unknown. */
  delete(id: string): Promise<void>;
}
