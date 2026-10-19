import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../src/app/App.js";
import { openTuiStore } from "../src/store.js";
import type { BootSlots } from "../src/app/routes.js";

const workspaces: string[] = [];
const workspace = (): string => {
  const value = mkdtempSync(join(tmpdir(), "tk-tui-boot-"));
  workspaces.push(value);
  return value;
};
afterEach(() => {
  while (workspaces.length) {
    const dir = workspaces.pop()!;
    try { Bun.$`rm -rf ${dir}`.quiet(); } catch { /* tmp cleanup best effort */ }
  }
});

/** Boot slots for one addressed issue; other slots at plain-launch defaults. */
const slotsFor = (overrides: Partial<BootSlots>): BootSlots => ({
  view: "list",
  detailId: null,
  helpOpen: false,
  modalId: null,
  diffOpen: false,
  graphId: null,
  composer: { mode: "closed", forId: null, initial: "", confirm: null },
  targetId: null,
  ...overrides,
});

describe("deep-link boot", () => {
  test("boots straight into the kanban board", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const setup = await testRender(
      <App store={store} actor="tester" onQuit={() => {}} boot={slotsFor({ view: "board" })} />,
      { width: 100, height: 24 },
    );
    try {
      const frame = await setup.waitForFrame((value) => value.includes("Open ("), { maxPasses: 40 });
      expect(frame).toContain("Review (");
      expect(frame).toContain("Closed");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });

  test("boots into the task detail pane", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const created = await store.surface.create({ title: "linked issue", priority: 1 });
    if (!created.ok) throw created.error;
    const setup = await testRender(
      <App store={store} actor="tester" onQuit={() => {}} boot={slotsFor({ view: "list", detailId: created.value.id, targetId: created.value.id })} />,
      { width: 100, height: 24 },
    );
    try {
      const frame = await setup.waitForFrame((value) => value.includes("linked issue"), { maxPasses: 40 });
      expect(frame).toContain(created.value.id);
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });

  test("a deep link naming an absent issue boots and toasts", async () => {
    const root = workspace();
    const store = await openTuiStore(root);
    const setup = await testRender(
      <App store={store} actor="tester" onQuit={() => {}} boot={slotsFor({ view: "list", detailId: "tasks-zzz", targetId: "tasks-zzz" })} />,
      { width: 100, height: 24 },
    );
    try {
      const frame = await setup.waitForFrame((value) => value.includes("unknown issue tasks-zzz"), { maxPasses: 40 });
      expect(frame).toContain("tasks-zzz");
    } finally {
      setup.renderer.destroy();
      await store.close();
    }
  });
});
