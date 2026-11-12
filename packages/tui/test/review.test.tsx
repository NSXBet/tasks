import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { ProcessRunner } from "@tasks/git";
import type { Issue } from "@tasks/domain";
import { waitForFramePredicate, waitForFrameText } from "./wait.js";
import { App } from "../src/app/App.js";
import { openTuiStore } from "../src/store.js";
import { resolveReviewSource, type ReviewSource } from "../src/review/source.js";
import { startReviewWatch } from "../src/review/live.js";
import { WATCHING_LINE } from "../src/app/diff.js";
import { HUNK_DIFF_THEME_NAMES } from "@tasks/review/opentui";
import { taskStoreCommentStore } from "@tasks/review";
import type { BootSlots } from "../src/app/routes.js";

/** Plain-launch defaults with per-test overrides, matching App's boot contract. */
const slotsFor = (overrides: Partial<BootSlots>): BootSlots => ({
  view: "list",
  detailId: null,
  helpOpen: false,
  modalId: null,
  diffOpen: false,
  reviewId: null,
  graphId: null,
  composer: { mode: "closed", forId: null, initial: "", confirm: null, review: null },
  targetId: null,
  ...overrides,
});

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* tmp cleanup best effort */ }
  }
});

const decode = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes ?? new Uint8Array());

const tk = (repo: string, ...args: readonly string[]): string => {
  const result = Bun.spawnSync([process.execPath, executable, "-C", repo, ...args, "--json"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`tk ${args.join(" ")} failed: ${decode(result.stderr)}`);
  return decode(result.stdout);
};

const gitIn = (dir: string, ...args: readonly string[]): void => {
  const result = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@e", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${decode(result.stderr)}`);
};

const write = (dir: string, path: string, text: string): void => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), text);
};

/** A git repo with one commit, a tk workspace, and one issue with no branch. */
const repoWithIssue = (aContents = "export const a = 1;\n"): { readonly repo: string; readonly id: string } => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "tk-tui-review-"))); // macOS /var → /private/var
  dirs.push(repo);
  gitIn(repo, "init", "-q", "-b", "main");
  write(repo, "src/a.ts", aContents);
  write(repo, "src/z.ts", "export const z = 1;\n");
  gitIn(repo, "add", ".");
  gitIn(repo, "commit", "-q", "-m", "init");
  tk(repo, "init", "--prefix", "tk");
  const created = JSON.parse(tk(repo, "create", "live review")) as { id: string };
  return { repo, id: created.id };
};

/** `repoWithIssue` plus `tk work <id>`: the issue has a branch, a worktree, and a pinned base. */
const repoWithWork = (aContents?: string): { readonly repo: string; readonly id: string; readonly worktree: string } => {
  const { repo, id } = repoWithIssue(aContents);
  tk(repo, "work", id);
  const shown = JSON.parse(tk(repo, "show", id)) as ReadonlyArray<Record<string, unknown>>;
  const worktree = shown[0]!["worktree"] as string;
  return { repo, id, worktree };
};

/**
 * The file the nav marks as selected (`▌ M a.ts`). The nav renders a
 * directory tree, so `src/a.ts` shows as `src/` over `a.ts`.
 */
const selectedFile = (frame: string): string | null => /▌\s*[A-Z?]\s+(\S+\.ts)/.exec(frame)?.[1] ?? null;

/** Sum of `+N` from the diff stats line (`tk/<id> ← <base> · +N −M`). */
const additions = (frame: string): number => {
  const match = /· \+(\d+) −\d+/.exec(frame);
  return match === null ? -1 : Number(match[1]);
};

const renderDiff = async (repo: string, id: string, onQuit: () => void = () => {}, width = 140) => {
  const store = await openTuiStore(repo);
  const setup = await testRender(
    <App store={store} actor="tester" onQuit={onQuit} boot={slotsFor({ view: "diff", reviewId: id, targetId: id })} />,
    { width, height: 40, useThread: false },
  );
  return { store, setup };
};

