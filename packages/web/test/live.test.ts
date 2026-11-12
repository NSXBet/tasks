import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitDiffPatch } from "@tasks/git";
import { startWebServer } from "../src/server";

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const dirs: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-web-live-")); dirs.push(value); return value; }
function tk<T>(directory: string, args: readonly string[]): T {
  const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args, "--json"], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  return JSON.parse(new TextDecoder().decode(result.stdout)) as T;
}
function git(directory: string, ...args: readonly string[]): void {
  const result = Bun.spawnSync(["git", "-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
}
/** A tk workspace in a git repo with one tracked file and one issue under `tk work`. */
function repoWithWorktree(): { readonly repo: string; readonly id: string; readonly worktree: string; readonly base: string } {
  const repo = realpathSync(workspace()); // macOS /var → /private/var symlink
  git(repo, "init", "-q", "-b", "main");
  Bun.spawnSync(["mkdir", "-p", join(repo, "src")]);
  appendFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  tk(repo, ["init", "--prefix", "tk"]);
  const { id } = tk<{ id: string }>(repo, ["create", "live review"]);
  const work = tk<{ path: string; base: string }>(repo, ["work", id]);
  return { repo, id, worktree: work.path, base: work.base };
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

interface Frame { readonly event: string | null; readonly data: string }
/** Reads SSE frames off GET /events; `next(pred)` resolves with the first matching frame within the deadline. */
const openEvents = async (url: string): Promise<{ next: (pred: (frame: Frame) => boolean, ms?: number) => Promise<{ match: Frame | null; seen: Frame[] }>; close: () => Promise<void> }> => {
  const controller = new AbortController();
  const response = await fetch(`${url}/events`, { signal: controller.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  const next = async (pred: (frame: Frame) => boolean, ms = 5_000): Promise<{ match: Frame | null; seen: Frame[] }> => {
    const seen: Frame[] = [];
    const deadline = Date.now() + ms;
    for (;;) {
      let split: number;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        let event: string | null = null;
        const data: string[] = [];
        for (const line of raw.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("data: ")) data.push(line.slice(6));
        }
        if (event === null && data.length === 0) continue;
        const frame = { event, data: data.join("\n") };
        seen.push(frame);
        if (pred(frame)) return { match: frame, seen };
      }
      const left = deadline - Date.now();
      if (left <= 0) return { match: null, seen };
      pending ??= reader.read();
      const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), left));
      const result = await Promise.race([pending, timeout]);
      if (result === "timeout") return { match: null, seen };
      pending = null;
      if (result.done) return { match: null, seen };
      buffer += decoder.decode(result.value, { stream: true });
    }
  };
  const close = async (): Promise<void> => {
    await reader.cancel().catch(() => {});
    controller.abort();
  };
  return { next, close };
};
const isReview = (id: string, reason: string) => (frame: Frame): boolean => {
  if (frame.event !== "review") return false;
  try { const parsed = JSON.parse(frame.data) as { id?: unknown; reason?: unknown }; return parsed.id === id && parsed.reason === reason; }
  catch { return false; }
};
/** Waits until the server has registered its watchers (initial sync pass is async). */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 600));

