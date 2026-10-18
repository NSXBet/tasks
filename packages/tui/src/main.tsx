import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { rootFrom } from "@tasks/surface";
import { readWorkspaceConfig } from "@tasks/workspace";
import { App } from "./app/App.js";
import { openTuiStore, parseImageSize, resolveImageSize, type ImageSize } from "./store.js";

/**
 * tk-tui entry: owns renderer lifecycle, store lifetime, and global keys
 * (ctrl+c/ctrl+q quit). Usage: `bun packages/tui/src/main.tsx [workspace-root] [--image-size WxH]`.
 * Without an argument the workspace is discovered from cwd like the tk CLI;
 * the image flag overrides the workspace's `tuiImage` config key.
 */

const args = process.argv.slice(2);
const flagIndex = args.indexOf("--image-size");
let sizeFlag: ImageSize | null = null;
if (flagIndex !== -1) {
  const value = args.splice(flagIndex, 2)[1];
  const parsed = value === undefined ? null : parseImageSize(value);
  if (parsed === null) {
    process.stderr.write(
      value === undefined
        ? "--image-size requires a WxH value\n"
        : `invalid --image-size "${value}"; expected WxH, e.g. 36x14\n`,
    );
    process.exit(2);
  }
  sizeFlag = parsed;
}

const rootArg = args[0];
const discovered = rootArg !== undefined ? rootArg : await rootFrom(process.cwd());
if (discovered === null) {
  process.stderr.write("no tasks workspace found; run tk init\n");
  process.exit(2);
}

const store = await openTuiStore(discovered);
const config = await readWorkspaceConfig(store.surface.store.tasksDir);
const imageSize = resolveImageSize(sizeFlag, config.tuiImage);
const renderer = await createCliRenderer({ exitOnCtrlC: false, screenMode: "alternate-screen", useMouse: true });
const actor = process.env["USER"] ?? "unknown";

/** Renderer ownership: destroy the store first, then the renderer, on every exit path. */
const shutdown = async (): Promise<void> => {
  try { await store.close(); } catch { /* already closed */ }
  renderer.destroy();
};
const quit = (): void => { process.exitCode = 0; void shutdown(); };

const GlobalKeys = (): null => {
  useKeyboard((key) => {
    if ((key.name === "q" && key.ctrl) || (key.name === "c" && key.ctrl)) quit();
  });
  return null;
};

try {
  createRoot(renderer).render(
    <>
      <GlobalKeys />
      <App store={store} actor={actor} onQuit={quit} imageSize={imageSize} />
    </>,
  );
} catch (cause) {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  await shutdown();
  process.exit(1);
}