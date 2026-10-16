import { readRuntimeRegistry, resolveWebPort, rootFrom } from "@tasks/surface";
import { readWorkspaceConfig } from "@tasks/workspace";
import { join } from "node:path";
import { PortBusyError, startWebServer, type WebServer } from "./server.js";

/**
 * tk web entry: serves the web UI over the resolved workspace.
 * Usage: `bun packages/web/src/main.ts [workspace-root] [--dev] [--open] [--port N] [--random-port] [--daemon]`.
 * Without a root the workspace is discovered from cwd like the tk CLI;
 * `--dev` live-reloads on shell edits, `--port N` (or TK_WEB_PORT) picks the
 * port, `--random-port` binds an ephemeral port bypassing the single-instance
 * check, and `--daemon`/`--open` hand off to a detached child / launch the
 * browser. Interactive sessions can press `d` to daemonize or `w` to open the
 * browser at any time.
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
// Port: --port flag wins over the TK_WEB_PORT env var, which wins over the
// workspace config's webPort; anything unparsable is reported and the next
// source applies.
const workspaceConfig = await readWorkspaceConfig(join(root, ".tasks")).catch((error: unknown) => {
  process.stderr.write(`tk web: ignoring invalid config.json (${error instanceof Error ? error.message.split("\n")[0]! : "unreadable"})\n`);
  return null;
});
const { port, ignored } = resolveWebPort(flagValue("--port"), process.env["TK_WEB_PORT"], workspaceConfig?.webPort);
for (const bad of ignored) process.stderr.write(`tk web: ignoring invalid port ${JSON.stringify(bad)}\n`);
const randomPort = has("--random-port");

let server: WebServer | undefined;
let handingOff = false;

/**
 * Daemon handoff: spawn a detached copy of this entry without `--daemon`,
 * wait for the child's `web` runtime row (the registry is the rendezvous —
 * the parent cannot know the child's URL any other way), and report. The
 * child outlives the parent: no signal tie, ignored stdio. An interactive
 * server closes first — the child rebinds the freed port (random-port
 * sessions pin the child to the bound port, so the URL survives the
 * handoff). Returns the daemon URL, or null when the child died or never
 * registered — the caller decides how to fail.
 */
const daemonize = async (): Promise<string | null> => {
  // The port must be free before the child starts: an interactive server
  // closes here, which also drops its registry row. `tk web -d` has none.
  let pin: number | null = null;
  if (server !== undefined) {
    pin = server.port;
    await server.close();
    server = undefined;
  }
  const childFlags = argv.filter((token) => token !== "--daemon" && !(pin !== null && token === "--random-port"));
  if (pin !== null) childFlags.push("--port", String(pin));
  // `detached` gives the child its own session: it must outlive this process,
  // the terminal, and any SIGHUP to the caller's foreground process group.
  const child = Bun.spawn([process.execPath, import.meta.path, ...childFlags], { stdin: "ignore", stdout: "ignore", stderr: "pipe", detached: true });
  const tasksDir = join(root, ".tasks");
  // Captured so a startup failure (e.g. a busy port) is reported, not lost to
  // the detached pipe. Capped: only the tail matters.
  const stderr = new Response(child.stderr).text().then((text) => text.trim().slice(-2000));
  let url: string | null = null;
  let code: number | null = null;
  for (let attempt = 0; attempt < 60 && url === null && code === null; attempt += 1) {
    const { promise: tick, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 100);
    code = await Promise.race([child.exited, tick.then(() => null)]);
    const row = (await readRuntimeRegistry(tasksDir)).find((entry) => entry.kind === "web" && entry.pid === child.pid);
    if (row !== undefined && row.kind === "web") url = row.url;
  }
  if (url === null) {
    if (code !== null) {
      const why = await stderr;
      process.stderr.write(`tk web: daemon pid ${child.pid} exited (code ${code})${why === "" ? "" : `: ${why}`}\n`);
    } else {
      process.stderr.write(`tk web: daemon pid ${child.pid} did not register within 6s — try tk web port\n`);
    }
    return null;
  }
  console.log(`tk web daemon → ${url}  (pid ${child.pid})`);
  return url;
};

if (has("--daemon")) {
  process.exit((await daemonize()) === null ? 1 : 0);
}

const interactive = Boolean(process.stdin.isTTY);
const options: Parameters<typeof startWebServer>[0] = {
  root, dev,
  ...(port !== undefined ? { port } : {}),
  ...(randomPort ? { randomPort: true } : {}),
};

try {
  server = await startWebServer(options);
} catch (error) {
  if (error instanceof PortBusyError) {
    // `live` known: another tk web server, give the stop/replace hint.
    // Otherwise a foreign process holds the port; message covers the rest.
    const detail = error.live === null
      ? `tk web: ${error.message}`
      : `tk web: port ${error.port} already serving ${error.live.workspace} — http://localhost:${error.live.port} (pid ${error.live.pid})\n` +
        `  stop it with tk web stop, pick another with --port N, or use --random-port\n`;
    process.stderr.write(`${detail}\n`);
    process.exit(1);
  }
  throw error;
}
console.log(`tk web → ${server.url}${dev ? "  (dev: live reload on)" : ""}${interactive ? "  (press d to daemonize, w to open, Ctrl-C to quit)" : ""}`);

const openBrowser = (): void => {
  // Absent only inside the daemon handoff window; nothing to open then.
  if (server === undefined) return;
  try { Bun.spawn(["open", server.url], { stdout: "ignore", stderr: "ignore" }); }
  catch { /* non-macOS: user opens the URL themselves */ }
};
if (autoOpen) openBrowser();

// Clean shutdown unregisters the runtime row; a hard kill is covered by the
// dead-pid prune on the next start.
process.on("SIGTERM", () => {
  if (server === undefined) process.exit(0);
  void server.close().then(() => process.exit(0));
});
process.on("SIGINT", () => {
  if (server === undefined) process.exit(0);
  void server.close().then(() => process.exit(0));
});

// Interactive sessions: raw stdin so single keys act. Raw mode swallows
// SIGINT, so Ctrl-C must quit explicitly (and un-raw the terminal).
if (interactive) {
  process.stdin.setRawMode(true);
  process.stdin.on("data", (chunk: Uint8Array): void => {
    if (chunk.includes(0x03)) { // Ctrl-C
      process.stdin.setRawMode(false);
      process.exit(0);
    }
    if (chunk.includes(0x77)) openBrowser(); // w
    if (chunk.includes(0x64) && !handingOff) { // d — hand the server to a detached child
      handingOff = true;
      process.stdin.setRawMode(false);
      void (async (): Promise<void> => {
        if ((await daemonize()) !== null) process.exit(0);
        // Handoff failed (rare: something took the freed port in the gap) —
        // keep serving interactively instead of leaving the user with nothing.
        try {
          server = await startWebServer(options);
        } catch (error) {
          process.stderr.write(`tk web: ${error instanceof Error ? error.message : String(error)}\n`);
          process.exit(1);
        }
        process.stdout.write(`tk web: daemon start failed — still serving ${server.url}\n`);
        handingOff = false;
        process.stdin.setRawMode(true);
      })();
    }
  });
}
