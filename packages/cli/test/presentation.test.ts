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

  it("emits a single terminated m=0 kitty graphics escape for small images", () => {
    process.env["KITTY_WINDOW_ID"] = "1";
    withTty(true, () => {
      const escape = terminalImageEscape(pngBlob());
      expect(escape).toBe("\x1b_Gf=100,t=d,q=1,m=0;" + Buffer.from(pngBlob().bytes).toString("base64") + "\x1b\\");
    });
  });

  it("chunks large kitty payloads at 4096 base64 bytes with m=1 until the final m=0", () => {
    process.env["KITTY_WINDOW_ID"] = "1";
    withTty(true, () => {
      const bytes = Uint8Array.from({ length: 9216 }, (_, index) => index % 256);
      const escape = terminalImageEscape({ ...pngBlob(), bytes });
      expect(escape).not.toBeNull();
      const parts = escape!.split("\x1b\\").filter((part) => part !== "");
      expect(parts.length).toBe(3);
      const payload = parts.map((part) => part.replace(/^.*;/, "")).join("");
      expect(payload).toBe(Buffer.from(bytes).toString("base64"));
      expect(parts[0]).toMatch(/^\x1b_Gf=100,t=d,q=1,m=1;/);
      expect(parts[1]).toMatch(/^\x1b_Gm=1;/);
      expect(parts[2]).toMatch(/^\x1b_Gm=0;/);
      for (const part of parts) expect(part.replace(/^.*;/, "").length).toBeLessThanOrEqual(4096);
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
