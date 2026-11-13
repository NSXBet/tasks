import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@tasks/rpc";
import { readRuntimeRegistry } from "@tasks/surface";
import { EVENTS_PAGE_LIMIT, PortBusyError, startWebServer } from "../src/server";

const workspaces: string[] = [];
function workspace(): string {
  const value = mkdtempSync(join(tmpdir(), "tk-web-"));
  mkdirSync(join(value, ".beads"), { recursive: true });
  workspaces.push(value);
  return value;
}
const init = async (root: string): Promise<void> => {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "../../cli/src/tk.ts"), "-C", root, "init", "--json"], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
};
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

describe("tk web server", () => {
  it("invokes onStopped when the HTTP /api/stop route tears the server down", async () => {
    const root = workspace();
    await init(root);
    let stopped = 0;
    const server = await startWebServer({ root, port: 0, onStopped: () => { stopped++; } });
    try {
      expect(stopped).toBe(0);
      const ack = await fetch(`${server.url}/api/stop`, { method: "POST" });
      expect(ack.status).toBe(200);
      // The route acks first and tears down on a timer — poll for the hook, then
      // verify the listening socket is actually gone.
      const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
      for (let i = 0; i < 50 && stopped === 0; i++) await delay(20);
      expect(stopped).toBe(1);
      await expect(fetch(`${server.url}/api/board`)).rejects.toThrow();
    } finally {
      await server.close(); // idempotent after a route-driven stop
    }
  });

  it("serves the shell and board API over a fresh workspace", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      const shell = await fetch(`${server.url}/`);
      expect(shell.status).toBe(200);
      expect(shell.headers.get("content-type")).toContain("text/html");
      const body = new TextDecoder().decode(await shell.arrayBuffer());
      expect(body).toContain("<!doctype html");
      // D-02: list-view rows carry the review doors — the TUI command as the row title, and two real
      // links (`❐ task` → /tasks/:id, `± review` → /tasks/:id/diff) in place of the old dead text.
      expect(body).toContain("doorsFor(i).tui");
      expect(body).toContain('class="lacts"');
      expect(body).toContain('class="task" href="${esc(taskUrl(issue.id))}" data-nav');
      expect(body).toContain('class="review" href="${esc(diffUrl(issue.id))}" data-nav');
      // Every view has a URL and the sidebar toggles (☰ / `\`).
      expect(body).toContain('id="navToggle"');
      expect(body).toContain('href="/list"');

      const board = await fetch(`${server.url}/api/board`);
      expect(board.status).toBe(200);
      const page = (await board.json()) as { readonly issues: readonly { readonly id: string }[]; readonly actor: string };
      expect(Array.isArray(page.issues)).toBe(true);
      expect(page.actor).toBe(process.env["USER"]);
    } finally {
      await server.close();
    }
  });

  it("serves the shell for the task, diff and file deep links (D-01)", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      for (const path of ["/list", "/board", "/graph/", "/insights", "/review", "/list?task=abc", "/tasks/abc", "/tasks/abc/", "/tasks/abc/diff", "/tasks/abc/diff/", "/tasks/abc/file"]) {
        const res = await fetch(`${server.url}${path}`);
        expect(res.status, path).toBe(200);
        expect(res.headers.get("content-type"), path).toContain("text/html");
        const body = new TextDecoder().decode(await res.arrayBuffer());
        expect(body, path).toContain('id="taskView"');
        expect(body, path).toContain('data-theme="dark"');
      }
      const miss = await fetch(`${server.url}/tasks/abc/nope`);
      expect(miss.status).toBe(404);
      expect(miss.headers.get("content-type")).toContain("application/json");
      const err = (await miss.json()) as { error: { kind: string } };
      expect(err.error.kind).toBe("not_found");
    } finally {
      await server.close();
    }
  });

  it("serves the review island in the shell and as a bundle", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      const shell = await fetch(`${server.url}/`);
      expect(shell.status).toBe(200);
      const body = new TextDecoder().decode(await shell.arrayBuffer());
      expect(body).toContain('id="reviewView"');
      expect(body).toContain("/assets/review-island.js");
      expect(body).not.toContain("tk-142");

      const bundle = await fetch(`${server.url}/assets/review-island.js`);
      expect(bundle.status).toBe(200);
      expect(bundle.headers.get("content-type")).toContain("text/javascript");
      const js = new TextDecoder().decode(await bundle.arrayBuffer());
      expect(js).toContain("ReviewIsland");
      // 08-03: lifecycle controls, header and send-to-agent ship in the bundle…
      for (const text of ["✕ remove", "✓ done", "↺ reopen", "/status", "All resolved", "send to agent", "/comments/send"]) expect(js).toContain(text);
      // …and the old resolve toggle route is gone from the island.
      expect(js).not.toContain("/resolve");
      // …without any storage code: the island imports only `@tasks/review/lifecycle` at runtime.
      expect(js).not.toContain("openStorage");
      expect(js).not.toContain("withinTransaction");
    } finally {
      await server.close();
    }
  });

  it("creates an issue through the API and reads it back on the board", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      const created = await fetch(`${server.url}/api/issue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "web-created", priority: 1 }) });
      expect(created.status).toBe(200);
      const { id } = (await created.json()) as { readonly id: string };
      expect(id).toBeTruthy();

      const board = await fetch(`${server.url}/api/board`);
      const page = (await board.json()) as { readonly issues: readonly { readonly id: string; readonly title: string }[] };
      const match = page.issues.find((issue) => issue.id === id);
      expect(match?.title).toBe("web-created");
    } finally {
      await server.close();
    }
  });

  it("updates status and title on an existing issue through the mutation route", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      const created = await fetch(`${server.url}/api/issue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "mutable" }) });
      const { id } = (await created.json()) as { readonly id: string };

      const updated = await fetch(`${server.url}/api/issue/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "closed", title: "renamed" }) });
      expect(updated.status).toBe(200);

      const board = await fetch(`${server.url}/api/board`);
      const page = (await board.json()) as { readonly issues: readonly { readonly id: string; readonly title: string; readonly status: string }[] };
      const match = page.issues.find((issue) => issue.id === id);
      expect(match?.title).toBe("renamed");
      expect(match?.status).toBe("closed");
    } finally {
      await server.close();
    }
  });

  it("answers 404 JSON for unknown routes", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      const missing = await fetch(`${server.url}/api/nope`);
      expect(missing.status).toBe(404);
      const error = (await missing.json()) as { readonly error: { readonly kind: string } };
      expect(error.error.kind).toBe("not_found");
    } finally {
      await server.close();
    }
  });

  it("refuses the port another tk web server already serves", async () => {
    const root = workspace();
    await init(root);
    const first = await startWebServer({ root, port: 0 });
    try {
      const busyPort = Number(new URL(first.url).port);
      await expect(startWebServer({ root, port: busyPort })).rejects.toThrow(PortBusyError);
    } finally {
      await first.close();
    }
  });

  it("refuses a port squatted by a foreign process instead of binding invisibly", async () => {
    const root = workspace();
    await init(root);
    const squatter = Bun.serve({ port: 0, fetch: () => new Response("not tk") });
    try {
      await expect(startWebServer({ root, port: squatter.port })).rejects.toThrow(PortBusyError);
    } finally {
      squatter.stop(true);
    }
  });

  it("serves POST /api/rpc with the server-injected root", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      const rpc = async (body: unknown): Promise<{ status: number; body: unknown }> => {
        const response = await fetch(`${server.url}/api/rpc`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      };
      const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

      // tk wire envelope: { v, id?, ok, value } | { v, id?, ok:false, error: { kind, message } }.
      const ok = await rpc({ v: PROTOCOL_VERSION, id: "c1", method: "issue.list", params: {} });
      expect(ok.status).toBe(200);
      expect(isObject(ok.body) && ok.body["v"]).toBe(PROTOCOL_VERSION);
      expect(isObject(ok.body) && ok.body["id"]).toBe("c1"); // correlation id echoed
      expect(isObject(ok.body) && ok.body["ok"]).toBe(true);
      // Verb handlers unwrap the surface Result, so value is the issue array itself.
      expect(isObject(ok.body) && Array.isArray(ok.body["value"])).toBe(true);
      const noId = await rpc({ v: PROTOCOL_VERSION, method: "issue.list" });
      expect(isObject(noId.body) && "id" in noId.body).toBe(false);

      expect((await rpc({ v: PROTOCOL_VERSION })).status).toBe(400); // method missing
      expect((await rpc({ method: "issue.list" })).status).toBe(400); // v missing
      expect((await rpc({ v: PROTOCOL_VERSION, method: "issue.list", root: "/elsewhere" })).status).toBe(400); // root injected server-side
      const unknownVerb = await rpc({ v: PROTOCOL_VERSION, method: "issue.undef" });
      expect(unknownVerb.status).toBe(400);
      const unknownVerbError = isObject(unknownVerb.body) ? unknownVerb.body["error"] : undefined;
      expect(isObject(unknownVerbError) && unknownVerbError["kind"]).toBe("method_unknown");
      const badJson = await fetch(`${server.url}/api/rpc`, { method: "POST", body: "{nope" });
      expect(badJson.status).toBe(400);
      const oversized = await fetch(`${server.url}/api/rpc`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ v: PROTOCOL_VERSION, method: "issue.list", params: { pad: "x".repeat(1_048_600) } }),
      });
      expect(oversized.status).toBe(413);
    } finally {
      await server.close();
    }
  });

  it("serves GET /api/events from the workspace log, including the server's own RPC writes", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      const created = await fetch(`${server.url}/api/rpc`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ v: PROTOCOL_VERSION, method: "issue.create", params: { title: "log test" } }),
      });
      expect(created.status).toBe(200);
      const id = ((await created.json()) as { value: { id: string } }).value.id;

      // The recorder appends after commit, so the line is on the log by the time the RPC answers.
      const page = async (query: string): Promise<{ events: { seq: number; kind: string; issueId?: string }[]; dropped: number; workspace: string }> =>
        (await (await fetch(`${server.url}/api/events?${query}`)).json()) as { events: { seq: number; kind: string; issueId?: string }[]; dropped: number; workspace: string };
      const all = await page("after=0");
      expect(all.dropped).toBe(0);
      expect(all.workspace).toBe(root);
      expect(all.events.map((e) => [e.kind, e.issueId])).toEqual([["task.created", id]]);
      const seqs = all.events.map((e) => e.seq);
      expect((await page(`after=${Math.max(...seqs)}`)).events).toEqual([]);
      // A legacy kind name maps through the alias table.
      expect((await page("after=0&kinds=issue.created")).events.map((e) => e.kind)).toEqual(["task.created"]);
      expect((await page("after=0&kinds=issue.deleted")).events).toEqual([]);
      expect(EVENTS_PAGE_LIMIT).toBe(512);
    } finally {
      await server.close();
    }
  });

  it("repoints the live server at another workspace via POST /api/open", async () => {
    const first = workspace();
    await init(first);
    const second = workspace();
    await init(second);
    const server = await startWebServer({ root: first, port: 0 });
    try {
      const status = (await (await fetch(`${server.url}/api/status`)).json()) as { readonly workspace: string; readonly workspaces: readonly string[] };
      expect(status.workspace).toBe(first);
      expect(status.workspaces).toEqual([first]);

      const opened = await fetch(`${server.url}/api/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: second }) });
      expect(opened.status).toBe(200);
      const ack = (await opened.json()) as { readonly ok: boolean; readonly workspace: string; readonly workspaces: readonly string[] };
      expect(ack.ok).toBe(true);
      expect(ack.workspace).toBe(second);
      // The known list now remembers both; the served workspace flipped.
      expect(ack.workspaces).toContain(first);
      expect(ack.workspaces).toContain(second);

      expect(((await fetch(`${server.url}/api/status`)).json() as Promise<{ readonly workspace: string }>)).resolves.toMatchObject({ workspace: second });

      const rejected = await fetch(`${server.url}/api/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "/definitely/not/a/workspace" }) });
      expect(rejected.status).toBe(400);
      const error = (await rejected.json()) as { readonly error: { readonly message: string } };
      expect(error.error.message).toBeTruthy();

      // A subdirectory of a workspace resolves to its enclosing root (CLI-identical discovery).
      const sub = mkdirSync(join(second, "sub"), { recursive: true });
      const viaSub = await fetch(`${server.url}/api/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: sub }) });
      expect(viaSub.status).toBe(200);
      expect(((await viaSub.json()) as { readonly workspace: string }).workspace).toBe(second);

      // The web registry row moves with the server: the new workspace's registry
      // names the live instance, the old one holds nothing — workspace-relative
      // `tk web stop`/`port` must resolve through the serving workspace.
      const moved = (await readRuntimeRegistry(join(second, ".tasks"))).find((row) => row.kind === "web");
      expect(moved?.url).toBe(server.url);
      const stale = (await readRuntimeRegistry(join(first, ".tasks"))).find((row) => row.kind === "web");
      expect(stale).toBeUndefined();
    } finally {
      await server.close();
    }
  });
});

