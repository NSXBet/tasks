import { describe, expect, test } from "bun:test";
import { bootSink, resolveTarget } from "../src/app/routes.js";

/** Applies a resolved target to fresh boot slots and returns them. */
const boot = (query: string) => {
  const resolved = resolveTarget(query);
  if (!resolved.ok) throw new Error(resolved.error);
  const { sink, slots } = bootSink();
  resolved.target.apply(sink);
  return { target: resolved.target, slots };
};

describe("deep-link grammar", () => {
  test("resolves every addressable kind", () => {
    expect(boot("tk://list").target.kind).toBe("list");
    expect(boot("tk://board").target.kind).toBe("board");
    expect(boot("tk://graph").target.kind).toBe("graph");
    expect(boot("tk://insights").target.kind).toBe("insights");
    expect(boot("tk://task").target.kind).toBe("task");
    expect(boot("tk://artifact").target.kind).toBe("artifact");
    expect(boot("tk://diff").target.kind).toBe("diff");
    expect(boot("tk://diff-modal").target.kind).toBe("diff-modal");
    expect(boot("tk://help").target.kind).toBe("help");
    expect(boot("tk://composer/create").target.kind).toBe("composer");
    expect(boot("tk://task-modal/tasks-abc").target.kind).toBe("task-modal");
    expect(boot("tk://task/tasks-abc").target.kind).toBe("detail");
  });

  test("task/<id> opens the list with the detail pane and records the target id", () => {
    const { target, slots } = boot("tk://task/tasks-abc");
    expect(target.id).toBe("tasks-abc");
    expect(slots.view).toBe("list");
    expect(slots.detailId).toBe("tasks-abc");
    expect(slots.targetId).toBe("tasks-abc");
  });

  test("bare task is the view, with null id", () => {
    const { target, slots } = boot("tk://task");
    expect(target.kind).toBe("task");
    expect(target.id).toBeNull();
    expect(slots.targetId).toBeNull();
  });

  test("task-modal and composer record their addressed id", () => {
    expect(boot("tk://task-modal/tasks-x").slots.modalId).toBe("tasks-x");
    const composer = boot("tk://composer/comment");
    expect(composer.slots.composer.mode).toBe("comment");
    expect(composer.slots.composer.forId).toBeNull();
    expect(composer.slots.targetId).toBeNull();
  });

  test("unknown mode composer routes fall through to the error path", () => {
    expect(resolveTarget("tk://composer/nonexistent").ok).toBe(false);
  });

  test("unknown routes and non-URIs produce readable errors", () => {
    expect(resolveTarget("tk://nope").ok).toBe(false);
    expect(resolveTarget("tk://nope").ok === false ? resolveTarget("tk://nope").error : "").toContain("unknown deep-link route");
    expect(resolveTarget("http://example.com").ok).toBe(false);
    expect(resolveTarget("http://example.com").ok === false ? resolveTarget("http://example.com").error : "").toContain("tk://");
    expect(resolveTarget("tk://").ok).toBe(false);
  });

  test("query params are parsed and tolerated on routes without them", () => {
    const { target } = boot("tk://board?x=1");
    expect(target.kind).toBe("board");
  });

  test("resolver never throws on hostile input", () => {
    for (const query of ["", "tk://", "tk://%zz", "tk://task/%zz", "tk://a/b/c/d/e"]) {
      expect(() => resolveTarget(query)).not.toThrow();
    }
  });
});
