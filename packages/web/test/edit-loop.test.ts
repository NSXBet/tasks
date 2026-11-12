/**
 * ROADMAP Phase 5 SC3 end to end (05-04): a web edit writes the worktree file
 * and shows up in the TUI's diff contract; a web comment lands in the task
 * store the TUI reads (and in `tk show`).
 */
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitDiffPatch } from "@tasks/git";
import { taskStoreCommentStore } from "@tasks/review";
import { openSurfaceStore } from "@tasks/surface";
import { startWebServer } from "../src/server";

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function run(directory: string, args: readonly string[]): string {
  const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  return new TextDecoder().decode(result.stdout);
}
const tk = <T>(directory: string, args: readonly string[]): T => JSON.parse(run(directory, [...args, "--json"])) as T;
function git(directory: string, ...args: readonly string[]): void {
  const result = Bun.spawnSync(["git", "-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
}

/** A tk workspace in a git repo: one task under `tk work`, one without a worktree. */
function fixture(): { readonly repo: string; readonly id: string; readonly bare: string; readonly worktree: string; readonly base: string } {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "tk-web-edit-")));
  dirs.push(repo);
  git(repo, "init", "-q", "-b", "main");
  Bun.spawnSync(["mkdir", "-p", join(repo, "src")]);
  appendFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  tk(repo, ["init", "--prefix", "tk"]);
  const { id } = tk<{ id: string }>(repo, ["create", "edit loop"]);
  const { id: bare } = tk<{ id: string }>(repo, ["create", "no worktree"]);
  const work = tk<{ path: string; base: string }>(repo, ["work", id]);
  return { repo, id, bare, worktree: work.path, base: work.base };
}

describe("web edit + comment loop (SC3)", () => {
  it("base reads are byte-exact; edits land in the worktree and the TUI diff; comments land in the store", async () => {
    const { repo, id, bare, worktree, base } = fixture();
    appendFileSync(join(worktree, "src", "new.ts"), "export const n = 0;\n");
    const server = await startWebServer({ root: repo, port: 0 });
    const api = `${server.url}/api/review`;
    const fileUrl = (task: string, path: string, side?: string) => `${api}/${encodeURIComponent(task)}/file?path=${encodeURIComponent(path)}${side === undefined ? "" : `&side=${side}`}`;
    let closed = false;
    try {
      // Base side: exact bytes at the pinned base; files added on the branch are 404.
      const baseRead = await fetch(fileUrl(id, "src/a.ts", "base"));
      expect(baseRead.status).toBe(200);
      expect(((await baseRead.json()) as { contents: string }).contents).toBe("export const a = 1;\n");
      expect((await fetch(fileUrl(id, "src/new.ts", "base"))).status).toBe(404);
      expect((await fetch(fileUrl(id, "src/a.ts", "theirs"))).status).toBe(400);

      // Edit through the write endpoint.
      const put = await fetch(fileUrl(id, "src/a.ts"), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: "export const a = 2;\n" }) });
      expect(put.status).toBe(200);
      expect(readFileSync(join(worktree, "src", "a.ts"), "utf8")).toBe("export const a = 2;\n");
      // The TUI review source's exact call (packages/tui/src/review/source.ts).
      const tuiPatch = await gitDiffPatch(worktree, base, null, {});
      expect(tuiPatch).toContain("+export const a = 2;");
      const payload = (await (await fetch(`${api}/${encodeURIComponent(id)}`)).json()) as { patch: string | null };
      expect(payload.patch).toContain("+export const a = 2;");

      // Writes never fall back to the main checkout, and stay under the worktree.
      const noWorktree = await fetch(fileUrl(bare, "src/a.ts"), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: "clobber\n" }) });
      expect(noWorktree.status).toBe(400);
      expect(((await noWorktree.json()) as { error: { kind: string } }).error.kind).toBe("no_worktree");
      expect(readFileSync(join(repo, "src", "a.ts"), "utf8")).toBe("export const a = 1;\n");
      const escape = await fetch(fileUrl(id, "../x"), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: "x" }) });
      expect(escape.status).toBe(400);
      expect(((await escape.json()) as { error: { kind: string } }).error.kind).toBe("escape");
      expect(existsSync(join(worktree, "..", "x"))).toBe(false);

      // Web comment → task store.
      const created = await fetch(`${api}/${encodeURIComponent(id)}/threads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filePath: "src/a.ts", line: 1, side: "new", body: "web note" }) });
      expect(created.ok).toBe(true);
      const shown = run(repo, ["show", id]);
      expect(shown).toContain("REVIEW (1)");
      expect(shown).toContain("web note");

      await server.close();
      closed = true;
      const store = await openSurfaceStore(repo, { actor: "tui" });
      try {
        const { threads } = await taskStoreCommentStore(store).listThreads(id);
        expect(threads).toHaveLength(1);
        expect(threads[0]).toMatchObject({ filePath: "src/a.ts" });
        expect(threads[0]!.comments[0]!.body).toContain("web note");
      } finally {
        await store.close();
      }
    } finally {
      if (!closed) await server.close();
    }
  }, 60_000);
});
