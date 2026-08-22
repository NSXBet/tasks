import { canonicalTimestampCodec, err, ok } from '@tasks/application';
import type {
  AuditEntry, IssueUnitOfWork, IssueQuery, IssuePage,
  MigrationFailure, MigrationHistoryEntry, MigrationPort, MigrationReport, MigrationStep,
  Result, TimestampCodec, UnitOfWork,
} from '@tasks/application';
import type { DependencyEdge, Issue, IssueId, Metadata } from '@tasks/domain';
import { IssueSchema, issueFromBdWire, issueToBdWire } from '@tasks/domain';
import type { BdWireEnvelope } from '@tasks/domain';
import * as fs from 'node:fs';
import * as path from 'node:path';

export { canonicalTimestampCodec } from '@tasks/application';
export type { TimestampCodec } from '@tasks/application';

// ─── Policy ───────────────────────────────────────────────────────────────────

export interface IssuePolicy {
  readonly readyStatus: string;
  readonly claimedStatus: string;
  readonly terminalStatuses: readonly string[];
  readonly blockerDependencyType: string;
}

export const defaultIssuePolicy: IssuePolicy = Object.freeze({
  readyStatus: 'open',
  claimedStatus: 'in_progress',
  terminalStatuses: ['closed'],
  blockerDependencyType: 'blocks',
});

// ─── Options ──────────────────────────────────────────────────────────────────

export interface FileAdapterOptions {
  /** Root directory (typically `.tasks/`). */
  readonly dir: string;
  readonly timestamps?: TimestampCodec;
  readonly now?: () => Date;
  readonly policy?: IssuePolicy;
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

interface MetaFile {
  backend: 'file';
  version: string | null;
  prefix: string;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class FileAdapter implements UnitOfWork, MigrationPort {
  readonly #dir: string;
  readonly #issuesDir: string;
  readonly #historyDir: string;
  readonly #metaPath: string;
  readonly #lockPath: string;
  readonly timestamps: TimestampCodec;
  readonly now: () => Date;
  readonly policy: IssuePolicy;

  constructor(options: FileAdapterOptions) {
    this.#dir = options.dir;
    this.#issuesDir = path.join(options.dir, 'issues');
    this.#historyDir = path.join(options.dir, 'history');
    this.#metaPath = path.join(options.dir, 'meta.json');
    this.#lockPath = path.join(options.dir, '.lock');
    this.timestamps = options.timestamps ?? canonicalTimestampCodec;
    this.now = options.now ?? (() => new Date());
    this.policy = options.policy ?? defaultIssuePolicy;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  #ensureDirs(): void {
    fs.mkdirSync(this.#issuesDir, { recursive: true });
    fs.mkdirSync(this.#historyDir, { recursive: true });
  }

  #issuePath(id: string): string {
    return path.join(this.#issuesDir, `${id}.json`);
  }

  #historyPath(id: string): string {
    return path.join(this.#historyDir, `${id}.jsonl`);
  }

  #readMeta(): MetaFile | null {
    try {
      return JSON.parse(fs.readFileSync(this.#metaPath, 'utf-8')) as MetaFile;
    } catch {
      return null;
    }
  }

  #writeMeta(meta: MetaFile): void {
    this.#atomicWrite(this.#metaPath, JSON.stringify(meta, null, 2) + '\n');
  }

  #atomicWrite(filePath: string, data: string): void {
    const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmp, data, 'utf-8');
    fs.renameSync(tmp, filePath);
  }

  #readIssue(id: string): Issue | null {
    const filePath = this.#issuePath(id);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return issueFromBdWire(raw, this.timestamps).issue;
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  #writeIssue(issue: Issue): void {
    const envelope: BdWireEnvelope = { version: 1, issue, unknown: issue.wireUnknown };
    const wire = issueToBdWire(envelope, this.timestamps);
    this.#atomicWrite(this.#issuePath(issue.id), JSON.stringify(wire, null, 2) + '\n');
  }

  #appendHistory(issueId: string, entry: { action: string; at: Date; actor: string | null; data: Record<string, unknown> }): void {
    const line = JSON.stringify({
      issue_id: issueId,
      action: entry.action,
      at: this.timestamps.encode(entry.at),
      actor: entry.actor,
      data: entry.data,
    }) + '\n';
    fs.appendFileSync(this.#historyPath(issueId), line, 'utf-8');
  }

