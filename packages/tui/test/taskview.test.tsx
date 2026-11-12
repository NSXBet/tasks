import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { testRender } from "@opentui/react/test-utils";
import { taskStoreCommentStore } from "@tasks/review";
import { App } from "../src/app/App.js";
import { openTuiStore } from "../src/store.js";
import { inlineImageMode } from "@tasks/terminal-image";
import { LIVE_LINE, RAIL_TAB_ROW } from "../src/app/task.js";
import { MODAL_EXPAND_HINT } from "../src/app/diff.js";
import { cleanupFixtures, gitIn, scratchDir, slotsFor, tk, tkPlain, write, repoWithWork, repoWithIssue } from "./fixtures.js";
import { TASKS_MIN_WIDTH, workingTasks } from "../src/app/tasklist.js";
import type { Issue } from "@tasks/domain";
import { waitForFramePredicate, waitForFrameText, waitForFrameWithout } from "./wait.js";

afterEach(cleanupFixtures);

/** A 1×1 PNG. */
const PNG_1X1 = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (char) => char.charCodeAt(0));

/** The CHANGES row for `name`: `name [S] … ●`. */
const changesRow = (frame: string, name: string, status: string): boolean =>
  frame.split("\n").some((line) => line.includes(`${name} [${status}]`) && /\[[A-Z?]\]\s+●/.test(line.slice(line.indexOf(`${name} [`))));

const renderTask = async (repo: string, id: string, width = 140) => {
  const store = await openTuiStore(repo);
  const setup = await testRender(
    <App store={store} actor="tester" onQuit={() => {}} boot={slotsFor({ view: "task", detailId: id, targetId: id })} />,
    { width, height: 40, useThread: false },
  );
  return { store, setup };
};

