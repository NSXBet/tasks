#!/usr/bin/env bun
/**
 * pty E2E smoke: launch the real TUI binary against a throwaway workspace and
 * drive it with keys. Harness is tmux — a real terminal emulator with a real
 * pty. Direct python `pty.fork()` is not viable: OpenTUI's Zig renderer queries
 * terminal capabilities (DECRQM etc.) at startup and waits seconds for replies
 * a bare pty never sends, so the first paint lags 5-10s. tmux answers those
 * queries, which is exactly what real terminals do.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "/Users/yuri/Workdir/Nsx/tasks";
const workspace = mkdtempSync(join(tmpdir(), "tk-tui-e2e-"));
const tasksDir = join(workspace, ".tasks");
const sock = join(workspace, "tmux.sock");
const session = "tui";

await Bun.$`mkdir -p ${tasksDir}`.quiet();
writeFileSync(join(tasksDir, "config.json"), JSON.stringify({ prefix: "tk", storage: { backend: "file" } }));

// Seed one issue through the real CLI so the board has a row.
const probe = Bun.spawn(["bun", join(REPO, "packages/cli/src/tk.ts"), "create", "--title", "e2e smoke issue", "--priority", "1"], { cwd: workspace, stdout: "pipe", stderr: "pipe" });
const probeErr = await new Response(probe.stderr).text();
await probe.exited;
if (probe.exitCode !== 0) {
  console.error("tk create failed:", probeErr || "");
  rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

const tmux = (...args: string[]): ReturnType<typeof Bun.spawn> =>
  Bun.spawn(["tmux", "-S", sock, ...args], { stdout: "pipe", stderr: "pipe" });

const tmuxOut = async (args: string[]): Promise<string> => {
  const proc = tmux(...args);
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text;
};

const capture = async (): Promise<string> => tmuxOut(["capture-pane", "-p", "-t", session]);
const sendKey = async (key: string): Promise<void> => { await tmuxOut(["send-keys", "-t", session, key]); };

// Await a predicate over the pane with a deadline; returns last capture either way.
const waitFor = async (predicate: (frame: string) => boolean, timeoutMs = 15000): Promise<string> => {
  const deadline = Date.now() + timeoutMs;
  let frame = "";
  while (Date.now() < deadline) {
    frame = await capture();
    if (predicate(frame)) return frame;
    await Bun.sleep(300);
  }
  return frame;
};

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, evidence = ""): void => {
  if (ok) { pass++; console.log(`  ok ${pass}: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name}`); if (evidence !== "") console.error(evidence); }
};

// Launch the TUI in a fresh tmux server (config-free) sized like a real terminal.
const launch = Bun.spawnSync(["tmux", "-S", sock, "-f", "/dev/null", "new-session", "-d", "-s", session, "-x", "100", "-y", "24",
  "bun", join(REPO, "packages/tui/src/main.tsx"), workspace], { cwd: REPO, env: { ...process.env, TERM: "xterm-256color" } });
if (launch.exitCode !== 0) {
  console.error("tmux launch failed:", new TextDecoder().decode(launch.stderr));
  rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

const frame1 = await waitFor((text) => text.includes("e2e smoke issue"));
const seedRow = /tk-[a-z0-9]+/.exec(frame1)?.[0] ?? null;
check("board lists the seeded issue", frame1.includes("e2e smoke issue"), frame1);
check("statusbar reflects the seed", frame1.includes("open 1"), frame1);

// Enter on the select opens the detail pane.
await sendKey("Enter");
const frame2 = await waitFor((text) => text.includes("esc:close"));
const sawDetail = seedRow !== null && frame2.includes(seedRow) && frame2.includes("P1") && frame2.includes("esc:close");
check("detail pane opens with issue metadata", sawDetail, frame2);

// Escape closes it again.
await sendKey("Escape");
await Bun.sleep(600);
const frame3 = await capture();
check("escape closes detail", !frame3.includes("esc:close"), frame3);

// Command palette: opens over the shell, filters, closes.
await sendKey(":");
const framePalette = await waitFor((text) => text.includes("go to Board"));
check("command palette lists commands with keycaps", framePalette.includes("go to Insights") && framePalette.includes("[n]") && framePalette.includes("esc close"), framePalette);
await sendKey("Escape");
await Bun.sleep(500);
const framePaletteGone = await capture();
check("escape closes the palette", !framePaletteGone.includes("go to Board"), framePaletteGone);

// View sweep: kanban (waits for the full column set before asserting).
await sendKey("2");
const frameKanban = await waitFor((text) => text.includes("Open (") && text.includes("In Progress") && text.includes("Closed"));
check("kanban shows flow columns", (seedRow === null || frameKanban.includes(seedRow)), frameKanban);

// Task modal: enter on a card opens the in-place editor over the board.
await sendKey("Enter");
const frameModal = await waitFor((text) => text.includes("esc close") && text.includes("Open (") && text.includes("In Progress"));
check("task modal floats over the board", frameModal.includes("updated") && (seedRow === null || frameModal.includes(seedRow)), frameModal);

await sendKey("Escape");
await Bun.sleep(500);
const frameModalGone = await capture();
check("escape closes the modal", !frameModalGone.includes("esc ✕"), frameModalGone);

await sendKey("3");
const frameGraph = await waitFor((text) => text.includes("j/k move"));
check("graph shows centered issue with metrics", seedRow !== null && frameGraph.includes(seedRow) && frameGraph.includes("chain"), frameGraph);

await sendKey("4");
const frameInsights = await waitFor((text) => text.includes("ready now"));
check("insights shows ready panel", seedRow !== null && frameInsights.includes(seedRow), frameInsights);

await sendKey("1");
await Bun.sleep(400);
await sendKey("C-q");
await Bun.sleep(1500);
const hasSession = tmux(["has-session", "-t", session]);
const quitCode = await hasSession.exited;
check("ctrl-q quits the app", quitCode !== 0);

// Ctrl+c is the primary exit path: relaunch and verify it tears down cleanly.
const relaunch = Bun.spawnSync(["tmux", "-S", sock, "-f", "/dev/null", "new-session", "-d", "-s", session, "-x", "100", "-y", "24",
  "bun", join(REPO, "packages/tui/src/main.tsx"), workspace], { cwd: REPO, env: { ...process.env, TERM: "xterm-256color" } });
if (relaunch.exitCode !== 0) {
  console.error("tmux relaunch failed:", new TextDecoder().decode(relaunch.stderr));
  rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}
await waitFor((text) => text.includes("e2e smoke issue"));
await sendKey("C-c");
await Bun.sleep(1500);
const hasSessionAfterCtrlC = tmux(["has-session", "-t", session]);
const ctrlCQuitCode = await hasSessionAfterCtrlC.exited;
check("ctrl-c quits the app", ctrlCQuitCode !== 0);

tmux(["kill-server"]);
rmSync(workspace, { recursive: true, force: true });
if (fail > 0) process.exit(1);
console.log(`smoke: all green (${pass} checks)`);