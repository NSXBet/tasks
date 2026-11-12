import { describe, expect, it } from "vitest";
import { renderWatchWidgetLines } from "../src/widget.ts";
import { formatEvent } from "../src/watch-manager.ts";
import tasksExtension from "../src/index.ts";

describe("widget rendering", () => {
  const counts = { open: 3, blocked: 2, readyToReview: 5 };
  it("renders a bordered box with per-watcher rows", () => {
    const lines = renderWatchWidgetLines([
      { name: "all", detail: "starting…", seq: 0, startedAt: Date.now() - 65_000, pending: false },
      { name: "ready", detail: "issue.created tk-a", seq: 3, startedAt: Date.now() - 5_000, pending: true },
    ], counts, 60);
    expect(lines.length).toBe(5);
    expect(lines[0]).toContain("Tasks Watch");
    expect(lines[0]).toContain("events");
    expect(lines[1]).toContain("🟢 3 open");
    expect(lines[1]).toContain("⛔ 2 blocked");
    expect(lines[1]).toContain("👀 5 ready-to-review");
    expect(lines[2]).toContain("01:05");
    expect(lines[3]).toContain("seq 3");
    expect(lines[4]!.startsWith("\x1b[38;2;214;158;46m╰")).toBe(true);
  });

  it("renders nothing without rows", () => {
    expect(renderWatchWidgetLines([], null, 60)).toEqual([]);
  });
});

describe("event formatting", () => {
  const at = "2026-08-31T18:47:24.991Z";
  it("formats each log event kind", () => {
    expect(formatEvent({ seq: 1, kind: "task.created", at, issueId: "tk-a", data: { title: "Add login", actor: "yuri" } })).toContain('tk-a created "Add login" by yuri');
    expect(formatEvent({ seq: 2, kind: "task.status", at, issueId: "tk-a", data: { from: "open", to: "ready-to-review" } })).toContain("open → ready-to-review");
    expect(formatEvent({ seq: 3, kind: "task.comment", at, issueId: "tk-a", data: { kind: "note", author: "bob", body: "looks good" } })).toContain("comment — bob: looks good");
    expect(formatEvent({ seq: 4, kind: "task.comment", at, issueId: "tk-a", data: { kind: "review", comment: "c-1", to: "sent", location: "src/a.ts:4", author: "alice", body: "fix" } })).toContain("review comment c-1 → sent src/a.ts:4 — alice: fix");
    expect(formatEvent({ seq: 5, kind: "task.owner", at, issueId: "tk-a", data: { field: "assignee", from: null, to: "bob" } })).toContain("assignee none → bob");
    expect(formatEvent({ seq: 6, kind: "task.update", at, issueId: "tk-a", data: { fields: ["priority", "title"] } })).toContain("updated (priority, title)");
    expect(formatEvent({ seq: 7, kind: "task.evidence", at, issueId: "tk-a", data: { id: "e1", name: "shot.png", mime: "image/png" } })).toContain("evidence shot.png");
    expect(formatEvent({ seq: 8, kind: "task.worktree", at, issueId: "tk-a", data: { path: "/w/tk-a", branch: "tk/tk-a" } })).toContain("worktree tk/tk-a /w/tk-a");
    expect(formatEvent({ seq: 9, kind: "task.deleted", at, issueId: "tk-a", data: { title: "x" } })).toContain("tk-a deleted");
    expect(formatEvent({ seq: 10, kind: "run.changed", at, issueId: "tk-a", data: { runId: "r1", from: "running", to: "done" } })).toContain("run r1 for tk-a — running → done");
  });

  it("strips ANSI escapes and control characters from user text", () => {
    const text = formatEvent({ seq: 1, kind: "task.comment", at, issueId: "tk-a", data: { kind: "note", author: "e\u001b[31mvil", body: "line1\nline2\u0007" } });
    expect(text).toContain("evil: line1 line2");
    expect(text).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });

  it("appends icon counts to event text and still formats legacy kinds", () => {
    const counts = { open: 3, blocked: 2, readyToReview: 5 };
    expect(formatEvent({ seq: 5, kind: "task.update", at, issueId: "tk-a", counts })).toContain("👀 5 ready-to-review");
    expect(formatEvent({ seq: 6, kind: "counts.changed", at, counts })).toContain("🟢 3 open");
    expect(formatEvent({ seq: 7, kind: "ready.changed", at })).toContain("ready set changed");
  });

  it("task.pr renders the PR card; task.report renders the stat card from event data alone (never a diff)", () => {
    const pr = formatEvent({ seq: 11, kind: "task.pr", at, issueId: "tk-a", data: { op: "state", number: 7, url: "https://x/pull/7", state: "merged" } });
    expect(pr).toContain("🔀 tasks: PR #7 for tk-a — merged (https://x/pull/7)");
    const badUrl = formatEvent({ seq: 12, kind: "task.pr", at, issueId: "tk-a", data: { op: "create", number: 7, url: "javascript:alert(1)", state: "open" } });
    expect(badUrl).toContain("PR #7 for tk-a — open");
    expect(badUrl).not.toContain("javascript");
    const head = "a".repeat(40);
    const report = formatEvent(
      { seq: 13, kind: "task.report", at, issueId: "tk-a", data: { changes: { commits: 1, files: 1, additions: 1, deletions: 0 }, head, at: "2026-11-10T00:00:00.000Z" } },
      null,
      "http://127.0.0.1:7878",
    );
    expect(report).toContain("📊 tasks: Changes · tk-a  1 commit · +1 −0 · 1 file");
    expect(report).toContain("http://127.0.0.1:7878/tasks/tk-a/diff");
    expect(report).toContain("tk review tk-a");
    expect(report).not.toContain("stale");
    expect(report).not.toContain("diff --git");
    const malformed = formatEvent({ seq: 14, kind: "task.report", at, issueId: "tk-a", data: { changes: { commits: -1, files: 1, additions: 1, deletions: 0 }, head, at } }, null);
    expect(malformed).toBe("📊 tasks: tk-a report (18:47:24)");
  });
});

describe("tasks tool", () => {
  it("lists the changes(id) op and accepts the task.pr / task.report watch kinds", () => {
    const tools = new Map<string, { description: string; parameters: unknown }>();
    tasksExtension({ on: () => undefined, registerTool: (tool: { name: string; description: string; parameters: unknown }) => { tools.set(tool.name, tool); }, registerCommand: () => undefined, sendUserMessage: () => undefined } as never);
    expect(tools.get("tasks")!.description).toContain("changes(id) → stat card data");
    expect(JSON.stringify(tools.get("tasks")!.parameters)).toContain('"changes"');
    const watch = JSON.stringify(tools.get("tasks_watch_start")!.parameters);
    expect(watch).toContain('"task.pr"');
    expect(watch).toContain('"task.report"');
  });
});
