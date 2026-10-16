import { afterEach, describe, expect, it } from "vitest";
import type { IssueBlobAttachment } from "@tasks/domain";
import { formatAttachments, terminalImageEscape } from "../src/presentation.js";
import type { BlobContent } from "@tasks/surface";

const pngBlob = (): BlobContent => ({ meta: { id: "ev-a90101", name: "dot.png", mime: "image/png", size: 4096, sha256: "a".repeat(64) }, bytes: Uint8Array.from([1, 2, 3, 4]) });
const evidence = (): IssueBlobAttachment => ({ kind: "evidence", id: "ev-a90101", name: "dot.png", mime: "image/png", size: 4096, sha256: "a".repeat(64), metadata: {}, wireUnknown: {} });
const inlineBlob = (): IssueBlobAttachment => ({ kind: "inline", id: "ev-b20202", name: "spec.md", mime: "text/markdown", size: 512, sha256: "b".repeat(64), metadata: {}, wireUnknown: {} });

/** Swaps process.stdout's isTTY for the fn duration, then restores the original descriptor. */
const withTty = (value: boolean | undefined, fn: () => void): void => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true, writable: true, enumerable: true });
  try { fn(); } finally {
    if (descriptor === undefined) Object.defineProperty(process.stdout, "isTTY", { value: undefined, configurable: true, writable: true, enumerable: true });
    else Object.defineProperty(process.stdout, "isTTY", descriptor);
  }
};

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

describe("terminalImageEscape", () => {
  afterEach(() => { delete process.env["KITTY_WINDOW_ID"]; delete process.env["TERM_PROGRAM"]; delete process.env["GHOSTTY_RESOURCES_DIR"]; });

  it("returns null when stdout is not a tty (agents, pipes)", () => {
    withTty(undefined, () => {
      expect(terminalImageEscape(pngBlob())).toBeNull();
    });
  });

  it("emits a terminated kitty graphics escape on kitty-class terminals", () => {
    process.env["KITTY_WINDOW_ID"] = "1";
    withTty(true, () => {
      const escape = terminalImageEscape(pngBlob());
      expect(escape).toContain("\x1b_Gf=100,t=f,q=1;");
      expect(escape?.endsWith("\x1b\\")).toBe(true);
    });
  });

  it("emits the osc1337 file escape on iTerm-style terminals", () => {
    process.env["TERM_PROGRAM"] = "iTerm.app";
    withTty(true, () => {
      const escape = terminalImageEscape(pngBlob());
      expect(escape).toContain("\x1b]1337;File=name=");
      expect(escape?.endsWith("\x1b\\")).toBe(true);
    });
  });
});
