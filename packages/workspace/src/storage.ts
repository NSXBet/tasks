import { join } from 'node:path';
import type { MigrationPort, UnitOfWork } from '@tasks/application';
import type { StorageConfig } from './config.js';

/** What every backend must provide for the CLI (and any future consumer) to treat them uniformly. */
export type StorageAdapter = UnitOfWork & MigrationPort;

export interface StorageHandle {
  readonly backend: StorageConfig['backend'];
  /** Human-readable location: filesystem path for file/sqlite, redacted URL for postgres. */
  readonly location: string;
  readonly adapter: StorageAdapter;
  close(): Promise<void>;
}

export interface OpenStorageOptions {
  readonly readonly?: boolean;
}

const redactUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '***';
  }
};

type PostgresStorageConfig = Extract<StorageConfig, { backend: 'postgres' }>;

const postgresUrlEnvName = (config: PostgresStorageConfig): string => config.urlEnv ?? 'TASKS_DATABASE_URL';

const readPostgresUrl = (config: PostgresStorageConfig): string | undefined =>
  config.url ?? (config.urlEnv === undefined ? undefined : process.env[config.urlEnv]) ?? process.env['TASKS_DATABASE_URL'];

const requirePostgresUrl = (config: PostgresStorageConfig): string => {
  const url = readPostgresUrl(config);
  if (url === undefined || url.length === 0) {
    return fail(`postgres storage requires a connection string: set ${postgresUrlEnvName(config)}, or storage.url in .tasks/config.json`);
  }
  return url;
};

const fail = (message: string): never => { throw new Error(message); };

/**
 * Cheap, connection-free preview of where a backend points. Used by `tk where`
 * so inspecting workspace config never opens a real database connection.
 */
export function describeStorage(tasksDir: string, config: StorageConfig): { readonly backend: StorageConfig['backend']; readonly location: string } {
  if (config.backend === 'file') return { backend: 'file', location: tasksDir };
  if (config.backend === 'sqlite') return { backend: 'sqlite', location: join(tasksDir, config.filename ?? 'tasks.db') };
  const url = readPostgresUrl(config);
  return { backend: 'postgres', location: url === undefined || url.length === 0 ? `<unset: ${postgresUrlEnvName(config)}>` : redactUrl(url) };
}

/**
 * Opens the adapter declared by `.tasks/config.json`. Backend packages load
 * lazily so choosing `file` (the default) never pulls in `pg` or `bun:sqlite`.
 */
export async function openStorage(tasksDir: string, config: StorageConfig, options: OpenStorageOptions = {}): Promise<StorageHandle> {
  if (config.backend === 'file') {
    const { FileAdapter } = await import('@tasks/file');
    const adapter = new FileAdapter({ dir: tasksDir });
    return { backend: 'file', location: tasksDir, adapter, close: async () => {} };
  }
  if (config.backend === 'sqlite') {
    const { SqliteAdapter } = await import('@tasks/sqlite');
    const filename = join(tasksDir, config.filename ?? 'tasks.db');
    const adapter = new SqliteAdapter({ filename, readonly: options.readonly ?? false });
    return { backend: 'sqlite', location: filename, adapter, close: async () => adapter.close() };
  }
  const { PostgresAdapter } = await import('@tasks/postgres');
  const url = requirePostgresUrl(config);
  const adapter = new PostgresAdapter({ connectionString: url });
  return { backend: 'postgres', location: redactUrl(url), adapter, close: async () => adapter.close() };
}

/**
 * In-memory scratch store for planning-only paths (`tk migrate --dry-run` when
 * no workspace exists yet). Never persisted and independent of the workspace's
 * configured backend — it exists only so the beads planner has somewhere to
 * read an (empty) issue set from without touching disk.
 */
export async function openEphemeralScratch(): Promise<StorageHandle> {
  const { SqliteAdapter } = await import('@tasks/sqlite');
  const adapter = new SqliteAdapter({ filename: ':memory:' });
  return { backend: 'sqlite', location: ':memory:', adapter, close: async () => adapter.close() };
}