describe("tui live review", () => {
  test("tk review after tk work opens the tk-derived diff with no branch linking", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    gitIn(worktree, "commit", "-q", "-am", "edit a");
    const { store, setup } = await renderDiff(repo, id);
    try {
      const frame = await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes(`tk/${id}`), 12000);
      expect(frame).toContain("src/");
      expect(frame).toContain("export const a");
      // The live watcher is running: the spec's indicator line is on the page.
      expect(await waitForFrameText(setup, `${WATCHING_LINE} ●`, 12000)).toContain(`${WATCHING_LINE} ●`);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 30000);

  test("a commit from another process re-renders the diff live, keeping the selection", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    gitIn(worktree, "commit", "-q", "-am", "edit a");
    const { store, setup } = await renderDiff(repo, id);
    try {
      const first = await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && additions(value) > 0, 12000);
      const before = additions(first);
      expect(before).toBeGreaterThan(0);
      expect(first).not.toContain("live.ts");

      // Let the watcher finish starting before the second process writes.
      await Bun.sleep(750);
      write(worktree, "src/live.ts", "export const live = 1;\nexport const more = 2;\n");
      gitIn(worktree, "add", "src/live.ts");
      gitIn(worktree, "commit", "-q", "-m", "live");

      let sawLoading = false;
      const live = await waitForFramePredicate(setup, (value) => {
        if (value.includes("resolving review source")) sawLoading = true;
        return value.includes("live.ts");
      }, 12000);
      expect(sawLoading).toBe(false);
      // Stats may land a frame after the nav; poll until the totals move.
      const grown = await waitForFramePredicate(setup, (value) => additions(value) > before, 4000);
      expect(additions(grown)).toBeGreaterThan(before);
      // The selected file is still src/a.ts.
      expect(selectedFile(live)).toBe("a.ts");
      expect(selectedFile(grown)).toBe("a.ts");
      // A live re-render keeps the watch (and its indicator) running.
      expect(grown).toContain(`${WATCHING_LINE} ●`);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("an untracked new file (never git-added) appears live (tasks-n5xi)", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    const { store, setup } = await renderDiff(repo, id);
    try {
      const first = await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes(`${WATCHING_LINE} ●`), 12000);
      expect(first).not.toContain("fresh.ts");
      // Let the watcher finish starting before the second process writes.
      await Bun.sleep(750);
      write(worktree, "src/fresh.ts", "export const fresh = 1;\n"); // NO git add, NO add -N
      const live = await waitForFrameText(setup, "fresh.ts", 12000);
      expect(live).toContain("fresh.ts");
      const page = await store.surface.all();
      if (!page.ok) throw new Error(page.error.message);
      const issue = page.value.find((entry) => entry.id === id)!;
      const source = await resolveReviewSource(issue, repo);
      expect(source.stats).toContainEqual(expect.objectContaining({ path: "src/fresh.ts", status: "A" }));
      // The index stays untouched: nothing staged.
      const cached = Bun.spawnSync(["git", "diff", "--cached", "--name-only"], { cwd: worktree, stdout: "pipe" });
      expect(decode(cached.stdout).trim()).toBe("");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("a live refresh keeps the selected file by path when its index moves", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    write(worktree, "src/z.ts", "export const z = 2; // EDIT_Z\n");
    gitIn(worktree, "commit", "-q", "-am", "edit a and z");
    const { store, setup } = await renderDiff(repo, id);
    try {
      await waitForFramePredicate(setup, (value) => value.includes("z.ts") && selectedFile(value) === "a.ts", 12000);
      await setup.mockInput.pressKey(".");
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "z.ts", 6000);
      await Bun.sleep(750);
      // src/live.ts sorts between a and z, so z's index moves from 1 to 2.
      write(worktree, "src/live.ts", "export const live = 1; // EDIT_LIVE\n");
      gitIn(worktree, "add", "src/live.ts");
      gitIn(worktree, "commit", "-q", "-m", "live");
      const frame = await waitForFrameText(setup, "live.ts", 12000);
      expect(selectedFile(frame)).toBe("z.ts");
      expect(frame).toContain("export const z");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("a branchless task shows the tk work hint in the diff view", async () => {
    const { repo, id } = repoWithIssue();
    write(repo, "src/a.ts", "export const a = 3; // DIRTY\n");
    const { store, setup } = await renderDiff(repo, id);
    try {
      const frame = await waitForFrameText(setup, `no branch yet — run tk work ${id}`, 12000);
      expect(frame).not.toContain("HEAD");
      expect(frame).not.toContain("a.ts");
      expect(frame).not.toContain("DIRTY");
      // No controller runs for a branchless source, so no indicator either.
      await Bun.sleep(1500);
      expect(setup.captureCharFrame()).not.toContain("watching worktree");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 30000);

  test("a branchless task's review rail shows the tk work hint", async () => {
    const { repo, id } = repoWithIssue();
    const store = await openTuiStore(repo);
    const setup = await testRender(
      <App store={store} actor="tester" onQuit={() => {}} boot={slotsFor({ view: "task", detailId: id, targetId: id })} />,
      { width: 160, height: 60, useThread: false },
    );
    try {
      const frame = await waitForFrameText(setup, "no branch yet", 12000);
      expect(frame).toContain(`tk work ${id}`.slice(0, 10));
      expect(frame).not.toContain("branch —");
      expect(frame).not.toContain("base HEAD");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 30000);

  test("startReviewWatch on an errored source starts nothing: watching false, stop callable", async () => {
    const source: ReviewSource = { issueId: "tk-x", branch: "tk/x", cwd: tmpdir(), base: "HEAD", files: [], additions: 0, deletions: 0, empty: null, error: "x" };
    const handle = await startReviewWatch({ source, onChange: () => {}, onError: () => {} });
    expect(handle.watching).toBe(false);
    expect(() => handle.stop()).not.toThrow();
  });

  test("the compact diff modal and the artifact view never show the watching indicator", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    gitIn(worktree, "commit", "-q", "-am", "edit a");
    for (const slots of [
      slotsFor({ view: "list", diffOpen: true, reviewId: id, targetId: id }),
      slotsFor({ view: "artifact", detailId: id, reviewId: id, targetId: id }),
    ]) {
      const store = await openTuiStore(repo);
      const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} boot={slots} />, { width: 140, height: 40, useThread: false });
      try {
        // The modal is file-scoped (09-04): its header names the file; the artifact view's nav marks it.
        await waitForFramePredicate(setup, (value) => (selectedFile(value) === "a.ts" || value.includes(`${id} / src/a.ts`)) && value.includes("EDIT_A"), 12000);
        await Bun.sleep(1500); // long enough for the watch to have started
        expect(setup.captureCharFrame()).not.toContain("watching worktree");
      } finally {
        setup.renderer.destroy();
        await store.close();
      }
    }
  }, 60000);

  test("resolveReviewSource never diffs the workspace for a branchless issue", async () => {
    const { repo, id } = repoWithIssue();
    write(repo, "src/a.ts", "export const a = 3; // DIRTY\n");
    const calls: string[][] = [];
    const runner: ProcessRunner = {
      run: async (argv) => {
        calls.push([...argv]);
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const issue = { id, branch: null, metadata: {} } as unknown as Issue;
    const source = await resolveReviewSource(issue, repo, runner);
    expect(source.files.length).toBe(0);
    expect(source.empty).toBe("no-branch");
    expect(source.error).toBeNull();
    expect(calls.some((argv) => argv.includes("diff"))).toBe(false);
  });
});

/** `repoWithWork` plus a committed three-line `src/a.ts`: hunk 0 is new-side lines 1-3. */
const repoWithHunk = (): { readonly repo: string; readonly id: string; readonly worktree: string; readonly contents: string } => {
  const work = repoWithWork();
  const contents = "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n";
  write(work.worktree, "src/a.ts", contents);
  gitIn(work.worktree, "commit", "-q", "-am", "grow a");
  return { ...work, contents };
};

const editTitle = "✎ edit src/a.ts:1-3";

describe("tui in-view hunk edit", () => {
  test("e on a selected hunk opens the buffer; ctrl+s writes the worktree and the diff re-renders", async () => {
    const { repo, id, worktree } = repoWithHunk();
    const { store, setup } = await renderDiff(repo, id);
    try {
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("export const c"), 12000);
      await setup.mockInput.pressKey("j");
      await Bun.sleep(150);
      await setup.mockInput.pressKey("e");
      const open = await waitForFrameText(setup, editTitle, 6000);
      expect(open).toContain("export const b = 2;");
      await setup.mockInput.typeText("// edited");
      setup.mockInput.pressEnter();
      await Bun.sleep(150);
      setup.mockInput.pressKey("s", { ctrl: true });
      const deadline = performance.now() + 8000;
      while (!readFileSync(join(worktree, "src/a.ts"), "utf8").includes("// edited") && performance.now() < deadline) await Bun.sleep(75);
      const onDisk = readFileSync(join(worktree, "src/a.ts"), "utf8");
      expect(onDisk).toBe("// edited\nexport const a = 1;\nexport const b = 2;\nexport const c = 3;\n");
      const frame = await waitForFramePredicate(setup, (value) => !value.includes("✎ edit src/a.ts") && value.includes("// edited"), 8000);
      expect(frame).toContain("E edit note");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("esc cancels the buffer, stays in the diff view, and leaves the file untouched", async () => {
    const { repo, id, worktree, contents } = repoWithHunk();
    const { store, setup } = await renderDiff(repo, id);
    try {
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("export const c"), 12000);
      await setup.mockInput.pressKey("j");
      await Bun.sleep(150);
      await setup.mockInput.pressKey("e");
      await waitForFrameText(setup, editTitle, 6000);
      await setup.mockInput.typeText("junk");
      setup.mockInput.pressEscape();
      const frame = await waitForFramePredicate(setup, (value) => !value.includes("✎ edit src/a.ts"), 6000);
      expect(frame).toContain("E edit note");
      expect(frame).toContain(`tk/${id}`);
      expect(readFileSync(join(worktree, "src/a.ts"), "utf8")).toBe(contents);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("e with no hunk selected toasts and opens nothing", async () => {
    const { repo, id } = repoWithHunk();
    const { store, setup } = await renderDiff(repo, id);
    try {
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("export const c"), 12000);
      await setup.mockInput.pressKey("e");
      const frame = await waitForFrameText(setup, "select a hunk (j) to edit", 6000);
      expect(frame).not.toContain("✎ edit src/a.ts");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("E on a selected thread opens the review-comment edit composer", async () => {
    const { repo, id } = repoWithHunk();
    const store = await openTuiStore(repo);
    await taskStoreCommentStore(store.surface.store).createThread(id, { filePath: "src/a.ts", line: 1, body: "first note", author: "tester" });
    const setup = await testRender(
      <App store={store} actor="tester" onQuit={() => {}} boot={slotsFor({ view: "diff", reviewId: id, targetId: id })} />,
      { width: 140, height: 40, useThread: false },
    );
    try {
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("export const c"), 12000);
      await Bun.sleep(500); // threads load alongside the source
      await setup.mockInput.pressKey("E");
      const frame = await waitForFrameText(setup, `✎ edit comment ${id}`, 6000);
      expect(frame).not.toContain("✎ edit src/a.ts");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);
});

/** `tk show <id>` (human output) in a fresh process, colour off. */
const showPlain = (repo: string, id: string): string => {
  const result = Bun.spawnSync([process.execPath, executable, "-C", repo, "show", id], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  if (result.exitCode !== 0) throw new Error(`tk show ${id} failed: ${decode(result.stderr)}`);
  // eslint-disable-next-line no-control-regex
  return decode(result.stdout).replace(/\x1b\[[0-9;]*m/g, "");
};

describe("tui review comments on the task record", () => {
  test("a TUI line comment lands on the record tk show reads; x resolves it to All resolved", async () => {
    const { repo, id } = repoWithHunk();
    let line = "";
    {
      const { store, setup } = await renderDiff(repo, id);
      try {
        await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("export const c"), 12000);
        await setup.mockInput.pressKey("j");
        await Bun.sleep(150);
        await setup.mockInput.pressKey("c");
        const composer = await waitForFramePredicate(setup, (value) => /comment on src\/a\.ts:\d+/.test(value), 6000);
        line = /comment on src\/a\.ts:(\d+)/.exec(composer)![1]!;
        await setup.mockInput.typeText("tighten this");
        setup.mockInput.pressEnter();
        const rail = await waitForFramePredicate(setup, (value) => value.includes(`open src/a.ts:${line}`) && value.includes("tester: tighten this"), 8000);
        expect(rail).toContain("tester: tighten this");
      } finally {
        setup.renderer.destroy();
        await store.close();
      }
    }
    const before = showPlain(repo, id);
    expect(before).toContain("REVIEW (1) · 1 open · 0 ✓");
    expect(before).toMatch(new RegExp(`src/a\\.ts:${line}[\\s\\S]*tighten this`));

    {
      const { store, setup } = await renderDiff(repo, id);
      try {
        await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("tester: tighten this"), 12000);
        await setup.mockInput.pressKey("j");
        await Bun.sleep(150);
        await setup.mockInput.pressKey("x");
        await waitForFramePredicate(setup, (value) => value.includes(`✓ resolved src/a.ts:${line}`), 8000);
      } finally {
        setup.renderer.destroy();
        await store.close();
      }
    }
    expect(showPlain(repo, id)).toContain("All resolved");
    const [wire] = JSON.parse(tk(repo, "show", id)) as Array<{ review: { counts: { allResolved: boolean } } }>;
    expect(wire?.review.counts.allResolved).toBe(true);
  }, 60000);

  test(". clamps at the last changed file", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    write(worktree, "src/z.ts", "export const z = 2; // EDIT_Z\n");
    gitIn(worktree, "commit", "-q", "-am", "edit a and z");
    const { store, setup } = await renderDiff(repo, id);
    try {
      await waitForFramePredicate(setup, (value) => value.includes("z.ts") && selectedFile(value) === "a.ts", 12000);
      for (let press = 0; press < 3; press += 1) {
        await setup.mockInput.pressKey(".");
        await Bun.sleep(150);
      }
      const frame = await waitForFramePredicate(setup, (value) => selectedFile(value) === "z.ts", 6000);
      expect(frame).toContain("export const z");
      expect(frame).not.toContain("no changed files");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);
});

/**
 * A 40-line `src/a.ts` committed on the base, edited near line 3 and near
 * line 35 in the worktree: two separate hunks. Line 3 carries unique
 * old/new markers for the split/unified check.
 */
const repoWithTwoHunks = (): { readonly repo: string; readonly id: string; readonly worktree: string } => {
  const base = Array.from({ length: 40 }, (_, index) => `const v${index + 1} = ${index + 1};`);
  base[2] = "OLD_A;";
  const work = repoWithWork(base.join("\n") + "\n");
  const next = [...base];
  next[2] = "NEW_A;";
  next[34] = "const v35 = 350; // NEW_B";
  write(work.worktree, "src/a.ts", next.join("\n") + "\n");
  write(work.worktree, "src/z.ts", "export const z = 2; // EDIT_Z\n");
  gitIn(work.worktree, "commit", "-q", "-am", "two hunks");
  return work;
};

const editRange = (frame: string): string | null => /✎ edit src\/a\.ts:(\d+-\d+)/.exec(frame)?.[1] ?? null;

describe("tui review keys are hunk's own", () => {
  /** Press `e`, read the opened buffer's range, then esc back to the diff. */
  const openedRange = async (setup: Awaited<ReturnType<typeof renderDiff>>["setup"]): Promise<string | null> => {
    await setup.mockInput.pressKey("e");
    const frame = await waitForFrameText(setup, "✎ edit src/a.ts", 6000);
    const range = editRange(frame);
    expect(selectedFile(frame)).toBe("a.ts");
    setup.mockInput.pressEscape();
    await waitForFramePredicate(setup, (value) => !value.includes("✎ edit src/a.ts"), 6000);
    return range;
  };

  test("] / [ step hunks within the file; g / G jump to the first / last hunk", async () => {
    const { repo, id } = repoWithTwoHunks();
    const { store, setup } = await renderDiff(repo, id);
    try {
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("NEW_A"), 12000);
      await setup.mockInput.pressKey("]");
      await Bun.sleep(150);
      const first = await openedRange(setup);
      await setup.mockInput.pressKey("]");
      await Bun.sleep(150);
      const second = await openedRange(setup);
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(second).not.toBe(first);
      expect(Number(second!.split("-")[0])).toBeGreaterThan(Number(first!.split("-")[0]));
      await setup.mockInput.pressKey("[");
      await Bun.sleep(150);
      expect(await openedRange(setup)).toBe(first);
      await setup.mockInput.pressKey("G");
      await Bun.sleep(150);
      expect(await openedRange(setup)).toBe(second);
      await setup.mockInput.pressKey("g");
      await Bun.sleep(150);
      expect(await openedRange(setup)).toBe(first);
      const frame = await waitForFrameText(setup, `tk/${id}`, 6000);
      expect(selectedFile(frame)).toBe("a.ts");
      expect(frame).not.toContain("enter focus or open"); // the graph view's key line
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 60000);

  test("the diff keybar lists the hunk map", async () => {
    const { repo, id } = repoWithHunk();
    const { store, setup } = await renderDiff(repo, id);
    try {
      const frame = await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("./, file"), 12000);
      expect(frame).toContain("./, file");
      expect(frame).toContain("R reply");
      expect(frame).not.toContain("u unified");
      expect(frame).not.toContain("r reply ·");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test(". / , move between changed files, clamped", async () => {
    const { repo, id } = repoWithTwoHunks();
    const { store, setup } = await renderDiff(repo, id);
    try {
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("z.ts"), 12000);
      await setup.mockInput.pressKey(".");
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "z.ts", 6000);
      for (let press = 0; press < 3; press += 1) {
        await setup.mockInput.pressKey(".");
        await Bun.sleep(150);
      }
      expect(selectedFile(await waitForFrameText(setup, "export const z", 6000))).toBe("z.ts");
      await setup.mockInput.pressKey(",");
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts", 6000);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("2 / 1 switch split / unified in place, without leaving the diff view", async () => {
    const { repo, id } = repoWithTwoHunks();
    const { store, setup } = await renderDiff(repo, id);
    const bothOnOneRow = (frame: string): boolean => frame.split("\n").some((row) => row.includes("OLD_A") && row.includes("NEW_A"));
    try {
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("NEW_A") && value.includes("OLD_A"), 12000);
      await setup.mockInput.pressKey("2");
      const split = await waitForFramePredicate(setup, bothOnOneRow, 6000);
      expect(bothOnOneRow(split)).toBe(true);
      expect(split).toContain(`tk/${id} ←`);
      await setup.mockInput.pressKey("1");
      const unified = await waitForFramePredicate(setup, (value) => !bothOnOneRow(value) && value.includes("NEW_A"), 6000);
      expect(bothOnOneRow(unified)).toBe(false);
      expect(unified).toContain(`tk/${id} ←`);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("R opens the reply composer; r is unbound", async () => {
    const { repo, id } = repoWithHunk();
    const store = await openTuiStore(repo);
    await taskStoreCommentStore(store.surface.store).createThread(id, { filePath: "src/a.ts", line: 1, body: "first note", author: "tester" });
    const setup = await testRender(
      <App store={store} actor="tester" onQuit={() => {}} boot={slotsFor({ view: "diff", reviewId: id, targetId: id })} />,
      { width: 140, height: 40, useThread: false },
    );
    try {
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("first note"), 12000);
      await setup.mockInput.pressKey("r");
      await Bun.sleep(500);
      expect(setup.captureCharFrame()).not.toContain("reply…");
      await setup.mockInput.pressKey("R");
      await waitForFrameText(setup, "reply…", 6000);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("q quits", async () => {
    const { repo, id } = repoWithHunk();
    let quits = 0;
    const { store, setup } = await renderDiff(repo, id, () => { quits += 1; });
    try {
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("export const c"), 12000);
      await setup.mockInput.pressKey("q");
      const deadline = performance.now() + 4000;
      while (quits === 0 && performance.now() < deadline) await Bun.sleep(50);
      expect(quits).toBe(1);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);
});

/**
 * A 60-line `src/a.ts` (`// LINE_<n>` markers) committed on the base, line 30
 * changed in the worktree: line 10 is outside git's default 3-line context.
 */
const repoWithLongFile = (): { readonly repo: string; readonly id: string; readonly worktree: string } => {
  const base = Array.from({ length: 60 }, (_, index) => `// LINE_${index + 1}`);
  const work = repoWithWork(base.join("\n") + "\n");
  const next = [...base];
  next[29] = "// CHANGED_30";
  write(work.worktree, "src/a.ts", next.join("\n") + "\n");
  gitIn(work.worktree, "commit", "-q", "-am", "change line 30");
  return work;
};

/** True when some row draws `// LINE_29` with its `29` gutter number in front. */
const numberedRow = (frame: string): boolean => frame.split("\n").some((row) => /\b29\b[^\n]*\/\/ LINE_29/.test(row));

describe("tui review view toggles (s l a t z)", () => {
  test("s hides and restores the files pane; a hides and restores the notes rail", async () => {
    const { repo, id } = repoWithHunk();
    const { store, setup } = await renderDiff(repo, id);
    try {
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("no threads — press c"), 12000);
      await setup.mockInput.pressKey("s");
      const hidden = await waitForFramePredicate(setup, (value) => selectedFile(value) === null, 6000);
      expect(hidden).toContain(`tk/${id} ←`);
      await setup.mockInput.pressKey("s");
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts", 6000);
      await setup.mockInput.pressKey("a");
      const railless = await waitForFramePredicate(setup, (value) => !value.includes("no threads — press c"), 6000);
      expect(railless).toContain(`tk/${id} ←`);
      await setup.mockInput.pressKey("a");
      await waitForFrameText(setup, "no threads — press c", 6000);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("l toggles line numbers", async () => {
    const { repo, id } = repoWithLongFile();
    const { store, setup } = await renderDiff(repo, id);
    try {
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && numberedRow(value), 12000);
      await setup.mockInput.pressKey("l");
      const bare = await waitForFramePredicate(setup, (value) => value.includes("// LINE_29") && !numberedRow(value), 6000);
      expect(numberedRow(bare)).toBe(false);
      await setup.mockInput.pressKey("l");
      await waitForFramePredicate(setup, numberedRow, 6000);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("t cycles the diff theme and toasts its name", async () => {
    const { repo, id } = repoWithHunk();
    const { store, setup } = await renderDiff(repo, id);
    try {
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("export const c"), 12000);
      await setup.mockInput.pressKey("t");
      await waitForFrameText(setup, `theme ${HUNK_DIFF_THEME_NAMES[0]}`, 6000);
      await setup.mockInput.pressKey("t");
      await waitForFrameText(setup, `theme ${HUNK_DIFF_THEME_NAMES[1]}`, 6000);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("z expands the context and back; expanded context survives a live commit", async () => {
    const { repo, id, worktree } = repoWithLongFile();
    const { store, setup } = await renderDiff(repo, id);
    try {
      const first = await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("CHANGED_30") && value.includes(WATCHING_LINE), 12000);
      expect(first).not.toContain("// LINE_10");
      await setup.mockInput.pressKey("z");
      await waitForFrameText(setup, "// LINE_10", 8000);
      await setup.mockInput.pressKey("z");
      await waitForFramePredicate(setup, (value) => !value.includes("// LINE_10") && value.includes("CHANGED_30"), 8000);
      await setup.mockInput.pressKey("z");
      await waitForFrameText(setup, "// LINE_10", 8000);
      write(worktree, "src/live.ts", "export const live = 1;\n");
      gitIn(worktree, "add", "src/live.ts");
      gitIn(worktree, "commit", "-q", "-m", "live");
      const live = await waitForFrameText(setup, "live.ts", 12000);
      await Bun.sleep(500);
      expect(selectedFile(live)).toBe("a.ts");
      expect(setup.captureCharFrame()).toContain("// LINE_10");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 60000);
});

describe("tui review search, select and copy (/ v y)", () => {
  test("/ selects the next file whose path matches; no match toasts and keeps the selection", async () => {
    const { repo, id, worktree } = repoWithWork();
    write(worktree, "src/a.ts", "export const a = 2; // EDIT_A\n");
    write(worktree, "src/live.ts", "export const live = 1;\n");
    write(worktree, "src/z.ts", "export const z = 2; // EDIT_Z\n");
    gitIn(worktree, "add", ".");
    gitIn(worktree, "commit", "-q", "-m", "three files");
    const { store, setup } = await renderDiff(repo, id);
    try {
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("z.ts"), 12000);
      await setup.mockInput.pressKey("/");
      await waitForFrameText(setup, "search files…", 6000);
      await setup.mockInput.typeText("Z.TS");
      setup.mockInput.pressEnter();
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "z.ts", 6000);
      await setup.mockInput.pressKey("/");
      await waitForFrameText(setup, "/ search files", 6000);
      for (let press = 0; press < 4; press += 1) setup.mockInput.pressBackspace(); // the last query is prefilled
      await setup.mockInput.typeText("nomatch");
      setup.mockInput.pressEnter();
      const frame = await waitForFrameText(setup, "no file matches nomatch", 6000);
      expect(selectedFile(frame)).toBe("z.ts");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  /** Replace the renderer's OSC 52 writer with a spy that returns `result`. */
  const spyClipboard = (setup: Awaited<ReturnType<typeof renderDiff>>["setup"], result: boolean): string[] => {
    const copied: string[] = [];
    (setup.renderer as unknown as { copyToClipboardOSC52: (text: string) => boolean }).copyToClipboardOSC52 = (text) => { copied.push(text); return result; };
    return copied;
  };

  // 180 columns: the stats line plus `· selecting hunks a–b` stays on one row
  // (at 140 the body beside nav and rail is ~51 columns and the line wraps).
  test("] v ] y copies both selected hunks through OSC 52", async () => {
    const { repo, id } = repoWithTwoHunks();
    const { store, setup } = await renderDiff(repo, id, () => {}, 180);
    const copied = spyClipboard(setup, true);
    try {
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("NEW_A"), 12000);
      await setup.mockInput.pressKey("]");
      await Bun.sleep(150);
      await setup.mockInput.pressKey("v");
      await Bun.sleep(150);
      await setup.mockInput.pressKey("]");
      await waitForFrameText(setup, "· selecting hunks 1–2", 6000);
      await setup.mockInput.pressKey("y");
      const frame = await waitForFramePredicate(setup, (value) => /copied \d+ lines/.test(value), 6000);
      expect(copied).toHaveLength(1);
      expect(copied[0]).toContain("+NEW_A;");
      expect(copied[0]).toContain("NEW_B");
      expect(frame).toContain(`copied ${copied[0]!.split("\n").length} lines`);
      expect(frame).not.toContain("selecting hunks");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("y toasts clipboard unavailable when OSC 52 is refused", async () => {
    const { repo, id } = repoWithTwoHunks();
    const { store, setup } = await renderDiff(repo, id);
    spyClipboard(setup, false);
    try {
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("NEW_A"), 12000);
      await setup.mockInput.pressKey("y");
      await waitForFrameText(setup, "clipboard unavailable", 6000);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("esc clears an active selection in place; a second esc leaves the diff view", async () => {
    const { repo, id } = repoWithTwoHunks();
    const { store, setup } = await renderDiff(repo, id, () => {}, 180);
    try {
      await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("NEW_A"), 12000);
      await setup.mockInput.pressKey("v");
      await waitForFrameText(setup, "· selecting hunks 1–1", 6000);
      setup.mockInput.pressEscape();
      const cleared = await waitForFramePredicate(setup, (value) => !value.includes("selecting hunks"), 6000);
      expect(cleared).toContain(`tk/${id} ←`);
      await Bun.sleep(300);
      expect(setup.captureCharFrame()).toContain(`tk/${id} ←`);
      setup.mockInput.pressEscape();
      await waitForFramePredicate(setup, (value) => !value.includes(`tk/${id} ←`), 6000);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  const specBar = "q quit  c note  ]/[ hunk  ./, file  1/2 layout  s files  l line numbers  z context  / search  v select  y copy  a notes  t theme  ? help";

  test("the diff keybar line 1 is the spec bar minus r refresh (one row where it fits)", async () => {
    const { repo, id } = repoWithHunk();
    // 160 columns: the 136-column bar fits beside the shell's 18-column nav rail.
    const { store, setup } = await renderDiff(repo, id, () => {}, 160);
    try {
      const frame = await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("t theme"), 12000);
      expect(frame).toContain(specBar);
      expect(frame).not.toContain("r refresh");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);

  test("at 140 columns the keybar wraps at key separators and keeps every key", async () => {
    const { repo, id } = repoWithHunk();
    const { store, setup } = await renderDiff(repo, id);
    try {
      const frame = await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("t theme  ? help"), 12000);
      for (const key of specBar.split("  ")) expect(frame).toContain(key);
      expect(frame).not.toContain("…");
      expect(frame).not.toContain("r refresh");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 40000);
});

/** Seeds review threads on the task record through a separate store, closed before the TUI boots. */
const seedThreads = async (repo: string, id: string, inputs: ReadonlyArray<{ readonly line?: number; readonly body: string }>): Promise<void> => {
  const store = await openTuiStore(repo);
  try {
    const comments = taskStoreCommentStore(store.surface.store);
    for (const input of inputs) {
      await comments.createThread(id, input.line === undefined ? { filePath: "src/a.ts", body: input.body, author: "tester" } : { filePath: "src/a.ts", line: input.line, body: input.body, author: "tester" });
    }
  } finally {
    await store.close();
  }
};

/** A fresh read of the task record: thread statuses, the lifecycle log, and the task comments. */
const recordOf = async (repo: string, id: string) => {
  const store = await openTuiStore(repo);
  try {
    const listed = await taskStoreCommentStore(store.surface.store).listThreads(id);
    const [shown] = JSON.parse(tk(repo, "show", id)) as Array<{ metadata: Record<string, unknown>; comments: Array<{ text: string }> }>;
    const log = (shown?.metadata["reviewCommentLog"] ?? []) as Array<{ to: string }>;
    return { statuses: listed.threads.map((thread) => thread.status), log, comments: shown?.comments ?? [] };
  } finally {
    await store.close();
  }
};

describe("tui comment lifecycle (08-02)", () => {
  test("D dismisses the selected comment on the record (✕ dismissed, All resolved); D again reopens it", async () => {
    const { repo, id } = repoWithHunk();
    await seedThreads(repo, id, [{ line: 2, body: "drop this" }]);
    const { store, setup } = await renderDiff(repo, id);
    try {
      const first = await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("tester: drop this"), 12000);
      expect(first).toContain("COMMENTS · 1 open · 0 ✓");
      expect(first).toContain("S send 1 to agent");
      await setup.mockInput.pressKey("D");
      const dismissed = await waitForFramePredicate(setup, (value) => value.includes("✕ dismissed src/a.ts:2") && value.includes("COMMENTS · All resolved"), 8000);
      expect(dismissed).not.toContain("S send 1 to agent");
      const record = await recordOf(repo, id);
      expect(record.statuses).toEqual(["dismissed"]);
      expect(record.log.at(-1)?.to).toBe("dismissed");

      await setup.mockInput.pressKey("D");
      await waitForFramePredicate(setup, (value) => value.includes("open src/a.ts:2") && value.includes("COMMENTS · 1 open · 0 ✓"), 8000);
      const reopened = await recordOf(repo, id);
      expect(reopened.statuses).toEqual(["open"]);
      expect(reopened.log.at(-1)?.to).toBe("open");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 60000);

  test("S sends every open comment in one batch; x marks one ✓ done; D removes the other → All resolved", async () => {
    const { repo, id } = repoWithHunk();
    await seedThreads(repo, id, [{ line: 2, body: "line note" }, { body: "file note" }]);
    const { store, setup } = await renderDiff(repo, id);
    try {
      const first = await waitForFramePredicate(setup, (value) => selectedFile(value) === "a.ts" && value.includes("tester: file note"), 12000);
      expect(first).toContain("COMMENTS · 2 open · 0 ✓");
      expect(first).toContain("x ✓ done · D ✕ remove · S send to agent");

      await setup.mockInput.pressKey("S");
      const sent = await waitForFramePredicate(setup, (value) => value.includes("sent 2 comments to the agent") && value.includes("→ sent src/a.ts:2") && /→ sent src\/a\.ts\s*$/m.test(value), 8000);
      // Sent still counts as open (03-05 rule).
      expect(sent).toContain("COMMENTS · 2 open · 0 ✓");
      expect(sent).not.toContain("S send 2 to agent");
      const afterSend = await recordOf(repo, id);
      expect(afterSend.statuses).toEqual(["sent", "sent"]);
      expect(afterSend.comments.filter((comment) => comment.text.startsWith("[review sent] 2 comments"))).toHaveLength(1);

      await Bun.sleep(150);
      await setup.mockInput.pressKey("S");
      await waitForFrameText(setup, "nothing open to send", 8000);
      const afterResend = await recordOf(repo, id);
      expect(afterResend.comments.filter((comment) => comment.text.startsWith("[review sent]"))).toHaveLength(1);

      await setup.mockInput.pressKey("x");
      await waitForFramePredicate(setup, (value) => value.includes("✓ resolved src/a.ts:2") && value.includes("COMMENTS · 1 open · 1 ✓"), 8000);
      await setup.mockInput.pressKey("J");
      await Bun.sleep(150);
      await setup.mockInput.pressKey("D");
      await waitForFramePredicate(setup, (value) => /✕ dismissed src\/a\.ts\s*$/m.test(value) && value.includes("COMMENTS · All resolved"), 8000);
      expect((await recordOf(repo, id)).statuses).toEqual(["resolved", "dismissed"]);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  }, 60000);
});
