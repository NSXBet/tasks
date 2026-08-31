import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Issue, IssueId } from '@tasks/domain';
import { issueId } from '@tasks/domain';
import { err, ok, type IssueUnitOfWork, type Result } from '@tasks/application';
import { openStorage, type OpenStorageOptions, type StorageAdapter, type StorageConfig } from '@tasks/workspace';
import { readWorkspaceConfig, resolveStorageConfig } from '@tasks/workspace';
import { classifyMessage, MessageError, type SurfaceError } from './errors.js';

export type SurfaceBackend = StorageConfig['backend'];

export interface SurfaceOptions {
  /** Workspace root; defaults to discovery from cwd (upward walk for `.tasks/`). */
  readonly root?: string;
  /** Actor identity for audits; defaults to env USER. */
  readonly actor?: string;
  readonly readonly?: boolean;
}

export interface SurfaceStore {
  readonly root: string;
  readonly tasksDir: string;
  /** Issue-id prefix from workspace config (default `tk`). */
  readonly prefix: string;
  readonly actor: string;
  readonly backend: SurfaceBackend;
  /** File path for file/sqlite backends; null for postgres (CLI parity). */
  readonly databasePath: string | null;
  readonly readonly: boolean;
  readonly adapter: StorageAdapter;
  /** One transaction around surface work; MessageError inside maps to classified SurfaceError. */
  transact<T>(work: (uow: IssueUnitOfWork) => Promise<T>): Promise<Result<T, SurfaceError>>;
  close(): Promise<void>;
}

class SurfaceStoreImpl implements SurfaceStore {
  constructor(
    readonly root: string,
    readonly tasksDir: string,
    readonly prefix: string,
    readonly actor: string,
    readonly readonly: boolean,
    private readonly handle: { backend: SurfaceBackend; location: string; adapter: StorageAdapter; close(): Promise<void> },
  ) {}

  get backend(): SurfaceBackend { return this.handle.backend; }
  get databasePath(): string | null { return this.handle.backend === 'postgres' ? null : this.handle.location; }
  get adapter(): StorageAdapter { return this.handle.adapter; }

  async transact<T>(work: (uow: IssueUnitOfWork) => Promise<T>): Promise<Result<T, SurfaceError>> {
    const outcome = await this.handle.adapter.withinTransaction(async (uow): Promise<Result<unknown>> => {
      try {
        return ok(await work(uow));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return err({ kind: 'repository' as const, operation: 'surface', cause: message });
      }
    });
    if (outcome.ok) return ok(outcome.value as T);
    const failure = outcome.error;
    if (failure.kind === 'repository' && typeof failure.cause === 'string') {
      return err({ kind: classifyMessage(failure.cause), message: failure.cause });
    }
    return err({ kind: 'runtime', message: failure.kind === 'validation' || failure.kind === 'conflict' || failure.kind === 'lifecycle' ? failure.message : 'storage error' });
  }

  close(): Promise<void> { return this.handle.close(); }
}

/**
 * Opens the storage adapter for a tasks workspace. Workspace discovery from
 * arbitrary roots lives in `discover.ts`; callers with an explicit root skip it.
 */
export const openSurfaceStore = async (root: string, options: SurfaceOptions = {}): Promise<SurfaceStore> => {
  const tasksDir = join(root, '.tasks');
  const config = await readWorkspaceConfig(tasksDir);
  const resolved = await resolveStorageConfig(tasksDir, config);
  const openOptions: OpenStorageOptions = { readonly: options.readonly ?? false };
  const handle = await openStorage(tasksDir, resolved, openOptions);
  const actor = options.actor ?? process.env['USER'] ?? 'unknown';
  return new SurfaceStoreImpl(root, tasksDir, config.prefix ?? 'tk', actor, options.readonly ?? false, handle);
};

/** `.tasks/current` file — the CLI's selected-issue pointer, shared with the surface. */
export const readCurrentId = async (tasksDir: string): Promise<string | null> => {
  const value = await readFile(join(tasksDir, 'current'), 'utf8').catch(() => '');
  return value.trim() || null;
};

export const writeCurrentId = async (tasksDir: string, id: IssueId): Promise<void> => {
  await writeFile(join(tasksDir, 'current'), `${id}\n`);
};

/** Fetch an issue or fail with the CLI-identical message. */
export const getOrThrow = async (uow: IssueUnitOfWork, raw: string): Promise<Issue> => {
  const found = await uow.findById(issueId(raw));
  const issue = found.ok ? found.value : null;
  if (!issue) throw new MessageError(`issue not found: ${raw}`);
  return issue;
};
