/**
 * Changes stat card (PR-02 / PR-03): resolves a task's counts-only
 * `ChangesView` for chat-facing output, and computes the `metadata.report`
 * stamp finish writes as the cache for hosts that cannot reach the branch.
 *
 * The fallback ladder (`resolveChanges`), first hit wins:
 *   1. closed + frozen snapshot → `snapshot`, not stale, zero git calls (CHG-02)
 *   2. live derivation from the recorded branch/base → `live`
 *   3. `metadata.report.changes` (finish / pr stamp) → `report`, stale
 *   4. a frozen snapshot on a reopened (non-closed) task → `snapshot`, stale
 *   5. nothing → null ("no changes recorded")
 *
 * "Out of reach" is strictly the null from `deriveChangeset` (deleted branch,
 * missing base, other host). Cached rungs carry counts only: no diff and no
 * file list is ever synthesized. Read path only; no writes here.
 */
import type { ChangesStat, ChangesView, Issue } from '@tasks/domain';
import { changesLinks, readReportStat, statFromChangeset } from '@tasks/domain';
import { bunRunner, gitBranchHead, type ProcessRunner } from '@tasks/git';
import { deriveChangeset, readChangesetBase, readChangesetSnapshot } from './changeset.js';
import { err, ok, type Result } from '@tasks/application';
import type { SurfaceError } from '../errors.js';
import type { SurfaceStore } from '../store.js';
import { resolveWebBase } from '../runtime.js';
import { showIssue } from './query.js';

/**
 * Card helpers re-exported for hosts that depend on `@tasks/surface` only
 * (the pi/omp extension renders `task.report` / `task.pr` lines with them).
 */
export { statCardLine, statSummary, readReportStat, changesLinks, readPrRecord, DEFAULT_WEB_BASE } from '@tasks/domain';
export type { ChangesView, ChangesStat, PrRecord, PrState } from '@tasks/domain';

/** `metadata.report` value. A type alias (not an interface) so it is assignable to `JsonValue`. */
export type ReportStamp = {
  readonly changes: { readonly commits: number; readonly files: number; readonly additions: number; readonly deletions: number };
  readonly head: string;
  readonly at: string;
};

/**
 * Live derivation folded into a `metadata.report` value: `{changes, head, at}`.
 * Null (nothing to stamp) when the task has no branch or pinned base, or when
 * any git call fails — callers keep whatever report was stored before.
 */
export const reportStampFor = async (
  ctx: { readonly cwd: string },
  issue: Issue,
  runner: ProcessRunner = bunRunner,
  at: Date = new Date(),
): Promise<ReportStamp | null> => {
  if (issue.branch === null || issue.branch === '') return null;
  const record = readChangesetBase(issue.metadata);
  if (record === null) return null;
  const payload = await deriveChangeset(ctx, record.base, issue.branch, runner);
  if (payload === null) return null;
  const head = await gitBranchHead(ctx.cwd, issue.branch, runner);
  if (head === null) return null;
  const stat = statFromChangeset(payload);
  return { changes: { commits: stat.commits, files: stat.files, additions: stat.additions, deletions: stat.deletions }, head, at: at.toISOString() };
};

/** The fallback ladder (see module doc). `cwd` is the repo root: branch refs live in the common dir, so the worktree directory need not exist. */
export const resolveChanges = async (
  ctx: { readonly cwd: string },
  issue: Issue,
  webBase: string,
  runner: ProcessRunner = bunRunner,
): Promise<ChangesView | null> => {
  const links = changesLinks(issue.id, webBase);
  const view = (source: ChangesView['source'], stale: boolean, at: string | null, stat: ChangesStat): ChangesView => ({ id: issue.id, source, stale, at, stat, links });
  const snapshot = readChangesetSnapshot(issue.metadata);
  if (issue.status === 'closed' && snapshot !== null) return view('snapshot', false, issue.closedAt === null ? null : issue.closedAt.toISOString(), statFromChangeset(snapshot));
  const record = readChangesetBase(issue.metadata);
  if (record !== null && issue.branch !== null && issue.branch !== '') {
    const live = await deriveChangeset(ctx, record.base, issue.branch, runner);
    if (live !== null) return view('live', false, null, statFromChangeset(live));
  }
  const report = readReportStat(issue.metadata);
  if (report !== null) return view('report', true, report.at, report.stat);
  if (snapshot !== null) return view('snapshot', true, issue.closedAt === null ? null : issue.closedAt.toISOString(), statFromChangeset(snapshot));
  return null;
};

/** JSON wire for a view: `{source, stale, at, stat, links}` (the id is carried by the enclosing object). */
export const changesWire = (view: ChangesView | null): { readonly source: string; readonly stale: boolean; readonly at: string | null; readonly stat: ChangesStat; readonly links: { readonly tui: string; readonly web: string } } | null =>
  view === null ? null : { source: view.source, stale: view.stale, at: view.at, stat: view.stat, links: view.links };

/**
 * `TasksSurface.changes(id)`: the task's counts-only `ChangesView` via the ladder (null = no changes
 * recorded); not-found like `show`. Read-only: no writes, never a diff. `cwd` is the workspace root.
 */
export const changesOf = async (store: SurfaceStore, id: string, runner: ProcessRunner = bunRunner): Promise<Result<ChangesView | null, SurfaceError>> => {
  const shown = await showIssue(store, id);
  if (!shown.ok) return shown;
  try {
    return ok(await resolveChanges({ cwd: store.root }, shown.value, await resolveWebBase(store.tasksDir), runner));
  } catch (cause) {
    return err({ kind: 'runtime', message: cause instanceof Error ? cause.message : String(cause) });
  }
};