describe("tk web live review", () => {
  it("worktree edit pushes a review frame and the payload carries the uncommitted edit", async () => {
    const { repo, id, worktree, base } = repoWithWorktree();
    const server = await startWebServer({ root: repo, port: 0 });
    const events = await openEvents(server.url);
    try {
      await settle();
      appendFileSync(join(worktree, "src", "a.ts"), "export const live = 2;\n");
      const { match, seen } = await events.next(isReview(id, "worktree"));
      expect(match, JSON.stringify(seen)).not.toBeNull();
      expect(JSON.parse(match!.data)).toEqual({ id, reason: "worktree" });
      expect(seen.some((frame) => frame.event === null && frame.data === "reload")).toBe(false);
      const payload = await (await fetch(`${server.url}/api/review/${encodeURIComponent(id)}`)).json() as { patch: string | null };
      expect(payload.patch).toContain("+export const live = 2;");
      expect(payload.patch).toBe(await gitDiffPatch(worktree, base, null, { fullIndex: true }));
    } finally {
      await events.close();
      await server.close();
    }
  }, 20_000);

  it("an untracked new file (never git-added) lands in the patch, changes and minimap live (tasks-n5xi)", async () => {
    const { repo, id, worktree } = repoWithWorktree();
    const server = await startWebServer({ root: repo, port: 0 });
    const events = await openEvents(server.url);
    try {
      await settle();
      writeFileSync(join(worktree, "src", "fresh.ts"), "export const fresh = 1;\n"); // NO git add, NO add -N
      const { match, seen } = await events.next(isReview(id, "worktree"));
      expect(match, JSON.stringify(seen)).not.toBeNull();
      const payload = await (await fetch(`${server.url}/api/review/${encodeURIComponent(id)}`)).json() as { patch: string | null };
      expect(payload.patch).toContain("+++ b/src/fresh.ts");
      expect(payload.patch).toContain("--- /dev/null");
      const view = await (await fetch(`${server.url}/api/review/${encodeURIComponent(id)}/taskview`)).json() as {
        changes: ReadonlyArray<{ kind: string; name: string; path: string; status: string | null }>;
        minimap: ReadonlyArray<{ path: string }>;
      };
      expect(view.changes).toContainEqual(expect.objectContaining({ kind: "file", name: "fresh.ts", status: "A" }));
      expect(view.minimap.some((bar) => bar.path === "src/fresh.ts")).toBe(true);
      const cached = Bun.spawnSync(["git", "diff", "--cached", "--name-only"], { cwd: worktree, stdout: "pipe" });
      expect(new TextDecoder().decode(cached.stdout).trim()).toBe("");
    } finally {
      await events.close();
      await server.close();
    }
  }, 20_000);

  it("worktree commit pushes a branch frame", async () => {
    const { repo, id, worktree } = repoWithWorktree();
    const server = await startWebServer({ root: repo, port: 0 });
    const events = await openEvents(server.url);
    try {
      await settle();
      git(worktree, "commit", "--allow-empty", "-qm", "x");
      const { match, seen } = await events.next(isReview(id, "branch"));
      expect(match, JSON.stringify(seen)).not.toBeNull();
      expect(JSON.parse(match!.data)).toEqual({ id, reason: "branch" });
      const payload = await (await fetch(`${server.url}/api/review/${encodeURIComponent(id)}`)).json() as { commits: unknown[] };
      expect(payload.commits).toHaveLength(1);
    } finally {
      await events.close();
      await server.close();
    }
  }, 20_000);

  it("a closed /events client does not break later broadcasts", async () => {
    const { repo, id, worktree } = repoWithWorktree();
    const server = await startWebServer({ root: repo, port: 0 });
    const stale = await openEvents(server.url);
    await stale.close();
    const events = await openEvents(server.url);
    try {
      await settle();
      appendFileSync(join(worktree, "src", "a.ts"), "export const one = 1;\n");
      expect((await events.next(isReview(id, "worktree"))).match).not.toBeNull();
      appendFileSync(join(worktree, "src", "a.ts"), "export const two = 2;\n");
      expect((await events.next(isReview(id, "worktree"))).match).not.toBeNull();
      expect((await fetch(`${server.url}/api/status`)).status).toBe(200);
    } finally {
      await events.close();
      await server.close();
    }
  }, 20_000);

  it("review routes follow a repoint to the active workspace", async () => {
    const first = repoWithWorktree();
    const second = repoWithWorktree();
    const server = await startWebServer({ root: first.repo, port: 0 });
    try {
      const opened = await fetch(`${server.url}/api/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: second.repo }) });
      expect(opened.status).toBe(200);
      const response = await fetch(`${server.url}/api/review/${encodeURIComponent(second.id)}`);
      expect(response.status).toBe(200);
      const payload = await response.json() as { id: string; worktree: string | null; branch: string | null; head: string | null; patchError: string | null };
      expect(payload).toMatchObject({ id: second.id, worktree: second.worktree, branch: `tk/${second.id}`, patchError: null });
      // The head resolves only in the second repo — proof the route used the active root, not the boot root.
      expect(payload.head).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      await server.close();
    }
  }, 20_000);
});
