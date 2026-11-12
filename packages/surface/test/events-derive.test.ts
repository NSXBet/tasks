import { describe, expect, it } from "vitest";
import type { Issue, Run } from "@tasks/domain";
import { issueId } from "@tasks/domain";
import { deriveIssueEvents, deriveRunEvent } from "../src/events/derive.js";
import { transitionReviewComment } from "../src/operations/review-comments.js";

const ID = issueId("tk-ev1");
const base = (patch: Partial<Record<keyof Issue, unknown>> = {}): Issue => ({
  id: ID, title: "T", description: "", status: "open", priority: 2, type: "task", owner: null, assignee: null, createdBy: "me",
  createdAt: new Date(0), updatedAt: new Date(0), startedAt: null, closedAt: null, dueAt: null, deferUntil: null, parentId: null, sprintId: null,
  labels: [], notes: null, design: null, acceptanceCriteria: null, estimate: null, specId: null, externalRef: null, branch: null,
  metadata: {}, attachments: [], wireUnknown: {}, dependencies: [], dependencyCount: 0, dependentCount: 0, comments: [], commentCount: 0,
  ...patch,
}) as unknown as Issue;
const comment = (id: string, text: string, wireUnknown: Record<string, unknown> = {}) => ({ id, issueId: ID, author: "ann", text, createdAt: new Date(1), wireUnknown });
const types = (before: Issue | null, after: Issue | null) => deriveIssueEvents(before, after).map((event) => event.type);

/** Issue with N open review threads, each rooted on a `[review file:line]` comment. */
const withThreads = (n: number): Issue => {
  const threads = Array.from({ length: n }, (_, index) => ({ id: `t${index}`, filePath: `f${index}.ts`, line: index + 1, rootCommentId: `r${index}`, replyCommentIds: [], status: "open", resolved: false }));
  const comments = threads.map((thread, index) => comment(thread.rootCommentId, `[review f${index}.ts:${index + 1}] body ${index}`, { reviewThread: thread.id }));
  return base({ metadata: { reviewThreads: { version: 1, threads } }, comments, commentCount: comments.length });
};

