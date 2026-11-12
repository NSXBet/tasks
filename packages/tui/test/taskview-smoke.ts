#!/usr/bin/env bun
/**
 * Real-terminal probe of the TUI task view (phase 9, 09-03). Drives the real
 * TUI binary inside tmux — same harness as smoke.ts / review-smoke.ts (own
 * `-S` socket, config-free server, capture-pane polling):
 *
 *   1. scratch git repo + `tk init` / `tk create` / `tk work <id>`, one worktree edit
 *   2. launch `packages/tui/src/main.tsx <scratch>` at 140×40, press `5`:
 *      the center column shows `◧ v open diff` and `ARTIFACTS`          (D-01)
 *   3. the rail shows `SESSIONS │ CHANGES │ WORKSPC │ MINIMAP` and an
 *      `a.ts` row with the needs-review dot                               (D-02)
 *   4. `Tab` changes the active panel (WORKSPC shows `host`)              (D-02)
 *   5. `tmux resize-window -x 90`: the worktree chip stays, the rail goes (D-03)
 *   6. back at 140: `Enter` on the CHANGES `a.ts` row opens the diff modal
 *      (`f ⤢ full view`) over the task view                               (D-04)
 *   7. `f` expands to the full diff view (stats line `· +1 −1`)           (D-04)
 *   8. `]` walks past the last file into EVIDENCE: the `▣ evidence:` caption
 *      row renders for the attached PNG                                    (D-06)
 *
 *   9. back in the task view, `J` + `o` on the evidence artifact opens the
 *      artifact view in EVIDENCE mode with the `▣ evidence:` row          (D-05)
 *  10. `Escape` returns to the task view                                    (D-05)
 *  11. `j` + `o` on the CHANGES `a.ts` row opens it as a CODE file view
 *      with numbered lines                                                 (D-05)
 *  12. `c` on the cursor line, typed note, `Enter` → a spawned `tk show`
 *      reads the note off the task record                                  (D-05)
 *  13. two more working tasks appear; at 160 cols the left `TASKS` column
 *      lists all three; `]` switches the task view to the next row, `[`
 *      switches back, and a `]]` burst (no settle sleep) moves two rows   (R34)
 * Not a `*.test.*` file, so `bun test` never collects it. Needs tmux and git.
 * Run: `bun packages/tui/test/taskview-smoke.ts`.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "../../..");
const TK = join(REPO, "packages/cli/src/tk.ts");
const MAIN = join(REPO, "packages/tui/src/main.tsx");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "tk-taskview-smoke-")));
const sock = join(scratch, "tmux.sock");
const session = `tktv-${process.pid}`;

const decode = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes ?? new Uint8Array());

const teardown = (): void => {
  Bun.spawnSync(["tmux", "-S", sock, "kill-server"], { stdout: "ignore", stderr: "ignore" });
  rmSync(scratch, { recursive: true, force: true });
};

const die = (message: string): never => {
  console.error(message);
  teardown();
  process.exit(1);
};

const run = (argv: readonly string[], cwd: string, env: Record<string, string> = {}): string => {
  const result = Bun.spawnSync([...argv], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  if (result.exitCode !== 0) die(`${argv.join(" ")} failed: ${decode(result.stderr)}`);
  return decode(result.stdout);
};
const git = (cwd: string, ...args: string[]): string => run(["git", "-c", "user.name=probe", "-c", "user.email=probe@example.invalid", ...args], cwd);
const tk = (...args: string[]): string => run([process.execPath, TK, "-C", scratch, ...args], scratch, { NO_COLOR: "1", FORCE_COLOR: "0" });
const writeIn = (dir: string, path: string, text: string): void => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), text);
};

const tmux = async (...args: string[]): Promise<{ readonly code: number; readonly out: string }> => {
  const proc = Bun.spawn(["tmux", "-S", sock, ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  return { code: await proc.exited, out };
};
const capture = async (): Promise<string> => (await tmux("capture-pane", "-p", "-t", session)).out;
const send = async (...keys: string[]): Promise<void> => { await tmux("send-keys", "-t", session, ...keys); };
const sendLiteral = async (text: string): Promise<void> => { await tmux("send-keys", "-t", session, "-l", text); };

/** Poll the pane until `predicate` holds; returns the last capture either way. */
const waitFor = async (predicate: (frame: string) => boolean, timeoutMs = 15000): Promise<string> => {
  const deadline = Date.now() + timeoutMs;
  let frame = "";
  while (Date.now() < deadline) {
    frame = await capture();
    if (predicate(frame)) return frame;
    await Bun.sleep(250);
  }
  return frame;
};

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, evidence = ""): void => {
  if (ok) { pass++; console.log(`  ok ${pass}: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name}`); if (evidence !== "") console.error(evidence); }
};

