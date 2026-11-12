import { afterEach, describe, expect, it } from "vitest";
import type { IssueBlobAttachment } from "@tasks/domain";
import { formatAttachments } from "../src/presentation.js";
import type { BlobContent } from "@tasks/surface";

const pngBlob = (): BlobContent => ({ meta: { id: "ev-a90101", name: "dot.png", mime: "image/png", size: 4096, sha256: "a".repeat(64) }, bytes: Uint8Array.from([1, 2, 3, 4]) });
const evidence = (): IssueBlobAttachment => ({ kind: "evidence", id: "ev-a90101", name: "dot.png", mime: "image/png", size: 4096, sha256: "a".repeat(64), metadata: {}, wireUnknown: {} });
const inlineBlob = (): IssueBlobAttachment => ({ kind: "inline", id: "ev-b20202", name: "spec.md", mime: "text/markdown", size: 512, sha256: "b".repeat(64), metadata: {}, wireUnknown: {} });

describe("formatAttachments", () => {
  it("splits path refs and ingested blobs into separate attachments and evidences sections", () => {
    const output = formatAttachments([{ path: "log.txt", metadata: {}, wireUnknown: {} }, evidence(), inlineBlob()]);
    expect(output).toContain("ATTACHMENTS:");
    expect(output).toContain("log.txt");
    expect(output).toContain("EVIDENCES (1)");
    expect(output).toContain("dot.png (ev-a90101, 4.0 kB)");
    expect(output).toContain("INLINE (1)");
    expect(output).toContain("inline spec.md (ev-b20202, 0.5 kB)");
  });

  it("appends the inline-image fallback for image evidences when bytes cannot render", () => {
    const output = formatAttachments([evidence()], new Map([["ev-a90101", pngBlob()]]));
    expect(output).toContain("terminal lacks inline-image support");
  });

  it("shows the plain-list note only when image bytes were fetched", () => {
    const output = formatAttachments([evidence()]);
    expect(output).not.toContain("terminal lacks inline-image support");
  });
});

import { IssueSchema } from "@tasks/domain";
import type { ChangesetPayload } from "@tasks/surface";
import { formatShow } from "../src/presentation.js";

const baseIssue = () => IssueSchema.parse({
  id: "tk-chg001", title: "changeset render", description: "", status: "open", priority: 2, type: "task",
  owner: null, assignee: null, createdBy: null, createdAt: new Date(), updatedAt: new Date(),
  startedAt: null, closedAt: null, dueAt: null, deferUntil: null, parentId: null,
  labels: [], notes: null, design: null, acceptanceCriteria: null, estimate: null,
  specId: null, externalRef: null, metadata: {}, dependencies: [], dependencyCount: 0, dependentCount: 0, comments: [], commentCount: 0,
});

const payload = (): ChangesetPayload => ({
  commits: [{ sha: "abc1234", subject: "add feature" }, { sha: "def5678", subject: "fix typo" }],
  files: [{ path: "src/a.ts", status: "A" }, { path: "src/b.ts", status: "M" }, { path: "old.ts", status: "R" }],
  counts: { additions: 12, deletions: 3 },
});

describe("formatShow changeset sections", () => {
  it("renders COMMITS and FILES sections with status codes when derived", () => {
    const issue = IssueSchema.parse({ ...baseIssue(), branch: "tk/tk-chg001", metadata: { changeset: { base: "a".repeat(40) } } });
    const output = formatShow(issue, new Map(), payload());
    expect(output).toContain("COMMITS (2)");
    expect(output).toContain("add feature");
    expect(output).toContain("FILES (3)");
    expect(output).toContain("src/a.ts");
  });

  it("omits both sections when the payload is null (unpinned or decayed)", () => {
    const issue = IssueSchema.parse({ ...baseIssue(), branch: "tk/tk-chg001" });
    const output = formatShow(issue, new Map(), null);
    expect(output).not.toContain("COMMITS");
    expect(output).not.toContain("FILES (");
  });

  it("omits empty sections individually", () => {
    const issue = IssueSchema.parse({ ...baseIssue(), branch: "tk/tk-chg001", metadata: { changeset: { base: "a".repeat(40) } } });
    const output = formatShow(issue, new Map(), { commits: [], files: [], counts: { additions: 0, deletions: 0 } });
    expect(output).not.toContain("COMMITS");
    expect(output).not.toContain("FILES (");
  });
});

