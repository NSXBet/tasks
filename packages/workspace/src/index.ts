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
