import { describe, expect, it } from "vitest";
import { countReviewComments, transitionReviewComment, reviewCommentLog } from "../src/operations/review-comments.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach } from "vitest";
import type { Issue } from "@tasks/domain";
import { issueDescription, issueId, issuePriority, issueTitle } from "@tasks/domain";
import { getOrThrow, openSurfaceStore, type SurfaceStore } from "../src/index.js";
import {
  LEGACY_HUNK_COMMENTS_KEY,
  importLegacyHunkComments,
  reviewCommentList,
  reviewCommentListUow,
  reviewComments,
  reviewCommentSendUow,
  reviewCommentSetStatus,
  reviewCommentSetStatusUow,
} from "../src/operations/review-comments.js";

const metadata = { reviewThreads: { version: 1, threads: [{ id: "t1", filePath: "a.ts", line: 2, rootCommentId: "tkr-t1", replyCommentIds: [], resolved: false }] } };

describe("review comment lifecycle (pure)", () => {
  it("counts render N open · K ✓ and allResolved needs at least one comment", () => {
    expect(countReviewComments([]).allResolved).toBe(false);
    const counts = countReviewComments(["open", "sent", "resolved", "dismissed"]);
    expect(counts).toMatchObject({ unresolved: 2, label: "2 open · 1 ✓", allResolved: false });
    expect(countReviewComments(["resolved", "dismissed"]).allResolved).toBe(true);
  });

  it("legacy records read as open, transitions log and mirror resolved", () => {
    const sent = transitionReviewComment(metadata, "t1", "sent", "a", new Date(0))!;
    const resolved = transitionReviewComment(sent, "t1", "resolved", "a", new Date(1))!;
    const thread = (resolved["reviewThreads"] as any).threads[0];
    expect(thread).toMatchObject({ status: "resolved", resolved: true, resolvedBy: "a", sentAt: new Date(0).toISOString() });
    expect(reviewCommentLog(resolved).map((entry) => [entry.from, entry.to])).toEqual([["open", "sent"], ["sent", "resolved"]]);
  });

  it("rejects unknown comments, no-op moves, and sent from non-open", () => {
    expect(transitionReviewComment(metadata, "nope", "resolved", null, new Date())).toBeNull();
    expect(transitionReviewComment(metadata, "t1", "open", null, new Date())).toBeNull();
    const resolved = transitionReviewComment(metadata, "t1", "resolved", null, new Date())!;
    expect(transitionReviewComment(resolved, "t1", "sent", null, new Date())).toBeNull();
  });
});

const legacyComment = (id: string, text: string) => ({ id, issueId: issueId("tk-legacy"), author: "hunk", text, createdAt: new Date(0), wireUnknown: {} });
const legacyIssue = (metadata: Record<string, unknown>, comments = [
  legacyComment("hunk-c1", "[hunk src/a.ts:12] fix this"),
  legacyComment("hunk-c2", "[hunk src/b.ts:? (old)] gone"),
]) => ({ metadata, comments }) as unknown as Issue;

describe("legacy hunk comment import", () => {
  it("imports hunk-synced comments as open review threads and drops the legacy key", () => {
    const next = importLegacyHunkComments(legacyIssue({ [LEGACY_HUNK_COMMENTS_KEY]: ["c1", "c2"] }))!;
    expect(next).not.toBeNull();
    expect(LEGACY_HUNK_COMMENTS_KEY in next).toBe(false);
    expect(next["reviewCommentLog"]).toBeUndefined();
    const registry = next["reviewThreads"] as { version: number; threads: Record<string, unknown>[] };
    expect(registry.version).toBe(1);
    expect(registry.threads).toEqual([
      { id: "hunk-c1", filePath: "src/a.ts", line: 12, side: "new", rootCommentId: "hunk-c1", replyCommentIds: [], resolved: false, status: "open", editedAtByCommentId: {} },
      { id: "hunk-c2", filePath: "src/b.ts", side: "old", rootCommentId: "hunk-c2", replyCommentIds: [], resolved: false, status: "open", editedAtByCommentId: {} },
    ]);
  });

  it("preserves existing threads and registry fields, skips already-rooted and missing comments", () => {
    const existing = { id: "t1", filePath: "x.ts", rootCommentId: "hunk-c1", replyCommentIds: [], resolved: false };
    const next = importLegacyHunkComments(legacyIssue({ hunkComments: ["c1", "c2", "missing"], reviewThreads: { version: 1, extra: "keep", threads: [existing] } }))!;
    const registry = next["reviewThreads"] as { extra: string; threads: Record<string, unknown>[] };
    expect(registry.extra).toBe("keep");
    expect(registry.threads.map((thread) => thread["id"])).toEqual(["t1", "hunk-c2"]);
  });

  it("degrades non-matching text to a file-level (hunk) thread", () => {
    const next = importLegacyHunkComments(legacyIssue({ hunkComments: ["c3"] }, [legacyComment("hunk-c3", "free text")]))!;
    const thread = (next["reviewThreads"] as { threads: Record<string, unknown>[] }).threads[0]!;
    expect(thread).toMatchObject({ id: "hunk-c3", filePath: "(hunk)", status: "open" });
    expect(thread["line"]).toBeUndefined();
  });

  it("keeps everything before the last :<line> for paths containing colons", () => {
    const next = importLegacyHunkComments(legacyIssue({ hunkComments: ["c4"] }, [legacyComment("hunk-c4", "[hunk C:/x/y.ts:7] hi")]))!;
    expect((next["reviewThreads"] as { threads: Record<string, unknown>[] }).threads[0]).toMatchObject({ filePath: "C:/x/y.ts", line: 7 });
  });

  it("returns null without the legacy key, and drops an empty legacy key", () => {
    expect(importLegacyHunkComments(legacyIssue({}))).toBeNull();
    expect(importLegacyHunkComments(legacyIssue({ hunkComments: [], other: 1 }))).toEqual({ other: 1 });
  });

  it("reviewComments shows legacy comments in memory with the prefix stripped", () => {
    const { comments, counts } = reviewComments(legacyIssue({ hunkComments: ["c1", "c2"] }));
    expect(comments.map((card) => [card.id, card.location, card.body])).toEqual([["hunk-c1", "src/a.ts:12", "fix this"], ["hunk-c2", "src/b.ts", "gone"]]);
    expect(counts).toMatchObject({ open: 2, total: 2 });
  });
});

