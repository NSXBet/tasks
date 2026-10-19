import { TextBuffer, TextBufferView } from "@opentui/core";

/**
 * Retained tabs are measured by the same native engine that paints them, so
 * measurement and painting stay identical by construction — the engine owns
 * tab geometry, and it changed in @opentui 0.5.11 (two-cell → one-cell, with
 * non-linear wrap behavior). Do not re-derive tab widths here.
 */
const TEXT_MEASUREMENT_ERROR = "terminal text measurement unavailable";

interface NativeTextBuffer {
  setText(text: string): void;
  destroy(): void;
}
interface NativeTextBufferView {
  setWrapMode(mode: "word"): void;
  setWrapWidth(width: number): void;
  measureForDimensions(width: number, height: number): { lineCount: number } | null;
  destroy(): void;
}
interface NativeTextMeasurement {
  readonly buffer: NativeTextBuffer;
  readonly view: NativeTextBufferView;
}
type NativeTextMeasurementFactory = () => NativeTextMeasurement;

/** Create the native buffer pair shared by every word-wrapped terminal text surface. */
function createNativeTextMeasurement(): NativeTextMeasurement {
  const buffer = TextBuffer.create("unicode");
  try {
    return { buffer, view: TextBufferView.create(buffer) };
  } catch (error) {
    try {
      buffer.destroy();
    } catch {
      /* Preserve the setup failure. */
    }
    throw error;
  }
}

/** Reuse OpenTUI's native wrap engine so measurement and painting retain identical geometry. */
export class TerminalTextMeasurer {
  #buffer: NativeTextBuffer | undefined;
  #view: NativeTextBufferView | undefined;
  #nativeAvailable = true;
  constructor(
    private readonly createNativeMeasurement: NativeTextMeasurementFactory = createNativeTextMeasurement,
  ) {}

  /** Measure one terminal-safe logical line; native failure never invents an approximate height. */
  measure(text: string, width: number) {
    if (text.length === 0) return 1;
    if (!this.#nativeAvailable) throw new Error(TEXT_MEASUREMENT_ERROR);
    const usableWidth = Math.max(1, Math.floor(width));
    try {
      if (!this.#buffer || !this.#view) {
        const native = this.createNativeMeasurement();
        this.#buffer = native.buffer;
        this.#view = native.view;
      }
      this.#buffer.setText(text);
      this.#view.setWrapMode("word");
      this.#view.setWrapWidth(usableWidth);
      const measured = this.#view.measureForDimensions(usableWidth, 1_000_001);
      if (
        !measured ||
        !Number.isSafeInteger(measured.lineCount) ||
        measured.lineCount < 0 ||
        measured.lineCount > 1_000_001
      )
        throw new Error(TEXT_MEASUREMENT_ERROR);
      return Math.max(1, measured.lineCount);
    } catch {
      this.#nativeAvailable = false;
      this.destroy();
      throw new Error(TEXT_MEASUREMENT_ERROR);
    }
  }

  /** Release both native resources without masking a measurement or renderer failure. */
  destroy() {
    const view = this.#view;
    const buffer = this.#buffer;
    this.#view = undefined;
    this.#buffer = undefined;
    try {
      view?.destroy();
    } catch {
      /* Teardown preserves the original failure. */
    }
    try {
      buffer?.destroy();
    } catch {
      /* Teardown preserves the original failure. */
    }
  }
}

/** Measure a standalone row using the same native word-wrap behavior as the mounted renderer. */
export function measureTerminalTextHeight(text: string, width: number) {
  const measurer = new TerminalTextMeasurer();
  try {
    return measurer.measure(text, width);
  } finally {
    measurer.destroy();
  }
}
