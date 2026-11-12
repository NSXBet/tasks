#!/usr/bin/env bun
/**
 * Real-terminal probe of the `tk review <id>` loop (phase 4 SC-1..SC-4 + the
 * branchless empty state). Drives the real CLI inside tmux — same harness as
 * smoke.ts (own `-S` socket, config-free server, capture-pane polling):
 *
 *   1. scratch git repo + `tk init` / `tk create` ×2 / `tk work <id>`, one commit in the worktree
 *   2. `tk review <id>` opens over the tk-derived diff                    (SC-1)
 *      and shows `watching worktree — re-derives as commits land ●`       (gap 2)
 *   3. a commit from this process (the "second terminal") re-renders it   (SC-2)
 *      then `/ live ↵` file search selects src/live.ts                    (spec bar)
 *   4. `,` back to src/a.ts; `2` / `1` switch split / unified in place   (hunk keys)
 *   5. `]` `e` edit the hunk inline, ctrl+s writes the worktree file      (SC-3)
 *   6. `c` comment → a fresh `tk show <id>` lists it on the record        (SC-4)
 *   7. `tk review <id2>` on a branchless task shows the `tk work` hint    (D-01)
 *   8. `q` quits the TUI (hunk app.quit)
 *
 * Not a `*.test.*` file, so `bun test` never collects it. Needs tmux and git.
 * Run: `bun packages/tui/test/review-smoke.ts`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "../../..");
const TK = join(REPO, "packages/cli/src/tk.ts");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "tk-review-smoke-")));
const sock = join(scratch, "tmux.sock");
const session = `tkrev-${process.pid}`;

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
const alive = async (): Promise<boolean> => (await tmux("has-session", "-t", session)).code === 0;

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
const waitUntil = async (predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await Bun.sleep(200);
  }
  return false;
};

/** The nav's selected file (`▌  M a.ts`). */
const selectedFile = (frame: string): string | null => /▌\s*[A-Z?]\s+(\S+\.ts)/.exec(frame)?.[1] ?? null;

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, evidence = ""): void => {
  if (ok) { pass++; console.log(`  ok ${pass}: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name}`); if (evidence !== "") console.error(evidence); }
};

const launch = async (id: string): Promise<void> => {
  if (await alive()) await tmux("kill-session", "-t", session);
  const started = Bun.spawnSync(
    ["tmux", "-S", sock, "-f", "/dev/null", "new-session", "-d", "-s", session, "-x", "140", "-y", "40", process.execPath, TK, "-C", scratch, "review", id],
    { cwd: scratch, env: { ...process.env, TERM: "xterm-256color" }, stdout: "pipe", stderr: "pipe" },
  );
  if (started.exitCode !== 0) die(`tmux launch failed: ${decode(started.stderr)}`);
};

const quitWith = async (key: string): Promise<boolean> => {
  await send(key);
  return waitUntil(async () => !(await alive()), 8000);
};
const quit = (): Promise<boolean> => quitWith("C-q");

/** Split layout: some row shows the old and the new side of line 3 (`const v3` twice). */
const splitRow = (frame: string): boolean => frame.split("\n").some((row) => row.split("const v3").length > 2);
/** The list view's filter tabs — present only if `1` fell through to the shell's view switch. */
const listTabs = (frame: string): boolean => frame.includes(" all  ready  open ");

