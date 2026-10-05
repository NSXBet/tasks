export {
  DEFAULT_STORAGE,
  StorageConfigSchema,
  WorkspaceConfigSchema,
  configPath,
  readWorkspaceConfig,
  resolveStorageConfig,
  writeWorkspaceConfig,
} from './config.js';
export type { StorageConfig, WorkspaceConfig } from './config.js';

export { describeStorage, openEphemeralScratch, openStorage } from './storage.js';
export type { OpenStorageOptions, StorageAdapter, StorageHandle } from './storage.js';

export {
  ensureLfsAttributes,
  FsBlobStore,
  guessMime,
  ingestFile,
  isImage,
  newBlobId,
  openBlobStore,
  slugFor,
} from './attachments.js';
export type { BlobInput, BlobMeta, BlobStore, OpenBlobStoreOptions } from './attachments.js';
export { AttachmentsConfigSchema } from './config.js';
export type { AttachmentsConfig } from './config.js';
