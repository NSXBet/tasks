/**
 * WORKSPC `commit` (Phase 11 D-04, deferred from Phase 9): commit the task
 * worktree's staged + tracked changes with a required message, through the
 * typed @tasks/git adapter (`gitCommitTracked` = `git commit --all
 * --message=<msg>`). Untracked files are never added, hooks run, nothing is
 * amended and nothing is pushed.
 *
 * Guards (each refuses before any `git commit`): empty message, no recorded
 * worktree on disk, the worktree is the main checkout, the worktree is on a
 * branch other than `issue.branch`, nothing tracked to commit.
 *
 * git runs outside the DB transaction. After a commit, `metadata.report` (the
 * D-03 cache) is restamped in one short transaction that re-reads the issue;
 * a failed stamp never hides or undoes the commit.
 */
import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Issue } from '@tasks/domain';
import type { IssueUnitOfWork } from '@tasks/application';
import { bunRunner, gitBranchHead, gitCommitTracked, gitCommonDir, gitCurrentBranch, mainWorktreeRoot, type ProcessRunner } from '@tasks/git';
import { MessageError } from '../errors.js';
import { getOrThrow } from '../store.js';
import { reportStampFor, type ReportStamp } from './changes.js';

export interface CommitDeps {
  /** Repo root (main checkout): the main-checkout guard and report derivation resolve from here. */
  readonly cwd: string;
  readonly transact: <T>(fn: (uow: IssueUnitOfWork) => Promise<T>) => Promise<T>;
  readonly runner?: ProcessRunner;
}

export interface CommitResult {
  readonly id: string;
  /** Full 40-hex sha of the new branch head. */
  readonly sha: string;
  /** The restamped `metadata.report`, or null when the stamp could not be derived/saved. */
  readonly report: ReportStamp | null;
}

export const COMMIT_MESSAGE_MAX = 4000;

/** Strip C0/C1 controls except `\n` and `\t`, trim, cap. */
export const normalizeCommitMessage = (raw: string): string =>
  raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '').trim().slice(0, COMMIT_MESSAGE_MAX).trim();

const firstLine = (text: string): string => {
  const line = text.split(/\r?\n/).map((part) => part.trim()).find((part) => part !== '') ?? 'unknown error';
  return line.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
};

const isDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

const real = async (path: string): Promise<string> => {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
};

/** `commit` on the WORKSPC tab: see module doc. */
export const commitWorktree = async (deps: CommitDeps, id: string, message: string): Promise<CommitResult> => {
  const runner = deps.runner ?? bunRunner;
  const msg = normalizeCommitMessage(typeof message === 'string' ? message : '');
  if (msg === '') throw new MessageError('commit message is empty');
  const issue: Issue = await deps.transact((uow) => getOrThrow(uow, id));
  const branch = issue.branch;
  const recorded = issue.metadata['worktree'];
  const noWorktree = `no worktree for ${issue.id} — run tk work ${issue.id}`;
  if (branch === null || branch === '' || typeof recorded !== 'string' || recorded === '') throw new MessageError(noWorktree);
  const worktree = resolve(deps.cwd, recorded);
  if (!(await isDirectory(worktree))) throw new MessageError(noWorktree);
  const commonDir = await gitCommonDir(deps.cwd, runner);
  const mainRoot = commonDir === null ? deps.cwd : mainWorktreeRoot(commonDir);
  if ((await real(worktree)) === (await real(mainRoot))) throw new MessageError(`${issue.id}'s worktree is the main checkout — refusing to commit`);
  const current = await gitCurrentBranch(worktree, runner);
  if (current !== branch) throw new MessageError(`worktree is on ${current ?? 'a detached HEAD'}, not ${branch} — refusing to commit`);
  const outcome = await gitCommitTracked(worktree, msg, runner);
  if (outcome.nothingToCommit) throw new MessageError(`nothing to commit in ${issue.id}'s worktree — untracked files are never added; git add them first`);
  if (!outcome.ok) throw new MessageError(`git commit failed: ${firstLine(outcome.stderr)}`);
  const sha = (await gitBranchHead(worktree, branch, runner)) ?? '';
  let report: ReportStamp | null = null;
  try {
    report = await reportStampFor({ cwd: deps.cwd }, issue, runner);
    if (report !== null) {
      const stamp = report;
      await deps.transact(async (uow) => {
        const latest = await getOrThrow(uow, issue.id);
        const saved = await uow.save({ ...latest, metadata: { ...latest.metadata, report: stamp }, updatedAt: new Date() });
        if (!saved.ok) throw new MessageError('save failed');
      });
    }
  } catch {
    // The commit already landed; a stale report cache is recoverable (next finish/pr restamps it).
    report = null;
  }
  return { id: issue.id, sha, report };
};