  #readHistory(issueId: string): AuditEntry[] {
    const filePath = this.#historyPath(issueId);
    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (!content) return [];
      return content.split('\n').map((line: string, i: number) => {
        const raw = JSON.parse(line) as { issue_id: string; action: string; at: string; actor: string | null; data: Record<string, unknown> };
        return { id: i + 1, issueId: raw.issue_id as IssueId, action: raw.action, at: this.timestamps.decode(raw.at), actor: raw.actor, data: raw.data };
      });
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  #listAllIssueIds(): string[] {
    try {
      return fs.readdirSync(this.#issuesDir)
        .filter((f: string) => f.endsWith('.json') && !f.includes('.tmp'))
        .map((f: string) => f.slice(0, -5))
        .sort();
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  // ─── Locking ────────────────────────────────────────────────────────────────

  #acquireLock(): void {
    this.#ensureDirs();
    const maxWait = 5000;
    const start = Date.now();
    while (true) {
      try {
        // mkdir is atomic — succeeds only if dir doesn't exist
        fs.mkdirSync(this.#lockPath);
        // Write PID for debugging stale locks
        fs.writeFileSync(path.join(this.#lockPath, 'pid'), `${process.pid}\n`);
        return;
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        if (Date.now() - start > maxWait) {
          // Stale lock — force acquire
          this.#releaseLock();
          continue;
        }
        // Spin wait 10ms
        const end = Date.now() + 10;
        while (Date.now() < end) { /* busy wait */ }
      }
    }
  }

  #releaseLock(): void {
    try { fs.rmSync(this.#lockPath, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // ─── MigrationPort ─────────────────────────────────────────────────────────

  async currentVersion(): Promise<Result<string | null>> {
    try {
      const meta = this.#readMeta();
      return ok(meta?.version ?? null);
    } catch (cause) {
      return err({ kind: 'repository', operation: 'currentVersion', cause });
    }
  }

  async history(): Promise<Result<readonly MigrationHistoryEntry[]>> {
    try {
      const meta = this.#readMeta();
      if (!meta) return ok([]);
      return ok(meta.version ? [{ id: meta.version, order: 1, checksum: '', appliedAt: new Date() }] : []);
    } catch (cause) {
      return err({ kind: 'repository', operation: 'history', cause });
    }
  }

  async migrate(steps: readonly MigrationStep[] = []): Promise<Result<MigrationReport, MigrationFailure>> {
    try {
      this.#ensureDirs();
      const latest = steps.at(-1);
      const meta: MetaFile = this.#readMeta() ?? { backend: 'file', version: null, prefix: "tk" };
      meta.version = latest?.id ?? null;
      this.#writeMeta(meta);
      return ok({ applied: [], currentVersion: meta.version, lockAcquired: true });
    } catch (cause) {
      return err({ kind: 'migration', phase: 'apply', message: cause instanceof Error ? cause.message : 'migration failed', cause });
    }
  }

  async hasPendingMigrations(_steps: readonly MigrationStep[] = []): Promise<Result<boolean>> {
    return ok(false);
  }

  // ─── UnitOfWork ─────────────────────────────────────────────────────────────

  async withinTransaction<T>(work: (uow: IssueUnitOfWork) => Promise<Result<T>>): Promise<Result<T>> {
    this.#acquireLock();
    try {
      const uow = new FileIssueUnitOfWork(this);
      const result = await work(uow);
      return result;
    } catch (cause) {
      return err({ kind: 'repository', operation: 'transaction', cause });
    } finally {
      this.#releaseLock();
    }
  }

  // Expose internals to UnitOfWork implementation
  /** @internal */ _readIssue(id: string) { return this.#readIssue(id); }
  /** @internal */ _writeIssue(issue: Issue) { this.#writeIssue(issue); }
  /** @internal */ _appendHistory(id: string, entry: { action: string; at: Date; actor: string | null; data: Record<string, unknown> }) { this.#appendHistory(id, entry); }
  /** @internal */ _readHistory(id: string) { return this.#readHistory(id); }
  /** @internal */ _listAllIssueIds() { return this.#listAllIssueIds(); }
}

// ─── UnitOfWork Implementation ────────────────────────────────────────────────

class FileIssueUnitOfWork implements IssueUnitOfWork {
  constructor(private readonly adapter: FileAdapter) {}

  async findById(id: IssueId): Promise<Result<Issue | null>> {
    try {
      return ok(this.adapter._readIssue(id));
    } catch (cause) {
      return err({ kind: 'repository', operation: 'findById', cause });
    }
  }

  async save(issue: Issue): Promise<Result<void>> {
    try {
      IssueSchema.parse(issue);
      this.adapter._writeIssue(issue);
      this.adapter._appendHistory(issue.id, {
        action: 'save',
        at: this.adapter.now(),
        actor: null,
        data: { status: issue.status, title: issue.title },
      });
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'repository', operation: 'save', cause });
    }
  }

  async list(query: IssueQuery): Promise<Result<IssuePage>> {
    try {
      const ids = this.adapter._listAllIssueIds();
      let items: Issue[] = [];

      for (const id of ids) {
        if (query.cursor && id <= query.cursor) continue;
        const issue = this.adapter._readIssue(id);
        if (!issue) continue;
        if (query.status && issue.status !== query.status) continue;
        items.push(issue);
      }

      const limit = query.limit ?? 100;
      const hasMore = items.length > limit;
      items = items.slice(0, limit);
      const nextCursor = hasMore ? items.at(-1)!.id : null;

      return ok({ items, nextCursor });
    } catch (cause) {
      return err({ kind: 'repository', operation: 'list', cause });
    }
  }

  async addDependency(edge: DependencyEdge): Promise<Result<void>> {
    try {
      const issue = this.adapter._readIssue(edge.issueId);
      if (!issue) return err({ kind: 'not_found', resource: 'issue', id: edge.issueId });

      const exists = issue.dependencies.some(d => d.target === edge.target && d.type === edge.type);
      if (!exists) {
        const updated = IssueSchema.parse({
          ...issue,
          dependencies: [...issue.dependencies, edge],
          dependencyCount: issue.dependencyCount + 1,
          updatedAt: this.adapter.now(),
        });
        this.adapter._writeIssue(updated);
      }

      this.adapter._appendHistory(edge.issueId, {
        action: 'dependency_added',
        at: this.adapter.now(),
        actor: edge.createdBy,
        data: { target: edge.target, type: edge.type },
      });
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'repository', operation: 'addDependency', cause });
    }
  }

  async removeDependency(issueId: IssueId, target: DependencyEdge['target'], type?: DependencyEdge['type']): Promise<Result<void>> {
    try {
      const issue = this.adapter._readIssue(issueId);
      if (!issue) return err({ kind: 'not_found', resource: 'issue', id: issueId });

      const filtered = issue.dependencies.filter(d =>
        type ? !(d.target === target && d.type === type) : d.target !== target
      );
      const updated = IssueSchema.parse({
        ...issue,
        dependencies: filtered,
        dependencyCount: filtered.length,
        updatedAt: this.adapter.now(),
      });
      this.adapter._writeIssue(updated);

      this.adapter._appendHistory(issueId, {
        action: 'dependency_removed',
        at: this.adapter.now(),
        actor: null,
        data: { target, type: type ?? null },
      });
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'repository', operation: 'removeDependency', cause });
    }
  }

  async addComment(issueId: IssueId, author: string, text: string): Promise<Result<void>> {
    try {
      const issue = this.adapter._readIssue(issueId);
      if (!issue) return err({ kind: 'not_found', resource: 'issue', id: issueId });

      const comment = {
        id: `comment-${crypto.randomUUID()}`,
        issueId,
        author,
        text,
        createdAt: this.adapter.now(),
        wireUnknown: {} as Metadata,
      };

      const updated = IssueSchema.parse({
        ...issue,
        comments: [...issue.comments, comment],
        commentCount: issue.commentCount + 1,
        updatedAt: this.adapter.now(),
      });
      this.adapter._writeIssue(updated);

      this.adapter._appendHistory(issueId, {
        action: 'comment',
        at: this.adapter.now(),
        actor: author,
        data: { text },
      });
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'repository', operation: 'addComment', cause });
    }
  }

  async history(issueId: IssueId): Promise<Result<readonly AuditEntry[]>> {
    try {
      return ok(this.adapter._readHistory(issueId));
    } catch (cause) {
      return err({ kind: 'repository', operation: 'history', cause });
    }
  }

  async claimReady(id: IssueId, assignee: string, expectedUpdatedAt?: Date): Promise<Result<Issue>> {
    try {
      const issue = this.adapter._readIssue(id);
      if (!issue) return err({ kind: 'not_found', resource: 'issue', id });

      const policy = this.adapter.policy;
      const now = this.adapter.now();

      if (issue.status !== policy.readyStatus) {
        return err({ kind: 'conflict', message: 'issue not ready or claim lost race' });
      }

      if (issue.deferUntil && issue.deferUntil > now) {
        return err({ kind: 'conflict', message: 'issue not ready or claim lost race' });
      }

      if (expectedUpdatedAt && issue.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        return err({ kind: 'conflict', message: 'issue not ready or claim lost race' });
      }

      // Check blockers
      for (const dep of issue.dependencies) {
        if (dep.type === policy.blockerDependencyType) {
          const blocker = this.adapter._readIssue(dep.target as string);
          if (blocker && !policy.terminalStatuses.includes(blocker.status)) {
            return err({ kind: 'conflict', message: 'issue not ready or claim lost race' });
          }
        }
      }

      const claimed = IssueSchema.parse({
        ...issue,
        assignee,
        status: policy.claimedStatus,
        startedAt: issue.startedAt ?? now,
        updatedAt: now,
      });
      this.adapter._writeIssue(claimed);

      this.adapter._appendHistory(id, {
        action: 'claim_ready',
        at: now,
        actor: assignee,
        data: { assignee, status: policy.claimedStatus },
      });

      return ok(claimed);
    } catch (cause) {
      return err({ kind: 'repository', operation: 'claimReady', cause });
    }
  }
}

// ─── Migrations (no-op for file backend) ─────────────────────────────────────

export const fileMigrations: readonly MigrationStep[] = [];