const storeDirs: string[] = [];
afterEach(() => {
  for (const dir of storeDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const seedLegacyIssue = async (store: SurfaceStore): Promise<string> => {
  const id = issueId(`${store.prefix}-${randomBytes(4).toString("hex")}`);
  const now = new Date();
  const comment = (cid: string, text: string) => ({ id: cid, issueId: id, author: "hunk", text, createdAt: now, wireUnknown: {} });
  const comments = [comment("hunk-c1", "[hunk src/a.ts:12] fix this"), comment("hunk-c2", "[hunk src/b.ts:? (old)] gone")];
  const issue: Issue = {
    id, title: issueTitle("legacy"), description: issueDescription(""), status: "open", priority: issuePriority(2), type: "task",
    owner: null, assignee: null, createdBy: store.actor, createdAt: now, updatedAt: now, startedAt: null, closedAt: null, dueAt: null,
    deferUntil: null, parentId: null, sprintId: null, labels: [], notes: null, design: null, acceptanceCriteria: null, estimate: null,
    specId: null, externalRef: null, branch: null, metadata: { hunkComments: ["c1", "c2"] } as Issue["metadata"], attachments: [],
    wireUnknown: {}, dependencies: [], dependencyCount: 0, dependentCount: 0, comments, commentCount: comments.length,
  };
  const outcome = await store.transact(async (uow) => {
    const saved = await uow.save(issue);
    if (!saved.ok) throw new Error(`save failed: ${saved.error.kind}`);
    return issue.id;
  });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
};

const readMetadata = async (store: SurfaceStore, id: string) => {
  const outcome = await store.transact((uow) => getOrThrow(uow, id));
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
};

describe("legacy hunk comment import (store, first read)", () => {
  it("persists on first read, is idempotent, and imported comments resolve", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-legacy-hunk-"));
    storeDirs.push(dir);
    const store = await openSurfaceStore(dir, { actor: "tester" });
    const id = await seedLegacyIssue(store);

    const first = await reviewCommentList(store, id);
    if (!first.ok) throw new Error(first.error.message);
    expect(first.value.counts).toMatchObject({ open: 2 });
    const afterFirst = await readMetadata(store, id);
    expect(afterFirst.metadata["hunkComments"]).toBeUndefined();
    expect((afterFirst.metadata["reviewThreads"] as { threads: unknown[] }).threads).toHaveLength(2);
    expect(afterFirst.comments).toHaveLength(2);

    await reviewCommentList(store, id);
    const afterSecond = await readMetadata(store, id);
    expect(JSON.stringify(afterSecond.metadata)).toBe(JSON.stringify(afterFirst.metadata));

    const resolved = await reviewCommentSetStatus(store, id, "hunk-c1", "resolved");
    if (!resolved.ok) throw new Error(resolved.error.message);
    expect(resolved.value.counts).toMatchObject({ resolved: 1, open: 1 });
  });
});

describe("uow-level lifecycle (caller's transaction, explicit actor)", () => {
  it("setStatus and send in one transaction stamp the given actor on the log and resolvedBy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-review-uow-"));
    storeDirs.push(dir);
    const store = await openSurfaceStore(dir, { actor: "store-actor" });
    const id = await seedLegacyIssue(store);
    const outcome = await store.transact(async (uow) => {
      const listed = await reviewCommentListUow(uow, id);
      const resolved = await reviewCommentSetStatusUow(uow, "cli-actor", id, "hunk-c1", "resolved");
      const sent = await reviewCommentSendUow(uow, "cli-actor", id);
      return { listed, resolved, sent };
    });
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.value.listed.counts).toMatchObject({ open: 2 });
    expect(outcome.value.resolved.counts).toMatchObject({ open: 1, resolved: 1 });
    expect(outcome.value.sent.sent.map((card) => card.id)).toEqual(["hunk-c2"]);
    const issue = await readMetadata(store, id);
    const log = reviewCommentLog(issue.metadata);
    expect(log.map((entry) => [entry.commentId, entry.to, entry.actor])).toEqual([["hunk-c1", "resolved", "cli-actor"], ["hunk-c2", "sent", "cli-actor"]]);
    const thread = (issue.metadata["reviewThreads"] as { threads: Record<string, unknown>[] }).threads.find((entry) => entry["id"] === "hunk-c1")!;
    expect(thread["resolvedBy"]).toBe("cli-actor");
    expect(issue.comments.at(-1)).toMatchObject({ author: "cli-actor" });
  });

  it("unknown comment id throws and writes nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-review-uow-"));
    storeDirs.push(dir);
    const store = await openSurfaceStore(dir, { actor: "store-actor" });
    const id = await seedLegacyIssue(store);
    await reviewCommentList(store, id);
    const outcome = await store.transact((uow) => reviewCommentSetStatusUow(uow, "cli-actor", id, "nope", "resolved"));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toContain("comment not found: nope");
    expect(reviewCommentLog((await readMetadata(store, id)).metadata)).toEqual([]);
  });
});
