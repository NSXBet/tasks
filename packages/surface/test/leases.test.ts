import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireLease, grantLease, LeaseBusyError, leaseBusyMessage, readLeases, releaseLease,
  releaseLeaseFile, renewLease, sweepLeases, type LeaseRow,
} from "../src/leases";

const row = (over: Partial<LeaseRow> = {}): LeaseRow => ({
  name: "ios-simulator", holder: "session-a", purpose: "verify accounts", issue: null,
  grantedAt: "2026-10-25T12:00:00.000Z", expiresAt: "2026-10-25T12:15:00.000Z", ...over,
});
const at = (iso: string): Date => new Date(iso);
const tasksDirs: string[] = [];
const tasksDir = (): string => {
  const value = mkdtempSync(join(tmpdir(), "tk-leases-"));
  tasksDirs.push(value);
  return value;
};
afterEach(() => { while (tasksDirs.length) rmSync(tasksDirs.pop()!, { recursive: true, force: true }); });

describe("lease book", () => {
  describe("sweepLeases", () => {
    it("drops only expired rows", () => {
      const book = [row(), row({ name: "port:19006", expiresAt: "2026-10-25T11:59:59.999Z" })];
      const swept = sweepLeases(book, at("2026-10-25T12:00:00.000Z"));
      expect(swept.book.map((entry) => entry.name)).toEqual(["ios-simulator"]);
      expect(swept.released.map((entry) => entry.name)).toEqual(["port:19006"]);
    });

    it("keeps a lease whose expiry is exactly now (border is exclusive)", () => {
      const book = [row({ expiresAt: "2026-10-25T12:00:00.000Z" })];
      expect(sweepLeases(book, at("2026-10-25T11:59:59.999Z")).book).toHaveLength(1);
    });
  });

  describe("grantLease", () => {
    it("grants on a free name and stamps grantedAt/expiresAt from ttl", () => {
      const result = grantLease([], { name: "ios-simulator", holder: "s1", purpose: "p", ttlMs: 60_000 }, at("2026-10-25T12:00:00.000Z"));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.lease).toEqual({ name: "ios-simulator", holder: "s1", purpose: "p", issue: null, grantedAt: "2026-10-25T12:00:00.000Z", expiresAt: "2026-10-25T12:01:00.000Z" });
      }
    });

    it("refuses with the active holder row when another session holds", () => {
      const book = [row()];
      const result = grantLease(book, { name: "ios-simulator", holder: "s2", purpose: "p2", ttlMs: 60_000 }, at("2026-10-25T12:01:00.000Z"));
      expect(result).toEqual({ ok: false, reason: "busy", holder: row() });
    });

    it("refreshes the hold when the same holder re-acquires (retry/restart friendly)", () => {
      const result = grantLease([row()], { name: "ios-simulator", holder: "session-a", purpose: "p2", ttlMs: 120_000 }, at("2026-10-25T12:10:00.000Z"));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.lease.expiresAt).toBe("2026-10-25T12:12:00.000Z");
    });

    it("grants independent names in parallel", () => {
      const first = grantLease([], { name: "ios-simulator", holder: "s1", purpose: "p", ttlMs: 60_000 }, at("2026-10-25T12:00:00.000Z"));
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const second = grantLease([first.lease], { name: "port:19006", holder: "s2", purpose: "p", ttlMs: 60_000 }, at("2026-10-25T12:00:00.000Z"));
      expect(second.ok).toBe(true);
    });
  });

  describe("renewLease", () => {
    it("extends the expiry for the holder", () => {
      const result = renewLease([row()], "ios-simulator", "session-a", 60_000, at("2026-10-25T12:14:00.000Z"));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.lease.expiresAt).toBe("2026-10-25T12:15:00.000Z");
    });

    it("reports not_found when no lease with the name is held", () => {
      expect(renewLease([], "ios-simulator", "session-a", 60_000, at("2026-10-25T12:00:00.000Z"))).toEqual({ ok: false, reason: "not_found" });
    });

    it("refuses a foreign holder from extending (takeover guard)", () => {
      expect(renewLease([row()], "ios-simulator", "session-b", 60_000, at("2026-10-25T12:00:00.000Z"))).toEqual({ ok: false, reason: "not_holder", holder: row() });
    });
  });

  describe("releaseLease", () => {
    it("removes the holder's lease", () => {
      const result = releaseLease([row()], "ios-simulator", "session-a");
      expect(result).toEqual({ ok: true });
    });

    it("reports not_found when nothing is held", () => {
      expect(releaseLease([], "ios-simulator", "session-a")).toEqual({ ok: false, reason: "not_found" });
    });

    it("refuses release by a foreign holder", () => {
      expect(releaseLease([row()], "ios-simulator", "session-b")).toEqual({ ok: false, reason: "not_holder", holder: row() });
    });
  });

  describe("leaseBusyMessage", () => {
    it("names the holder, purpose, task, and remaining time", () => {
      const message = leaseBusyMessage(row({ purpose: "verify accounts", issue: "tasks-42" }), at("2026-10-25T12:03:00.000Z"));
      expect(message).toContain("ios-simulator");
      expect(message).toContain("session-a");
      expect(message).toContain("verify accounts");
      expect(message).toContain("tasks-42");
      expect(message).toContain("12m");
    });

    it("formats sub-minute remainders in seconds", () => {
      expect(leaseBusyMessage(row(), at("2026-10-25T12:14:20.000Z"))).toContain("40s");
    });
  });

  describe("persistence", () => {
    it("round-trips leases through leases.json with atomic writes and expiry sweep on read", async () => {
      const dir = tasksDir();
      expect(await readLeases(dir)).toEqual([]);
      const acquired = await acquireLease(dir, { name: "ios-simulator", holder: "s1", purpose: "p", ttlMs: 60_000 }, at("2026-10-25T12:00:00.000Z"));
      expect(acquired.holder).toBe("s1");
      const busy = await acquireLease(dir, { name: "ios-simulator", holder: "s2", purpose: "p", ttlMs: 60_000 }, at("2026-10-25T12:00:01.000Z")).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(busy).toBeInstanceOf(LeaseBusyError);
      expect((busy as LeaseBusyError).message).toContain("s1");
      const held = await readLeases(dir, at("2026-10-25T12:00:01.000Z")); // 1s after grant, 59s before expiry
      expect(held).toHaveLength(1);
      expect(held[0]?.holder).toBe("s1");
      await releaseLeaseFile(dir, "ios-simulator", "s1");
      expect(await readLeases(dir, at("2026-10-25T12:00:01.000Z"))).toEqual([]);
    });
  });
});
