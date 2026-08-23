import { canonicalTimestampCodec } from '@tasks/application';
import type { IssueUnitOfWork, Result, UnitOfWork } from '@tasks/application';
import { err, ok } from '@tasks/application';
import type { Issue, JsonValue, WireTimestampCodec } from '@tasks/domain';
import { decodeIssue, isIssueRecord, splitRecords, type BeadsIssueRecord, type BeadsRecord, type BeadsRecordError } from './records.js';
import { planIssues, type DanglingParent, type ParentCycle } from './plan.js';

/** How to treat an issue ID that already exists in the target. */
export type ConflictPolicy = 'skip' | 'overwrite' | 'fail';
export interface MigrateOptions {
  readonly timestamps?: WireTimestampCodec;
  /** Parse, plan and report without writing. */
  readonly dryRun?: boolean;
  readonly onConflict?: ConflictPolicy;
  /** Abort on the first undecodable record instead of quarantining it. */
  readonly strict?: boolean;
}
/** Foreign beads records (memories, infra beads, gates) kept verbatim for re-export. */
export interface CarriedRecord { readonly line: number; readonly type: string; readonly raw: Readonly<Record<string, JsonValue>> }
export interface MigrationSummary {
  readonly read: number;
  readonly imported: number;
  /** IDs of the issues that landed, in insertion order. */
  readonly importedIds: readonly string[];
  readonly skipped: readonly string[];
  readonly overwritten: readonly string[];
  readonly carried: readonly CarriedRecord[];
  readonly rejected: readonly BeadsRecordError[];
  readonly detachedParents: readonly DanglingParent[];
  readonly cycles: readonly ParentCycle[];
  readonly dryRun: boolean;
}
export interface MigrationFailure { readonly kind: 'beads_migration'; readonly message: string; readonly rejected?: readonly BeadsRecordError[]; readonly cause?: unknown }

const failure = (message: string, extra: Omit<MigrationFailure, 'kind' | 'message'> = {}): MigrationFailure => ({ kind: 'beads_migration', message, ...extra });
const describe = (error: BeadsRecordError): string => `line ${error.line} field ${error.field}: ${error.message}`;

/**
 * Import a `bd export` JSONL stream into any tasks adapter.
 *
 * Runs inside one transaction: either the whole batch lands or nothing does,
 * so a partially-migrated workspace is never observable. Issues are ordered
 * parent-first and non-issue records are carried rather than rejected.
 */
export async function migrateBeadsJsonl(target: UnitOfWork, source: string, options: MigrateOptions = {}): Promise<Result<MigrationSummary, MigrationFailure>> {
  const timestamps = options.timestamps ?? canonicalTimestampCodec;
  const policy = options.onConflict ?? 'skip';
  const { records, errors } = splitRecords(source);

  const issues: BeadsIssueRecord[] = [];
  const carried: CarriedRecord[] = [];
  const rejected: BeadsRecordError[] = [...errors];
  for (const record of records) {
    if (!isIssueRecord(record)) { carried.push(record satisfies BeadsRecord); continue; }
    const decoded = decodeIssue(record, timestamps);
    if ('error' in decoded) rejected.push(decoded.error); else issues.push(decoded.issue);
  }
  if (rejected.length > 0 && (options.strict ?? false)) return err(failure(`rejected ${rejected.length} record(s): ${describe(rejected[0]!)}`, { rejected }));

  return runInTransaction(target, async (uow) => {
    const existingIds = await durableIds(uow);
    const conflicts = issues.filter((record) => existingIds.has(record.issue.id));
    if (policy === 'fail' && conflicts.length > 0) return err(failure(`${conflicts.length} issue(s) already exist, first: ${conflicts[0]!.issue.id}`));

    const skipped = policy === 'skip' ? conflicts.map((record) => record.issue.id) : [];
    const overwritten = policy === 'overwrite' ? conflicts.map((record) => record.issue.id) : [];
    const admitted = policy === 'skip' ? issues.filter((record) => !existingIds.has(record.issue.id)) : issues;
    const plan = planIssues(admitted, existingIds);

    if (options.dryRun ?? false) return ok(summary({ read: records.length, skipped, overwritten, carried, rejected, plan, dryRun: true }));

    for (const record of plan.ordered) {
      const saved = await uow.save(record.issue);
      if (!saved.ok) return err(failure(`line ${record.line} issue ${record.issue.id}: save failed`, { cause: saved.error }));
      const edges = await writeEdges(uow, record.issue);
      if (edges !== null) return err(edges);
    }
    return ok(summary({ read: records.length, skipped, overwritten, carried, rejected, plan, dryRun: false }));
  });
}

/** `save` replaces edges from the issue payload; explicit adds cover adapters that ignore them. */
async function writeEdges(uow: IssueUnitOfWork, issue: Issue): Promise<MigrationFailure | null> {
  for (const edge of issue.dependencies) {
    const added = await uow.addDependency(edge);
    if (!added.ok) return failure(`issue ${issue.id}: dependency ${edge.target} failed`, { cause: added.error });
  }
  return null;
}

async function durableIds(uow: IssueUnitOfWork): Promise<Set<string>> {
  const ids = new Set<string>();
  const page = await uow.list({ limit: 100_000 });
  if (page.ok) for (const issue of page.value.items) ids.add(issue.id);
  return ids;
}

/** Adapter transactions carry their own error type; normalise it to MigrationFailure. */
async function runInTransaction(target: UnitOfWork, work: (uow: IssueUnitOfWork) => Promise<Result<MigrationSummary, MigrationFailure>>): Promise<Result<MigrationSummary, MigrationFailure>> {
  let captured: MigrationFailure | null = null;
  const outcome = await target.withinTransaction(async (uow) => {
    const result = await work(uow);
    if (result.ok) return ok(result.value);
    captured = result.error;
    // Failing the transaction is what triggers adapter rollback.
    return err({ kind: 'repository' as const, operation: 'beads_migration', cause: result.error });
  });
  if (outcome.ok) return ok(outcome.value);
  return err(captured ?? failure('transaction rolled back', { cause: outcome.error }));
}

const summary = (input: { read: number; skipped: readonly string[]; overwritten: readonly string[]; carried: readonly CarriedRecord[]; rejected: readonly BeadsRecordError[]; plan: ReturnType<typeof planIssues>; dryRun: boolean }): MigrationSummary => ({
  read: input.read, imported: input.plan.ordered.length, importedIds: input.plan.ordered.map((record) => record.issue.id),
  skipped: input.skipped, overwritten: input.overwritten,
  carried: input.carried, rejected: input.rejected, detachedParents: input.plan.detached, cycles: input.plan.cycles, dryRun: input.dryRun,
});
