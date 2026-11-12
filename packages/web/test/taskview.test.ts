/**
 * 09-06: the web task view's one payload, `GET /api/review/:id/taskview` —
 * changes tree, minimap, artifacts, sessions, workspace and comments derived
 * server-side through `@tasks/review/taskview` over a real `tk work` repo.
 */
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderDocBlocks, worktreeLabel } from "../src/review";
import { startWebServer } from "../src/server";

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function tk<T>(directory: string, args: readonly string[]): T {
  const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args, "--json"], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  return JSON.parse(new TextDecoder().decode(result.stdout)) as T;
}
function git(directory: string, ...args: readonly string[]): void {
  const result = Bun.spawnSync(["git", "-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
}

/** A 1×1 PNG, so `tk attach --evidence` records `image/png`. */
const png = (): Buffer => {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (bytes: Buffer): number => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))), chunk("IEND", Buffer.alloc(0))]);
};

/** A tk workspace in a git repo: one task under `tk work` with an uncommitted edit to src/a.ts, one plain task. */
function fixture(): { readonly repo: string; readonly id: string; readonly bare: string; readonly worktree: string } {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "tk-web-taskview-")));
  dirs.push(repo);
  git(repo, "init", "-q", "-b", "main");
  Bun.spawnSync(["mkdir", "-p", join(repo, "src")]);
  appendFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  tk(repo, ["init", "--prefix", "tk"]);
  const { id } = tk<{ id: string }>(repo, ["create", "task view"]);
  const { id: bare } = tk<{ id: string }>(repo, ["create", "no branch"]);
  const work = tk<{ path: string }>(repo, ["work", id]);
  writeFileSync(join(work.path, "src", "a.ts"), "export const a = 2;\n");
  return { repo, id, bare, worktree: work.path };
}

interface ChangesRow { kind: string; depth: number; name: string; path: string; status: string | null; needsReview: boolean }
interface TaskView {
  stats: { path: string; status: string }[];
  changes: ChangesRow[];
  minimap: { path: string; hunkIndex: number; size: number; tone: string }[];
  artifacts: { counts: { src: number; edit: number; new: number; other: number }; groups: { label: string; rows: { key: string; kind: string; comments: number }[] }[] };
  sessions: { id: string; state: string; label: string; updatedAt: string }[];
  workspace: { branch: string | null; base: string | null; worktree: string | null; worktreeLabel: string | null; host: string; dirty: number | null };
  comments: { counts: { open: number; resolved: number }; rows: { id: string; author: string; first: string; location: string; filePath: string | null; status: string }[] };
}

