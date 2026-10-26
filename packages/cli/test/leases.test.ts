import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-lease-")); workspaces.push(value); return value; }
function run(directory: string, args: readonly string[], env?: Record<string, string>): { readonly stdout: string; readonly stderr: string; readonly status: number } {
  const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: env === undefined ? { ...process.env } : { ...process.env, ...env } });
  return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode };
}
function json<T>(directory: string, args: readonly string[], env?: Record<string, string>): T { const result = run(directory, [...args, "--json"], env); expect(result.status, result.stderr).toBe(0); return JSON.parse(result.stdout) as T; }
interface LeaseWire { readonly name: string; readonly holder: string; readonly purpose: string; readonly issue_id: string | null; readonly remaining_ms: number; }
interface LeaseError { readonly error: { readonly kind: string; readonly message: string }; }

afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

describe("tk lease", () => {
  it("acquires, lists, and releases a hold with holder identity", () => {
    const directory = workspace();
    json(directory, ["init"]);
    const leased = json<LeaseWire>(directory, ["lease", "acquire", "ios-simulator", "--purpose", "verify accounts", "--ttl", "60000"], { TK_SESSION: "session-a" });
    expect(leased.name).toBe("ios-simulator");
    expect(leased.holder).toBe("session-a");
    expect(leased.purpose).toBe("verify accounts");
    expect(leased.issue_id).toBeNull();
    expect(leased.remaining_ms).toBeGreaterThan(50_000);
    const listed = json<readonly LeaseWire[]>(directory, ["lease", "list"]);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.holder).toBe("session-a");
    const released = json<{ readonly name: string }>(directory, ["lease", "release", "ios-simulator"], { TK_SESSION: "session-a" });
    expect(released.name).toBe("ios-simulator");
    expect(json<readonly unknown[]>(directory, ["lease", "list"])).toEqual([]);
  });

  it("rejects a second acquirer with the holder's identity as a conflict", () => {
    const directory = workspace();
    json(directory, ["init"]);
    json(directory, ["lease", "acquire", "ios-simulator", "--purpose", "verify"], { TK_SESSION: "session-a" });
    const busy = run(directory, ["lease", "acquire", "ios-simulator", "--json"], { TK_SESSION: "session-b" });
    expect(busy.status).not.toBe(0);
    const error = JSON.parse(busy.stderr) as LeaseError;
    expect(error.error.kind).toBe("conflict");
    expect(error.error.message).toContain("session-a");
    expect(error.error.message).toContain("ios-simulator");
  });

  it("associates a lease with an existing issue and rejects typos", () => {
    const directory = workspace();
    json(directory, ["init"]);
    const issue = json<{ readonly id: string }>(directory, ["create", "verify accounts screen"]);
    const leased = json<LeaseWire>(directory, ["lease", "acquire", "ios-simulator", "--task", issue.id], { TK_SESSION: "session-a" });
    expect(leased.issue_id).toBe(issue.id);
    const typo = run(directory, ["lease", "acquire", "port:19006", "--task", "tk-nope", "--json"]);
    expect(typo.status).not.toBe(0);
    expect((JSON.parse(typo.stderr) as LeaseError).error.kind).toBe("not_found");
  });

  it("renews for the current holder and refuses others", () => {
    const directory = workspace();
    json(directory, ["init"]);
    json(directory, ["lease", "acquire", "ios-simulator", "--ttl", "60000"], { TK_SESSION: "session-a" });
    const renewed = json<LeaseWire>(directory, ["lease", "renew", "ios-simulator", "--ttl", "120000"], { TK_SESSION: "session-a" });
    expect(renewed.remaining_ms).toBeGreaterThan(110_000);
    const other = run(directory, ["lease", "renew", "ios-simulator", "--json"], { TK_SESSION: "session-b" });
    expect(other.status).not.toBe(0);
    expect((JSON.parse(other.stderr) as LeaseError).error.kind).toBe("conflict");
  });

  it("refuses releasing another holder's or an unknown lease", () => {
    const directory = workspace();
    json(directory, ["init"]);
    json(directory, ["lease", "acquire", "ios-simulator"], { TK_SESSION: "session-a" });
    const foreign = run(directory, ["lease", "release", "ios-simulator", "--json"], { TK_SESSION: "session-b" });
    expect((JSON.parse(foreign.stderr) as LeaseError).error.kind).toBe("conflict");
    const unknown = run(directory, ["lease", "release", "port:19006", "--json"]);
    expect((JSON.parse(unknown.stderr) as LeaseError).error.kind).toBe("not_found");
  });

  it("queues a second acquirer with --wait until the hold expires", () => {
    const directory = workspace();
    json(directory, ["init"]);
    json(directory, ["lease", "acquire", "ios-simulator", "--ttl", "1000"], { TK_SESSION: "session-a" });
    // Genuine clock-driven expiry — the TTL lives in leases.json and the
    // waiter polls the real file; deterministic fake time cannot drive it.
    const waited = run(directory, ["lease", "acquire", "ios-simulator", "--wait", "5000", "--json"], { TK_SESSION: "session-b" });
    expect(waited.status, waited.stderr).toBe(0);
    expect((JSON.parse(waited.stdout) as LeaseWire).holder).toBe("session-b");
  });
});
