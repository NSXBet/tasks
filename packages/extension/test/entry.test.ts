import { describe, expect, it } from "vitest";
import { renderWatchWidgetLines } from "../src/widget.js";
import { formatEvent } from "../src/watch-manager.js";

describe("widget rendering", () => {
  it("renders a bordered box with per-watcher rows", () => {
    const lines = renderWatchWidgetLines([
      { name: "all", detail: "starting…", seq: 0, startedAt: Date.now() - 65_000, pending: false },
      { name: "ready", detail: "issue.created tk-a", seq: 3, startedAt: Date.now() - 5_000, pending: true },
    ], 60);
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain("Tasks Watch");
    expect(lines[0]).toContain("events");
    expect(lines[1]).toContain("01:05");
    expect(lines[2]).toContain("seq 3");
    expect(lines[3]!.startsWith("\x1b[38;2;214;158;46m╰")).toBe(true);
  });

  it("renders nothing without rows", () => {
    expect(renderWatchWidgetLines([], 60)).toEqual([]);
  });
});

describe("event formatting", () => {
  it("formats each event kind", () => {
    const at = "2026-08-31T18:47:24.991Z";
    expect(formatEvent({ seq: 1, kind: "issue.created", at, issueId: "tk-a" })).toContain("tk-a created");
    expect(formatEvent({ seq: 2, kind: "issue.status_changed", at, issueId: "tk-a" })).toContain("status changed");
    expect(formatEvent({ seq: 3, kind: "ready.changed", at })).toContain("ready set changed");
    expect(formatEvent({ seq: 4, kind: "issue.deleted", at, issueId: "tk-a" })).toContain("deleted");
  });
});
