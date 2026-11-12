/**
 * Comment lifecycle view rules shared by every review surface.
 *
 * The TUI diff view and the web review island both render comments through
 * these rules — which controls a comment offers, its status badge, the
 * `N open · K ✓` / `All resolved` header, and the pending send batch — so the
 * two views agree. Type-only imports keep the module browser-safe (the web
 * island loads it through the `@tasks/review/lifecycle` subpath without
 * pulling the node-backed root index).
 */
import type { ReviewCommentStatus, ReviewThreadCounts } from "./commentStore.js";

/** One lifecycle control on a comment: ✓ done, ✕ remove, or ↺ reopen, and the status it moves to. */
export interface CommentControl {
  readonly key: "done" | "remove" | "reopen";
  readonly label: string;
  readonly to: ReviewCommentStatus;
}

const liveControls: readonly CommentControl[] = [
  { key: "done", label: "✓ done", to: "resolved" },
  { key: "remove", label: "✕ remove", to: "dismissed" },
];

const closedControls: readonly CommentControl[] = [{ key: "reopen", label: "↺ reopen", to: "open" }];

/** Controls offered for a comment: open/sent → ✓ done + ✕ remove; resolved/dismissed → ↺ reopen. Never targets `sent`. */
export function commentControls(status: ReviewCommentStatus): readonly CommentControl[] {
  return status === "resolved" || status === "dismissed" ? closedControls : liveControls;
}

/** Row badge for a stored status: `open`, `→ sent`, `✓ resolved`, `✕ dismissed`. */
export function commentStatusBadge(status: ReviewCommentStatus): string {
  switch (status) {
    case "sent": return "→ sent";
    case "resolved": return "✓ resolved";
    case "dismissed": return "✕ dismissed";
    default: return "open";
  }
}

/** Header label: `All resolved`, `no comments`, or the counts label (`N open · K ✓`). */
export function reviewHeaderLabel(input: { readonly counts: ReviewThreadCounts; readonly allResolved: boolean }): string {
  if (input.allResolved) return "All resolved";
  if (input.counts.total === 0) return "no comments";
  return input.counts.label;
}

/** Comments a send would move to the agent: only `open` ones (sent comments are not re-sent). */
export function sendableCount(counts: ReviewThreadCounts): number {
  return counts.open;
}
