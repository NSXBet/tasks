import type { Result } from '../result.js';

/** Immutable migration declaration. SQL runs only inside adapter migration transaction. */
export interface MigrationStep { readonly id: string; readonly order: number; readonly checksum: string; readonly description: string; readonly sql: string; }
export interface MigrationHistoryEntry { readonly id: string; readonly order: number; readonly checksum: string; readonly appliedAt: Date; }
export interface MigrationReport { readonly applied: readonly MigrationHistoryEntry[]; readonly currentVersion: string | null; readonly lockAcquired: true; }
/** Every failure is typed and transaction rollback is required, including Result failures. */
export interface MigrationFailure { readonly kind: 'migration'; readonly phase: 'lock' | 'validate_history' | 'apply'; readonly version?: string; readonly message: string; readonly cause?: unknown; }
/** Migration adapter validates declared/durable prefix before executing any declared DDL. */
export interface MigrationPort {
  currentVersion(): Promise<Result<string | null>>;
  history(): Promise<Result<readonly MigrationHistoryEntry[]>>;
  migrate(steps: readonly MigrationStep[]): Promise<Result<MigrationReport, MigrationFailure>>;
}
export interface ApplicationPorts {
  readonly clock: import('./clock.js').Clock;
  readonly idGenerator: import('./id-generator.js').IdGenerator;
  readonly unitOfWork: import('./issue-repository.js').UnitOfWork;
  readonly migrations: MigrationPort;
}
export interface ApplicationCompositionRoot<TApplication> { create(ports: ApplicationPorts): TApplication; }
