import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bunRunner,
  ensureWorktreePoolIgnored,
  gitCommitTracked,
  gitCurrentBranch,
  gitDefaultBranch,
  gitDeleteBranch,
  gitDiffNewFile,
  gitDiffPatch,
  gitDirtyCount,
  gitMergeBase,
  gitPushBranch,
  gitShowFile,
  gitToplevel,
  gitUntrackedFiles,
  gitWorktreeAdd,
  gitWorktreeList,
  gitWorktreeRemove,
  mainWorktreeRoot,
  type ProcessRunner,
  UNTRACKED_MAX_BYTES,
  UNTRACKED_PATCH_LIMIT,
} from "../src/index.js";

const dirs: string[] = [];
function repo(): string { const dir = mkdtempSync(join(tmpdir(), "tk-git-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

/** In-memory runner for deterministic adapter tests. */
function fakeRunner(responses: Readonly<Record<string, string>>): ProcessRunner & { commands: string[][] } {
  const commands: string[][] = [];
  return {
    commands,
    async run(command: readonly string[]) {
      commands.push([...command]);
      const key = command.join(" ");
      return { stdout: (responses[key] ?? "").trim(), stderr: "", code: key in responses ? 0 : 1 };
    },
  };
}

describe("git adapter commands", () => {
  it("enumerates every spawn inside the adapter and parses through it", async () => {
    const runner = fakeRunner({
      "git rev-parse --show-toplevel": "/repo",
      "git rev-parse --abbrev-ref HEAD": "main",
      "git worktree list --porcelain": "worktree /repo/.git\nHEAD abc\nbranch refs/heads/main\n\n",
    });
    expect(await gitToplevel("/repo", runner)).toBe("/repo");
    expect(await gitCurrentBranch("/repo", runner)).toBe("main");
    expect(await gitWorktreeList("/repo", runner)).toMatchObject([{ branch: "main" }]);
    expect(runner.commands.every((command) => command[0] === "git")).toBe(true);
  });

  it("gitDefaultBranch: keeps origin/HEAD when the remote is not behind the local default", async () => {
    // Diverged (is-ancestor fails) → remote stays the integration anchor.
    const diverged = fakeRunner({
      "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main",
      "git rev-parse --verify --quiet main": "sha1",
    });
    expect(await gitDefaultBranch("/repo", diverged)).toBe("origin/main");
    // No remote HEAD → plain local candidate.
    const localOnly = fakeRunner({ "git rev-parse --verify --quiet main": "sha1" });
    expect(await gitDefaultBranch("/repo", localOnly)).toBe("main");
  });

  it("surfaces non-zero exits as { code, stderr } verbatim instead of a success-shaped default", async () => {
    const runner: ProcessRunner = {
      async run() {
        return { stdout: "", stderr: "fatal: not a git repository", code: 128 };
      },
    };
    // Documented-nullable probes (rev-parse) return null on non-zero.
    expect(await gitToplevel("/nowhere", runner)).toBeNull();
    expect(await gitCurrentBranch("/nowhere", runner)).toBeNull();
    expect(await gitMergeBase("/nowhere", "a", "b", runner)).toBeNull();
    // Command functions carrying outcomes carry code+stderr verbatim — no command
    // function converts non-zero into a success-shaped default.
    const add = await gitWorktreeAdd("/nowhere", "/tmp/x", "nope", true, runner);
    expect(add).toEqual({ ok: false, stderr: "fatal: not a git repository" });
    const remove = await gitWorktreeRemove("/nowhere", "/tmp/x", true, runner);
    expect(remove).toEqual({ ok: false, stderr: "fatal: not a git repository" });
  });

  it("reports structured failure outcomes instead of throwing", async () => {
    const dir = repo();
    const outcome = await gitWorktreeAdd(dir, join(dir, "..", "missing"), "nope");
    expect(outcome.ok).toBe(false);
  });
});

describe("git integration", () => {
  it("anchors the default branch to the local line when origin/HEAD is stale (phase-02 UAT issue 2)", async () => {
    const origin = repo();
    const og = (...args: readonly string[]) => Bun.spawnSync(["git", ...args], { cwd: origin, stdout: "pipe", stderr: "pipe" });
    og("init", "-q", "--initial-branch=main");
    og("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--allow-empty", "-m", "init");
    const clone = repo();
    const cg = (...args: readonly string[]) => Bun.spawnSync(["git", ...args], { cwd: clone, stdout: "pipe", stderr: "pipe" });
    expect(cg("clone", "--quiet", origin, clone).exitCode).toBe(0);
    // In sync: origin/HEAD keeps precedence.
    expect(await gitDefaultBranch(clone)).toBe("origin/main");
    // Local commit left unpulled (the reweld scenario: origin/main behind local main).
    expect(cg("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--allow-empty", "-m", "local ahead").exitCode).toBe(0);
    expect(await gitDefaultBranch(clone)).toBe("main");
  });

  it("creates, lists, and removes a worktree end to end", async () => {
    const dir = repo();
    const git = (...args: readonly string[]) => Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    git("init", "-q");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--allow-empty", "-m", "init");
    const toplevel = await gitToplevel(dir);
    expect(toplevel).not.toBeNull();
    expect(await gitDefaultBranch(dir)).not.toBeNull();
    expect(await gitMergeBase(dir, "HEAD", "HEAD")).not.toBeNull();
    const target = join(dir, "..", "linked");
    expect((await gitWorktreeAdd(dir, target, "linked")).ok).toBe(true);
    const entries = await gitWorktreeList(dir);
    expect(entries.map((entry) => entry.branch)).toContain("linked");
    expect(mainWorktreeRoot(join(dir, ".git"))).toBe(dir);
    expect((await gitWorktreeRemove(dir, target, false)).ok).toBe(true);
  });

  it("gitCurrentBranch returns the branch name, and null on a detached HEAD (WR-01)", async () => {
    const dir = repo();
    const git = (...args: readonly string[]) => Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    git("init", "-q", "-b", "main");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--allow-empty", "-m", "init");
    expect(await gitCurrentBranch(dir)).toBe("main");
    expect(git("checkout", "-q", "--detach").exitCode).toBe(0);
    expect(await gitCurrentBranch(dir)).toBeNull();
  });

  it("gitDeleteBranch removes a merged branch and reports failure for a missing one", async () => {
    const dir = repo();
    const git = (...args: readonly string[]) => Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    git("init", "-q", "-b", "main");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--allow-empty", "-m", "init");
    git("branch", "scratch");
    expect((await gitDeleteBranch(dir, "scratch")).ok).toBe(true);
    expect(git("rev-parse", "--verify", "--quiet", "refs/heads/scratch").exitCode).not.toBe(0);
    expect((await gitDeleteBranch(dir, "scratch")).ok).toBe(false);
  });

  it("ensureWorktreePoolIgnored appends /.worktrees/ to info/exclude once and never writes .gitignore", async () => {
    const dir = repo();
    const git = (...args: readonly string[]) => Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    git("init", "-q");
    expect(await ensureWorktreePoolIgnored(dir)).toEqual({ changed: true, ok: true, stderr: "" });
    expect(await ensureWorktreePoolIgnored(dir)).toEqual({ changed: false, ok: true, stderr: "" });
    const exclude = readFileSync(join(dir, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n").filter((line) => line === "/.worktrees/")).toHaveLength(1);
    expect(git("check-ignore", "-q", "--no-index", "--", ".worktrees/x").exitCode).toBe(0);
  });

  it("gitDirtyCount counts porcelain entries: clean 0, modified+untracked 2, non-repo null", async () => {
    const dir = repo();
    const git = (...args: readonly string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    git("init", "-q", "-b", "main");
    writeFileSync(join(dir, "tracked.txt"), "one\n");
    git("add", "tracked.txt");
    git("commit", "-q", "-m", "init");
    expect(await gitDirtyCount(dir)).toBe(0);
    writeFileSync(join(dir, "tracked.txt"), "two\n");
    writeFileSync(join(dir, "new.txt"), "new\n");
    expect(await gitDirtyCount(dir)).toBe(2);
    const plain = repo();
    expect(await gitDirtyCount(plain)).toBeNull();
  });

  it("bunRunner aborts cleanly on cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await bunRunner.run(["git", "rev-parse", "HEAD"], process.cwd(), controller.signal);
    expect(result.code).not.toBe(0);
  });
});

describe("gitDiffPatch", () => {
  const setup = (): { dir: string; git: (...args: readonly string[]) => ReturnType<typeof Bun.spawnSync>; base: string } => {
    const dir = repo();
    const git = (...args: readonly string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    git("init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.txt"), "one\n");
    git("add", "a.txt");
    git("commit", "-q", "-m", "init");
    const base = git("rev-parse", "HEAD").stdout.toString().trim();
    git("checkout", "-q", "-b", "feature");
    writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
    git("commit", "-q", "-am", "feature edit");
    return { dir, git, base };
  };

  it("diffs the three-dot range base...to", async () => {
    const { dir, base } = setup();
    const patch = await gitDiffPatch(dir, base, "feature");
    expect(patch).toContain("+++ b/a.txt");
    expect(patch).toContain("+two");
    expect(await gitDiffPatch(dir, base, "feature", { fullIndex: true })).toMatch(/^index [0-9a-f]{40}\.\.[0-9a-f]{40}/m);
  });

  it("diffs the working tree against `from` when to is null (uncommitted edits count)", async () => {
    const { dir } = setup();
    expect(await gitDiffPatch(dir, "HEAD", null)).toBe("");
    writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
    expect(await gitDiffPatch(dir, "HEAD", null)).toContain("+three");
  });

  it("contextLines widens the hunk context via --unified; invalid values fall back to the default", async () => {
    const { dir, git } = setup();
    const lines = Array.from({ length: 60 }, (_, index) => `// LINE_${index + 1}`);
    writeFileSync(join(dir, "long.txt"), `${lines.join("\n")}\n`);
    git("add", "long.txt");
    git("commit", "-q", "-m", "long");
    lines[29] = "// CHANGED_30";
    writeFileSync(join(dir, "long.txt"), `${lines.join("\n")}\n`);
    const narrow = await gitDiffPatch(dir, "HEAD", null);
    expect(narrow).toContain("+// CHANGED_30");
    expect(narrow).not.toContain("// LINE_10\n");
    expect(await gitDiffPatch(dir, "HEAD", null, { contextLines: 25 })).toContain(" // LINE_10\n");
    for (const contextLines of [-1, 2.5, Number.NaN, 10001]) {
      expect(await gitDiffPatch(dir, "HEAD", null, { contextLines })).toBe(narrow);
    }
    const seen: string[][] = [];
    const spy: ProcessRunner = { run: async (argv) => { seen.push([...argv]); return { code: 0, stdout: "", stderr: "" }; } };
    await gitDiffPatch(dir, "HEAD", null, { contextLines: -3 }, spy);
    await gitDiffPatch(dir, "HEAD", null, { contextLines: 25 }, spy);
    // working-tree form also runs `ls-files` for untracked files; check the tracked diff calls only
    const diffs = seen.filter((argv) => argv[1] === "diff");
    expect(diffs[0]!.some((arg) => arg.startsWith("--unified"))).toBe(false);
    expect(diffs[1]!.indexOf("--unified=25")).toBeLessThan(diffs[1]!.indexOf("--end-of-options"));
  });

  it("working-tree form includes never-added files as /dev/null new-file diffs (tasks-n5xi)", async () => {
    const { dir } = setup();
    writeFileSync(join(dir, "new.txt"), "hello\n");
    const patch = (await gitDiffPatch(dir, "HEAD", null))!;
    expect(patch).toContain("diff --git a/new.txt b/new.txt");
    expect(patch).toContain("new file mode");
    expect(patch).toContain("--- /dev/null");
    expect(patch).toContain("+++ b/new.txt");
    expect(patch).toContain("+hello");
    expect(patch.endsWith("\n")).toBe(false);
    expect(await gitDiffPatch(dir, "HEAD", null, { fullIndex: true })).toMatch(/^index 0{40}\.\.[0-9a-f]{40}/m);
    // tracked edit + untracked file: both present, tracked first, parts newline-separated
    writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
    const both = (await gitDiffPatch(dir, "HEAD", null))!;
    expect(both.indexOf("+three")).toBeLessThan(both.indexOf("diff --git a/new.txt b/new.txt"));
    expect(both).toContain("+three\ndiff --git a/new.txt b/new.txt");
  });

  it("ignored files and nested-repo rows stay out; .gitignore itself is untracked and shows", async () => {
    const { dir } = setup();
    writeFileSync(join(dir, ".gitignore"), "ignored.txt\nnode_modules/\n");
    writeFileSync(join(dir, "ignored.txt"), "secret\n");
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "x\n");
    mkdirSync(join(dir, "nested"));
    Bun.spawnSync(["git", "init", "-q"], { cwd: join(dir, "nested") });
    writeFileSync(join(dir, "nested", "inner.txt"), "inner\n");
    const patch = (await gitDiffPatch(dir, "HEAD", null))!;
    expect(patch).toContain("+++ b/.gitignore");
    expect(patch).not.toContain("ignored.txt\n+secret");
    expect(patch).not.toContain("b/ignored.txt");
    expect(patch).not.toContain("node_modules/pkg");
    expect(patch).not.toContain("inner.txt");
    expect(await gitUntrackedFiles(dir)).toEqual([".gitignore"]);
  });

  it("never touches the index: .git/index bytes unchanged, status still ??", async () => {
    const { dir, git } = setup();
    writeFileSync(join(dir, "new.txt"), "hello\n");
    const before = readFileSync(join(dir, ".git", "index"));
    await gitDiffPatch(dir, "HEAD", null, { fullIndex: true });
    expect(readFileSync(join(dir, ".git", "index")).equals(before)).toBe(true);
    expect(git("status", "--porcelain").stdout.toString()).toContain("?? new.txt");
    expect(git("diff", "--cached", "--name-only").stdout.toString().trim()).toBe("");
  });

  it("range form is unchanged with untracked files present", async () => {
    const { dir, base } = setup();
    const before = await gitDiffPatch(dir, base, "feature");
    writeFileSync(join(dir, "new.txt"), "hello\n");
    const after = await gitDiffPatch(dir, base, "feature");
    expect(after).toBe(before);
    expect(after).not.toContain("new.txt");
  });

  it("caps: files over UNTRACKED_MAX_BYTES are skipped; odd names (space, leading dash) render", async () => {
    const { dir } = setup();
    writeFileSync(join(dir, "big.bin"), "a".repeat(UNTRACKED_MAX_BYTES + 1));
    writeFileSync(join(dir, "with space.txt"), "s\n");
    writeFileSync(join(dir, "-dash.txt"), "d\n");
    const patch = (await gitDiffPatch(dir, "HEAD", null))!;
    expect(patch).not.toContain("big.bin");
    expect(patch).toContain("diff --git a/with space.txt b/with space.txt");
    expect(patch).toContain("diff --git a/-dash.txt b/-dash.txt");
    expect(patch).toContain("+d");
    expect(UNTRACKED_PATCH_LIMIT).toBe(200);
  });

  it("caps: at most UNTRACKED_PATCH_LIMIT untracked files are diffed, first by path", async () => {
    const { dir } = setup();
    const total = UNTRACKED_PATCH_LIMIT + 5;
    for (let index = 0; index < total; index += 1) writeFileSync(join(dir, `f${String(index).padStart(4, "0")}.txt`), `${index}\n`);
    const seen: string[][] = [];
    const spy: ProcessRunner = { run: async (argv, cwd, signal, options) => { seen.push([...argv]); return bunRunner.run(argv, cwd, signal, options); } };
    const patch = (await gitDiffPatch(dir, "HEAD", null, {}, spy))!;
    const perFile = seen.filter((argv) => argv.includes("--no-index"));
    expect(perFile).toHaveLength(UNTRACKED_PATCH_LIMIT);
    expect(patch).toContain("b/f0000.txt");
    expect(patch).toContain(`b/f${String(UNTRACKED_PATCH_LIMIT - 1).padStart(4, "0")}.txt`);
    expect(patch).not.toContain(`b/f${String(UNTRACKED_PATCH_LIMIT).padStart(4, "0")}.txt`);
  });

  it("argv: per-file call is git diff --no-index … -- /dev/null <path>; nothing writes the index", async () => {
    const { dir } = setup();
    writeFileSync(join(dir, "-dash.txt"), "d\n");
    const seen: string[][] = [];
    const spy: ProcessRunner = { run: async (argv, cwd, signal, options) => { seen.push([...argv]); return bunRunner.run(argv, cwd, signal, options); } };
    await gitDiffPatch(dir, "HEAD", null, { fullIndex: true, contextLines: 5 }, spy);
    expect(seen).toContainEqual(["git", "ls-files", "--others", "--exclude-standard", "-z"]);
    expect(seen).toContainEqual(["git", "diff", "--no-index", "--patch", "--full-index", "--unified=5", "--", "/dev/null", "-dash.txt"]);
    for (const argv of seen) for (const forbidden of ["add", "update-index", "read-tree"]) expect(argv.slice(1, 2)).not.toContain(forbidden);
    for (const argv of seen) expect(argv.includes("-N")).toBe(false);
  });

  it("gitDiffNewFile: rejects unsafe paths without spawning; exit 1 counts as success", async () => {
    const seen: string[][] = [];
    const spy: ProcessRunner = { run: async (argv) => { seen.push([...argv]); return { code: 1, stdout: "diff --git a/x b/x\n", stderr: "" }; } };
    for (const bad of ["", "/etc/passwd", "../escape.txt", "a/../../b", "nul\0byte"]) expect(await gitDiffNewFile("/tmp", bad, {}, spy)).toBeNull();
    expect(seen).toHaveLength(0);
    expect(await gitDiffNewFile("/tmp", "x", {}, spy)).toBe("diff --git a/x b/x\n");
    const failing: ProcessRunner = { run: async () => ({ code: 128, stdout: "", stderr: "fatal" }) };
    expect(await gitDiffNewFile("/tmp", "x", {}, failing)).toBeNull();
    expect(await gitUntrackedFiles("/tmp", failing)).toBeNull();
  });

  it("returns null for a bogus ref", async () => {
    const { dir } = setup();
    expect(await gitDiffPatch(dir, "no-such-ref", "feature")).toBeNull();
    expect(await gitDiffPatch(dir, "no-such-ref", null)).toBeNull();
  });

  it("never parses an option-looking ref as an option (T-03-01)", async () => {
    const { dir } = setup();
    const target = join(dir, "pwned.txt");
    expect(await gitDiffPatch(dir, `--output=${target}`, null)).toBeNull();
    expect(existsSync(target)).toBe(false);
  });

  it("gitShowFile: reads a blob byte-exact at a rev; null for an absent path or a non-hex rev (no spawn)", async () => {
    const dir = repo();
    const run = async (...args: string[]) => {
      const result = await bunRunner.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], dir);
      expect(result.code).toBe(0);
      return result.stdout;
    };
    await run("init", "-q", "-b", "main");
    mkdirSync(join(dir, "src"));
    const contents = "\n  lead\ntrail\n\n";
    writeFileSync(join(dir, "src", "ws.txt"), contents);
    await run("add", ".");
    await run("commit", "-qm", "init");
    const sha = await run("rev-parse", "HEAD");
    expect(await gitShowFile(dir, sha, "src/ws.txt")).toBe(contents);
    expect(await gitShowFile(dir, sha.slice(0, 12), "src/ws.txt")).toBe(contents);
    expect(await gitShowFile(dir, sha, "src/absent.txt")).toBeNull();
    const fake = fakeRunner({});
    expect(await gitShowFile(dir, "--output=x", "src/ws.txt", fake)).toBeNull();
    expect(await gitShowFile(dir, sha, "-x", fake)).toBeNull();
    expect(await gitShowFile(dir, sha, "/etc/passwd", fake)).toBeNull();
    expect(await gitShowFile(dir, sha, "", fake)).toBeNull();
    expect(fake.commands).toEqual([]);
  });

  it("raw run option keeps stdout untrimmed; default still trims", async () => {
    const dir = repo();
    expect((await bunRunner.run(["printf", "  x\n\n"], dir)).stdout).toBe("x");
    expect((await bunRunner.run(["printf", "  x\n\n"], dir, undefined, { raw: true })).stdout).toBe("  x\n\n");
  });
});

describe("gitPushBranch (PR-01)", () => {
  it("pushes with upstream to origin through the runner, in cwd", async () => {
    const calls: { command: string[]; cwd: string }[] = [];
    const runner: ProcessRunner = { async run(command, cwd) { calls.push({ command: [...command], cwd }); return { stdout: "", stderr: "", code: 0 }; } };
    expect(await gitPushBranch("/r", "tk/x", undefined, runner)).toEqual({ ok: true, stderr: "" });
    expect(calls).toEqual([{ command: ["git", "push", "--set-upstream", "origin", "tk/x"], cwd: "/r" }]);
  });

  it("a non-zero exit is a failed outcome carrying stderr", async () => {
    const runner: ProcessRunner = { async run() { return { stdout: "", stderr: "fatal: no remote", code: 1 }; } };
    expect(await gitPushBranch("/r", "tk/x", "origin", runner)).toEqual({ ok: false, stderr: "fatal: no remote" });
  });
});

describe("gitCommitTracked (11-05, D-04)", () => {
  const recording = (reply: { stdout?: string; stderr?: string; code?: number }) => {
    const calls: { command: string[]; cwd: string }[] = [];
    const runner: ProcessRunner = { async run(command, cwd) { calls.push({ command: [...command], cwd }); return { stdout: reply.stdout ?? "", stderr: reply.stderr ?? "", code: reply.code ?? 0 }; } };
    return { calls, runner };
  };

  it("runs exactly `git commit --all --message=<msg>` in cwd; exit 0 is ok", async () => {
    const { calls, runner } = recording({});
    expect(await gitCommitTracked("/w", "fix: x", runner)).toEqual({ ok: true, stderr: "", nothingToCommit: false });
    expect(calls).toEqual([{ command: ["git", "commit", "--all", "--message=fix: x"], cwd: "/w" }]);
  });

  it("nothing to commit / no changes added → nothingToCommit", async () => {
    for (const stdout of ["On branch tk/x\nnothing to commit, working tree clean", "no changes added to commit (use \"git add\" and/or \"git commit -a\")", "nothing added to commit but untracked files present (use \"git add\" to track)"]) {
      const { runner } = recording({ stdout, code: 1 });
      const outcome = await gitCommitTracked("/w", "m", runner);
      expect(outcome.ok).toBe(false);
      expect(outcome.nothingToCommit).toBe(true);
    }
  });

  it("a failing hook is a plain failure carrying stderr", async () => {
    const { runner } = recording({ stderr: "pre-commit: lint failed", code: 1 });
    expect(await gitCommitTracked("/w", "m", runner)).toEqual({ ok: false, stderr: "pre-commit: lint failed", nothingToCommit: false });
  });

  it("a leading dash stays inside the single --message= token; never --no-verify/--amend/-n", async () => {
    const { calls, runner } = recording({});
    await gitCommitTracked("/w", "--amend --no-verify", runner);
    expect(calls[0]!.command).toEqual(["git", "commit", "--all", "--message=--amend --no-verify"]);
    expect(calls[0]!.command.filter((arg) => arg === "--amend" || arg === "--no-verify" || arg === "-n" || arg === "--allow-empty")).toEqual([]);
  });
});