describe("formatShow review record", () => {
  it("renders agent line, both doors and the comments row", () => {
    const issue = { ...baseIssue(), metadata: { agent_session: "sess-9", agent_harness: "codex", finished_at: "2026-11-10T09:30:00.000Z", reviewThreads: { version: 1, threads: [{ resolved: true }, { resolved: false }] } } };
    const output = formatShow(issue, new Map(), null, { tui: "tk review tk-chg001", web: "http://localhost:9/tasks/tk-chg001" });
    expect(output).toContain("agent codex · session sess-9 finished 2026-11-10 09:30");
    expect(output).toContain("tk review tk-chg001");
    expect(output).toContain("http://localhost:9/tasks/tk-chg001");
    expect(output).toContain("comments 0 · 1 open 1 ✓");
  });
  it("omits the agent line before finish but keeps doors and comments", () => {
    const output = formatShow(baseIssue());
    expect(output).not.toContain("agent ");
    expect(output).toContain("tk review tk-chg001");
    expect(output).toContain("comments 0 · 0 open 0 ✓");
    expect(output).not.toContain("REVIEW (");
  });

  const thread = (id: string, filePath: string, status: string, line?: number) => ({
    id, filePath, ...(line === undefined ? {} : { line }), rootCommentId: `tkr-${id}`, replyCommentIds: [], resolved: status === "resolved", status, editedAtByCommentId: {},
  });
  const comment = (id: string, location: string, text: string) => ({ id: `tkr-${id}`, issueId: "tk-chg001", author: "reviewer", text: `[review ${location}] ${text}`, createdAt: new Date(), wireUnknown: {} });
  const reviewed = (statuses: readonly [string, string]) => IssueSchema.parse({
    ...baseIssue(),
    metadata: { reviewThreads: { version: 1, threads: [thread("t1", "a.ts", statuses[0], 2), thread("t2", "b.ts", statuses[1])] } },
    comments: [comment("t1", "a.ts:2", "first note\nsecond line"), comment("t2", "b.ts", "file \u001b[31mnote")],
    commentCount: 2,
  });

  it("lists review comments with status glyphs and header counts", () => {
    const output = formatShow(reviewed(["resolved", "open"]));
    const section = output.slice(output.indexOf("REVIEW ("), output.indexOf("DESCRIPTION"));
    expect(section).toContain("REVIEW (2) · 1 open · 1 ✓");
    expect(section).toContain("✓ a.ts:2  reviewer  first note");
    expect(section).not.toContain("second line");
    expect(section).toContain("○ b.ts  reviewer  file [31mnote");
    expect(section).not.toContain("\u001b");
    expect(output).toContain("comments 2 · 1 open 1 ✓");
  });
  it("renders All resolved in the header and the comments row once nothing is open or sent", () => {
    const output = formatShow(reviewed(["resolved", "resolved"]));
    expect(output).toContain("REVIEW (2) · All resolved");
    expect(output).toContain("comments 2 · All resolved · 2 ✓");
    expect(output).toContain("✓ b.ts");
  });
  it("treats dismissed as settled and sent as open", () => {
    const dismissed = formatShow(reviewed(["dismissed", "dismissed"]));
    expect(dismissed).toContain("REVIEW (2) · All resolved");
    expect(dismissed).toContain("– a.ts:2");
    expect(dismissed).toContain("comments 2 · All resolved · 0 ✓");
    const sent = formatShow(reviewed(["sent", "resolved"]));
    expect(sent).toContain("REVIEW (2) · 1 open · 1 ✓");
    expect(sent).toContain("→ a.ts:2");
  });
});

import { formatBlocked, formatSearch, formatStale } from "../src/presentation.js";

describe("list-family doors footer (D-02)", () => {
  const blocker = () => IssueSchema.parse({ ...baseIssue(), id: "tk-blk001", title: "blocker" });
  const blocked = () => IssueSchema.parse({ ...baseIssue(), id: "tk-bkd001", title: "blocked", dependencies: [{ issueId: "tk-bkd001", type: "blocks", target: "tk-blk001", createdAt: new Date(), createdBy: null, metadata: {}, wireUnknown: {} }], dependencyCount: 1 });
  const doorsLine = (output: string) => output.split("\n").at(-1) ?? "";

  it("formatSearch ends with the doors when given a base, unchanged without", () => {
    const bare = formatSearch([baseIssue()], "x");
    const withBase = formatSearch([baseIssue()], "x", "http://h:1");
    expect(doorsLine(withBase)).toContain("tk review <id>");
    expect(doorsLine(withBase)).toContain("http://h:1/tasks/<id>");
    expect(withBase.startsWith(`${bare}\n\n`)).toBe(true);
    expect(bare).not.toContain("tk review");
  });
  it("formatBlocked ends with the doors when given a base, unchanged without", () => {
    const all = [blocker(), blocked()];
    const bare = formatBlocked([blocked()], all);
    const withBase = formatBlocked([blocked()], all, "http://h:1");
    expect(doorsLine(withBase)).toContain("tk review <id>");
    expect(doorsLine(withBase)).toContain("http://h:1/tasks/<id>");
    expect(withBase.startsWith(`${bare}\n\n`)).toBe(true);
    expect(bare).not.toContain("tk review");
  });
  it("formatStale ends with the doors when given a base, unchanged without", () => {
    const bare = formatStale([baseIssue()], 14);
    const withBase = formatStale([baseIssue()], 14, "http://h:1");
    expect(doorsLine(withBase)).toContain("tk review <id>");
    expect(doorsLine(withBase)).toContain("http://h:1/tasks/<id>");
    expect(withBase.startsWith(`${bare}\n\n`)).toBe(true);
    expect(bare).not.toContain("tk review");
  });
  it("empty results get no footer", () => {
    expect(formatSearch([], "x", "http://h:1")).not.toContain("tk review");
    expect(formatBlocked([], [], "http://h:1")).not.toContain("tk review");
    expect(formatStale([], 14, "http://h:1")).not.toContain("tk review");
  });
});
