/**
 * Real-clock frame polling for TUI tests.
 *
 * opentui's own test primitives (`waitForFrame`, `flush`, repeated
 * `renderOnce`) deadlock under `bun test` once a render is scheduled from
 * outside the initial act()-wrapped one: the native span feed backpressures
 * and the harness's frame/idle await chain never drains, while frames
 * themselves keep advancing on the real clock (the watch poll drives the
 * renderer's own loop timeouts). These helpers therefore poll
 * `captureCharFrame()` against the real clock and never await the harness's
 * frame/idle chain.
 */
interface FrameSource {
  readonly renderer: { destroy(): unknown };
  readonly captureCharFrame: () => string;
}

const deadlineError = (substring: string, timeoutMs: number, present: boolean): Error =>
  new Error(
    present
      ? `frame still contained "${substring}" after ${timeoutMs}ms`
      : `frame never contained "${substring}" within ${timeoutMs}ms`,
  );

/** First frame containing `substring`, polling the real clock. */
export const waitForFrameText = async (
  setup: FrameSource,
  substring: string,
  timeoutMs = 12000,
): Promise<string> => {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const frame = setup.captureCharFrame();
    if (frame.includes(substring)) return frame;
    if (performance.now() >= deadline) throw deadlineError(substring, timeoutMs, false);
    await Bun.sleep(75);
  }
};

/** First frame matching `predicate`, polling the real clock. */
export const waitForFramePredicate = async (
  setup: FrameSource,
  predicate: (frame: string) => boolean,
  timeoutMs = 12000,
): Promise<string> => {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const frame = setup.captureCharFrame();
    if (predicate(frame)) return frame;
    if (performance.now() >= deadline) throw new Error(`frame predicate never matched within ${timeoutMs}ms`);
    await Bun.sleep(75);
  }
};

/** First frame NOT containing `substring`, with a minimum settle wait so a
 *  filter that never applies doesn't pass on the pre-filter frame. */
export const waitForFrameWithout = async (
  setup: FrameSource,
  substring: string,
  timeoutMs = 12000,
): Promise<string> => {
  const deadline = performance.now() + timeoutMs;
  await Bun.sleep(1000);
  for (;;) {
    const frame = setup.captureCharFrame();
    if (!frame.includes(substring)) return frame;
    if (performance.now() >= deadline) throw deadlineError(substring, timeoutMs, true);
    await Bun.sleep(75);
  }
};