describe("review comment lifecycle endpoints", () => {
  it("creates file and evidence comments, resolves, and sends one batch", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      const post = async (path: string, body: unknown): Promise<any> => (await fetch(`${server.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
      const made = await post("/api/issue", { title: "reviewed" });
      const id = made.id as string;
      const file = await post(`/api/review/${id}/threads`, { filePath: "src/a.ts", line: 4, body: "fix this" });
      const evidence = await post(`/api/review/${id}/threads`, { evidenceId: "evidence:shot", body: "wrong colour" });
      expect(evidence).toMatchObject({ evidenceId: "shot", filePath: "evidence:shot", status: "open" });

      const resolved = await post(`/api/review/${id}/threads/${file.id}/status`, { status: "resolved" });
      expect(resolved.status).toBe("resolved");
      const bad = await fetch(`${server.url}/api/review/${id}/threads/${file.id}/status`, { method: "POST", body: JSON.stringify({ status: "sent" }) });
      expect(bad.status).toBe(400);

      const sent = await post(`/api/review/${id}/comments/send`, {});
      expect(sent.sent).toHaveLength(1);
      expect(sent.sent[0]).toMatchObject({ location: "evidence:shot", body: "wrong colour" });
      expect(sent.counts.label).toBe("1 open · 1 ✓");

      const list = await (await fetch(`${server.url}/api/review/${id}/threads`)).json() as { counts: { sent: number; resolved: number }; allResolved: boolean };
      expect(list.counts).toMatchObject({ sent: 1, resolved: 1 });
      expect(list.allResolved).toBe(false);

      // The island's `✕ remove` on the sent comment, then `↺ reopen` (08-03): same calls, same route.
      const getList = async (): Promise<{ counts: { dismissed: number; label: string }; allResolved: boolean }> => (await fetch(`${server.url}/api/review/${id}/threads`)).json() as never;
      const dismissed = await post(`/api/review/${id}/threads/${evidence.id}/status`, { status: "dismissed" });
      expect(dismissed.status).toBe("dismissed");
      const afterRemove = await getList();
      expect(afterRemove.counts.dismissed).toBe(1);
      expect(afterRemove.allResolved).toBe(true);
      expect(afterRemove.counts.label).toBe("0 open · 1 ✓");
      const reopened = await post(`/api/review/${id}/threads/${evidence.id}/status`, { status: "open" });
      expect(reopened.status).toBe("open");
      expect((await getList()).allResolved).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("sends every open comment as one batch from the island's send-to-agent button (08-03)", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root, port: 0 });
    try {
      const post = async (path: string, body: unknown): Promise<any> => (await fetch(`${server.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
      const made = await post("/api/issue", { title: "batch send" });
      const id = made.id as string;
      await post(`/api/review/${id}/threads`, { filePath: "src/a.ts", line: 2, body: "first" });
      await post(`/api/review/${id}/threads`, { filePath: "src/b.ts", body: "second" });

      const first = await post(`/api/review/${id}/comments/send`, {});
      expect(first.sent).toHaveLength(2);
      const list = await (await fetch(`${server.url}/api/review/${id}/threads`)).json() as { threads: { status: string }[]; counts: { label: string } };
      expect(list.threads.map((t) => t.status)).toEqual(["sent", "sent"]);
      expect(list.counts.label).toBe("2 open · 0 ✓");

      const again = await post(`/api/review/${id}/comments/send`, {});
      expect(again.sent).toHaveLength(0);

      const shown = await post("/api/rpc", { v: PROTOCOL_VERSION, method: "issue.show", params: { id } });
      expect(shown.ok).toBe(true);
      const comments = (shown.value?.comments ?? []) as { text?: string; body?: string }[];
      const summaries = comments.filter((c) => (c.text ?? c.body ?? "").startsWith("[review sent] 2 comments"));
      expect(summaries).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});

describe("artifact view endpoints (05-03)", () => {
  const tkBin = join(import.meta.dir, "../../cli/src/tk.ts");
  const run = (cmd: readonly string[], cwd?: string): string => {
    const result = Bun.spawnSync([...cmd], { cwd, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    return new TextDecoder().decode(result.stdout);
  };
  const git = (dir: string, ...args: readonly string[]): string =>
    run(["git", "-c", "user.name=test", "-c", "user.email=test@example.com", ...args], dir);
  const tk = (dir: string, ...args: readonly string[]): string => run([process.execPath, tkBin, "-C", dir, ...args]);

  it("reads the worktree file, guards the path, and records line + file threads on the task", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "tk-web-artifact-"))); // macOS /var → /private/var
    workspaces.push(repo);
    git(repo, "init", "-q", "-b", "main");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "init");
    tk(repo, "init", "--prefix", "tk", "--json");
    const { id } = JSON.parse(tk(repo, "create", "artifact task", "--json")) as { id: string };
    const work = JSON.parse(tk(repo, "work", id, "--json")) as { path: string };
    const server = await startWebServer({ root: repo, port: 0 });
    try {
      const fileUrl = (path: string): string => `${server.url}/api/review/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`;
      const ok = await fetch(fileUrl("src/a.ts"));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ contents: readFileSync(join(work.path, "src", "a.ts"), "utf8") });
      expect((await fetch(fileUrl("../escape"))).status).toBe(400);
      expect((await fetch(fileUrl("nope.ts"))).status).toBe(404);

      const post = async (body: unknown): Promise<Response> => fetch(`${server.url}/api/review/${encodeURIComponent(id)}/threads`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      expect((await post({ filePath: "src/a.ts", line: 1, side: "new", body: "artifact note" })).status).toBe(200);
      expect((await post({ filePath: "src/a.ts", body: "file note" })).status).toBe(200);

      const list = await (await fetch(`${server.url}/api/review/${encodeURIComponent(id)}/threads`)).json() as { threads: Array<{ filePath: string; line?: number; side?: string; comments: Array<{ body: string }> }> };
      const onFile = list.threads.filter((t) => t.filePath === "src/a.ts");
      expect(onFile).toHaveLength(2);
      expect(onFile.find((t) => t.line === 1)).toMatchObject({ side: "new", comments: [{ body: expect.stringContaining("artifact note") }] });
      expect(onFile.find((t) => t.line === undefined)).toMatchObject({ comments: [{ body: expect.stringContaining("file note") }] });

      const shown = tk(repo, "show", id);
      expect(shown).toContain("REVIEW (2)");
      expect(shown).toContain("src/a.ts:1");
      expect(shown).toContain("artifact note");
      expect(shown).toContain("file note");
    } finally {
      await server.close();
    }
  });
});
