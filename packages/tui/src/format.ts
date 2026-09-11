
/** Column formatting shared by list rows and cards. Deterministic helpers so
 * test snapshots stay stable. Palette and glyphs live in theme.js. */

/** Relative age like `3m`, `2h`, `5d`; deterministic from now. */
export const relativeAge = (from: Date, now: Date): string => {
  const seconds = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
};

export interface ListRow {
  readonly id: string;
  readonly status: string;
  readonly priority: number;
  readonly title: string;
  readonly assignee: string | null;
  readonly labels: readonly string[];
  readonly blocked: boolean;
  readonly age: string;
  readonly comments: number;
  readonly deps: number;
}

export const padStart = (value: string, width: number): string =>
  value.length >= width ? value.slice(0, width) : " ".repeat(width - value.length) + value;

export const truncate = (value: string, width: number): string =>
  value.length <= width ? value : value.slice(0, Math.max(0, width - 1)) + "…";