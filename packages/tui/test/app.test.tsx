import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../src/app/App.js";
import { openTuiStore } from "../src/store.js";

const workspaces: string[] = [];
const workspace = (): string => {
  const value = mkdtempSync(join(tmpdir(), "tk-tui-"));
  workspaces.push(value);
  return value;
};
afterEach(() => {
  while (workspaces.length) {
    const dir = workspaces.pop()!;
    try { Bun.$`rm -rf ${dir}`.quiet(); } catch { /* tmp cleanup best effort */ }
  }
});

describe("tui app", () => {
  test("renders empty board with statusbar counters", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24 });
    try {
      const frame = await setup.waitForFrame((value) => value.includes("open 0"), { maxPasses: 40 });
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
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24 });
    try {
      const frame = await setup.waitForFrame((value) => value.includes("first board"), { maxPasses: 40 });
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
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24 });
    try {
      await setup.waitForFrame((value) => value.includes("alpha"), { maxPasses: 40 });
      await setup.mockInput.pressKey("2");
      const frame = await setup.waitForFrame((value) => value.includes("Open (") && value.includes("Closed"), { maxPasses: 40 });
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
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24 });
    try {
      await setup.waitForFrame((value) => value.includes("alpha"), { maxPasses: 40 });
      await setup.mockInput.pressKey("3");
      const frame = await setup.waitForFrame((value) => value.includes("blocked by") || value.includes("blocks ("), { maxPasses: 40 });
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
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24 });
    try {
      await setup.waitForFrame((value) => value.includes("gamma"), { maxPasses: 40 });
      await setup.mockInput.pressKey("4");
      const frame = await setup.waitForFrame((value) => value.includes("ready now"), { maxPasses: 40 });
      expect(frame).toContain(issue.value.id);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });

  test("composer creates an issue from the n prompt", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24 });
    try {
      await setup.waitForFrame((value) => value.includes("open 0"), { maxPasses: 40 });
      await setup.mockInput.pressKey("n");
      await setup.waitForFrame((value) => value.includes("new issue title"), { maxPasses: 40 });
      await setup.mockInput.pressKeys(["m", "a", "d", "e"]);
      await setup.mockInput.pressKey("\r");
      const frame = await setup.waitForFrame((value) => value.includes("made"), { maxPasses: 60 });
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
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24 });
    try {
      const frame = await setup.waitForFrame((value) => value.includes("VIEWS"), { maxPasses: 40 });
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
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24 });
    try {
      await setup.waitForFrame((value) => value.includes("palette target"), { maxPasses: 40 });
      await setup.mockInput.pressKey(":");
      const frame = await setup.waitForFrame((value) => value.includes("go to Board"), { maxPasses: 40 });
      expect(frame).toContain("go to Insights");
      expect(frame).toContain("close");
      await setup.mockInput.pressKeys(["s", "t", "a"]);
      const filtered = await setup.waitForFrame((value) => !value.includes("go to Board"), { maxPasses: 40 });
      expect(filtered).toContain("start (in progress)");
      expect(filtered).toContain("[s]");
      await setup.mockInput.pressKey("escape");
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
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24 });
    try {
      await setup.waitForFrame((value) => value.includes("modal issue"), { maxPasses: 40 });
      await setup.mockInput.pressKey("2");
      await setup.waitForFrame((value) => value.includes("Open ("), { maxPasses: 40 });
      await setup.mockInput.pressKey("\r");
      const frame = await setup.waitForFrame((value) => value.includes("updated"), { maxPasses: 40 });
      expect(frame).toContain("modal issue");
      expect(frame).toContain(first.value.id);
      expect(frame).toContain("Open (");
      await setup.mockInput.pressKey("escape");
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
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24 });
    try {
      await setup.waitForFrame((value) => value.includes("modal verb"), { maxPasses: 40 });
      await setup.mockInput.pressKey("2");
      await setup.waitForFrame((value) => value.includes("Open ("), { maxPasses: 40 });
      await setup.mockInput.pressKey("\r");
      await setup.waitForFrame((value) => value.includes("modal verb"), { maxPasses: 40 });
      await setup.mockInput.pressKey("s");
      const frame = await setup.waitForFrame((value) => value.includes("in_progress"), { maxPasses: 60 });
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
    const setup = await testRender(<App store={store} actor="tester" onQuit={() => {}} />, { width: 100, height: 24 });
    try {
      await setup.waitForFrame((value) => value.includes("confirm target"), { maxPasses: 40 });
      await setup.mockInput.pressKey("2");
      await setup.waitForFrame((value) => value.includes("Open ("), { maxPasses: 40 });
      await setup.mockInput.pressKey("\r");
      await setup.waitForFrame((value) => value.includes("esc ✕"), { maxPasses: 40 });
      await setup.mockInput.pressKey("d");
      const prompt = await setup.waitForFrame((value) => value.includes("↵/y · n"), { maxPasses: 40 });
      expect(prompt).toContain("close tk-");
      await setup.mockInput.pressKey("\r");
      const frame = await setup.waitForFrame((value) => value.includes("done 1"), { maxPasses: 60 });
      expect(frame).not.toContain("✎ title");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });
});