import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { rootFrom } from "@tasks/surface";
import { App } from "./app/App.js";
import { openTuiStore } from "./store.js";

/**
 * tk-tui entry: owns renderer lifecycle, store lifetime, and global keys
 * (ctrl+q quit). Usage: `bun packages/tui/src/main.tsx [workspace-root]`.
 * Without an argument the workspace is discovered from cwd like the tk CLI.
 */

const rootArg = process.argv[2];
const discovered = rootArg !== undefined ? rootArg : await rootFrom(process.cwd());
if (discovered === null) {
  process.stderr.write("no tasks workspace found; run tk init\n");
  process.exit(2);
}

const store = await openTuiStore(discovered);
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
    if ((key.name === "q" && key.ctrl) || (key.name === "c" && key.ctrl && key.meta)) quit();
  });
  return null;
};

try {
  createRoot(renderer).render(
    <>
      <GlobalKeys />
      <App store={store} actor={actor} onQuit={quit} />
    </>,
  );
} catch (cause) {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  await shutdown();
  process.exit(1);
}