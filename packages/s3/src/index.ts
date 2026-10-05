import { basename, extname } from 'node:path';
import type { BlobInput, BlobMeta, BlobStore } from '@tasks/application';
import { BlobMetaSchema } from '@tasks/domain';

/** One `aws configure get <key> --profile <p>` lookup; undefined when unset or the CLI is absent. */
const awsConfigureGet = (profile: string, key: string): string | undefined => {
  const spawned = Bun.spawnSync(['aws', 'configure', 'get', key, '--profile', profile], { stdout: 'pipe', stderr: 'pipe' });
  if (spawned.exitCode !== 0) return undefined;
  const value = spawned.stdout.toString().trim();
  return value === '' ? undefined : value;
};

/**
 * S3-compatible blob backend (AWS S3, Cloudflare R2, MinIO) on Bun's native
 * S3Client. Credentials resolve from explicit options or the standard
 * S3_ACCESS_KEY_ID/AWS_* env fallbacks (see bun-types S3Options). Each blob
 * stores two objects under the prefix: the bytes at `<id>-<slug>.<ext>` and a
 * JSON sidecar at `<id>.json` (name/mime/sha256/size), so meta survives
 * without HEAD-only ETag metadata.
 */
export class S3BlobStore implements BlobStore {
  readonly #client: Bun.S3Client;
  readonly #prefix: string;

  constructor(options: S3BlobStoreOptions = {}) {
    // AWS profile support: named-profile credentials/region come from the
    // shared AWS config when explicit values are absent (env fallbacks then
    // apply last inside Bun.S3Client).
    const profileValues = options.profile === undefined ? {} : {
      region: awsConfigureGet(options.profile, 'region'),
      accessKeyId: awsConfigureGet(options.profile, 'aws_access_key_id'),
      secretAccessKey: awsConfigureGet(options.profile, 'aws_secret_access_key'),
      sessionToken: awsConfigureGet(options.profile, 'aws_session_token'),
    };
    const resolved = {
      accessKeyId: options.accessKeyId ?? profileValues.accessKeyId,
      secretAccessKey: options.secretAccessKey ?? profileValues.secretAccessKey,
      region: options.region ?? profileValues.region,
      endpoint: options.endpoint,
      sessionToken: options.sessionToken ?? profileValues.sessionToken,
    };
    if (options.bucket === undefined) throw new Error('attachments.store = s3 requires attachments.s3.bucket');
    this.#client = new Bun.S3Client({
      ...(resolved.accessKeyId === undefined ? {} : { accessKeyId: resolved.accessKeyId }),
      ...(resolved.secretAccessKey === undefined ? {} : { secretAccessKey: resolved.secretAccessKey }),
      ...(resolved.region === undefined ? {} : { region: resolved.region }),
      bucket: options.bucket,
      ...(resolved.endpoint === undefined ? {} : { endpoint: resolved.endpoint }),
      ...(resolved.sessionToken === undefined ? {} : { sessionToken: resolved.sessionToken }),
    });
    this.#prefix = options.prefix ?? 'tk-attachments';
  }

  async put(data: Uint8Array, input: BlobInput): Promise<BlobMeta> {
    const name = basename(input.name);
    const meta: BlobMeta = { id: input.id, name, mime: input.mime, size: data.byteLength, sha256: Bun.SHA256.hash(data, 'hex') };
    await Promise.all([
      this.#client.file(this.#dataKey(meta), { type: input.mime }).write(data),
      this.#client.file(this.#metaKey(meta.id), { type: 'application/json' }).write(JSON.stringify(meta, null, 2)),
    ]);
    return meta;
  }

  async read(id: string): Promise<Uint8Array | null> {
    const meta = await this.meta(id);
    if (meta === null) return null;
    return new Uint8Array(await this.#client.file(this.#dataKey(meta)).arrayBuffer());
  }

  async meta(id: string): Promise<BlobMeta | null> {
    if (!(await this.#client.exists(this.#metaKey(id)))) return null;
    return BlobMetaSchema.parse(JSON.parse(await this.#client.file(this.#metaKey(id)).text()));
  }

  async delete(id: string): Promise<void> {
    const meta = await this.meta(id);
    await this.#client.delete(this.#metaKey(id));
    if (meta !== null) await this.#client.delete(this.#dataKey(meta));
  }

  #metaKey(id: string): string { return `${this.#prefix}/${id}.json`; }
  #dataKey(meta: BlobMeta): string { return `${this.#prefix}/${meta.id}${extname(meta.name).toLowerCase()}`; }
}

export interface S3BlobStoreOptions {
  readonly accessKeyId?: string | undefined;
  readonly secretAccessKey?: string | undefined;
  readonly region?: string | undefined;
  readonly bucket?: string | undefined;
  /** Any S3-compatible endpoint, e.g. `https://<account-id>.r2.cloudflarestorage.com`. */
  readonly endpoint?: string | undefined;
  readonly sessionToken?: string | undefined;
  /** Shared-credentials profile; consulted when explicit keys are absent. */
  readonly profile?: string | undefined;
  /** Object prefix; defaults to `tk-attachments`. */
  readonly prefix?: string | undefined;
}
