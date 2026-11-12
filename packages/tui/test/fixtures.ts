/**
 * Shared TUI test fixtures: boot slots, the real `tk` CLI, git in a scratch
 * repo, and the `repoWithIssue` / `repoWithWork` scratch workspaces. Copies of
 * the helpers in review.test.tsx (left untouched); call `cleanupFixtures()`
 * from `afterEach` to remove the scratch dirs.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BootSlots } from "../src/app/routes.js";

/** Plain-launch defaults with per-test overrides, matching App's boot contract. */
export const slotsFor = (overrides: Partial<BootSlots>): BootSlots => ({
  view: "list",
  detailId: null,
  helpOpen: false,
  modalId: null,
  diffOpen: false,
  reviewId: null,
  graphId: null,
  composer: { mode: "closed", forId: null, initial: "", confirm: null, review: null },
  targetId: null,
  ...overrides,
});

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const dirs: string[] = [];

/** Removes every scratch dir the fixtures created (best effort). */
export const cleanupFixtures = (): void => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* tmp cleanup best effort */ }
  }
};

/** A scratch dir removed by `cleanupFixtures`. */
export const scratchDir = (prefix: string): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix))); // macOS /var → /private/var
  dirs.push(dir);
  return dir;
};

const decode = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes ?? new Uint8Array());

/** Runs the real `tk` CLI with `--json` in `repo`; throws on a non-zero exit. */
export const tk = (repo: string, ...args: readonly string[]): string => {
  const result = Bun.spawnSync([process.execPath, executable, "-C", repo, ...args, "--json"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`tk ${args.join(" ")} failed: ${decode(result.stderr)}`);
  return decode(result.stdout);
};

/** Runs the real `tk` CLI without `--json`, colour off; ANSI stripped. Throws on a non-zero exit. */
export const tkPlain = (repo: string, ...args: readonly string[]): string => {
  const result = Bun.spawnSync([process.execPath, executable, "-C", repo, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  if (result.exitCode !== 0) throw new Error(`tk ${args.join(" ")} failed: ${decode(result.stderr)}`);
  // eslint-disable-next-line no-control-regex
  return decode(result.stdout).replace(/\x1b\[[0-9;]*m/g, "");
};

export const gitIn = (dir: string, ...args: readonly string[]): void => {
  const result = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@e", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${decode(result.stderr)}`);
};

export const write = (dir: string, path: string, text: string | Uint8Array): void => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), text);
};

/** A git repo with one commit, a tk workspace, and one issue with no branch. */
export const repoWithIssue = (aContents = "export const a = 1;\n"): { readonly repo: string; readonly id: string } => {
  const repo = scratchDir("tk-tui-taskview-");
  gitIn(repo, "init", "-q", "-b", "main");
  write(repo, "src/a.ts", aContents);
  write(repo, "src/z.ts", "export const z = 1;\n");
  gitIn(repo, "add", ".");
  gitIn(repo, "commit", "-q", "-m", "init");
  tk(repo, "init", "--prefix", "tk");
  const created = JSON.parse(tk(repo, "create", "live review")) as { id: string };
  return { repo, id: created.id };
};

/** `repoWithIssue` plus `tk work <id>`: the issue has a branch, a worktree, and a pinned base. */
export const repoWithWork = (aContents?: string): { readonly repo: string; readonly id: string; readonly worktree: string } => {
  const { repo, id } = repoWithIssue(aContents);
  tk(repo, "work", id);
  const shown = JSON.parse(tk(repo, "show", id)) as ReadonlyArray<Record<string, unknown>>;
  const worktree = shown[0]!["worktree"] as string;
  return { repo, id, worktree };
};