describe("deriveIssueEvents", () => {
  it("created and deleted", () => {
    const issue = base({ owner: "o" });
    expect(deriveIssueEvents(null, issue)).toEqual([{ task: ID, type: "task.created", data: { title: "T", status: "open", owner: "o", assignee: null } }]);
    expect(deriveIssueEvents(issue, null)).toEqual([{ task: ID, type: "task.deleted", data: { title: "T" } }]);
    expect(deriveIssueEvents(null, null)).toEqual([]);
  });

  it("status moves, approvals, finish and refinish", () => {
    expect(deriveIssueEvents(base(), base({ status: "approved" }))).toEqual([{ task: ID, type: "task.status", data: { from: "open", to: "approved" } }]);
    const finished = base({ status: "ready-to-review", metadata: { agent_session: "s-1", finished_at: "2026-01-01T00:00:00.000Z" } });
    expect(deriveIssueEvents(base({ status: "in-progress" }), finished)).toEqual([
      { task: ID, type: "task.status", data: { from: "in-progress", to: "ready-to-review", session: "s-1", finishedAt: "2026-01-01T00:00:00.000Z" } },
    ]);
    const again = base({ status: "ready-to-review", metadata: { agent_session: "s-2", finished_at: "2026-01-02T00:00:00.000Z" } });
    expect(deriveIssueEvents(finished, again)).toEqual([
      { task: ID, type: "task.status", data: { from: "ready-to-review", to: "ready-to-review", session: "s-2", finishedAt: "2026-01-02T00:00:00.000Z", refinish: true } },
    ]);
  });

  it("owner and assignee are separate task.owner events", () => {
    expect(deriveIssueEvents(base(), base({ owner: "a", assignee: "b" }))).toEqual([
      { task: ID, type: "task.owner", data: { field: "owner", from: null, to: "a" } },
      { task: ID, type: "task.owner", data: { field: "assignee", from: null, to: "b" } },
    ]);
  });

  it("plain comments are notes; review-thread and [review comments are not", () => {
    const after = base({ comments: [comment("c1", "hello"), comment("c2", "[review a.ts:1] x"), comment("c3", "thread root", { reviewThread: "t" })] });
    expect(deriveIssueEvents(base(), after)).toEqual([{ task: ID, type: "task.comment", data: { kind: "note", comment: "c1", author: "ann", body: "hello" } }]);
  });

  it("a 3-card send yields three sent review events with location/author/body and no note", () => {
    const before = withThreads(3);
    let metadata: Record<string, unknown> = { ...before.metadata };
    for (const id of ["t0", "t1", "t2"]) metadata = transitionReviewComment(metadata, id, "sent", "rev", new Date(5))!;
    const summary = comment("s1", "[review sent] 3 comments");
    const after = { ...before, metadata, comments: [...before.comments, summary] } as Issue;
    const events = deriveIssueEvents(before, after);
    expect(events.map((event) => event.type)).toEqual(["task.comment", "task.comment", "task.comment"]);
    expect(events.map((event) => event.data)).toEqual([0, 1, 2].map((index) => ({
      kind: "review", comment: `t${index}`, from: "open", to: "sent", actor: "rev", file: `f${index}.ts`, line: index + 1,
      location: `f${index}.ts:${index + 1}`, author: "ann", body: `body ${index}`,
    })));
  });

  it("review entry for a missing card carries null location/author/body", () => {
    const before = base({ metadata: { reviewCommentLog: [{ n: 1, commentId: "x", from: null, to: "open", actor: null, at: "", file: null, line: null }] } });
    const after = base({ metadata: { reviewCommentLog: [...(before.metadata["reviewCommentLog"] as unknown[]), { n: 2, commentId: "gone", from: "open", to: "resolved", actor: "a", at: "", file: "z", line: 3 }] } });
    expect(deriveIssueEvents(before, after)).toEqual([{ task: ID, type: "task.comment", data: { kind: "review", comment: "gone", from: "open", to: "resolved", actor: "a", file: "z", line: 3, location: null, author: null, body: null } }]);
  });

  it("evidence blobs emit task.evidence; inline blobs are ignored", () => {
    const blob = (kind: string, id: string) => ({ kind, id, name: `${id}.png`, mime: "image/png", size: 1, sha256: "0".repeat(64), metadata: {}, wireUnknown: {} });
    const after = base({ attachments: [blob("evidence", "e1"), blob("inline", "i1")] });
    expect(deriveIssueEvents(base(), after)).toEqual([{ task: ID, type: "task.evidence", data: { id: "e1", name: "e1.png", mime: "image/png" } }]);
  });

  it("worktree or branch change emits task.worktree", () => {
    expect(deriveIssueEvents(base(), base({ branch: "tk/x", metadata: { worktree: "/w" } }))).toEqual([{ task: ID, type: "task.worktree", data: { path: "/w", branch: "tk/x" } }]);
  });

  it("a new metadata.report stamp emits one task.report carrying the stat card data; an identical one emits nothing", () => {
    const report = { changes: { commits: 1, files: 1, additions: 1, deletions: 0 }, head: "a".repeat(40), at: "2026-11-10T00:00:00.000Z" };
    expect(deriveIssueEvents(base(), base({ metadata: { report } }))).toEqual([{ task: ID, type: "task.report", data: report }]);
    expect(deriveIssueEvents(base({ metadata: { report } }), base({ metadata: { report: { ...report } } }))).toEqual([]);
    // A restamp that only moves `at` (e.g. tk pr sync with unchanged counts and head) emits nothing.
    expect(deriveIssueEvents(base({ metadata: { report } }), base({ metadata: { report: { ...report, at: "2026-11-12T00:00:00.000Z" } } }))).toEqual([]);
    const restamped = { ...report, changes: { ...report.changes, commits: 2 }, at: "2026-11-11T00:00:00.000Z" };
    expect(deriveIssueEvents(base({ metadata: { report } }), base({ metadata: { report: restamped } }))).toEqual([{ task: ID, type: "task.report", data: restamped }]);
    // A malformed stamp (negative count) is not a report.
    expect(types(base(), base({ metadata: { report: { ...report, changes: { ...report.changes, files: -1 } } } }))).toEqual([]);
  });

  describe("task.pr (metadata.pr)", () => {
    const url = "https://github.com/o/r/pull/7";
    const pr = (patch: Record<string, unknown> = {}) => ({ number: 7, url, state: "open", ...patch });
    const withPr = (value: unknown, branch: string | null = "tk/tk-ev1") => base({ branch, metadata: value === undefined ? {} : { pr: value } });

    it("a first PR is op create with the task branch as head, and never a task.update", () => {
      expect(deriveIssueEvents(withPr(undefined), withPr(pr()))).toEqual([
        { task: ID, type: "task.pr", data: { op: "create", number: 7, url, state: "open", head: "tk/tk-ev1" } },
      ]);
    });

    it("state moves: open → merged is op state, open → closed is op close, a new number is op create", () => {
      expect(deriveIssueEvents(withPr(pr()), withPr(pr({ state: "merged" })))[0]!.data).toEqual({ op: "state", number: 7, url, state: "merged", head: "tk/tk-ev1" });
      expect(deriveIssueEvents(withPr(pr()), withPr(pr({ state: "closed" })))[0]!.data).toMatchObject({ op: "close", state: "closed" });
      expect(deriveIssueEvents(withPr(pr({ state: "closed" })), withPr(pr({ state: "open" })))[0]!.data).toMatchObject({ op: "state", state: "open" });
      expect(deriveIssueEvents(withPr(pr({ state: "closed" })), withPr(pr({ number: 8, url: "https://github.com/o/r/pull/8" })))[0]!.data).toMatchObject({ op: "create", number: 8 });
    });

    it("url-only, unchanged and invalid records emit nothing", () => {
      expect(types(withPr(pr()), withPr(pr({ url: "https://github.com/o/r2/pull/7" })))).toEqual([]);
      expect(types(withPr(pr()), withPr(pr()))).toEqual([]);
      expect(types(withPr(undefined), withPr(pr({ number: 0 })))).toEqual([]);
      expect(types(withPr(undefined), withPr(pr({ url: "javascript:alert(1)" })))).toEqual([]);
      expect(types(withPr(pr()), withPr(undefined))).toEqual([]);
    });

    it("a finish-shaped save is [task.status, task.report]; a pr save restamping unchanged counts is [task.pr] only; no task.update", () => {
      const report = { changes: { commits: 1, files: 1, additions: 1, deletions: 0 }, head: "b".repeat(40), at: "2026-11-10T00:00:00.000Z" };
      const finished = base({ status: "ready-to-review", branch: "tk/tk-ev1", metadata: { agent_session: "s-1", finished_at: report.at, report } });
      expect(types(base({ status: "in-progress", branch: "tk/tk-ev1" }), finished)).toEqual(["task.status", "task.report"]);
      const created = base({ status: "ready-to-review", branch: "tk/tk-ev1", metadata: { agent_session: "s-1", finished_at: report.at, report: { ...report, at: "2026-11-10T00:00:01.000Z" }, pr: pr() } });
      expect(types(finished, created)).toEqual(["task.pr"]);
      const moved = base({ status: "ready-to-review", branch: "tk/tk-ev1", metadata: { agent_session: "s-1", finished_at: report.at, report: { ...report, changes: { ...report.changes, commits: 2 }, at: "2026-11-10T00:00:02.000Z" }, pr: pr() } });
      expect(types(created, moved)).toEqual(["task.report"]);
    });
  });

  it("other fields collapse into one sorted task.update; covered fields and timestamps never appear", () => {
    const after = base({
      title: "T2", priority: 1, labels: ["x"], notes: "n", dependencies: [{ issueId: ID, target: { kind: "issue", id: "tk-2" }, type: "blocks", createdAt: new Date(0), createdBy: null, metadata: {}, wireUnknown: {} }],
      metadata: { custom: 1, worktree: "/w", reviewCommentLog: [] }, branch: "b", updatedAt: new Date(9), startedAt: new Date(9), closedAt: new Date(9), commentCount: 4,
    });
    const events = deriveIssueEvents(base(), after);
    expect(events.map((event) => event.type)).toEqual(["task.worktree", "task.update"]);
    expect(events[1]!.data).toEqual({ fields: ["dependencies", "labels", "metadata.custom", "notes", "priority", "title"] });
    expect(types(base(), base({ updatedAt: new Date(9), commentCount: 3 }))).toEqual([]);
    expect(types(base({ labels: ["a", "b"] }), base({ labels: ["b", "a"] }))).toEqual([]);
  });

  it("orders created < status < owner < comment < evidence < worktree < pr < report < update", () => {
    const blob = { kind: "evidence", id: "e1", name: "e", mime: "text/plain", size: 1, sha256: "0".repeat(64), metadata: {}, wireUnknown: {} };
    const metadata = {
      pr: { number: 7, url: "https://x/pull/7", state: "open" },
      report: { changes: { commits: 1, files: 1, additions: 1, deletions: 0 }, head: "c".repeat(40), at: "2026-11-10T00:00:00.000Z" },
    };
    const after = base({ status: "in-progress", owner: "o", comments: [comment("c1", "hi")], attachments: [blob], branch: "b", title: "X", metadata });
    expect(types(base(), after)).toEqual(["task.status", "task.owner", "task.comment", "task.evidence", "task.worktree", "task.pr", "task.report", "task.update"]);
  });
});

describe("deriveRunEvent", () => {
  const run = (state: string) => ({ id: "run-1", issueId: ID, state }) as unknown as Run;
  it("new run and state moves emit run.changed; same state emits nothing", () => {
    expect(deriveRunEvent(null, run("running"))).toEqual([{ task: ID, type: "run.changed", data: { runId: "run-1", from: null, to: "running" } }]);
    expect(deriveRunEvent(run("running"), run("done"))).toEqual([{ task: ID, type: "run.changed", data: { runId: "run-1", from: "running", to: "done" } }]);
    expect(deriveRunEvent(run("done"), run("done"))).toEqual([]);
  });
});
