/**
 * PR sidecar (Phase 11 D-01, PR-01): one PR per task, mirrored on the record as
 * `metadata.pr = {number, url, state}`. gh is the remote truth; tk reads it
 * only inside an explicit verb — no poller, no timer, no retry.
 *
 *   - `prCreate`: push the branch (@tasks/git), then refresh the recorded open
 *     PR, else adopt an open PR for the head branch, else `gh pr create`.
 *     A closed/merged record refuses (1-to-1).
 *   - `prSync`: one `gh pr view <number>` and one save.
 *   - `prShow`: the local mirror only; zero gh calls.
 *   - `prClose` / `prMerge` (11-03): `gh pr view` precheck (remote truth), the
 *     mutating call only when the remote state differs from the target, then
 *     one `gh pr view` and one save. Neither touches the branch, the worktree
 *     or the task status — pruning stays `tk close`'s job.
 *
 * git/gh run outside the DB transaction; the save is a separate short
 * transaction that re-reads the issue (T-11-08). A successful live derivation
 * restamps `metadata.report` (the D-03 cache) in the same save.
 */
import { DEFAULT_WEB_BASE, readPrRecord, statCardLine, type Issue, type PrRecord } from '@tasks/domain';
import type { IssueUnitOfWork } from '@tasks/application';
import { bunRunner, gitDefaultBranch, gitPushBranch, type ProcessRunner } from '@tasks/git';
import { MessageError } from '../errors.js';
import { getOrThrow, type SurfaceStore } from '../store.js';
import { ghPrClose, ghPrCreate, ghPrListOpenForHead, ghPrMerge, ghPrView, type PrMergeMethod } from '../gh.js';
import { reportStampFor, resolveChanges } from './changes.js';

export interface PrDeps {
  /** Repo root: git pushes and gh resolves the GitHub repo from here. */
  readonly cwd: string;
  readonly transact: <T>(fn: (uow: IssueUnitOfWork) => Promise<T>) => Promise<T>;
  /** git runner (push, default branch, derivation). */
  readonly runner?: ProcessRunner;
  /** gh runner. */
  readonly ghRunner?: ProcessRunner;
  /** Web base for the stat-card link in the PR body. */
  readonly webBase?: string;
}

export type PrOp = 'create' | 'adopt' | 'refresh' | 'sync' | 'close' | 'merge';

export interface PrResult {
  readonly issue: Issue;
  readonly pr: PrRecord;
  readonly op: PrOp;
}

const gitFailure = (stderr: string): string => {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  return (lines.find((line) => /^(fatal|error):/.test(line)) ?? lines[0] ?? 'unknown error').replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
};

const firstParagraph = (text: string): string => text.trim().split(/\r?\n\s*\r?\n/)[0]?.trim() ?? '';

const readIssue = (deps: PrDeps, id: string): Promise<Issue> => deps.transact((uow) => getOrThrow(uow, id));

/** One short save: re-read, merge `pr` (+ `report` when stamped), bump `updatedAt`. */
const savePr = (deps: PrDeps, id: string, pr: PrRecord, report: Awaited<ReturnType<typeof reportStampFor>>): Promise<Issue> =>
  deps.transact(async (uow) => {
    const current = await getOrThrow(uow, id);
    const next: Issue = { ...current, metadata: { ...current.metadata, pr, ...(report !== null ? { report } : {}) }, updatedAt: new Date() };
    const saved = await uow.save(next);
    if (!saved.ok) throw new MessageError('save failed');
    return next;
  });

/** `tk pr create <id>`: idempotent and 1-to-1 (see module doc). */
export const prCreate = async (deps: PrDeps, id: string, opts: { readonly title?: string; readonly body?: string } = {}): Promise<PrResult> => {
  const runner = deps.runner ?? bunRunner;
  const ghRunner = deps.ghRunner ?? bunRunner;
  const issue = await readIssue(deps, id);
  const branch = issue.branch;
  if (branch === null || branch === '') throw new MessageError(`tk pr create needs a worked task — run tk work ${issue.id} first`);
  const recorded = readPrRecord(issue.metadata);
  if (recorded !== null && recorded.state !== 'open')
    throw new MessageError(`${issue.id} already has PR #${recorded.number} (${recorded.state}) — one PR per task; run tk pr sync ${issue.id}`);
  const pushed = await gitPushBranch(deps.cwd, branch, 'origin', runner);
  if (!pushed.ok) throw new MessageError(`git push failed: ${gitFailure(pushed.stderr)}`);
  let op: PrOp;
  let pr: PrRecord;
  if (recorded !== null) {
    pr = await ghPrView(String(recorded.number), deps.cwd, ghRunner);
    op = 'refresh';
  } else {
    const adopted = await ghPrListOpenForHead(branch, deps.cwd, ghRunner);
    if (adopted !== null) {
      pr = adopted;
      op = 'adopt';
    } else {
      const base = (await gitDefaultBranch(deps.cwd, runner)) ?? 'main';
      const view = await resolveChanges({ cwd: deps.cwd }, issue, deps.webBase ?? DEFAULT_WEB_BASE, runner);
      const body = opts.body ?? [`tk: ${issue.id}`, firstParagraph(issue.description), view === null ? '' : statCardLine(view)].filter((part) => part !== '').join('\n\n');
      pr = await ghPrCreate({ head: branch, base, title: opts.title ?? issue.title, body }, deps.cwd, ghRunner);
      op = 'create';
    }
  }
  const report = await reportStampFor({ cwd: deps.cwd }, issue, runner);
  return { issue: await savePr(deps, issue.id, pr, report), pr, op };
};

