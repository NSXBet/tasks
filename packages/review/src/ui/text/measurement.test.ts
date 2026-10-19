import { describe, expect, test } from "bun:test";
import { TextBuffer, TextBufferView } from "@opentui/core";
import {
  TerminalTextMeasurer,
  measureTerminalTextHeight,
} from "./measurement";

describe("terminal text measurement", () => {
  test("matches the native engine's own wrapping for words and wide unbroken text", () => {
    // The contract is parity with @opentui/core's wrap engine (the same
    // engine paints what this measures), not specific line counts — those
    // are engine-version details that changed in 0.5.11.
    for (const [text, width] of [["hello world", 7], ["hello world", 5], ["ab界界cd", 4], ["界", 1]] as const) {
      const buffer = TextBuffer.create("unicode");
      const view = TextBufferView.create(buffer);
      buffer.setText(text);
      view.setWrapMode("word");
      view.setWrapWidth(width);
      const native = view.measureForDimensions(width, 1_000_001)?.lineCount;
      view.destroy();
      buffer.destroy();
      expect(measureTerminalTextHeight(text, width)).toBe(native);
    }
  });
  test("retained tabs match the native engine's own geometry at 0.5.11", () => {
    // Tab geometry is owned by @opentui/core's wrap engine (one-cell as of
    // 0.5.11); this pins only that measurement delegates to it unchanged.
    expect(measureTerminalTextHeight("a\tb", 4)).toBe(1);
    expect(measureTerminalTextHeight("\t\t", 2)).toBe(2);
  });
  test("contains setup failures and poisons the measurer", () => {
    let calls = 0;
    const measurer = new TerminalTextMeasurer(() => {
      calls++;
      throw new Error("native details");
    });
    expect(() => measurer.measure("content", 10)).toThrow("terminal text measurement unavailable");
    expect(() => measurer.measure("content", 10)).toThrow("terminal text measurement unavailable");
    expect(calls).toBe(1);
  });
  test("destroys native resources exactly once after measurement failures", () => {
    for (const failure of [
      "set-text",
      "wrap-mode",
      "wrap-width",
      "measure",
      "malformed-measure",
    ] as const) {
      let bufferDestroyed = 0;
      let viewDestroyed = 0;
      const measurer = new TerminalTextMeasurer(() => ({
        buffer: {
          setText() {
            if (failure === "set-text") throw new Error("failed");
          },
          destroy() {
            bufferDestroyed++;
          },
        },
        view: {
          setWrapMode() {
            if (failure === "wrap-mode") throw new Error("failed");
          },
          setWrapWidth() {
            if (failure === "wrap-width") throw new Error("failed");
          },
          measureForDimensions() {
            return failure === "measure"
              ? null
              : { lineCount: failure === "malformed-measure" ? Number.NaN : 1 };
          },
          destroy() {
            viewDestroyed++;
          },
        },
      }));
      expect(() => measurer.measure("content", 10)).toThrow(
        "terminal text measurement unavailable",
      );
      expect(bufferDestroyed).toBe(1);
      expect(viewDestroyed).toBe(1);
      expect(() => measurer.measure("other", 10)).toThrow("terminal text measurement unavailable");
      expect(bufferDestroyed).toBe(1);
      expect(viewDestroyed).toBe(1);
    }
  });
  test("keeps empty rows at height one without touching poisoned native state", () => {
    const measurer = new TerminalTextMeasurer(() => {
      throw new Error("unavailable");
    });
    expect(() => measurer.measure("content", 10)).toThrow("terminal text measurement unavailable");
    expect(measurer.measure("", 10)).toBe(1);
  });
});
