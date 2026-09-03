import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { diffOnce } from "../src/watch/core.js";
import type { WatchSubscription } from "../src/watch/protocol.js";
import type { IssueUnitOfWork } from "@tasks/application";
import type { Issue } from "@tasks/domain";

const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-watch-")); workspaces.push(value); return value; }
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

function fakeUow(issues: readonly Issue[]): IssueUnitOfWork {
  return {
    findById: async () => { throw new Error("not used"); },
    save: async () => { throw new Error("not used"); },
    list: async () => ({ ok: true, value: { items: issues, nextCursor: null } }),
    addDependency: async () => { throw new Error("not used"); },
    removeDependency: async () => { throw new Error("not used"); },
    addComment: async () => { throw new Error("not used"); },
    delete: async () => { throw new Error("not used"); },
    history: async () => { throw new Error("not used"); },
    claimReady: async () => { throw new Error("not used"); },
    withinTransaction: async () => { throw new Error("not used"); },
    currentVersion: async () => { throw new Error("not used"); },
    historyAll: async () => { throw new Error("not used"); },
    migrate: async () => { throw new Error("not used"); },
    hasPendingMigrations: async () => { throw new Error("not used"); },
  } as unknown as IssueUnitOfWork;
}

const issue = (id: string, status = "open", updatedAt = new Date(0)): Issue => ({
  id: id as Issue["id"], title: id as Issue["title"], description: "" as Issue["description"],
  status, priority: 2 as Issue["priority"], type: "task", owner: null, assignee: null, createdBy: null,
  createdAt: new Date(0), updatedAt, startedAt: null, closedAt: null, dueAt: null, deferUntil: null,
  parentId: null, labels: [], notes: null, design: null, acceptanceCriteria: null, estimate: null,
  specId: null, externalRef: null, branch: null, metadata: {}, wireUnknown: {},
  dependencies: [], dependencyCount: 0, dependentCount: 0, comments: [], commentCount: 0,
});

describe("watch diff", () => {
  it("emits created on first sight, updated/status_changed on change, deleted on removal", async () => {
    const subscription: WatchSubscription = {};
    const state = { lastUpdatedAt: new Map<string, string>(), readyHash: null, counts: null };
    const uow1 = fakeUow([issue("tk-a"), issue("tk-b")]);
    const first = await diffOnce(uow1, subscription, state);
    expect(first.map((event) => event.kind).sort()).toEqual(["issue.created", "issue.created"]);

    const uow2 = fakeUow([issue("tk-a", "open", new Date(1000)), issue("tk-b")]);
    const second = await diffOnce(uow2, subscription, state);
    expect(second).toHaveLength(1);
    expect(second[0]!.kind).toBe("issue.updated");
    expect(second[0]!.issueId).toBe("tk-a");

    const uow3 = fakeUow([issue("tk-b")]);
    const third = await diffOnce(uow3, subscription, state);
    // tk-a removed (deleted), the ready set shrank, and open counts 2→1.
    expect(third.map((event) => event.kind).sort()).toEqual(["counts.changed", "issue.deleted", "ready.changed"]);
    expect(third.find((event) => event.kind === "issue.deleted")!.issueId).toBe("tk-a");
  });

  it("honors kinds and ids subscription filters", async () => {
    const subscription: WatchSubscription = { kinds: ["issue.created"], ids: ["tk-a"] };
    const state = { lastUpdatedAt: new Map<string, string>(), readyHash: null, counts: null };
    const uow = fakeUow([issue("tk-a"), issue("tk-b")]);
    const events = await diffOnce(uow, subscription, state);
    expect(events).toHaveLength(1);
    expect(events[0]!.issueId).toBe("tk-a");
  });

  it("emits ready.changed when the ready set grows", async () => {
    const subscription: WatchSubscription = {};
    const state = { lastUpdatedAt: new Map<string, string>(), readyHash: null, counts: null };
    await diffOnce(fakeUow([issue("tk-a", "closed")]), subscription, state);
    const events = await diffOnce(fakeUow([issue("tk-a", "open")]), subscription, state);
    expect(events.map((event) => event.kind)).toContain("ready.changed");
  });

  it("attaches counts to every event and emits counts.changed when they move", async () => {
    const subscription: WatchSubscription = {};
    const state = { lastUpdatedAt: new Map<string, string>(), readyHash: null, counts: null };
    const first = await diffOnce(fakeUow([issue("tk-a", "open"), issue("tk-b", "ready-to-review")]), subscription, state);
    expect(first.every((event) => event.counts?.open === 2)).toBe(true);
    expect(state.counts).toEqual({ open: 2, blocked: 0, readyToReview: 1 });

    const second = await diffOnce(fakeUow([issue("tk-a", "closed"), issue("tk-b", "ready-to-review")]), subscription, state);
    // tk-a closing emits both its deleted event and a counts.changed (open 2→1).
    expect(second.some((event) => event.kind === "counts.changed" && event.counts?.open === 1)).toBe(true);
    expect(state.counts).toEqual({ open: 1, blocked: 0, readyToReview: 1 });
  });
});

describe("watch child", () => {
  it("exits 2 when no workspace exists", async () => {
    const missing = join(tmpdir(), `tk-watch-missing-${Date.now()}`);
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/watch/child-entry.ts"), missing], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
    const code = await child.exited;
    expect(code).toBe(2);
  });
});