try {
  // 1. Scratch repo, two tasks, `tk work` on the first, one commit in its worktree.
  git(scratch, "init", "-q", "-b", "main");
  const original = Array.from({ length: 8 }, (_, index) => `export const v${index + 1} = ${index + 1};`).join("\n") + "\n";
  writeIn(scratch, "src/a.ts", original);
  git(scratch, "add", ".");
  git(scratch, "commit", "-q", "-m", "init");
  tk("init", "--prefix", "tk");
  const id = (JSON.parse(tk("create", "review probe", "--json")) as { id: string }).id;
  const id2 = (JSON.parse(tk("create", "no branch", "--json")) as { id: string }).id;
  tk("work", id);
  const shown = JSON.parse(tk("show", id, "--json")) as ReadonlyArray<Record<string, unknown>>;
  const worktree = String(shown[0]?.["worktree"] ?? "");
  if (worktree === "" || !existsSync(worktree)) die(`tk work recorded no worktree: ${JSON.stringify(shown[0])}`);
  const lines = original.split("\n");
  lines[2] = "export const v3 = 30; // probe change";
  lines[3] = "export const v4 = 40; // probe change";
  writeIn(worktree, "src/a.ts", lines.join("\n"));
  git(worktree, "commit", "-q", "-am", "probe change");

  // 2. SC-1: tk review opens over the tk-derived diff.
  await launch(id);
  const opened = await waitFor((frame) => selectedFile(frame) === "a.ts" && frame.includes(`tk/${id}`) && frame.includes("probe change"), 20000);
  check("tk review opens the tk-derived diff", (opened.includes("src/a.ts") || (opened.includes("src/") && opened.includes("a.ts"))) && opened.includes(`tk/${id}`), opened);
  const watching = await waitFor((frame) => frame.includes("watching worktree — re-derives as commits land ●"), 10000);
  check("watching indicator", watching.includes("watching worktree — re-derives as commits land ●"), watching);

  // 3. SC-2: a commit from a second process re-renders with no key sent.
  await Bun.sleep(1000); // let the watcher settle
  writeIn(worktree, "src/live.ts", "export const live = 1;\n");
  git(worktree, "add", "src/live.ts");
  git(worktree, "commit", "-q", "-m", "live");
  const live = await waitFor((frame) => frame.includes("live.ts"), 10000);
  check("commit re-renders live", live.includes("live.ts"), live);

  // `/` file search: the next changed file whose path contains `live`.
  await send("/");
  await waitFor((frame) => frame.includes("/ search files"), 4000);
  await sendLiteral("live");
  await Bun.sleep(200);
  await send("Enter");
  const searched = await waitFor((frame) => selectedFile(frame) === "live.ts" && !frame.includes("/ search files"), 6000);
  check("search selects file", selectedFile(searched) === "live.ts", searched);

  // 4. Hunk keys: `,` back to src/a.ts, then `2` / `1` switch layout without leaving the diff view.
  for (let step = 0; step < 4 && selectedFile(await capture()) !== "a.ts"; step++) {
    await send(",");
    await Bun.sleep(300);
  }
  await send("2");
  await Bun.sleep(400);
  const split = await waitFor((frame) => splitRow(frame), 4000);
  await send("1");
  await Bun.sleep(400);
  const unified = await waitFor((frame) => !splitRow(frame) && frame.includes("v3"), 4000);
  check(
    "layout keys stay in the diff view",
    selectedFile(split) === "a.ts" && splitRow(split) && split.includes(`tk/${id}`) && !listTabs(split)
      && !splitRow(unified) && unified.includes(`tk/${id}`) && !listTabs(unified),
    `${split}\n---\n${unified}`,
  );

  // 5. SC-3: open the inline hunk buffer on the first hunk, add a line, save.
  await send("]");
  await Bun.sleep(300);
  await send("e");
  const editing = await waitFor((frame) => frame.includes("✎ edit"), 8000);
  if (!editing.includes("✎ edit")) console.error(editing);
  await send("End");
  await Bun.sleep(150);
  await send("Enter");
  await Bun.sleep(150);
  await sendLiteral("// probe-edit");
  await Bun.sleep(300);
  await send("C-s");
  const persisted = await waitUntil(() => readFileSync(join(worktree, "src/a.ts"), "utf8").includes("// probe-edit"), 8000);
  const edited = await waitFor((frame) => frame.includes("// probe-edit") && !frame.includes("✎ edit"), 8000);
  check("edit persisted", persisted && edited.includes("// probe-edit"), `${readFileSync(join(worktree, "src/a.ts"), "utf8")}\n${edited}`);

  // 6. SC-4: comment from the TUI; a fresh `tk show` reads it off the record.
  await send("c");
  await waitFor((frame) => frame.includes("comment on src/a.ts"), 6000);
  await sendLiteral("probe comment");
  await Bun.sleep(200);
  await send("Enter");
  const commented = await waitFor((frame) => frame.includes("probe comment") && !frame.includes("comment on src/a.ts"), 8000);
  const ended = await quit();
  const record = ended ? tk("show", id) : "";
  check("comment on the record", ended && record.includes("REVIEW (1)") && record.includes("probe comment"), `${commented}\n---\n${record}`);

  // 7. D-01: a branchless task shows the tk work hint.
  await launch(id2);
  const empty = await waitFor((frame) => frame.includes("no branch yet — run tk work"), 20000);
  check("branchless empty state", empty.includes("no branch yet — run tk work"), empty);

  // 8. `q` quits (hunk app.quit), with no ctrl modifier.
  check("q quits", await quitWith("q"));
} finally {
  // 9. Teardown on every path: tmux server + scratch repo (worktrees live under it or are pruned with it).
  teardown();
}

if (fail > 0) {
  console.error(`review-smoke: ${fail} failed, ${pass} ok`);
  process.exit(1);
}
console.log(`review-smoke: all green (${pass} checks)`);
