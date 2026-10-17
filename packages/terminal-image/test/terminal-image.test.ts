import { afterEach, describe, expect, it } from "vitest";
import { kittyImageEscape, osc1337ImageEscape, terminalImageEscape, terminalImageKind } from "../src/index.js";

const png = (size = 4): Uint8Array => Uint8Array.from({ length: size }, (_, index) => index % 256);
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

const kittyIO = (): { env: Record<string, string | undefined>; isTTY: boolean } => ({ env: { KITTY_WINDOW_ID: "1" }, isTTY: true });
const ghosttyIO = (): { env: Record<string, string | undefined>; isTTY: boolean } => ({ env: { GHOSTTY_RESOURCES_DIR: "/Applications/Ghostty.app/Contents/Resources" }, isTTY: true });
const itermIO = (): { env: Record<string, string | undefined>; isTTY: boolean } => ({ env: { TERM_PROGRAM: "iTerm.app" }, isTTY: true });

describe("terminalImageKind", () => {
  it.each([
    ["kitty window", kittyIO().env, true, "kitty"],
    ["ghostty", ghosttyIO().env, true, "kitty"],
    ["iterm", itermIO().env, true, "osc1337"],
    ["wezterm", { TERM_PROGRAM: "WezTerm" }, true, "osc1337"],
    ["vscode", { TERM_PROGRAM: "vscode" }, true, "osc1337"],
    ["mintty", { TERM_PROGRAM: "mintty" }, true, "osc1337"],
    ["unknown terminal", {}, true, null],
    ["piped stdout", kittyIO().env, false, null],
  ])("detects %s", (_name, env, isTTY, expected) => {
    expect(terminalImageKind({ env, isTTY })).toBe(expected);
  });
});

describe("kittyImageEscape", () => {
  it("emits a transmit-and-display chunk with the a=T action key", () => {
    const escape = kittyImageEscape(png());
    expect(escape).toBe(`\x1b_Ga=T,f=100,t=d,q=1,m=0;${b64(png())}\x1b\\`);
  });

  it("chunks payloads at 4096 base64 bytes; only the first chunk carries the control keys", () => {
    const bytes = png(9216);
    const parts = kittyImageEscape(bytes).split("\x1b\\").filter((part) => part !== "");
    expect(parts.length).toBe(3);
    expect(parts[0]).toMatch(/^\x1b_Ga=T,f=100,t=d,q=1,m=1;/);
    expect(parts[1]).toMatch(/^\x1b_Gm=1;/);
    expect(parts[2]).toMatch(/^\x1b_Gm=0;/);
    expect(parts.map((part) => part.replace(/^.*;/, "")).join("")).toBe(b64(bytes));
    for (const part of parts) expect(part.replace(/^.*;/, "").length).toBeLessThanOrEqual(4096);
  });
});

describe("osc1337ImageEscape", () => {
  it("emits the inline file escape with base64 name and payload", () => {
    const bytes = png();
    expect(osc1337ImageEscape({ bytes, name: "dot.png" })).toBe(`\x1b]1337;File=${Buffer.from("dot.png").toString("base64")};inline=1;preserveAspectRatio=1:${b64(bytes)}\x1b\\`);
  });
});

describe("terminalImageEscape", () => {
  afterEach(() => { delete process.env["KITTY_WINDOW_ID"]; delete process.env["GHOSTTY_RESOURCES_DIR"]; delete process.env["TERM_PROGRAM"]; });

  const source = (): { bytes: Uint8Array; name: string; mime: string } => ({ bytes: png(), name: "dot.png", mime: "image/png" });

  it("returns null without a supported terminal", () => {
    expect(terminalImageEscape(source(), { env: {}, isTTY: true })).toBeNull();
    expect(terminalImageEscape(source(), { env: kittyIO().env, isTTY: false })).toBeNull();
  });

  it("restricts the kitty path to PNG bytes; other image mimes get null", () => {
    expect(terminalImageEscape({ ...source(), mime: "image/jpeg" }, kittyIO())).toBeNull();
    expect(terminalImageEscape({ ...source(), mime: "image/jpeg" }, itermIO())).toBe(osc1337ImageEscape({ bytes: png(), name: "dot.png" }));
  });

  it("uses kitty on kitty/ghostty and osc1337 on iTerm-style terminals", () => {
    expect(terminalImageEscape(source(), kittyIO())).toBe(kittyImageEscape(png()));
    expect(terminalImageEscape(source(), ghosttyIO())).toBe(kittyImageEscape(png()));
    expect(terminalImageEscape(source(), itermIO())).toBe(osc1337ImageEscape({ bytes: png(), name: "dot.png" }));
  });

  it("falls back to the live process environment and stdout when io is omitted", () => {
    process.env["KITTY_WINDOW_ID"] = "1";
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      expect(terminalImageEscape(source())).toBe(kittyImageEscape(png()));
    } finally {
      if (descriptor === undefined) delete (process.stdout as { isTTY?: boolean }).isTTY;
      else Object.defineProperty(process.stdout, "isTTY", descriptor);
    }
  });
});
