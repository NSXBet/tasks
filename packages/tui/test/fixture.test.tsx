import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import type { TestRendererSetup } from "@opentui/core/testing";
import { App } from "../src/app/App.js";
import { openFixtureStore } from "../src/fixture.js";

/**
 * Phase 0 mock tests: the canonical task→review scenario rendered from the
 * fixture store, with navigation live and every action reporting WIP.
 */
describe("task→review mock (fixture store)", () => {
  type Setup = TestRendererSetup;

  const open = async () => {
    const setup = await testRender(
      <App store={openFixtureStore()} actor="tester" onQuit={() => {}} />,
      { width: 150, height: 44 },
    );
    return setup;
  };

  /**
   * Key dispatches must run inside act(): testRender sets IS_REACT_ACT_ENVIRONMENT,
   * so updates fired outside act() park in React's queue and never flush — the
   * frame would freeze and every subsequent waitForFrame would time out.
   */
  const press = (setup: Setup, key: string) =>
    act(async () => {
      setup.mockInput.pressKey(key);
    });

  const pressEscape = (setup: Setup) =>
    act(async () => {
      setup.mockInput.pressEscape();
      // A lone ESC byte is held by the terminal input parser as a potential
      // escape-sequence start; only its real-time window releases it as a key
      // event, so wait past that window before pumping frames.
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

  test("list view renders the canonical fixture issue", async () => {
    const setup = await open();
    try {
      const frame = await setup.waitForFrame((value) => value.includes("tk-142"), { maxPasses: 40 });
      // The list row truncates long titles with an ellipsis; the fixture
      // title's head plus the status chip still prove the canonical issue.
      expect(frame).toContain("Fix flaky retry");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("task view shows branch, sessions, and comments", async () => {
    const setup = await open();
    try {
      await setup.waitForFrame((value) => value.includes("tk-142"), { maxPasses: 40 });
      await press(setup, "5");
      const frame = await setup.waitForFrame((value) => value.includes("tk/tk-142"), { maxPasses: 40 });
      expect(frame).toContain("main @ 9f13ee4");
      expect(frame).toContain("../platform-api-tk-142");
      expect(frame).toContain("sess-7f3k");
      expect(frame).toContain("sess-k2q9");
      expect(frame).toContain("kyle");
      expect(frame).toContain("serialized refresh via refreshMutex.run");
      expect(frame).toContain("−70% p99");
      expect(frame).toContain("src/uploader/retry.ts");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("task view actions report WIP", async () => {
    const setup = await open();
    try {
      await setup.waitForFrame((value) => value.includes("tk-142"), { maxPasses: 40 });
      await press(setup, "5");
      await setup.waitForFrame((value) => value.includes("tk/tk-142"), { maxPasses: 40 });
      await press(setup, "s");
      const frame = await setup.waitForFrame((value) => value.includes("WIP"), { maxPasses: 40 });
      expect(frame).toContain("WIP");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("diff view opens as full page and escape returns to list", async () => {
    const setup = await open();
    try {
      await setup.waitForFrame((value) => value.includes("tk-142"), { maxPasses: 40 });
      await press(setup, "5");
      await setup.waitForFrame((value) => value.includes("tk/tk-142"), { maxPasses: 40 });
      await press(setup, "v");
      // The view-switch paint can land after waitForFrame's idle check breaks;
      // flush pumps the scheduler so the frame is present before waiting.
      await setup.flush();
      const frame = await setup.waitForFrame((value) => value.includes("src/uploader/retry.ts") && value.includes("@@ -12,3 +12,10 @@"), { maxPasses: 40 });
      expect(frame).toContain("-  const res = await fetch(REFRESH_URL, {");
      expect(frame).toContain("+  const res = await refreshMutex.run(token, async () => {");
      await pressEscape(setup);
      await setup.flush();
      // Back in the list, where the row truncates the title with an ellipsis.
      const back = await setup.waitForFrame((value) => value.includes("Fix flaky retry") && !value.includes("@@ -12,3 +12,10 @@"), { maxPasses: 40 });
      expect(back).toContain("tk-142");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("diff modal opens from task view and closes on escape", async () => {
    const setup = await open();
    try {
      await setup.waitForFrame((value) => value.includes("tk-142"), { maxPasses: 40 });
      await press(setup, "5");
      await setup.waitForFrame((value) => value.includes("tk/tk-142"), { maxPasses: 40 });
      await press(setup, "V");
      // The modal-mount paint can land after waitForFrame's idle check breaks;
      // flush pumps the scheduler so the frame is present before waiting.
      await setup.flush();
      const frame = await setup.waitForFrame((value) => value.includes("@@ -12,3 +12,10 @@"), { maxPasses: 40 });
      expect(frame).toContain("refreshMutex.run");
      // Regression: a fixed/percent height on the modal panel collapsed diff
      // rows — hunk headers garbled with gutter digits and fold bars vanished.
      // Both hunks and both fold bars must render as separate rows.
      expect(frame).toContain("▾ 11 unchanged lines");
      expect(frame).toContain("▾ 24 unchanged lines");
      expect(frame).toContain("@@ -41,4 +48,7 @@");
      await pressEscape(setup);
      await setup.flush();
      await setup.waitForFrame((value) => value.includes("tk/tk-142") && !value.includes("@@ -12,3 +12,10 @@"), { maxPasses: 40 });
    } finally {
      setup.renderer.destroy();
    }
  });

  test("artifact view lists changed files and navigates to diff", async () => {
    const setup = await open();
    try {
      await setup.waitForFrame((value) => value.includes("tk-142"), { maxPasses: 40 });
      await press(setup, "6");
      const frame = await setup.waitForFrame((value) => value.includes("src/uploader/refresh-mutex.ts"), { maxPasses: 40 });
      expect(frame).toContain("+38/−12");
      expect(frame).toContain("bench/retry-bench.txt");
      await press(setup, "7");
      const diff = await setup.waitForFrame((value) => value.includes("@@ -12,3 +12,10 @@"), { maxPasses: 40 });
      expect(diff).toContain("DIFF tk-142");
    } finally {
      setup.renderer.destroy();
    }
  });
});
