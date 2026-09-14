import { rootFrom } from "@tasks/surface";
import { startWebServer } from "./server.js";

/**
 * tk web entry: serves the web UI over the resolved workspace.
 * Usage: `bun packages/web/src/main.ts [workspace-root] [--dev] [--port N]`.
 * Without a root the workspace is discovered from cwd like the tk CLI;
 * --dev auto-opens the browser and live-reloads on shell edits.
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
const portFlag = flagValue("--port");
const options: Parameters<typeof startWebServer>[0] = { root, dev, ...(portFlag !== undefined && /^\d+$/.test(portFlag) ? { port: Number(portFlag) } : {}) };

const server = await startWebServer(options);
console.log(`tk web → ${server.url}${dev ? "  (dev: live reload on)" : ""}`);
if (dev) {
  try { Bun.spawn(["open", server.url], { stdout: "ignore", stderr: "ignore" }); }
  catch { /* non-macOS: user opens the URL themselves */ }
}
