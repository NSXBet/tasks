import type { Issue } from "@tasks/domain";

/**
 * Design tokens for the tk TUI. Tokyo Night base with beads_viewer-style
 * accents: violet header bands and selection borders, pink/khaki reserved for
 * interactive chips, dimming as the primary depth cue. All colors are plain
 * hex strings so renderer styling and test snapshots agree.
 */
export const colors = {
  bg: "#16161e",
  panel: "#1a1b26",
  border: "#2f3449",
  borderFocus: "#7aa2f7",
  text: "#c0caf5",
  dim: "#565f89",
  accent: "#7aa2f7",
  green: "#9ece6a",
  yellow: "#e0af68",
  orange: "#ff9e66",
  red: "#f7768e",
  magenta: "#bb6bd9",
  cyan: "#7dcfff",
  /** Violet: header bands, active chips, selection borders. */
  band: "#bb9af7",
  /** Dark text placed on band-colored backgrounds. */
  bandFg: "#16161e",
  /** Muted violet for card/column borders. */
  violet: "#5b4b7a",
  /** Selection pill background. */
  selection: "#3b3370",
  /** Full-screen dim layer behind modal overlays (darker than bg). */
  overlayBg: "#0f0f16",
} as const;

export const statusColor = (status: string): string => {
  switch (status) {
    case "open": return colors.green;
    case "in_progress": return colors.accent;
    case "ready-to-review": return colors.yellow;
    case "approved": return colors.cyan;
    case "rejected": return colors.red;
    case "closed": return colors.dim;
    case "deferred": return colors.magenta;
    case "archived": return colors.dim;
    default: return colors.text;
  }
};

export const priorityLabel = (priority: number): string =>
  ["P0", "P1", "P2", "P3", "P4"][Math.min(4, Math.max(0, priority))] ?? `P${priority}`;

export const priorityColor = (priority: number): string => {
  switch (priority) {
    case 0: return colors.red;
    case 1: return colors.yellow;
    default: return colors.dim;
  }
};

/** Single-character state glyphs; blocked wins over everything but closed. */
export const statusGlyph = (status: string, blocked: boolean): string => {
  if (status === "closed") return "✓";
  if (blocked) return "⛔";
  switch (status) {
    case "open": return "⚡";
    case "ready-to-review": return "👀";
    case "approved": return "☑";
    case "rejected": return "✗";
    case "deferred": return "⏸";
    case "archived": return "▦";
    default: return "·";
  }
};

/** Issue-type emoji, beads_viewer style. Unknown types get a neutral page. */
export const typeEmoji = (type: string): string => {
  switch (type) {
    case "task": return "📋";
    case "bug": return "🐛";
    case "feature": return "✨";
    case "epic": return "⛰️";
    case "chore": return "🧹";
    case "docs": return "📝";
    case "question": return "❓";
    case "spike": return "🔬";
    default: return "📄";
  }
};

export const doneDot = (status: string): string => "●";