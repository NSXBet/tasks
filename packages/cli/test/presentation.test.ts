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
