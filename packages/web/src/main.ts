import { rootFrom } from "@tasks/surface";
import { startWebServer } from "./server.js";

/**
 * tk web entry: serves the web UI over the resolved workspace.
 * Usage: `bun packages/web/src/main.ts [workspace-root] [--dev] [--open] [--port N]`.
 * Without a root the workspace is discovered from cwd like the tk CLI;
 * --dev live-reloads on shell edits, --port N (or TK_WEB_PORT) picks the port,
 * and --dev/--open launch the browser at startup. Interactive sessions can
 * also press `w` to open the browser at any time.
 */

const argv = process.argv.slice(2);
const flagValue = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(name);

const portFlagIndex = argv.indexOf("--port");
const rootArg = argv.find((token, index) => !token.startsWith("--") && index !== portFlagIndex + 1);
const root = rootArg ?? await rootFrom(process.cwd());
if (root === null) {
  process.stderr.write("no tasks workspace found; run tk init\n");
  process.exit(2);
}
const dev = has("--dev");
const autoOpen = dev || has("--open");
// Port: --port flag wins over the TK_WEB_PORT env var; anything unparsable is
// reported and the server default applies.
const rawPort = flagValue("--port") ?? process.env["TK_WEB_PORT"];
const port = rawPort !== undefined && /^\d+$/.test(rawPort) ? Number(rawPort) : undefined;
if (rawPort !== undefined && port === undefined) process.stderr.write(`tk web: ignoring invalid port ${JSON.stringify(rawPort)}\n`);
const options: Parameters<typeof startWebServer>[0] = { root, dev, ...(port !== undefined ? { port } : {}) };

const server = await startWebServer(options);
const interactive = Boolean(process.stdin.isTTY);
console.log(`tk web → ${server.url}${dev ? "  (dev: live reload on)" : ""}${interactive && !autoOpen ? "  (press w to open)" : ""}`);

const openBrowser = (): void => {
  try { Bun.spawn(["open", server.url], { stdout: "ignore", stderr: "ignore" }); }
  catch { /* non-macOS: user opens the URL themselves */ }
};
if (autoOpen) openBrowser();

// Interactive sessions: raw stdin so a single `w` opens the browser. Raw mode
// swallows SIGINT, so Ctrl-C must quit explicitly (and un-raw the terminal).
if (interactive) {
  process.stdin.setRawMode(true);
  process.stdin.on("data", (chunk: Uint8Array): void => {
    if (chunk.includes(0x03)) { // Ctrl-C
      process.stdin.setRawMode(false);
      process.exit(0);
    }
    if (chunk.includes(0x77)) openBrowser(); // w
  });
}
