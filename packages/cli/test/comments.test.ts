import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-comments-")); workspaces.push(value); return value; }
function run(directory: string, args: readonly string[], input?: string): { readonly stdout: string; readonly stderr: string; readonly status: number } { const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdin: input === undefined ? undefined : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1", USER: "reviewer" } }); return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode }; }
function json<T>(directory: string, args: readonly string[], input?: string): T { const result = run(directory, [...args, "--json"], input); expect(result.status, result.stderr).toBe(0); return JSON.parse(result.stdout) as T; }
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

interface Card { readonly id: string; readonly location: string; readonly evidence: string | null; readonly author: string; readonly body: string; readonly status: string }
interface Counts { readonly open: number; readonly sent: number; readonly resolved: number; readonly label: string; readonly allResolved: boolean }
interface ListResult { readonly comments: readonly Card[]; readonly counts: Counts }
interface SendResult { readonly sent: readonly Card[]; readonly counts: Counts }
interface Shown { readonly comments: readonly { text: string }[]; readonly metadata: Record<string, unknown>; readonly review: { readonly counts: Counts } }

/** A task with three review comments: t1 (src/a.ts:4, open), t2 (evidence:shot, open), t3 (src/b.ts, resolved). */
function seeded(): { readonly directory: string; readonly id: string } {
  const directory = workspace();
  json(directory, ["init", "--prefix", "tk"]);
  const { id } = json<{ id: string }>(directory, ["create", "review me"]);
  const wire = json<readonly Record<string, unknown>[]>(directory, ["export"])[0]!;
  const at = wire["created_at"];
  const root = (cid: string, text: string) => ({ id: cid, issue_id: id, author: "alice", text, created_at: at });
  wire["metadata"] = { reviewThreads: { version: 1, threads: [
    { id: "t1", filePath: "src/a.ts", line: 4, status: "open", rootCommentId: "tkr-t1", replyCommentIds: [] },
    { id: "t2", filePath: "evidence:shot", evidenceId: "shot", status: "open", rootCommentId: "tkr-t2", replyCommentIds: [] },
    { id: "t3", filePath: "src/b.ts", status: "resolved", resolved: true, rootCommentId: "tkr-t3", replyCommentIds: [] },
  ] } };
  wire["comments"] = [root("tkr-t1", "[review src/a.ts:4] fix this"), root("tkr-t2", "[review evidence:shot] wrong colour"), root("tkr-t3", "[review src/b.ts] fine")];
  wire["comment_count"] = 3;
  json(directory, ["import"], JSON.stringify(wire));
  return { directory, id };
}
const show = (directory: string, id: string): Shown => json<readonly Shown[]>(directory, ["show", id])[0]!;
const logLength = (directory: string, id: string): number => ((show(directory, id).metadata["reviewCommentLog"] as unknown[] | undefined) ?? []).length;

describe("tk comments", () => {
  it("lists review comments with locations as data and in the human view", () => {
    const { directory, id } = seeded();
    const listed = json<ListResult>(directory, ["comments", id]);
    expect(listed.comments).toHaveLength(3);
    expect(listed.comments.find((card) => card.id === "t1")).toMatchObject({ location: "src/a.ts:4", body: "fix this", status: "open", author: "alice" });
    expect(listed.comments.find((card) => card.id === "t2")).toMatchObject({ location: "evidence:shot", evidence: "shot" });
    expect(listed.counts.label).toBe("2 open · 1 ✓");
    const human = run(directory, ["comments", id]);
    expect(human.status, human.stderr).toBe(0);
    for (const text of ["REVIEW (3) · 2 open · 1 ✓", "t1", "src/a.ts:4", "fix this", "evidence:shot"]) expect(human.stdout).toContain(text);
  });

  it("send batches every open comment into cards once and records it", () => {
    const { directory, id } = seeded();
    const sent = json<SendResult>(directory, ["comments", "send", id]);
    expect(sent.sent.map((card) => card.id)).toEqual(["t1", "t2"]);
    for (const card of sent.sent) { expect(card.location).toBeTruthy(); expect(card.author).toBe("alice"); expect(card.body).toBeTruthy(); }
    expect(sent.counts.sent).toBe(2);
    expect(json<SendResult>(directory, ["comments", "send", id]).sent).toEqual([]);
    const after = show(directory, id);
    expect(after.review.counts.sent).toBe(2);
    const log = after.metadata["reviewCommentLog"] as { to: string; actor: string }[];
    expect(log.map((entry) => entry.to)).toEqual(["sent", "sent"]);
    expect(after.comments.filter((comment) => comment.text.startsWith("[review sent] 2 comments"))).toHaveLength(1);
  });

  it("send in verb-second order sends only the named ids; unknown ids fail without writing", () => {
    const { directory, id } = seeded();
    const failed = run(directory, ["comments", "send", id, "nope", "--json"]);
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain("comment not found: nope");
    expect(logLength(directory, id)).toBe(0);
    const human = run(directory, ["comments", id, "send", "t2"]);
    expect(human.status, human.stderr).toBe(0);
    expect(human.stdout).toContain("Sent 1 comment(s) to the agent");
    expect(human.stdout).toContain("evidence:shot");
    expect(json<ListResult>(directory, ["comments", id]).comments.find((card) => card.id === "t1")!.status).toBe("open");
  });

  it("resolve, dismiss and reopen move one comment each and log one transition", () => {
    const { directory, id } = seeded();
    const resolved = json<ListResult>(directory, ["comments", "resolve", id, "t1"]);
    expect(resolved.comments.find((card) => card.id === "t1")!.status).toBe("resolved");
    expect(resolved.counts.label).toBe("1 open · 2 ✓");
    const dismissed = run(directory, ["comments", id, "dismiss", "t2"]);
    expect(dismissed.status, dismissed.stderr).toBe(0);
    expect(dismissed.stdout).toContain("✕ Dismissed t2");
    expect(dismissed.stdout).toContain("REVIEW (3) · All resolved");
    expect(run(directory, ["comments", id]).stdout).toContain("REVIEW (3) · All resolved");
    const reopened = json<ListResult>(directory, ["comments", "reopen", id, "t1"]);
    expect(reopened.comments.find((card) => card.id === "t1")!.status).toBe("open");
    // ✓ counts resolved only (countReviewComments): t3 resolved, t2 dismissed, t1 open again.
    expect(reopened.counts.label).toBe("1 open · 1 ✓");
    const log = show(directory, id).metadata["reviewCommentLog"] as { commentId: string; from: string; to: string; actor: string }[];
    expect(log.map((entry) => [entry.commentId, entry.from, entry.to])).toEqual([["t1", "open", "resolved"], ["t2", "open", "dismissed"], ["t1", "resolved", "open"]]);
    expect(log.every((entry) => entry.actor === "reviewer")).toBe(true);
  });

  it("unknown, missing and extra comment ids fail without writing", () => {
    const { directory, id } = seeded();
    const unknown = run(directory, ["comments", "resolve", id, "nope", "--json"]);
    expect(unknown.status).not.toBe(0);
    expect(unknown.stderr).toContain("comment not found: nope");
    const missing = run(directory, ["comments", "resolve", id]);
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("comments resolve requires a comment id");
    const extra = run(directory, ["comments", "dismiss", id, "t1", "t2"]);
    expect(extra.status).not.toBe(0);
    expect(extra.stderr).toContain("comments dismiss takes one comment id");
    const noId = run(directory, ["comments"]);
    expect(noId.status).not.toBe(0);
    expect(noId.stderr).toContain("comments requires issue id");
    expect(logLength(directory, id)).toBe(0);
  });

  it("an issue without review comments lists empty", () => {
    const directory = workspace();
    json(directory, ["init", "--prefix", "tk"]);
    const { id } = json<{ id: string }>(directory, ["create", "plain"]);
    expect(json<ListResult>(directory, ["comments", id]).comments).toEqual([]);
    expect(run(directory, ["comments", id]).stdout).toContain(`No review comments on ${id}`);
    expect(run(directory, ["comments", "send", id]).stdout).toContain(`Nothing open to send on ${id}`);
  });
});
