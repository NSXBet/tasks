/**
 * Host-agnostic widget rendering for the Tasks Watch bubble, copied in shape
 * from pi-herdr-subagents (borderTop/borderLine/borderBottom + width-safe
 * truncation). Consumed via `ctx.ui.setWidget(key, factory, { placement:
 * "aboveEditor" })` — identical contract on pi and omp.
 */
import type { WatchCounts } from "../../surface/src/index.ts";
import { formatCounts } from "./watch-manager.ts";

export interface WatchRow {
  readonly name: string;
  readonly detail: string;
  readonly seq: number;
  readonly startedAt: number;
  readonly pending: boolean;
}

const ACTIVE_ACCENT = "\x1b[38;2;77;163;255m";
const OPEN_ACCENT = "\x1b[38;2;214;158;46m";
const RST = "\x1b[0m";

const visibleWidth = (text: string): number => {
  // Strip ANSI sequences; count emoji/wide codepoints (the count icons) as
  // double width to match terminal rendering.
  let width = 0;
  for (const char of text.replace(/\x1b\[[0-9;]*m/g, "")) {
    width += char.codePointAt(0)! > 0x2fff ? 2 : 1;
  }
  return width;
};

const truncateToWidth = (text: string, maxWidth: number): string => {
  const visible = visibleWidth(text);
  if (visible <= maxWidth) return text;
  let out = "";
  let width = 0;
  for (const char of text.replace(/\x1b\[[0-9;]*m/g, "")) {
    const charWidth = char.codePointAt(0)! > 0x2fff ? 2 : 1;
    if (width + charWidth > maxWidth - 1) break;
    out += char;
    width += charWidth;
  }
  return `${out}…`;
};

const borderLine = (left: string, right: string, width: number, accent: string): string => {
  if (width <= 1) return `${accent}│${RST}`;
  const contentWidth = Math.max(0, width - 2);
  const rightVis = visibleWidth(right);
  if (rightVis >= contentWidth) {
    const truncRight = truncateToWidth(right, contentWidth);
    const rightPad = Math.max(0, contentWidth - visibleWidth(truncRight));
    return `${accent}│${RST}${truncRight}${" ".repeat(rightPad)}${accent}│${RST}`;
  }
  const maxLeft = Math.max(0, contentWidth - rightVis);
  const truncLeft = truncateToWidth(left, maxLeft);
  const leftVis = visibleWidth(truncLeft);
  const pad = Math.max(0, contentWidth - leftVis - rightVis);
  return `${accent}│${RST}${truncLeft}${" ".repeat(pad)}${right}${accent}│${RST}`;
};

const borderTop = (title: string, info: string, width: number, accent: string): string => {
  if (width <= 0) return "";
  if (width === 1) return `${accent}╭${RST}`;
  const inner = Math.max(0, width - 2);
  const titlePart = `─ ${title} `;
  const infoPart = ` ${info} ─`;
  const fillLen = Math.max(0, inner - visibleWidth(titlePart) - visibleWidth(infoPart));
  const fill = "─".repeat(fillLen);
  const content = `${titlePart}${fill}${infoPart}`.slice(0, visibleWidth(titlePart) + fillLen + visibleWidth(infoPart)).padEnd(inner, "─");
  return `${accent}╭${content}╮${RST}`;
};

const borderBottom = (width: number, accent: string): string => {
  if (width <= 0) return "";
  if (width === 1) return `${accent}╰${RST}`;
  const inner = Math.max(0, width - 2);
  return `${accent}╰${"─".repeat(inner)}╯${RST}`;
};

const formatElapsed = (startTime: number, now: number): string => {
  const seconds = Math.max(0, Math.floor((now - startTime) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

/** Render the full widget box for the given watcher rows at terminal width. */
export function renderWatchWidgetLines(rows: readonly WatchRow[], counts: WatchCounts | null, width: number): string[] {
  if (rows.length === 0) return [];
  const now = Date.now();
  const pending = rows.some((row) => row.pending);
  const accent = pending ? OPEN_ACCENT : ACTIVE_ACCENT;
  const info = pending ? `${rows.length} watching · events` : `${rows.length} watching · idle`;
  const lines: string[] = [borderTop("Tasks Watch", info, width, accent)];
  if (counts !== null) {
    lines.push(borderLine(` ${formatCounts(counts)} `, "", width, accent));
  }
  for (const row of rows) {
    const elapsed = formatElapsed(row.startedAt, now);
    const left = ` ${elapsed}  ${row.name}  ${row.detail} `;
    const right = ` seq ${row.seq} `;
    lines.push(borderLine(left, right, width, accent));
  }
  lines.push(borderBottom(width, accent));
  return lines;
}
