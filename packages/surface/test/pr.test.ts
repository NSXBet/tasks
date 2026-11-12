/** gh.ts over a fake ProcessRunner (no binary): parsing, validation and failure mapping (PR-01). */
import { afterEach, describe, expect, it } from "vitest";
import type { ProcessRunner } from "@tasks/git";
import { ghBinary, ghPrClose, ghPrCreate, ghPrListOpenForHead, ghPrMerge, ghPrView, prClose, prMerge, prShow } from "../src/index.js";

type Reply = { stdout?: string; stderr?: string; code?: number };
function fakeGh(answer: (argv: readonly string[]) => Reply): ProcessRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return { calls, async run(command) { calls.push([...command]); const reply = answer(command.slice(1)); return { stdout: reply.stdout ?? "", stderr: reply.stderr ?? "", code: reply.code ?? 0 }; } };
}
const URL = "https://github.com/acme/app/pull/7";
const saved = process.env["TK_GH"];
afterEach(() => { if (saved === undefined) delete process.env["TK_GH"]; else process.env["TK_GH"] = saved; });

describe("gh wrapper", () => {
  it("ghBinary honors a non-empty TK_GH", () => {
    process.env["TK_GH"] = "";
    expect(ghBinary()).toBe("gh");
    process.env["TK_GH"] = "/opt/gh";
    expect(ghBinary()).toBe("/opt/gh");
  });

  it("ghPrView parses and lowercases gh JSON", async () => {
    delete process.env["TK_GH"];
    const runner = fakeGh(() => ({ stdout: JSON.stringify({ number: 7, url: URL, state: "OPEN" }) }));
    expect(await ghPrView("7", "/r", runner)).toEqual({ number: 7, url: URL, state: "open" });
    expect(runner.calls).toEqual([["gh", "pr", "view", "7", "--json", "number,url,state"]]);
  });

  it("malformed or invalid payloads are a clear error", async () => {
    await expect(ghPrView("7", "/r", fakeGh(() => ({ stdout: "not json" })))).rejects.toThrow("gh returned an unexpected PR payload");
    await expect(ghPrView("7", "/r", fakeGh(() => ({ stdout: JSON.stringify({ number: 7, url: "javascript:x", state: "OPEN" }) })))).rejects.toThrow("gh returned an unexpected PR payload");
  });

  it("maps exit 127 to gh not found and other exits to the first stderr line", async () => {
    await expect(ghPrView("7", "/r", fakeGh(() => ({ code: 127 })))).rejects.toThrow("gh not found — install GitHub CLI (https://cli.github.com) or set TK_GH");
    const auth = ghPrView("7", "/r", fakeGh(() => ({ code: 4, stderr: "gh: authentication required\nmore" })));
    await expect(auth).rejects.toThrow("gh pr view failed: gh: authentication required");
    await expect(ghPrView("7", "/r", fakeGh(() => ({ code: 4, stderr: "bad\u001b[31m thing\nmore" })))).rejects.toThrow(/^gh pr view failed: bad\[31m thing$/);
  });

  it("ghPrListOpenForHead returns null for [] and the record otherwise", async () => {
    expect(await ghPrListOpenForHead("tk/x", "/r", fakeGh(() => ({ stdout: "[]" })))).toBeNull();
    const runner = fakeGh(() => ({ stdout: JSON.stringify([{ number: 7, url: URL, state: "OPEN" }]) }));
    expect(await ghPrListOpenForHead("tk/x", "/r", runner)).toEqual({ number: 7, url: URL, state: "open" });
    expect(runner.calls[0]).toEqual(["gh", "pr", "list", "--head", "tk/x", "--state", "open", "--json", "number,url,state", "--limit", "1"]);
  });

  it("ghPrCreate keeps title/body single-token (a leading dash cannot become a flag) and views the URL", async () => {
    const runner = fakeGh((argv) => (argv[1] === "create" ? { stdout: `Creating pull request\n${URL}\n` } : { stdout: JSON.stringify({ number: 7, url: URL, state: "OPEN" }) }));
    expect(await ghPrCreate({ head: "tk/x", base: "main", title: "--draft", body: "-b" }, "/r", runner)).toEqual({ number: 7, url: URL, state: "open" });
    expect(runner.calls[0]).toEqual(["gh", "pr", "create", "--head", "tk/x", "--base", "main", "--title=--draft", "--body=-b"]);
    expect(runner.calls[1]).toEqual(["gh", "pr", "view", URL, "--json", "number,url,state"]);
  });

  it("prShow never runs a process", async () => {
    const issue = { id: "tk-1", metadata: { pr: { number: 7, url: URL, state: "open" } } };
    const shown = await prShow({ transact: async (fn) => fn({ findById: async () => ({ ok: true, value: issue }) } as never) }, "tk-1");
    expect(shown.pr).toEqual({ number: 7, url: URL, state: "open" });
  });
});

describe("gh close/merge (11-03)", () => {
  it("ghPrMerge passes only the closed-enum method — never --admin or --delete-branch", async () => {
    delete process.env["TK_GH"];
    const runner = fakeGh(() => ({}));
    await ghPrMerge(7, "rebase", "/r", runner);
    await ghPrMerge(7, "squash", "/r", runner);
    await ghPrMerge(7, "merge", "/r", runner);
    expect(runner.calls).toEqual([["gh", "pr", "merge", "7", "--rebase"], ["gh", "pr", "merge", "7", "--squash"], ["gh", "pr", "merge", "7", "--merge"]]);
    await expect(ghPrMerge(7, "admin" as never, "/r", runner)).rejects.toThrow("unknown merge method: admin");
    expect(runner.calls).toHaveLength(3);
    expect(runner.calls.flat()).not.toContain("--admin");
    expect(runner.calls.flat()).not.toContain("--delete-branch");
  });

  it("ghPrClose runs `pr close <n>` behind ghBinary()", async () => {
    process.env["TK_GH"] = "/opt/gh";
    const runner = fakeGh(() => ({}));
    await ghPrClose(7, "/r", runner);
    expect(runner.calls).toEqual([["/opt/gh", "pr", "close", "7"]]);
  });

  type Saved = { metadata: Record<string, unknown> };
  function deps(state: () => string, stored: { pr?: unknown }) {
    const issue: Saved & { id: string } = { id: "tk-1", metadata: { ...(stored.pr === undefined ? {} : { pr: stored.pr }) } };
    const saves: Saved[] = [];
    const uow = { findById: async () => ({ ok: true, value: issue }), save: async (next: Saved) => { saves.push(next); return { ok: true }; } };
    const ghRunner = fakeGh((argv) => (argv[1] === "view" ? { stdout: JSON.stringify({ number: 7, url: URL, state: state() }) } : {}));
    return { saves, ghRunner, deps: { cwd: "/r", transact: async (fn: (u: never) => unknown) => fn(uow as never), ghRunner } as never };
  }

  it("prMerge prechecks, merges, views again and saves merged; no-op on an already merged PR", async () => {
    delete process.env["TK_GH"];
    let state = "OPEN";
    const open = deps(() => state, { pr: { number: 7, url: URL, state: "open" } });
    const original = open.ghRunner.run.bind(open.ghRunner);
    open.ghRunner.run = async (command) => { const out = await original(command); if (command[2] === "merge") state = "MERGED"; return out; };
    const merged = await prMerge(open.deps, "tk-1", "squash");
    expect(merged.op).toBe("merge");
    expect(merged.pr.state).toBe("merged");
    expect(open.ghRunner.calls.map((call) => call.slice(1, 3).join(" "))).toEqual(["pr view", "pr merge", "pr view"]);
    expect(open.saves).toHaveLength(1);
    const already = deps(() => "MERGED", { pr: { number: 7, url: URL, state: "open" } });
    expect((await prMerge(already.deps, "tk-1")).pr.state).toBe("merged");
    expect(already.ghRunner.calls.map((call) => call.slice(1, 3).join(" "))).toEqual(["pr view"]);
    expect(already.saves).toHaveLength(1);
  });

  it("close/merge without a record refuse before any gh call; merge refuses a closed PR, close refuses a merged one", async () => {
    const none = deps(() => "OPEN", {});
    await expect(prClose(none.deps, "tk-1")).rejects.toThrow("no PR on tk-1 — run tk pr create tk-1");
    await expect(prMerge(none.deps, "tk-1")).rejects.toThrow("no PR on tk-1 — run tk pr create tk-1");
    expect(none.ghRunner.calls).toHaveLength(0);
    const closed = deps(() => "CLOSED", { pr: { number: 7, url: URL, state: "open" } });
    await expect(prMerge(closed.deps, "tk-1")).rejects.toThrow("is closed — reopen it on GitHub before merging");
    const merged = deps(() => "MERGED", { pr: { number: 7, url: URL, state: "open" } });
    await expect(prClose(merged.deps, "tk-1")).rejects.toThrow("is already merged — nothing to close");
    expect([...closed.ghRunner.calls, ...merged.ghRunner.calls].every((call) => call[2] === "view")).toBe(true);
  });
});