describe("tui task view (09-03)", () => {
  test("CHANGES tab tree follows worktree edits live; tab cycles the rail", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    const { store, setup } = await renderTask(repo, id);
    try {
      const first = await waitForFramePredicate(setup, (frame) => frame.includes(RAIL_TAB_ROW) && changesRow(frame, "a.ts", "M"), 12000);
      expect(first).toContain("▸ src/");
      expect(first).toContain("↵ diff modal · tab next");
      // Edit only once the live watch runs (an edit before it subscribes is not an event).
      await waitForFrameText(setup, LIVE_LINE, 12000);

      // A new file from another process shows up with no key press (04-01 watch).
      write(worktree, "src/b.ts", "export const b = 1;\n");
      gitIn(worktree, "add", "-N", "src/b.ts");
      // The index lives outside the watched tree: re-touch the file so the last
      // worktree event lands after the intent-to-add.
      write(worktree, "src/b.ts", "export const b = 1;\n");
      const live = await waitForFramePredicate(setup, (frame) => changesRow(frame, "b.ts", "A"), 15000);
      expect(changesRow(live, "a.ts", "M")).toBe(true);

      // CHANGES → WORKSPC → MINIMAP.
      await setup.mockInput.pressTab();
      await waitForFrameText(setup, "host     ", 5000);
      await setup.mockInput.pressTab();
      const minimap = await waitForFrameText(setup, "↵ open in the diff modal", 5000);
      expect(minimap).not.toContain("↵ diff modal · tab next");
      // shift+tab goes back to WORKSPC.
      await setup.mockInput.pressTab({ shift: true });
      const back = await waitForFrameText(setup, "host     ", 5000);
      expect(back).not.toContain("↵ open in the diff modal");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("center column leads with the work: chips, open diff, artifacts, comments; every rail tab has data", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    const shots = scratchDir("tk-tui-taskview-png-");
    write(shots, "shot.png", PNG_1X1);
    tk(repo, "attach", id, "--evidence", `${shots}/shot.png`);
    const seed = await openTuiStore(repo);
    await taskStoreCommentStore(seed.surface.store).createThread(id, { filePath: "src/a.ts", line: 1, body: "is this bounded?\nsecond line", author: "kyle" });
    await seed.close();

    const { store, setup } = await renderTask(repo, id);
    try {
      const frame = await waitForFramePredicate(setup, (value) => value.includes("COMMENTS · 1") && value.includes("1 other") && changesRow(value, "a.ts", "M"), 15000);
      expect(frame).toContain("◧ v open diff");
      expect(frame).toContain("[ worktree ");
      expect(frame).toContain(`[ tk/${id} → `);
      expect(frame).toContain("ARTIFACTS — evidence on the task");
      expect(frame).toContain("0 src · 0 edit · 0 new · 1 other");
      expect(frame).toContain("UNREFERENCED (1)");
      expect(frame).toContain("shot.png");
      expect(frame).toContain("kyle: is this bounded?");
      expect(frame).toContain("→ src/a.ts:1");
      expect(frame).not.toContain("second line");
      expect(frame).not.toContain("s:start");
      // The work comes first: no sessions table until the SESSIONS tab is chosen.
      expect(frame).not.toContain("STATUS  SESSION");
      const lines = frame.split("\n");
      const row = (needle: string): number => lines.findIndex((line) => line.includes(needle));
      expect(row("◧ v open diff")).toBeLessThan(row("ARTIFACTS"));
      expect(row("ARTIFACTS")).toBeLessThan(row("COMMENTS · 1"));
      expect(row("COMMENTS · 1")).toBeLessThan(row("review  TUI"));

      await setup.mockInput.pressTab();
      const workspace = await waitForFrameText(setup, "host     ", 5000);
      expect(workspace).toMatch(/state\s+1 dirty/);
      await setup.mockInput.pressTab();
      const minimap = await waitForFrameText(setup, "a.ts#1", 5000);
      expect(minimap).toContain("█");
      await setup.mockInput.pressTab();
      const sessions = await waitForFrameText(setup, "STATUS  SESSION", 5000);
      expect(sessions).toContain("sessions live in the rail");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("below 100 columns the rail hides and the worktree chip stays", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    const { store, setup } = await renderTask(repo, id, 90);
    try {
      const frame = await waitForFrameText(setup, "◧ v open diff", 12000);
      const tail = worktree.slice(worktree.lastIndexOf("/") + 1);
      expect(frame).toContain("[ worktree ");
      expect(frame).toContain(tail.slice(0, 12));
      expect(frame).not.toContain("SESSIONS │");
      // Path only: the branch chip drops on narrow terminals.
      expect(frame).not.toContain(`[ tk/${id} → `);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 30000);

  test("a task with no worktree keeps the chip slot with the tk work hint", async () => {
    const repo = scratchDir("tk-tui-taskview-bare-");
    gitIn(repo, "init", "-q", "-b", "main");
    write(repo, "README.md", "x\n");
    gitIn(repo, "add", ".");
    gitIn(repo, "commit", "-q", "-m", "init");
    tk(repo, "init", "--prefix", "tk");
    const { id } = JSON.parse(tk(repo, "create", "no work yet")) as { id: string };
    const { store, setup } = await renderTask(repo, id, 90);
    try {
      expect(await waitForFrameText(setup, `[ no worktree — tk work ${id} ]`, 12000)).toContain("◧ v open diff");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 30000);

  test("ready-to-review never offers start-work: footer shows v:open diff, s toasts, v opens the diff", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    tk(repo, "update", id, "--status", "ready-to-review");
    const store = await openTuiStore(repo);
    const setup = await testRender(
      <App store={store} actor="tester" onQuit={() => {}} boot={slotsFor({ view: "list", detailId: id, targetId: id })} />,
      { width: 140, height: 40, useThread: false },
    );
    try {
      const frame = await waitForFrameText(setup, "v:open diff", 12000);
      expect(frame).not.toContain("s:start");
      await setup.mockInput.pressKey("s");
      await waitForFrameText(setup, "ready-to-review — v opens the diff", 5000);
      await Bun.sleep(300);
      const shown = JSON.parse(tk(repo, "show", id)) as ReadonlyArray<Record<string, unknown>>;
      expect(shown[0]!["status"]).toBe("ready-to-review");
      await setup.mockInput.pressKey("v");
      const diff = await waitForFrameText(setup, `tk/${id}`, 12000);
      expect(diff).toContain("q quit");
      await waitForFrameWithout(setup, "v:open diff", 5000);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);
});

describe("tui diff modal and evidence (09-04)", () => {
  test("↵ on a CHANGES file opens the diff modal over the task view; C files a whole-file comment; f expands to the full view", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    const { store, setup } = await renderTask(repo, id);
    try {
      await waitForFramePredicate(setup, (frame) => changesRow(frame, "a.ts", "M"), 12000);
      // Rows: `▸ src/` then `a.ts`.
      await setup.mockInput.pressKey("j");
      await Bun.sleep(100);
      setup.mockInput.pressEnter();
      const modal = await waitForFrameText(setup, MODAL_EXPAND_HINT, 8000);
      expect(modal).toContain(`${id} / src/a.ts`);
      expect(modal).toContain("[M] +1 −1");
      expect(modal).toContain("EDIT_A");
      expect(modal).toContain("C comment on the file");
      // The task view stays drawn behind the modal.
      expect(modal).toContain("live review");

      await setup.mockInput.pressKey("C");
      await waitForFrameText(setup, "comment on src/a.ts", 6000);
      expect(setup.captureCharFrame()).not.toMatch(/comment on src\/a\.ts:\d/);
      await setup.mockInput.typeText("whole file note");
      setup.mockInput.pressEnter();
      await waitForFrameText(setup, "tester: whole file note", 8000);
      const shown = tkPlain(repo, "show", id);
      expect(shown).toContain("src/a.ts");
      expect(shown).toContain("whole file note");

      await setup.mockInput.pressKey("f");
      const full = await waitForFrameWithout(setup, MODAL_EXPAND_HINT, 6000);
      expect(full).toMatch(/· \+1 −1/);
      expect(full).toContain("q quit");
      // The full view stays on the same file.
      expect(full).toMatch(/▌\s*[A-Z?]\s+a\.ts/);
      // esc in the diff view goes back to the list (ShellKeys).
      await setup.mockInput.pressEscape();
      await waitForFrameWithout(setup, "q quit", 6000);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("esc closes the modal back to the task view with the CHANGES cursor kept", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    write(worktree, "src/z.ts", "export const z = 2; // EDIT_Z\n");
    const { store, setup } = await renderTask(repo, id);
    try {
      await waitForFramePredicate(setup, (frame) => changesRow(frame, "a.ts", "M") && changesRow(frame, "z.ts", "M"), 12000);
      // Rows: `▸ src/`, `a.ts`, `z.ts`.
      await setup.mockInput.pressKey("j");
      await Bun.sleep(80);
      await setup.mockInput.pressKey("j");
      await Bun.sleep(80);
      setup.mockInput.pressEnter();
      const modal = await waitForFrameText(setup, `${id} / src/z.ts`, 8000);
      expect(modal).toContain("EDIT_Z");
      await setup.mockInput.pressEscape();
      const back = await waitForFrameWithout(setup, MODAL_EXPAND_HINT, 6000);
      expect(back).toContain(RAIL_TAB_ROW);
      expect(back).toContain("↵ diff modal · tab next");
      expect(back).toContain("◧ v open diff");
      // Same cursor: ↵ opens z.ts again (a dir row would open the first file needing review, a.ts).
      setup.mockInput.pressEnter();
      await waitForFrameText(setup, `${id} / src/z.ts`, 8000);
      await setup.mockInput.pressEscape();
      await waitForFrameWithout(setup, MODAL_EXPAND_HINT, 6000);
      // V opens the modal at the first file needing review.
      await setup.mockInput.pressKey("V");
      await waitForFrameText(setup, `${id} / src/a.ts`, 8000);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("EvidenceImage: the detail pane keeps its attachment rows; no inline mode off a TTY", async () => {
    expect(inlineImageMode({ mime: "image/png", isTTY: false, kittyGraphics: false })).toBeNull();
    const { repo, id } = repoWithWork();
    const shots = scratchDir("tk-tui-taskview-png-");
    write(shots, "shot.png", PNG_1X1);
    tk(repo, "attach", id, "--evidence", `${shots}/shot.png`);
    const store = await openTuiStore(repo);
    const setup = await testRender(
      <App store={store} actor="tester" onQuit={() => {}} boot={slotsFor({ view: "list", detailId: id, targetId: id })} />,
      { width: 140, height: 40, useThread: false },
    );
    try {
      const frame = await waitForFrameText(setup, "attachments", 12000);
      expect(frame).toContain("shot.png");
      expect(frame).toMatch(/ev-[a-z0-9]{6} · evidence/);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 30000);

  test("the full diff view walks past the files into EVIDENCE; c comments at evidence:<id>", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    const shots = scratchDir("tk-tui-taskview-png-");
    write(shots, "shot.png", PNG_1X1);
    tk(repo, "attach", id, "--evidence", `${shots}/shot.png`);
    const store = await openTuiStore(repo);
    const setup = await testRender(
      <App store={store} actor="tester" onQuit={() => {}} boot={slotsFor({ view: "diff", reviewId: id, detailId: id, targetId: id })} />,
      { width: 140, height: 40, useThread: false },
    );
    try {
      const first = await waitForFramePredicate(setup, (frame) => frame.includes("EDIT_A") && frame.includes("EVIDENCE · 1"), 12000);
      expect(first).toContain("▣ shot.png · 💬 0");
      let frame = first;
      for (let press = 0; press < 4 && !frame.includes("evidence · shot.png"); press++) {
        await setup.mockInput.pressKey("]");
        await Bun.sleep(150);
        frame = setup.captureCharFrame();
      }
      frame = await waitForFramePredicate(setup, (value) => value.includes("evidence · shot.png") && /▣ evidence:ev-[a-z0-9]{6} · shot\.png · 💬 0/.test(value), 6000);
      expect(frame).not.toContain("EDIT_A");
      const evId = /▣ evidence:(ev-[a-z0-9]{6})/.exec(frame)![1]!;
      // j/k are no-ops on evidence; `]` clamps at the last entry.
      await setup.mockInput.pressKey("j");
      await setup.mockInput.pressKey("]");
      await Bun.sleep(150);
      expect(setup.captureCharFrame()).toContain("evidence · shot.png");

      await setup.mockInput.pressKey("c");
      await waitForFrameText(setup, `comment on evidence:${evId}`, 6000);
      await setup.mockInput.typeText("this is the 500");
      setup.mockInput.pressEnter();
      const rail = await waitForFramePredicate(setup, (value) => value.includes("tester: this is the 500") && value.includes("💬 1"), 8000);
      expect(rail).toContain(`evidence:${evId}`);
      const comments = JSON.parse(tk(repo, "comments", id)) as unknown;
      expect(JSON.stringify(comments)).toContain(`"evidence:${evId}"`);
      expect(tkPlain(repo, "show", id)).toContain(`evidence:${evId}`);

      // `[` walks back onto the last file's last hunk.
      await setup.mockInput.pressKey("[");
      await waitForFrameText(setup, "EDIT_A", 6000);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("D-03 everywhere: the board task modal and the palette offer open diff, never start, on ready-to-review", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    tk(repo, "update", id, "--status", "ready-to-review");
    {
      const store = await openTuiStore(repo);
      const setup = await testRender(
        <App store={store} actor="tester" onQuit={() => {}} boot={slotsFor({ view: "board", modalId: id, targetId: id })} />,
        { width: 140, height: 40, useThread: false },
      );
      try {
        const modal = await waitForFrameText(setup, "v open diff · r/o status", 12000);
        expect(modal).not.toContain("s/r/o status");
        await setup.mockInput.pressKey("s");
        await waitForFrameText(setup, "ready-to-review — v opens the diff", 5000);
        await Bun.sleep(300);
        expect((JSON.parse(tk(repo, "show", id)) as ReadonlyArray<Record<string, unknown>>)[0]!["status"]).toBe("ready-to-review");
        await setup.mockInput.pressKey("v");
        const diff = await waitForFrameText(setup, "q quit", 12000);
        expect(diff).not.toContain("v open diff · r/o status");
      } finally {
        setup.renderer.destroy();
        await store.close();
      }
    }
    {
      const store = await openTuiStore(repo);
      const setup = await testRender(
        <App store={store} actor="tester" onQuit={() => {}} boot={slotsFor({ view: "list", targetId: id })} />,
        { width: 140, height: 40, useThread: false },
      );
      try {
        await waitForFrameText(setup, "live review", 12000);
        await setup.mockInput.pressKey(":");
        await waitForFrameText(setup, "go to Board", 6000);
        await setup.mockInput.pressKeys(["s", "t", "a"]);
        const started = await waitForFramePredicate(setup, (value) => !value.includes("go to Board"), 6000);
        expect(started).not.toContain("start (in progress)");
        await setup.mockInput.pressKey("\x1b");
        await waitForFrameWithout(setup, "↑↓ select", 6000);
        await setup.mockInput.pressKey(":");
        await waitForFrameText(setup, "go to Board", 6000);
        await setup.mockInput.pressKeys(["d", "i", "f"]);
        const palette = await waitForFramePredicate(setup, (value) => !value.includes("go to Board") && value.includes("open diff"), 6000);
        expect(palette).toContain("[v]");
        expect(palette).not.toContain("start (in progress)");
      } finally {
        setup.renderer.destroy();
        await store.close();
      }
    }
  }, 40000);
});

describe("tui artifact view (09-05)", () => {
  test("ARTIFACTS J/o opens a path attachment as a CODE file view; c files a line comment on the record", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\nexport const second = 3;\n");
    tk(repo, "attach", id, "src/a.ts");
    const { store, setup } = await renderTask(repo, id);
    try {
      await waitForFramePredicate(setup, (frame) => frame.includes("J/K select · o open") && changesRow(frame, "a.ts", "M"), 12000);
      await setup.mockInput.pressKey("J");
      await setup.mockInput.pressKey("o");
      const code = await waitForFramePredicate(setup, (frame) => frame.includes("CODE") && frame.includes("1 │ export const a"), 8000);
      expect(code).toContain(`${id} / src/a.ts`);
      expect(code).toContain("2 │ export const second");
      expect(code).toContain("COMMENTS · NO COMMENTS");
      // The diff workbench is not drawn here.
      expect(code).not.toContain("]/[ hunk");

      await setup.mockInput.pressKey("j");
      await Bun.sleep(80);
      await setup.mockInput.pressKey("c");
      await waitForFrameText(setup, "comment on src/a.ts:2", 6000);
      await Bun.sleep(150); // handlers re-bind after the composer frame draws
      await setup.mockInput.typeText("line note");
      setup.mockInput.pressEnter();
      const noted = await waitForFramePredicate(setup, (frame) => frame.includes("▸ tester: line note") && frame.includes("1 OPEN · 0 ✓"), 8000);
      const lines = noted.split("\n");
      const lineTwo = lines.findIndex((line) => line.includes("2 │ export const second"));
      expect(lines[lineTwo + 1]).toContain("▸ tester: line note");
      expect(noted).toContain("open src/a.ts:2");
      const shown = tkPlain(repo, "show", id);
      expect(shown).toContain("src/a.ts:2");
      expect(shown).toContain("line note");

      // C comments on the whole file.
      await setup.mockInput.pressKey("C");
      await waitForFramePredicate(setup, (frame) => frame.includes("comment on src/a.ts") && !/comment on src\/a\.ts:\d/.test(frame), 6000);
      await setup.mockInput.pressEscape();
      await waitForFrameWithout(setup, "comment on src/a.ts", 6000);
      // esc returns to the task view.
      await setup.mockInput.pressEscape();
      await waitForFrameText(setup, "◧ v open diff", 6000);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("a path outside the worktree is refused and never read", async () => {
    const { repo, id } = repoWithWork();
    const outside = scratchDir("tk-tui-artifact-outside-");
    write(outside, "secret.txt", "TOP_SECRET\n");
    tk(repo, "attach", id, `../${outside.slice(outside.lastIndexOf("/") + 1)}/secret.txt`);
    const { store, setup } = await renderTask(repo, id);
    try {
      await waitForFrameText(setup, "J/K select · o open", 12000);
      await setup.mockInput.pressKey("o");
      const refused = await waitForFrameText(setup, "refused: outside the worktree", 8000);
      expect(refused).not.toContain("TOP_SECRET");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 30000);

  test("a .md artifact renders as a DOC; c comments the block's line range", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "docs/task.md", "# Plan\n\nstep one\nstep two\n\n- a\n- b\n");
    tk(repo, "attach", id, "docs/task.md");
    const { store, setup } = await renderTask(repo, id);
    try {
      await waitForFrameText(setup, "J/K select · o open", 12000);
      await setup.mockInput.pressKey("o");
      const doc = await waitForFramePredicate(setup, (frame) => frame.includes("DOC") && frame.includes("· a"), 8000);
      expect(doc).toContain(`${id} / docs/task.md`);
      expect(doc).toContain("Plan");
      expect(doc).not.toContain("# Plan");
      expect(doc).toContain("· b");
      expect(doc).toContain("selection → lines 1–1 (c)");

      await setup.mockInput.pressKey("j");
      await waitForFrameText(setup, "selection → lines 3–4 (c)", 6000);
      await setup.mockInput.pressKey("c");
      await waitForFrameText(setup, "comment on docs/task.md:3-4", 6000);
      await Bun.sleep(150); // handlers re-bind after the composer frame draws
      await setup.mockInput.typeText("block note");
      setup.mockInput.pressEnter();
      const noted = await waitForFrameText(setup, "▸ tester: block note", 8000);
      const lines = noted.split("\n");
      // The thread renders under its block (after `step two`, before the list).
      expect(lines.findIndex((line) => line.includes("step two"))).toBeLessThan(lines.findIndex((line) => line.includes("▸ tester: block note")));
      expect(lines.findIndex((line) => line.includes("▸ tester: block note"))).toBeLessThan(lines.findIndex((line) => line.includes("· a")));
      expect(tk(repo, "comments", id)).toContain("docs/task.md:3-4");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("an evidence artifact renders EVIDENCE with its caption; c comments at evidence:<id>", async () => {
    const { repo, id } = repoWithWork();
    const shots = scratchDir("tk-tui-taskview-png-");
    write(shots, "shot.png", PNG_1X1);
    tk(repo, "attach", id, "--evidence", `${shots}/shot.png`);
    const { store, setup } = await renderTask(repo, id);
    try {
      await waitForFrameText(setup, "J/K select · o open", 12000);
      await setup.mockInput.pressKey("o");
      const shown = await waitForFramePredicate(setup, (frame) => frame.includes("EVIDENCE") && /▣ evidence:ev-[a-z0-9]{6}/.test(frame), 8000);
      const evId = /▣ evidence:(ev-[a-z0-9]{6})/.exec(shown)![1]!;
      await setup.mockInput.pressKey("c");
      await waitForFrameText(setup, `comment on evidence:${evId}`, 6000);
      await Bun.sleep(150); // handlers re-bind after the composer frame draws
      await setup.mockInput.typeText("evidence note");
      setup.mockInput.pressEnter();
      await waitForFramePredicate(setup, (frame) => frame.includes("▸ tester: evidence note") && frame.includes("💬 1"), 8000);
      expect(tk(repo, "comments", id)).toContain(`"evidence:${evId}"`);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 30000);

  test("the diff view hands the selected file to the artifact view with o; the CHANGES row opens with o too", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    const store = await openTuiStore(repo);
    const setup = await testRender(
      <App store={store} actor="tester" onQuit={() => {}} boot={slotsFor({ view: "diff", reviewId: id, detailId: id, targetId: id })} />,
      { width: 140, height: 40, useThread: false },
    );
    try {
      const diff = await waitForFrameText(setup, "EDIT_A", 12000);
      expect(diff).toContain("o open as file");
      await setup.mockInput.pressKey("o");
      const code = await waitForFramePredicate(setup, (frame) => frame.includes("CODE") && frame.includes("1 │ export const a = 2; // EDIT_A"), 8000);
      expect(code).toContain(`${id} / src/a.ts`);
      // esc → the task view; no artifacts attached, so `o` opens from the CHANGES rail row.
      await setup.mockInput.pressEscape();
      await waitForFramePredicate(setup, (frame) => frame.includes("◧ v open diff") && changesRow(frame, "a.ts", "M"), 8000);
      await setup.mockInput.pressKey("j");
      await Bun.sleep(80);
      await setup.mockInput.pressKey("o");
      await waitForFramePredicate(setup, (frame) => frame.includes("CODE") && frame.includes(`${id} / src/a.ts`), 8000);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);
});

describe("tui task view TASKS column (09-10, R34)", () => {
  const issueStub = (id: string, status: string): Issue => ({ id, status, title: id } as unknown as Issue);

  test("workingTasks drops closed / archived / deferred, keeps board order, appends the shown task", () => {
    const board = [issueStub("a", "in_progress"), issueStub("c", "closed"), issueStub("b", "open"), issueStub("d", "deferred"), issueStub("e", "archived"), issueStub("f", "ready-to-review")];
    expect(workingTasks(board, "a").map((issue) => issue.id)).toEqual(["a", "b", "f"]);
    expect(workingTasks(board, "c").map((issue) => issue.id)).toEqual(["a", "b", "f", "c"]);
    expect(workingTasks(board, null).map((issue) => issue.id)).toEqual(["a", "b", "f"]);
    expect(workingTasks(board, "missing").map((issue) => issue.id)).toEqual(["a", "b", "f"]);
    expect(TASKS_MIN_WIDTH).toBe(130);
  });

  /** Three tasks: A in progress, B open, C closed. */
  const threeTasks = () => {
    const { repo, id: a } = repoWithIssue();
    tk(repo, "update", a, "--status", "in_progress");
    const b = (JSON.parse(tk(repo, "create", "second task")) as { id: string }).id;
    const c = (JSON.parse(tk(repo, "create", "closed task")) as { id: string }).id;
    tk(repo, "close", c);
    return { repo, a, b, c };
  };

  const renderAt = async (repo: string, id: string, width: number) => {
    const store = await openTuiStore(repo);
    const setup = await testRender(
      <App store={store} actor="tester" onQuit={() => {}} boot={slotsFor({ view: "task", detailId: id, targetId: id })} />,
      { width, height: 40, useThread: false },
    );
    return { store, setup };
  };

  /** The TASKS row line holding `title`. */
  const rowOf = (frame: string, title: string): string => frame.split("\n").find((line) => line.includes(`● ${title}`)) ?? "";

  test("lists the working tasks with the shown one highlighted; ] / [ switch and wrap; a click switches", async () => {
    const { repo, a, b } = threeTasks();
    const { store, setup } = await renderAt(repo, a, 160);
    try {
      const frame = await waitForFramePredicate(setup, (value) => value.includes("TASKS") && value.includes(`${a} · in_progress`) && value.includes(RAIL_TAB_ROW), 12000);
      expect(frame).toContain("● live review");
      expect(frame).toContain("● second task");
      expect(frame).not.toContain("closed task");
      expect(frame).toContain("VIEWS");
      expect(frame).toContain("[ ] switch task");
      expect(rowOf(frame, "live review")).toContain("▎");
      expect(rowOf(frame, "second task")).not.toContain("▎");

      await setup.mockInput.pressKey("]");
      const second = await waitForFrameText(setup, `${b} · open`, 6000);
      expect(rowOf(second, "second task")).toContain("▎");
      expect(rowOf(second, "live review")).not.toContain("▎");
      expect(second).toContain(RAIL_TAB_ROW);

      await setup.mockInput.pressKey("[");
      const back = await waitForFrameText(setup, `${a} · in_progress`, 6000);
      expect(rowOf(back, "live review")).toContain("▎");
      // `[` on the first row wraps to the last working row.
      await setup.mockInput.pressKey("[");
      await waitForFrameText(setup, `${b} · open`, 6000);
      await setup.mockInput.pressKey("]");
      await waitForFrameText(setup, `${a} · in_progress`, 6000);

      // A click on B's row switches the task view to B.
      const lines = (await waitForFrameText(setup, "● second task", 3000)).split("\n");
      const y = lines.findIndex((line) => line.includes("● second task"));
      const x = lines[y]!.indexOf("second task");
      await setup.mockMouse.click(x, y);
      const clicked = await waitForFrameText(setup, `${b} · open`, 6000);
      expect(rowOf(clicked, "second task")).toContain("▎");
      expect(clicked).toContain(RAIL_TAB_ROW);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("a closed shown task is still listed and highlighted", async () => {
    const { repo, c } = threeTasks();
    const { store, setup } = await renderAt(repo, c, 160);
    try {
      const frame = await waitForFramePredicate(setup, (value) => value.includes("TASKS") && value.includes(`${c} · closed`), 12000);
      expect(rowOf(frame, "closed task")).toContain("▎");
      expect(frame).toContain("● second task");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 30000);

  test("below 130 columns the TASKS column hides and the center column still renders", async () => {
    const { repo, a } = threeTasks();
    const { store, setup } = await renderAt(repo, a, 120);
    try {
      const frame = await waitForFrameText(setup, "◧ v open diff", 12000);
      expect(frame).toContain(`${a} · in_progress`);
      expect(frame).not.toContain("TASKS");
      expect(frame).not.toContain("● second task");
      expect(frame).toContain(RAIL_TAB_ROW);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 30000);
});

/* ------------------------------------------------------------------ */
/* 11-05: WORKSPC `C commit` / `P open pr`.                              */
/* ------------------------------------------------------------------ */

const FAKE_GH = `${import.meta.dir}/../../cli/test/fixtures/gh`;

/** repoWithWork + repo-local identity (no gpg), a bare origin, and a fake-gh wrapper with its state/log baked in. */
const workspcRepo = () => {
  const work = repoWithWork();
  gitIn(work.repo, "config", "user.name", "t");
  gitIn(work.repo, "config", "user.email", "t@e");
  gitIn(work.repo, "config", "commit.gpgsign", "false");
  const side = scratchDir("tk-tui-gh-");
  gitIn(side, "init", "-q", "--bare", `${side}/origin.git`);
  gitIn(work.repo, "remote", "add", "origin", `${side}/origin.git`);
  gitIn(work.repo, "push", "-q", "origin", "main");
  write(side, "gh-state/.keep", "");
  write(side, "gh-fixture", readFileSync(FAKE_GH));
  chmodSync(`${side}/gh-fixture`, 0o755);
  write(side, "gh", `#!/bin/sh\nFAKE_GH_DIR='${side}/gh-state' FAKE_GH_LOG='${side}/gh.log' exec '${side}/gh-fixture' "$@"\n`);
  chmodSync(`${side}/gh`, 0o755);
  return { ...work, gh: `${side}/gh`, log: `${side}/gh.log` };
};

const gitOut = (dir: string, ...args: readonly string[]): string =>
  new TextDecoder().decode(Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" }).stdout).trim();

describe("tui WORKSPC actions (11-05)", () => {
  const savedGh = process.env["TK_GH"];
  afterEach(() => { if (savedGh === undefined) delete process.env["TK_GH"]; else process.env["TK_GH"] = savedGh; });

  test("C commits tracked changes through the commit composer; an empty message refuses", async () => {
    const { repo, id, worktree } = workspcRepo();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    const head = gitOut(worktree, "rev-parse", "HEAD");
    const { store, setup } = await renderTask(repo, id);
    try {
      await waitForFramePredicate(setup, (frame) => frame.includes(RAIL_TAB_ROW) && changesRow(frame, "a.ts", "M"), 12000);
      await setup.mockInput.pressTab();
      const panel = await waitForFrameText(setup, "host     ", 5000);
      expect(panel).toContain("[C] commit  [P] open pr");
      expect(panel).toMatch(/pr\s+—/);

      // Empty message: the refusal is shown, no commit.
      await setup.mockInput.pressKey("C");
      await waitForFrameText(setup, `commit ${id}`, 5000);
      await setup.mockInput.pressKey("\r");
      await waitForFrameText(setup, "commit message is empty", 5000);
      expect(gitOut(worktree, "rev-parse", "HEAD")).toBe(head);

      await setup.mockInput.pressKey("C");
      await waitForFrameText(setup, "commit message (tracked + staged", 5000);
      await setup.mockInput.typeText("tui: commit");
      await setup.mockInput.pressKey("\r");
      await waitForFrameText(setup, "✓ committed", 10000);
      expect(gitOut(worktree, "log", "-1", "--format=%s")).toBe("tui: commit");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("P opens the PR through the fake gh and the WORKSPC panel shows it; on CHANGES, C/P do nothing", async () => {
    const { repo, id, gh, log, worktree } = workspcRepo();
    // A pending edit keeps CHANGES the default rail tab (an empty worktree opens on SESSIONS).
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    process.env["TK_GH"] = gh;
    const { store, setup } = await renderTask(repo, id);
    try {
      await waitForFramePredicate(setup, (frame) => frame.includes(RAIL_TAB_ROW) && changesRow(frame, "a.ts", "M"), 12000);
      // CHANGES tab: C / P are inert.
      await setup.mockInput.pressKey("P");
      await setup.mockInput.pressKey("C");
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(setup.captureCharFrame()).not.toContain(`commit ${id}`);
      expect(existsSync(log)).toBe(false);

      await setup.mockInput.pressTab();
      await waitForFrameText(setup, "host     ", 5000);
      await setup.mockInput.pressKey("P");
      await waitForFrameText(setup, "PR #7", 15000);
      const panel = await waitForFrameText(setup, "pr       PR #7 · open", 10000);
      expect(panel).toContain("pr       PR #7 · open");
      const shown = JSON.parse(tk(repo, "show", id)) as ReadonlyArray<{ metadata: { pr?: { number: number } } }>;
      expect(shown[0]!.metadata.pr?.number).toBe(7);
      expect(readFileSync(log, "utf8").split("\n").filter((line) => line.startsWith("pr create"))).toHaveLength(1);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);
});
