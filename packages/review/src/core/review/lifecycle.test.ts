import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reviewCommentStatuses, type ReviewThreadCounts } from "./commentStore";
import { commentControls, commentStatusBadge, reviewHeaderLabel, sendableCount } from "./lifecycle";

/** Counts with the `N open · K ✓` label derived as reviewThreadCounts does. */
function counts(partial: Partial<Pick<ReviewThreadCounts, "open" | "sent" | "resolved" | "dismissed">>): ReviewThreadCounts {
  const open = partial.open ?? 0;
  const sent = partial.sent ?? 0;
  const resolved = partial.resolved ?? 0;
  const dismissed = partial.dismissed ?? 0;
  return { total: open + sent + resolved + dismissed, open, sent, resolved, dismissed, unresolved: open + sent, label: `${open + sent} open · ${resolved} ✓` };
}

describe("comment lifecycle rules", () => {
  test("open and sent comments offer ✓ done and ✕ remove", () => {
    for (const status of ["open", "sent"] as const) {
      const controls = commentControls(status);
      expect(controls.map((control) => control.key)).toEqual(["done", "remove"]);
      expect(controls.map((control) => control.to)).toEqual(["resolved", "dismissed"]);
      expect(controls.map((control) => control.label)).toEqual(["✓ done", "✕ remove"]);
    }
  });

  test("resolved and dismissed comments offer only reopen", () => {
    for (const status of ["resolved", "dismissed"] as const) {
      expect(commentControls(status).map(({ key, to }) => ({ key, to }))).toEqual([{ key: "reopen", to: "open" }]);
    }
  });

  test("no control ever targets sent", () => {
    for (const status of reviewCommentStatuses) {
      expect(commentControls(status).some((control) => control.to === "sent")).toBe(false);
    }
  });

  test("status badges", () => {
    expect(reviewCommentStatuses.map(commentStatusBadge)).toEqual(["open", "→ sent", "✓ resolved", "✕ dismissed"]);
  });

  test("header label", () => {
    expect(reviewHeaderLabel({ counts: counts({}), allResolved: false })).toBe("no comments");
    expect(reviewHeaderLabel({ counts: counts({ resolved: 1, dismissed: 1 }), allResolved: true })).toBe("All resolved");
    expect(reviewHeaderLabel({ counts: counts({ open: 1, sent: 1, resolved: 1 }), allResolved: false })).toBe("2 open · 1 ✓");
  });

  test("sendableCount counts only open comments", () => {
    expect(sendableCount(counts({ open: 2, sent: 3, resolved: 1 }))).toBe(2);
    expect(sendableCount(counts({ sent: 3 }))).toBe(0);
  });

  test("the module has only type imports (browser-safe)", () => {
    const source = readFileSync(join(import.meta.dir, "lifecycle.ts"), "utf8");
    const runtimeImports = source.split("\n").filter((line) => /^import\b/.test(line) && !/^import type\b/.test(line));
    expect(runtimeImports).toEqual([]);
  });
});