const post = (url: string, body: unknown): Promise<Response> =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("GET /api/review/:id/taskview (09-06)", () => {
  it("changes tree reads the worktree; a resolved thread clears the review dot; a branchless task is empty, not 500", async () => {
    const { repo, id, bare } = fixture();
    const server = await startWebServer({ root: repo, port: 0 });
    try {
      const view = await (await fetch(`${server.url}/api/review/${id}/taskview`)).json() as TaskView;
      expect(view.stats[0]?.path).toBe("src/a.ts");
      expect(view.changes).toContainEqual(expect.objectContaining({ kind: "dir", name: "src/", needsReview: true }));
      expect(view.changes).toContainEqual(expect.objectContaining({ kind: "file", name: "a.ts", status: "M", needsReview: true }));

      const created = await (await post(`${server.url}/api/review/${id}/threads`, { filePath: "src/a.ts", line: 1, body: "x" })).json() as { id: string };
      expect((await post(`${server.url}/api/review/${id}/threads/${created.id}/status`, { status: "resolved" })).status).toBe(200);
      const after = await (await fetch(`${server.url}/api/review/${id}/taskview`)).json() as TaskView;
      expect(after.changes.find((row) => row.name === "a.ts")?.needsReview).toBe(false);
      // The COMMENTS preview row: prefix stripped, line location, file link target.
      expect(after.comments.rows).toEqual([expect.objectContaining({ first: "x", location: "src/a.ts:1", filePath: "src/a.ts", status: "resolved" })]);

      const plain = await fetch(`${server.url}/api/review/${bare}/taskview`);
      expect(plain.status).toBe(200);
      const empty = await plain.json() as TaskView;
      expect(empty.changes).toEqual([]);
      expect(empty.workspace.branch).toBeNull();
      expect(empty.workspace.dirty).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("artifacts, workspace, minimap and sessions carry real data", async () => {
    const { repo, id } = fixture();
    const shot = join(repo, "shot.png");
    writeFileSync(shot, png());
    tk(repo, ["attach", id, "--evidence", shot]);
    const shown = tk<{ attachments: { id?: string; kind?: string }[] }[]>(repo, ["show", id]);
    const evidenceId = shown[0]!.attachments.find((a) => a.kind === "evidence")!.id!;
    const server = await startWebServer({ root: repo, port: 0 });
    try {
      expect((await post(`${server.url}/api/review/${id}/threads`, { evidenceId, body: "this is the 500" })).status).toBe(200);
      const view = await (await fetch(`${server.url}/api/review/${id}/taskview`)).json() as TaskView;
      expect(view.artifacts.counts.other).toBe(1);
      const evidenceRow = view.artifacts.groups.flatMap((g) => g.rows).find((row) => row.key === `evidence:${evidenceId}`);
      expect(evidenceRow?.comments).toBe(1);
      expect(view.comments.rows).toContainEqual(expect.objectContaining({ location: `evidence:${evidenceId}`, filePath: null }));
      expect(view.workspace.host.length).toBeGreaterThan(0);
      expect(view.workspace.dirty).toBeGreaterThanOrEqual(1);
      expect(view.workspace.branch).toBe(`tk/${id}`);
      expect(view.minimap.length).toBeGreaterThanOrEqual(1);
      expect(view.minimap[0]?.path).toBe("src/a.ts");
      expect(view.sessions).toEqual([]);
    } finally {
      await server.close();
    }

    tk(repo, ["finish", id, "--session", "s1"]);
    const again = await startWebServer({ root: repo, port: 0 });
    try {
      const view = await (await fetch(`${again.url}/api/review/${id}/taskview`)).json() as TaskView;
      expect(view.sessions[0]?.label).toContain("session s1");
      expect(view.sessions[0]?.state).toBe("done");
    } finally {
      await again.close();
    }
  });

  it("the served shell carries the tabbed rail and the ready-to-review palette guard", async () => {
    const { repo } = fixture();
    const server = await startWebServer({ root: repo, port: 0 });
    try {
      const html = await (await fetch(`${server.url}/tasks/abc`)).text();
      // The rail's tabs are rendered from RAIL_TABS (exact mock labels); state.railTab defaults to CHANGES.
      expect(html).toContain('const RAIL_TABS = [["sessions", "SESSIONS"], ["changes", "CHANGES"], ["workspace", "WORKSPC"], ["minimap", "MINIMAP"]];');
      expect(html).toContain('railTab: "changes"');
      expect(html).toContain('role="tablist"');
      expect(html).toContain("/taskview");
      expect(html).toContain("open diff ${issue.id}");
      // D-03: the palette's start row is guarded — a ready-to-review task gets `open diff <id>` in its place.
      expect(html).toContain('const rtr = issue?.status === "ready-to-review";');
      expect(html).toMatch(/rtr \? \{[^\n]*`open diff \$\{issue\.id\}`[^\n]*\} : \{[^\n]*`start \$\{issue\.id\}`/);
    } finally {
      await server.close();
    }
  });
});

describe("diff modal + evidence in the diff flow (09-07)", () => {
  it("the island bundle builds with the modal frame and the evidence composer", async () => {
    const { repo } = fixture();
    const server = await startWebServer({ root: repo, port: 0 });
    try {
      const res = await fetch(`${server.url}/assets/review-island.js`);
      expect(res.status).toBe(200);
      const bundle = await res.text();
      expect(bundle).toContain("⤢ full view");
      expect(bundle).toContain("esc close");
      expect(bundle).toContain("comment on the evidence…");
      const html = await (await fetch(`${server.url}/tasks/abc`)).text();
      expect(html).toContain('id="diffModal"');
      expect(html).toContain('mode: "modal"');
    } finally {
      await server.close();
    }
  });

  it("GET /api/review/:id lists blob evidence; an evidence comment lands at evidence:<id>", async () => {
    const { repo, id, bare } = fixture();
    const shot = join(repo, "shot.png");
    writeFileSync(shot, png());
    tk(repo, ["attach", id, "--evidence", shot]);
    const evidenceId = tk<{ attachments: { id?: string; kind?: string }[] }[]>(repo, ["show", id])[0]!.attachments.find((a) => a.kind === "evidence")!.id!;
    const server = await startWebServer({ root: repo, port: 0 });
    try {
      const payload = await (await fetch(`${server.url}/api/review/${id}`)).json() as { evidence: unknown };
      expect(payload.evidence).toEqual([{ id: evidenceId, name: "shot.png", mime: "image/png" }]);
      expect(evidenceId).toMatch(/^ev-[a-z0-9]{6}$/);
      const plain = await (await fetch(`${server.url}/api/review/${bare}`)).json() as { evidence: unknown };
      expect(plain.evidence).toEqual([]);

      const thread = await (await post(`${server.url}/api/review/${id}/threads`, { evidenceId, body: "this is the 500" })).json() as { evidenceId?: string; filePath: string };
      expect(thread.evidenceId).toBe(evidenceId);
      expect(thread.filePath).toBe(`evidence:${evidenceId}`);
      const view = await (await fetch(`${server.url}/api/review/${id}/taskview`)).json() as TaskView;
      expect(view.comments.rows).toContainEqual(expect.objectContaining({ location: `evidence:${evidenceId}` }));
    } finally {
      await server.close();
    }
    const listed = tk<{ comments: { location: string }[] }>(repo, ["comments", id]);
    expect(listed.comments.map((c) => c.location)).toContain(`evidence:${evidenceId}`);
  });
});

describe("artifact view: docs as documents, evidence as an artifact (09-08)", () => {
  it("renderDocBlocks: one sanitized HTML block per docBlocks range", () => {
    const blocks = renderDocBlocks("# Plan\n\nstep one\nstep two\n\n[x](javascript:alert(1)) <b>raw</b>\n");
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ line: 1, endLine: 1, html: "<h1>Plan</h1>" });
    expect(blocks[1]).toMatchObject({ line: 3, endLine: 4 });
    expect(blocks[2]!.html).not.toContain("javascript:");
    expect(blocks[2]!.html).toContain("&lt;b&gt;");
    expect(blocks[2]!.html).not.toContain("<b>");
  });

  it("renderDocBlocks scrubs entity-encoded, mixed-case, whitespace and data: targets; keeps safe ones", () => {
    const html = renderDocBlocks("[a](&#106;avascript:1) [b](JaVaScRiPt:x) ![c](data:image/svg+xml,x) [d](https://ok.example/x?q=1&r=2) [e](./rel.md) [f](#top) [g](mailto:a@b.c) [h](other/path.md)")
      .map((b) => b.html).join("");
    expect(html.toLowerCase()).not.toContain("javascript");
    expect(html).not.toContain("data:");
    for (const ok of ['href="https://ok.example/x?q=1&amp;r=2"', 'href="./rel.md"', 'href="#top"', 'href="mailto:a@b.c"', 'href="other/path.md"']) expect(html).toContain(ok);
  });

  it("GET …/file?render=doc adds blocks for docs only; a block-range comment lands at path:line-endLine", async () => {
    const { repo, id, worktree } = fixture();
    Bun.spawnSync(["mkdir", "-p", join(worktree, "docs")]);
    writeFileSync(join(worktree, "docs", "task.md"), "# Plan\n\nstep one\nstep two\n");
    const server = await startWebServer({ root: repo, port: 0 });
    try {
      const doc = await fetch(`${server.url}/api/review/${id}/file?path=docs%2Ftask.md&render=doc`);
      expect(doc.status).toBe(200);
      const docBody = await doc.json() as { contents: string; blocks?: { line: number; endLine: number; html: string }[] };
      expect(docBody.contents).toContain("# Plan");
      expect(docBody.blocks).toEqual([{ line: 1, endLine: 1, html: "<h1>Plan</h1>" }, { line: 3, endLine: 4, html: "<p>step one\nstep two</p>" }]);
      const code = await (await fetch(`${server.url}/api/review/${id}/file?path=src%2Fa.ts&render=doc`)).json() as { contents: string; blocks?: unknown };
      expect(code.contents).toContain("export const a = 2");
      expect(code.blocks).toBeUndefined();
      expect((await fetch(`${server.url}/api/review/${id}/file?path=..%2Fescape.md&render=doc`)).status).toBe(400);
      expect((await fetch(`${server.url}/api/review/${id}/file?path=nope.md&render=doc`)).status).toBe(404);

      const created = await post(`${server.url}/api/review/${id}/threads`, { filePath: "docs/task.md", line: 3, endLine: 4, side: "new", body: "block note" });
      expect(created.status).toBe(200);
    } finally {
      await server.close();
    }
    const listed = tk<{ comments: { location: string }[] }>(repo, ["comments", id]);
    expect(listed.comments.map((c) => c.location)).toContain("docs/task.md:3-4");
  });

  it("/tasks/:id/file?evidence= serves the shell; the island bundle carries DOC/EVIDENCE modes", async () => {
    const { repo } = fixture();
    const server = await startWebServer({ root: repo, port: 0 });
    try {
      const res = await fetch(`${server.url}/tasks/abc/file?evidence=ev-abcdef`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toContain("text/html");
      const html = await res.text();
      expect(html).toContain("evidenceUrl");
      expect(html).toContain('params.get("evidence")');
      const bundle = await (await fetch(`${server.url}/assets/review-island.js`)).text();
      expect(bundle).toContain("rvi-docblock");
      expect(bundle).toContain("evidence not found: ");
      expect(bundle).toContain("render=doc");
    } finally {
      await server.close();
    }
  });
});

describe("short worktree label + TASKS column (09-11)", () => {
  it("worktreeLabel: relative under root, .worktrees/ tail outside, else absolute; null stays null", () => {
    expect(worktreeLabel("/r/repo", "/r/repo/.worktrees/repo-tk-1")).toBe(".worktrees/repo-tk-1");
    expect(worktreeLabel("/r/repo", "/elsewhere/x/.worktrees/repo-tk-2")).toBe(".worktrees/repo-tk-2");
    expect(worktreeLabel("/r/repo", "/elsewhere/wt")).toBe("/elsewhere/wt");
    expect(worktreeLabel("/r/repo", "/r/repo")).toBe("/r/repo");
    expect(worktreeLabel("/r/repo", null)).toBeNull();
  });

  it("taskview workspace carries worktreeLabel (.worktrees/<repo>-<id>); worktree stays absolute; branchless is null", async () => {
    const { repo, id, bare, worktree } = fixture();
    const server = await startWebServer({ root: repo, port: 0 });
    try {
      const view = await (await fetch(`${server.url}/api/review/${id}/taskview`)).json() as TaskView;
      expect(view.workspace.worktreeLabel).toMatch(new RegExp(`^\\.worktrees/[^/]+-${id}$`));
      expect(view.workspace.worktree).toBe(worktree);
      expect(view.workspace.worktree!.startsWith("/")).toBe(true);
      const plain = await (await fetch(`${server.url}/api/review/${bare}/taskview`)).json() as TaskView;
      expect(plain.workspace.worktreeLabel).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("the served shell carries the TASKS column, its highlight, the [ / ] keys and the short chip label", async () => {
    const { repo } = fixture();
    const server = await startWebServer({ root: repo, port: 0 });
    try {
      const html = await (await fetch(`${server.url}/tasks/abc`)).text();
      expect(html).toContain('<nav class="ttasks" aria-label="tasks">');
      expect(html).toContain('aria-current="page"');
      expect(html).toContain("const workingTasks = (issues, shownId)");
      expect(html).toMatch(/e\.key === "\[" \|\| e\.key === "\]"/);
      expect(html).toContain("${tasksColumn(issue)}");
      expect(html).toContain("@media (max-width: 1100px) { .tview .ttasks { display: none; } }");
      expect(html).toContain("worktree ${esc(wtLabel(issue.id, worktree))}");
    } finally {
      await server.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 11-05: WORKSPC `commit` / `open pr` routes and `workspace.pr`.        */
/* ------------------------------------------------------------------ */

const FAKE_GH = join(import.meta.dir, "../../cli/test/fixtures/gh");
const GH_ENV_KEYS = ["TK_GH", "FAKE_GH_DIR", "FAKE_GH_LOG", "FAKE_GH_FAIL"] as const;

/** fixture() + repo-local commit identity (no gpg), a bare `origin`, and the fake gh copied into a temp bin. */
function prFixture(): ReturnType<typeof fixture> & { readonly gh: string; readonly ghDir: string; readonly log: string } {
  const base = fixture();
  git(base.repo, "config", "user.name", "test");
  git(base.repo, "config", "user.email", "test@example.com");
  git(base.repo, "config", "commit.gpgsign", "false");
  const side = realpathSync(mkdtempSync(join(tmpdir(), "tk-web-gh-")));
  dirs.push(side);
  const origin = join(side, "origin.git");
  git(side, "init", "-q", "--bare", origin);
  git(base.repo, "remote", "add", "origin", origin);
  git(base.repo, "push", "-q", "origin", "main");
  // The server runs in-process and spawns gh through bunRunner, which does not forward later
  // process.env edits — so the FAKE_GH_* settings are baked into a wrapper around the fixture copy.
  const ghDir = join(side, "gh-state");
  mkdirSync(ghDir);
  const log = join(side, "gh.log");
  const real = join(side, "gh-fixture");
  writeFileSync(real, readFileSync(FAKE_GH));
  chmodSync(real, 0o755);
  const gh = join(side, "gh");
  writeFileSync(gh, `#!/bin/sh\nFAKE_GH_DIR='${ghDir}' FAKE_GH_LOG='${log}' exec '${real}' "$@"\n`);
  chmodSync(gh, 0o755);
  return { ...base, gh, ghDir, log };
}

function gitOut(directory: string, ...args: readonly string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" });
  return new TextDecoder().decode(result.stdout).trim();
}

describe("WORKSPC actions (11-05)", () => {
  const saved: Partial<Record<(typeof GH_ENV_KEYS)[number], string | undefined>> = {};
  beforeEach(() => { for (const key of GH_ENV_KEYS) saved[key] = process.env[key]; });
  afterEach(() => { for (const key of GH_ENV_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

  it("POST commit commits tracked changes only, clears dirty; empty message and no worktree refuse", async () => {
    const { repo, id, bare, worktree } = prFixture();
    writeFileSync(join(worktree, "loose.txt"), "untracked\n");
    const server = await startWebServer({ root: repo, port: 0 });
    try {
      const before = await (await fetch(`${server.url}/api/review/${id}/taskview`)).json() as TaskView & { workspace: { pr: unknown } };
      expect(before.workspace.pr).toBeNull();
      expect(before.workspace.dirty).toBe(2);

      const empty = await post(`${server.url}/api/review/${id}/commit`, { message: "" });
      expect(empty.status).toBe(400);
      expect(((await empty.json()) as { error: { message: string } }).error.message).toContain("commit message is empty");

      const ok = await post(`${server.url}/api/review/${id}/commit`, { message: "web: commit" });
      expect(ok.status).toBe(200);
      const body = await ok.json() as { ok: boolean; sha: string };
      expect(body.ok).toBe(true);
      expect(body.sha).toBe(gitOut(worktree, "rev-parse", "HEAD"));
      expect(gitOut(worktree, "log", "-1", "--format=%s")).toBe("web: commit");
      expect(gitOut(worktree, "show", "--name-only", "--format=", "HEAD")).toBe("src/a.ts");
      expect(gitOut(worktree, "status", "--porcelain")).toBe("?? loose.txt");
      const after = await (await fetch(`${server.url}/api/review/${id}/taskview`)).json() as TaskView;
      expect(after.workspace.dirty).toBe(1);

      const noTree = await post(`${server.url}/api/review/${bare}/commit`, { message: "x" });
      expect(noTree.status).toBe(400);
      expect(((await noTree.json()) as { error: { message: string } }).error.message).toContain(`no worktree for ${bare}`);
    } finally {
      await server.close();
    }
  });

  it("a clean worktree commit yields dirty 0", async () => {
    const { repo, id, worktree } = prFixture();
    const server = await startWebServer({ root: repo, port: 0 });
    try {
      expect((await post(`${server.url}/api/review/${id}/commit`, { message: "web: commit" })).status).toBe(200);
      expect(gitOut(worktree, "log", "-1", "--format=%s")).toBe("web: commit");
      const after = await (await fetch(`${server.url}/api/review/${id}/taskview`)).json() as TaskView;
      expect(after.workspace.dirty).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("POST pr creates once through the fake gh, then refreshes; workspace.pr mirrors it; a missing gh is a 400", async () => {
    const { repo, id, gh, log } = prFixture();
    process.env["TK_GH"] = gh;
    const server = await startWebServer({ root: repo, port: 0 });
    try {
      const first = await post(`${server.url}/api/review/${id}/pr`, {});
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ ok: true, op: "create", pr: { number: 7, state: "open", url: "https://github.com/acme/app/pull/7" } });
      const view = await (await fetch(`${server.url}/api/review/${id}/taskview`)).json() as { workspace: { pr: { number: number; state: string; url: string } | null } };
      expect(view.workspace.pr?.number).toBe(7);
      const second = await post(`${server.url}/api/review/${id}/pr`, {});
      expect(((await second.json()) as { op: string }).op).toBe("refresh");
      const lines = readFileSync(log, "utf8").split("\n").filter((line) => line.startsWith("pr create"));
      expect(lines).toHaveLength(1);

      process.env["TK_GH"] = "/nonexistent/gh";
      const missing = await post(`${server.url}/api/review/${id}/pr`, {});
      expect(missing.status).toBe(400);
      expect(((await missing.json()) as { error: { message: string } }).error.message).toContain("gh not found");
    } finally {
      await server.close();
    }
  });

  it("the served shell carries the WORKSPC buttons and inline message input, and no prompt()", async () => {
    const { repo } = fixture();
    const server = await startWebServer({ root: repo, port: 0 });
    try {
      const html = await (await fetch(`${server.url}/tasks/abc`)).text();
      expect(html).toContain('data-ws-act="commit"');
      expect(html).toContain('data-ws-act="pr"');
      expect(html).toContain('id="wsCommitMsg"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).not.toContain("prompt(");
    } finally {
      await server.close();
    }
  });
});
