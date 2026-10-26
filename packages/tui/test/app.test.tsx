import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { waitForFramePredicate, waitForFrameText, waitForFrameWithout } from "./wait.js";
import { App } from "../src/app/App.js";
import { openTuiStore } from "../src/store.js";
import { attachEvidenceUow } from "@tasks/surface";
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

const workspaces: string[] = [];
const workspace = (): string => {
  const value = mkdtempSync(join(tmpdir(), "tk-tui-"));
  workspaces.push(value);
  return value;
};
afterEach(() => {
  while (workspaces.length) {
    const dir = workspaces.pop()!;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* tmp cleanup best effort */ }
  }
});

describe("tui app", () => {
  test("renders empty board with statusbar counters", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24, useThread: false });
    try {
      const frame = await waitForFramePredicate(setup, (value) => value.includes("open 0"));
      expect(frame).toContain("done 0");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });

  test("lists created issues and opens detail on selection change", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const created = await store.surface.create({ title: "first board", priority: 1, labels: ["tui"] });
    if (!created.ok) throw created.error;
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24, useThread: false });
    try {
      const frame = await waitForFramePredicate(setup, (value) => value.includes("first board"));
      expect(frame).toContain(created.value.id);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });

  test("kanban view shows flow columns with the card", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const first = await store.surface.create({ title: "alpha", priority: 1 });
    if (!first.ok) throw first.error;
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24, useThread: false });
    try {
      await waitForFramePredicate(setup, (value) => value.includes("alpha"));
      await setup.mockInput.pressKey("2");
      const frame = await waitForFramePredicate(setup, (value) => value.includes("Open (") && value.includes("Closed"));
      expect(frame).toContain("alpha");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });

  test("graph view centers first issue and shows dep trees", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const blocker = await store.surface.create({ title: "alpha", priority: 1 });
    const blocked = await store.surface.create({ title: "beta", priority: 2 });
    if (!blocker.ok || !blocked.ok) throw new Error("create failed");
    const dep = await store.surface.depAdd(blocked.value.id, blocker.value.id);
    if (!dep.ok) throw dep.error;
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24, useThread: false });
    try {
      await waitForFramePredicate(setup, (value) => value.includes("alpha"));
      await setup.mockInput.pressKey("3");
      const frame = await waitForFramePredicate(setup, (value) => value.includes("blocked by") || value.includes("blocks ("));
      expect(frame).toContain(blocker.value.id);
      expect(frame).toContain(blocked.value.id);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });

  test("insights view shows ready panel", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const issue = await store.surface.create({ title: "gamma", priority: 0 });
    if (!issue.ok) throw issue.error;
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24, useThread: false });
    try {
      await waitForFramePredicate(setup, (value) => value.includes("gamma"));
      await setup.mockInput.pressKey("4");
      const frame = await waitForFramePredicate(setup, (value) => value.includes("ready now"));
      expect(frame).toContain(issue.value.id);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });

  test("composer creates an issue from the n prompt", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24, useThread: false });
    try {
      await waitForFramePredicate(setup, (value) => value.includes("open 0"));
      await setup.mockInput.pressKey("n");
      await waitForFramePredicate(setup, (value) => value.includes("new issue title"));
      await setup.mockInput.pressKeys(["m", "a", "d", "e"]);
      await setup.mockInput.pressKey("\r");
      const frame = await waitForFramePredicate(setup, (value) => value.includes("made"));
      expect(frame).toContain("made");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });

  test("nav rail shows named views with counts and active highlight", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const first = await store.surface.create({ title: "rail item", priority: 1 });
    if (!first.ok) throw first.error;
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24, useThread: false });
    try {
      const frame = await waitForFramePredicate(setup, (value) => value.includes("VIEWS"));
      expect(frame).toContain("List");
      expect(frame).toContain("Board");
      expect(frame).toContain("Insights");
      expect(frame).toContain("1");
      expect(frame).toContain("ACTIONS");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });

  test("command palette lists commands with keycaps and filters", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const issue = await store.surface.create({ title: "palette target", priority: 1 });
    if (!issue.ok) throw issue.error;
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24, useThread: false });
    try {
      await waitForFramePredicate(setup, (value) => value.includes("palette target"));
      await setup.mockInput.pressKey(":");
      const frame = await waitForFramePredicate(setup, (value) => value.includes("go to Board"));
      expect(frame).toContain("go to Insights");
      expect(frame).toContain("close");
      await setup.mockInput.pressKeys(["s", "t", "a"]);
      const filtered = await waitForFramePredicate(setup, (value) => !value.includes("go to Board"));
      expect(filtered).toContain("start (in progress)");
      expect(filtered).toContain("[s]");
      // KeyCodes are uppercase-only ("ESCAPE"); a lowercase "escape" would be
      // typed as literal text. "\x1b" resolves via valueToKeyNameMap → "escape".
      await setup.mockInput.pressKey("\x1b");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });

  test("board enter opens modal over kanban without leaving board view", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const first = await store.surface.create({ title: "modal issue", priority: 0 });
    if (!first.ok) throw first.error;
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24, useThread: false });
    try {
      await waitForFramePredicate(setup, (value) => value.includes("modal issue"));
      await setup.mockInput.pressKey("2");
      await waitForFramePredicate(setup, (value) => value.includes("Open ("));
      await setup.mockInput.pressKey("\r");
      const frame = await waitForFramePredicate(setup, (value) => value.includes("updated"));
      expect(frame).toContain("modal issue");
      expect(frame).toContain(first.value.id);
      expect(frame).toContain("Open (");
      // Regression (live-pane repro 2026-10-19): TaskModal had no escape case
      // and the shell bails while a modal is open — esc closed nothing and
      // every later key died. Assert the modal actually closes AND input
      // keeps working afterwards.
      await setup.mockInput.pressKey("\x1b");
      const closed = await waitForFrameWithout(setup, "esc ✕");
      expect(closed).not.toContain("esc ✕");
      await setup.mockInput.pressKey("?");
      const help = await waitForFrameText(setup, "task modal");
      expect(help).toContain("esc closes");
      await setup.mockInput.pressKey("\x1b");
      await waitForFrameWithout(setup, "task modal (enter");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });

  test("modal status keys keep the modal open and update the issue", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const first = await store.surface.create({ title: "modal verb", priority: 1 });
    if (!first.ok) throw first.error;
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24, useThread: false });
    try {
      await waitForFramePredicate(setup, (value) => value.includes("modal verb"));
      await setup.mockInput.pressKey("2");
      await waitForFramePredicate(setup, (value) => value.includes("Open ("));
      await setup.mockInput.pressKey("\r");
      await waitForFramePredicate(setup, (value) => value.includes("modal verb"));
      await setup.mockInput.pressKey("s");
      const frame = await waitForFramePredicate(setup, (value) => value.includes("in_progress"));
      expect(frame).toContain("modal verb");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });

  test("confirm prompt closes the issue on enter without modal hijacking keys", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const first = await store.surface.create({ title: "confirm target", priority: 1 });
    if (!first.ok) throw first.error;
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24, useThread: false });
    try {
      await waitForFramePredicate(setup, (value) => value.includes("confirm target"));
      await setup.mockInput.pressKey("2");
      await waitForFramePredicate(setup, (value) => value.includes("Open ("));
      await setup.mockInput.pressKey("\r");
      await waitForFramePredicate(setup, (value) => value.includes("esc ✕"));
      await setup.mockInput.pressKey("d");
      const prompt = await waitForFramePredicate(setup, (value) => value.includes("↵/y · n"));
      expect(prompt).toContain("close tk-");
      await setup.mockInput.pressKey("\r");
      const frame = await waitForFramePredicate(setup, (value) => value.includes("done 1"));
      expect(frame).not.toContain("✎ title");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });

  test("task view renders the live record meta, description, and review rail", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const anchor = await store.surface.create({ title: "Fix flaky retry logic in uploader", priority: 1 });
    if (!anchor.ok) throw anchor.error;
    const id = anchor.value.id;
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} boot={slotsFor({ view: "task", detailId: id, targetId: id })} />, { width: 120, height: 80, useThread: false });
    try {
      const frame = await waitForFramePredicate(setup, (value) => value.includes("Fix flaky retry logic"));
      expect(frame).toContain(id);
      expect(frame).toContain("open");
      expect(frame).toContain("v open diff · V diff modal · c comment");
      // No work record yet: the rail still resolves its null form.
      expect(frame).toContain("branch —");
      expect(frame).toContain("base HEAD");
      expect(frame).toContain("THREADS 0 open");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });

  test("artifact view boots the review workbench with its escape hint", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const created = await store.surface.create({ title: "artifact probe", priority: 2 });
    if (!created.ok) throw created.error;
    const id = created.value.id;
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} boot={slotsFor({ view: "artifact", detailId: id, targetId: id })} />, { width: 120, height: 80, useThread: false });
    try {
      // Same live review session chrome as the diff view, framed on one file.
      const frame = await waitForFramePredicate(setup, (value) => value.includes("esc back to task"));
      expect(frame).toContain("c comment · r reply");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });

  // The diff view shares the artifact view's Workbench chrome (covered above)
  // and its live rendering is exercised end-to-end by `tk review` in the smoke.

  test("detail shows attachments with image blobs rendered", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const created = await store.surface.create({ title: "with blobs", priority: 1 });
    if (!created.ok) throw created.error;
    const issueId = created.value.id;
    const png = join(root, "dot.png");
    await Bun.write(png, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const attached = await store.surface.store.transact(async (uow) => attachEvidenceUow(uow, { root: store.surface.store.root, tasksDir: store.surface.store.tasksDir }, issueId, [png]));
    if (!attached.ok) throw attached.error;
    const pathAttached = await store.surface.attach(issueId, "docs/log.txt");
    if (!pathAttached.ok) throw pathAttached.error;
    const blobId = attached.value.attachments.find((attachment) => "kind" in attachment)?.id;
    if (blobId === undefined) throw new Error("evidence attachment missing");
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 48, useThread: false });
    try {
      await waitForFramePredicate(setup, (value) => value.includes("with blobs"));
      await setup.mockInput.pressKey("\r");
      // Canonical web detail has a single attachments row (app.html attrow):
      // path chips + inline image blobs. No separate "evidences" heading.
      const frame = await waitForFramePredicate(setup, (value) => value.includes("attachments"));
      expect(frame).toContain("docs/log.txt");
      expect(frame).toContain(`dot.png`);
      expect(frame).toContain(blobId);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });
});