/**
 * The chat stat card (PR-02 / PR-03): one plain-text line that summarises a
 * task's changes as counts plus two links into the changes view. Shared by the
 * CLI (`tk finish`, `tk changes`, `tk show`) and the agent extension. Pure: no
 * IO, no ANSI, never a diff, a file path or file contents.
 */
import type { Metadata } from './issue.js';
import { reviewDoors, DEFAULT_WEB_BASE } from './review-record.js';

export interface ChangesStat {
  readonly commits: number;
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
}

/** Where the counts came from: a live branch derivation, the close-time frozen snapshot, or the finish report cache. */
export type ChangesSource = 'live' | 'snapshot' | 'report';

export interface ChangesLinks {
  readonly tui: string;
  readonly web: string;
}

export interface ChangesView {
  readonly id: string;
  readonly source: ChangesSource;
  /** True when the counts are cached and may lag the branch (report, reopened snapshot). */
  readonly stale: boolean;
  /** ISO time the counts were taken (report stamp / close), null for live. */
  readonly at: string | null;
  readonly stat: ChangesStat;
  readonly links: ChangesLinks;
}

/** Counts-only reduction of a changeset payload (live derivation or frozen snapshot). */
export const statFromChangeset = (payload: {
  readonly commits: readonly unknown[];
  readonly files: readonly unknown[];
  readonly counts: { readonly additions: number; readonly deletions: number };
}): ChangesStat => ({
  commits: payload.commits.length,
  files: payload.files.length,
  additions: payload.counts.additions,
  deletions: payload.counts.deletions,
});

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/**
 * Narrowing read of `metadata.report = { changes: {commits, files, additions, deletions}, head, at }`,
 * the counts-only cache stamped by `tk finish` (and `tk pr create|sync`). Anything malformed reads as absent.
 */
export const readReportStat = (metadata: Metadata): { readonly stat: ChangesStat; readonly head: string | null; readonly at: string | null } | null => {
  const report = record(metadata['report']);
  if (report === null) return null;
  const changes = record(report['changes']);
  if (changes === null) return null;
  const commits = count(changes['commits']);
  const files = count(changes['files']);
  const additions = count(changes['additions']);
  const deletions = count(changes['deletions']);
  if (commits === null || files === null || additions === null || deletions === null) return null;
  const head = typeof report['head'] === 'string' && report['head'] !== '' ? report['head'] : null;
  const at = typeof report['at'] === 'string' && report['at'] !== '' ? report['at'] : null;
  return { stat: { commits, files, additions, deletions }, head, at };
};

/** The changes-view links: the TUI review door and the web diff route (`<base>/tasks/<id>/diff`). */
export const changesLinks = (id: string, webBase: string = DEFAULT_WEB_BASE): ChangesLinks => {
  const doors = reviewDoors(id, webBase);
  return { tui: doors.tui, web: `${doors.web}/diff` };
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** `N commits · +A −D · F files` (U+2212 minus), singular for 1. */
export const statSummary = (stat: ChangesStat): string =>
  `${plural(stat.commits, 'commit')} · +${stat.additions} −${stat.deletions} · ${plural(stat.files, 'file')}`;

/** `Changes · <id>  <stat>  → <web> · <tui>` plus a stale pill for cached rungs. Plain text, no ANSI. */
export const statCardLine = (view: ChangesView): string => {
  const base = `Changes · ${view.id}  ${statSummary(view.stat)}  → ${view.links.web} · ${view.links.tui}`;
  if (!view.stale) return base;
  if (view.source === 'report') return `${base}  · stale — from finish report ${view.at ?? 'unknown time'}`;
  return `${base}  · frozen at close`;
};
