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