const RAIL_TABS = "SESSIONS │ CHANGES │ WORKSPC │ MINIMAP";
/** A CHANGES row for `a.ts` ending in the needs-review dot. */
const changedRow = (frame: string): boolean => frame.split("\n").some((row) => /a\.ts \[M\]\s+●/.test(row));

try {
  // 1. Scratch repo, one task, `tk work`, one uncommitted worktree edit.
  git(scratch, "init", "-q", "-b", "main");
  writeIn(scratch, "src/a.ts", "export const a = 1;\n");
  git(scratch, "add", ".");
  git(scratch, "commit", "-q", "-m", "init");
  tk("init", "--prefix", "tk");
  const id = (JSON.parse(tk("create", "probe task", "--json")) as { id: string }).id;
  tk("work", id);
  const shown = JSON.parse(tk("show", id, "--json")) as ReadonlyArray<Record<string, unknown>>;
  const worktree = String(shown[0]?.["worktree"] ?? "");
  if (worktree === "" || !existsSync(worktree)) die(`tk work recorded no worktree: ${JSON.stringify(shown[0])}`);
  writeIn(worktree, "src/a.ts", "export const a = 2; // probe edit\n");
  // 09-04: one PNG evidence on the task (a 1×1 image).
  writeFileSync(join(scratch, "shot.png"), Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (char) => char.charCodeAt(0)));
  tk("attach", id, "--evidence", join(scratch, "shot.png"));

  // 2. Launch the real binary and open the task view.
  const started = Bun.spawnSync(
    ["tmux", "-S", sock, "-f", "/dev/null", "new-session", "-d", "-s", session, "-x", "140", "-y", "40", process.execPath, MAIN, scratch],
    { cwd: scratch, env: { ...process.env, TERM: "xterm-256color" }, stdout: "pipe", stderr: "pipe" },
  );
  if (started.exitCode !== 0) die(`tmux launch failed: ${decode(started.stderr)}`);
  await waitFor((frame) => frame.includes("probe task"), 20000);
  await send("5");
  const task = await waitFor((frame) => frame.includes("◧ v open diff") && frame.includes("ARTIFACTS"), 15000);
  check("task view leads with ◧ v open diff and ARTIFACTS", task.includes("◧ v open diff") && task.includes("ARTIFACTS"), task);

  // 3. Tabbed rail with the live CHANGES tree.
  const rail = await waitFor((frame) => frame.includes(RAIL_TABS) && changedRow(frame), 15000);
  check("rail tabs + a.ts row with ●", rail.includes(RAIL_TABS) && changedRow(rail), rail);

  // 4. Tab moves CHANGES → WORKSPC.
  await send("Tab");
  const workspace = await waitFor((frame) => /host\s{2,}\S/.test(frame), 8000);
  check("Tab switches the panel (WORKSPC shows host)", /host\s{2,}\S/.test(workspace) && !changedRow(workspace), workspace);

  // 5. Narrow terminal: the rail hides, the worktree chip stays.
  await tmux("resize-window", "-t", session, "-x", "90", "-y", "40");
  const narrow = await waitFor((frame) => !frame.includes("SESSIONS │") && frame.includes("[ worktree "), 8000);
  check("narrow (90 cols) keeps the worktree chip and drops the rail", !narrow.includes("SESSIONS │") && narrow.includes("[ worktree "), narrow);
  await tmux("resize-window", "-t", session, "-x", "140", "-y", "40");

  // 09-04 checks
  // 6. Back to CHANGES (shift+tab from WORKSPC), cursor onto a.ts, Enter → the diff modal.
  await waitFor((frame) => frame.includes("SESSIONS │"), 8000);
  await send("BTab");
  await waitFor(changedRow, 8000);
  // No settle sleeps: the task view reads its tab / cursor from refs, so a key burst lands.
  await send("j");
  await send("Enter");
  const modal = await waitFor((frame) => frame.includes("f ⤢ full view") && frame.includes("/ src/a.ts"), 10000);
  check("Enter on a CHANGES file opens the diff modal over the task (f ⤢ full view)", modal.includes("f ⤢ full view") && modal.includes("/ src/a.ts") && modal.includes("probe task"), modal);

  // 7. `f` → the full diff view on the same file.
  await send("f");
  const full = await waitFor((frame) => !frame.includes("f ⤢ full view") && /· \+1 −1/.test(frame) && frame.includes("q quit"), 10000);
  check("f expands to the full diff view (stats line)", !full.includes("f ⤢ full view") && /· \+1 −1/.test(full), full);

  // 8. `]` past the last hunk walks into the EVIDENCE entries.
  let evidence = full;
  for (let press = 0; press < 4 && !evidence.includes("▣ evidence:"); press++) {
    await send("]");
    evidence = await waitFor((frame) => frame.includes("▣ evidence:"), 1500);
  }
  check("] walks into EVIDENCE: the ▣ evidence: caption row renders", evidence.includes("▣ evidence:") && evidence.includes("EVIDENCE · 1"), evidence);
  await send("Escape");

  // 09-05 checks
  // 9. Esc took the diff view to the list; `5` → the task view, `J` + `o` on the evidence artifact.
  await waitFor((frame) => !frame.includes("q quit"), 6000);
  await send("5");
  await waitFor((frame) => frame.includes("J/K select · o open") && frame.includes("◧ v open diff"), 10000);
  await send("J");
  await send("o");
  const artifact = await waitFor((frame) => frame.includes("EVIDENCE") && frame.includes("▣ evidence:") && frame.includes("esc back to task"), 10000);
  check("J + o opens the evidence artifact (EVIDENCE, ▣ evidence:)", artifact.includes("EVIDENCE") && artifact.includes("▣ evidence:") && artifact.includes("esc back to task"), artifact);

  // 10. Escape → the task view.
  await send("Escape");
  const back = await waitFor((frame) => frame.includes("◧ v open diff") && changedRow(frame), 10000);
  check("Escape returns to the task view", back.includes("◧ v open diff") && !back.includes("esc back to task"), back);

  // 11. `j` onto the CHANGES a.ts row (focus moves to the rail), `o` → CODE file view.
  await send("j");
  await send("o");
  const code = await waitFor((frame) => frame.includes("CODE") && /1 │ export const a = 2/.test(frame), 10000);
  check("o on a changed file opens a CODE view with numbered lines", code.includes("CODE") && /1 │ export const a = 2/.test(code) && code.includes("/ src/a.ts"), code);

  // 12. `c` on line 1, type, Enter → the comment is on the task record.
  await send("c");
  await waitFor((frame) => frame.includes("comment on src/a.ts:1"), 6000);
  await Bun.sleep(200);
  await sendLiteral("probe artifact note");
  await Bun.sleep(200);
  await send("Enter");
  const noted = await waitFor((frame) => frame.includes("probe artifact note") && !frame.includes("comment on src/a.ts:1"), 8000);
  const record = tk("show", id);
  check("c on a line puts the comment on the record (tk show)", record.includes("probe artifact note") && record.includes("src/a.ts:1"), `${noted}\n---\n${record}`);

  // 09-10 checks
  // 13. TASKS column: two more working tasks, `]` / `[` switch the task view.
  const second = (JSON.parse(tk("create", "second probe task", "--json")) as { id: string }).id;
  const third = (JSON.parse(tk("create", "third probe task", "--json")) as { id: string }).id;
  const titles: Record<string, string> = { [id]: "probe task", [second]: "second probe task", [third]: "third probe task" };
  await send("Escape");
  await tmux("resize-window", "-t", session, "-x", "160", "-y", "40");
  const listed = await waitFor((frame) => frame.includes("TASKS") && frame.includes("● second probe task") && frame.includes("● third probe task") && frame.includes(`${id} · `), 12000);
  // Board order as the column shows it (rows are `▎● title` / ` ● title`).
  const order = listed.split("\n").flatMap((row) => {
    const match = /[▎ ]● ((?:second |third )?probe task)\b/.exec(row);
    return match === null ? [] : [Object.keys(titles).find((key) => titles[key] === match[1])!];
  });
  const step = (from: string, by: number): string => order[(order.indexOf(from) + by + order.length * 4) % order.length]!;
  const header = (frame: string, which: string): boolean => frame.includes(`${which} · `);
  const highlighted = (frame: string, which: string): boolean => frame.split("\n").some((row) => row.includes(`▎● ${titles[which]} `) || row.endsWith(`▎● ${titles[which]}`));
  await send("]");
  const next = step(id, 1);
  const switched = await waitFor((frame) => header(frame, next) && highlighted(frame, next), 8000);
  await send("[");
  const switchedBack = await waitFor((frame) => header(frame, id) && highlighted(frame, id), 8000);
  // A `]]` burst in one stdin write moves two rows (the handler steps from a ref, not a stale closure).
  await send("]", "]");
  const twoOn = step(id, 2);
  const burst = await waitFor((frame) => header(frame, twoOn), 8000);
  await Bun.sleep(600);
  const settled = await capture();
  check(
    "TASKS column lists the working tasks; ] / [ switch the task view; a ]] burst moves two rows",
    order.length === 3 && header(switched, next) && highlighted(switched, next) && switched.includes(RAIL_TABS)
      && header(switchedBack, id) && header(burst, twoOn) && header(settled, twoOn) && highlighted(settled, twoOn),
    `order=${order.join(",")}\n${listed}\n---\n${switched}\n---\n${switchedBack}\n---\n${settled}`,
  );
} finally {
  // Teardown on every path: tmux server + scratch repo (worktrees live under it).
  teardown();
}

console.log(`taskview-smoke: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