/** `tk pr sync <id>`: the only remote read — one `gh pr view <number>`, one save. */
export const prSync = async (deps: PrDeps, id: string): Promise<PrResult> => {
  const issue = await readIssue(deps, id);
  const recorded = readPrRecord(issue.metadata);
  if (recorded === null) throw new MessageError(`no PR on ${issue.id} — run tk pr create ${issue.id}`);
  const pr = await ghPrView(String(recorded.number), deps.cwd, deps.ghRunner ?? bunRunner);
  const report = await reportStampFor({ cwd: deps.cwd }, issue, deps.runner ?? bunRunner);
  return { issue: await savePr(deps, issue.id, pr, report), pr, op: 'sync' };
};

/**
 * Shared close/merge path: require the record, precheck with `gh pr view` (the number comes only from the
 * validated record, T-11-12), skip the mutation when the remote already has the target state, otherwise
 * mutate and view once more; save `metadata.pr` in one short transaction.
 */
const prTransition = async (deps: PrDeps, id: string, target: 'closed' | 'merged', mutate: (number: number, ghRunner: ProcessRunner) => Promise<void>): Promise<PrResult> => {
  const ghRunner = deps.ghRunner ?? bunRunner;
  const issue = await readIssue(deps, id);
  const recorded = readPrRecord(issue.metadata);
  if (recorded === null) throw new MessageError(`no PR on ${issue.id} — run tk pr create ${issue.id}`);
  let pr = await ghPrView(String(recorded.number), deps.cwd, ghRunner);
  if (pr.state !== target) {
    if (pr.state === 'merged') throw new MessageError(`PR #${pr.number} on ${issue.id} is already merged — nothing to close`);
    if (target === 'merged' && pr.state === 'closed') throw new MessageError(`PR #${pr.number} on ${issue.id} is closed — reopen it on GitHub before merging`);
    await mutate(pr.number, ghRunner);
    pr = await ghPrView(String(pr.number), deps.cwd, ghRunner);
  }
  return { issue: await savePr(deps, issue.id, pr, null), pr, op: target === 'merged' ? 'merge' : 'close' };
};

/** `tk pr close <id>`: `gh pr close <n>`; keeps the branch and worktree; idempotent on a closed PR. */
export const prClose = (deps: PrDeps, id: string): Promise<PrResult> =>
  prTransition(deps, id, 'closed', (number, ghRunner) => ghPrClose(number, deps.cwd, ghRunner));

/** `tk pr merge <id>`: `gh pr merge <n> --<method>`; never closes the task (next: `tk close <id>`); idempotent on a merged PR. */
export const prMerge = (deps: PrDeps, id: string, method: PrMergeMethod = 'merge'): Promise<PrResult> =>
  prTransition(deps, id, 'merged', (number, ghRunner) => ghPrMerge(number, method, deps.cwd, ghRunner));

/** `tk pr <id>` / `tk pr show <id>`: the local mirror; never runs gh or git. */
export const prShow = async (deps: Pick<PrDeps, 'transact'>, id: string): Promise<{ readonly issue: Issue; readonly pr: PrRecord | null }> => {
  const issue = await deps.transact((uow) => getOrThrow(uow, id));
  return { issue, pr: readPrRecord(issue.metadata) };
};

/**
 * Adapts `SurfaceStore.transact` (a `Result`) to the throwing `transact` dep that
 * `prCreate` / `commitWorktree` take, so web and TUI build
 * `{cwd: store.root, transact: storeTransact(store)}`. On failure the original
 * thrown error is rethrown when there is one (MessageError text preserved
 * verbatim); otherwise a MessageError carrying the store error's message.
 */
export const storeTransact = (store: SurfaceStore): (<T>(fn: (uow: IssueUnitOfWork) => Promise<T>) => Promise<T>) =>
  async <T>(fn: (uow: IssueUnitOfWork) => Promise<T>): Promise<T> => {
    let thrown: { readonly error: unknown } | null = null;
    const result = await store.transact(async (uow) => {
      try {
        return await fn(uow);
      } catch (error) {
        thrown = { error };
        throw error;
      }
    });
    if (result.ok) return result.value;
    const captured = thrown as { readonly error: unknown } | null;
    if (captured !== null) throw captured.error;
    throw new MessageError(result.error.message);
  };
