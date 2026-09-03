import { tmpdir } from "node:os";
import { existsSync, mkdirSync, realpathSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const executable = join(process.cwd(), "packages/cli/src/tk.ts");
const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-hooks-")); workspaces.push(value); return value; }
function gitRepo(): string { const value = workspace(); Bun.spawnSync(["git", "init", "-q"], { cwd: value }); return value; }
function run(directory: string, args: readonly string[], input?: string, env?: Record<string, string>): { readonly stdout: string; readonly stderr: string; readonly status: number } {
  const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdin: input === undefined ? undefined : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe", env: env === undefined ? undefined : { ...process.env, ...env } });
  return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode };
}
function json<T>(directory: string, args: readonly string[], input?: string, env?: Record<string, string>): T { const result = run(directory, [...args, "--json"], input, env); expect(result.status, result.stderr).toBe(0); return JSON.parse(result.stdout) as T; }
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

describe("tk hooks (ported from bd hooks)", () => {
  it("installs marked hooks into .git/hooks and lists them", () => {
    const repo = gitRepo();
    json<unknown>(repo, ["hooks", "install"]);
    const hook = readFileSync(join(repo, ".git", "hooks", "pre-commit"), "utf8");
    expect(hook).toContain("# --- BEGIN TK INTEGRATION");
    expect(hook).toContain("# --- END TK INTEGRATION");
    expect(hook).toContain("tk hooks run pre-commit");
    expect(hook).toContain("export TK_GIT_HOOK=1");
    expect(existsSync(join(repo, ".git", "hooks", "post-merge"))).toBe(true);
    expect(existsSync(join(repo, ".git", "hooks", "prepare-commit-msg"))).toBe(true);
    const list = json<{ hooks: readonly { name: string; installed: boolean; outdated: boolean }[] }>(repo, ["hooks", "list"]);
    expect(list.hooks).toHaveLength(5);
    expect(list.hooks.every((status) => status.installed && !status.outdated)).toBe(true);
  });

  it("preserves user content outside the markers across reinstall and uninstall", () => {
    const repo = gitRepo();
    const hookPath = join(repo, ".git", "hooks", "pre-commit");
    mkdirSync(join(repo, ".git", "hooks"), { recursive: true });
    writeFileSync(hookPath, "#!/bin/sh\necho user-own-code\n");
    json<unknown>(repo, ["hooks", "install"]);
    const injected = readFileSync(hookPath, "utf8");
    expect(injected).toContain("echo user-own-code");
    expect(injected).toContain("# --- BEGIN TK INTEGRATION");
    // Reinstall must not duplicate the user content.
    json<unknown>(repo, ["hooks", "install"]);
    const reinstalled = readFileSync(hookPath, "utf8");
    expect(reinstalled.match(/echo user-own-code/g)).toHaveLength(1);
    // Uninstall strips only the section.
    json<unknown>(repo, ["hooks", "uninstall"]);
    const uninstalled = readFileSync(hookPath, "utf8");
    expect(uninstalled).not.toContain("BEGIN TK INTEGRATION");
    expect(uninstalled).toContain("echo user-own-code");
  });

  it("creates and restores a .backup when injecting into foreign hooks", () => {
    const repo = gitRepo();
    const hookPath = join(repo, ".git", "hooks", "pre-commit");
    mkdirSync(join(repo, ".git", "hooks"), { recursive: true });
    writeFileSync(hookPath, "#!/bin/sh\necho mine\n");
    json<unknown>(repo, ["hooks", "install"]);
    expect(readFileSync(`${hookPath}.backup`, "utf8")).toBe("#!/bin/sh\necho mine\n");
    json<unknown>(repo, ["hooks", "uninstall"]);
    expect(readFileSync(hookPath, "utf8")).toContain("echo mine");
  });

  it("runs chained .old hooks and reports failures", () => {
    const repo = gitRepo();
    json<unknown>(repo, ["hooks", "install"]);
    const hooksDir = join(repo, ".git", "hooks");
    writeFileSync(join(hooksDir, "pre-commit.old"), `#!/bin/sh\ntouch ${JSON.stringify(join(repo, "chained-marker"))}\n`);
    // chmod +x via spawnSync on sh
    Bun.spawnSync(["chmod", "+x", join(hooksDir, "pre-commit.old")]);
    const ok = run(repo, ["hooks", "run", "pre-commit"]);
    expect(ok.status).toBe(0);
    expect(existsSync(join(repo, "chained-marker"))).toBe(true);
    writeFileSync(join(hooksDir, "post-merge.old"), "#!/bin/sh\nexit 7\n");
    Bun.spawnSync(["chmod", "+x", join(hooksDir, "post-merge.old")]);
    expect(run(repo, ["hooks", "run", "post-merge"]).status).toBe(7);
  });

  it("appends the Executed-By trailer from TK_ACTOR in prepare-commit-msg", () => {
    const repo = gitRepo();
    const msgFile = join(repo, "COMMIT_MSG");
    writeFileSync(msgFile, "subject line\n");
    const result = run(repo, ["hooks", "run", "prepare-commit-msg", msgFile, "message"], undefined, { TK_ACTOR: "agent-x" });
    expect(result.status).toBe(0);
    expect(readFileSync(msgFile, "utf8")).toBe("subject line\n\nExecuted-By: agent-x\n");
    // Amend: no duplicate trailer.
    run(repo, ["hooks", "run", "prepare-commit-msg", msgFile, "message"], undefined, { TK_ACTOR: "agent-x" });
    expect(readFileSync(msgFile, "utf8").match(/Executed-By:/g)).toHaveLength(1);
    // Merge commits keep their format.
    writeFileSync(msgFile, "merge subject\n");
    run(repo, ["hooks", "run", "prepare-commit-msg", msgFile, "merge"], undefined, { TK_ACTOR: "agent-x" });
    expect(readFileSync(msgFile, "utf8")).toBe("merge subject\n");
  });

  it("exits silently under TK_GIT_HOOK with no workspace and exports+stages on pre-commit when configured", () => {
    const repo = gitRepo();
    // Hook context without workspace: silent success.
    const silent = run(repo, ["q", "silent"], undefined, { TK_GIT_HOOK: "1" });
    expect(silent.status).toBe(0);
    expect(silent.stderr).toBe("");
    // Real pre-commit auto-export path.
    json<unknown>(repo, ["init"]);
    json<unknown>(repo, ["create", "hook export test"]);
    writeFileSync(join(repo, ".tasks", "config.json"), `${JSON.stringify({ prefix: "tk", "export.auto": true, "export.git-add": true })}\n`);
    Bun.spawnSync(["git", "-C", repo, "add", ".tasks/config.json"]);
    const result = run(repo, ["hooks", "run", "pre-commit"]);
    expect(result.status, result.stderr).toBe(0);
    const exported = readFileSync(join(repo, ".tasks", "issues.jsonl"), "utf8");
    expect(exported).toContain("hook export test");
    const staged = Bun.spawnSync(["git", "-C", repo, "diff", "--cached", "--name-only"]);
    expect(new TextDecoder().decode(staged.stdout)).toContain(".tasks/issues.jsonl");
  });

  it("imports JSONL on post-merge when import.auto is on", () => {
    const source = workspace();
    const repo = gitRepo();
    json<unknown>(source, ["init", "--prefix", "src"]);
    json<unknown>(source, ["create", "synced from jsonl"]);
    const jsonl = run(source, ["export"]).stdout;
    json<unknown>(repo, ["init", "--prefix", "tk"]);
    writeFileSync(join(repo, ".tasks", "issues.jsonl"), jsonl);
    writeFileSync(join(repo, ".tasks", "config.json"), `${JSON.stringify({ prefix: "tk", "import.auto": true })}\n`);
    const result = run(repo, ["hooks", "run", "post-merge"]);
    expect(result.status, result.stderr).toBe(0);
    const list = json<readonly { title: string }[]>(repo, ["list"]);
    expect(list.some((issue) => issue.title === "synced from jsonl")).toBe(true);
  });

  it("installs shared hooks into .tasks-hooks and sets core.hooksPath", () => {
    const repo = gitRepo();
    json<unknown>(repo, ["hooks", "install", "--shared"]);
    expect(existsSync(join(repo, ".tasks-hooks", "pre-commit"))).toBe(true);
    const hooksPath = Bun.spawnSync(["git", "-C", repo, "config", "--get", "core.hooksPath"]);
    expect(new TextDecoder().decode(hooksPath.stdout).trim()).toBe(realpathSync(join(repo, ".tasks-hooks")));
    json<unknown>(repo, ["hooks", "uninstall"]);
    const cleared = Bun.spawnSync(["git", "-C", repo, "config", "--get", "core.hooksPath"]);
    expect(new TextDecoder().decode(cleared.stdout).trim()).toBe("");
    // tk-owned shared hooks are wholly removed on uninstall (as bd does); user
    // content preservation is covered by the .git/hooks and .backup tests.
    expect(existsSync(join(repo, ".tasks-hooks", "pre-commit"))).toBe(false);
  });

  it("rejects installing over a tracked foreign hook", () => {
    const repo = gitRepo();
    Bun.spawnSync(["git", "-C", repo, "config", "commit.gpgsign", "false"], { encoding: "utf8" });
    Bun.spawnSync(["git", "-C", repo, "config", "user.email", "t@t"], { encoding: "utf8" });
    Bun.spawnSync(["git", "-C", repo, "config", "user.name", "t"], { encoding: "utf8" });
    mkdirSync(join(repo, ".githooks"), { recursive: true });
    const tracked = join(repo, ".githooks", "pre-commit");
    writeFileSync(tracked, "#!/bin/sh\ntrue\n");
    Bun.spawnSync(["git", "-C", repo, "add", ".githooks/pre-commit"], { encoding: "utf8" });
    Bun.spawnSync(["git", "-C", repo, "commit", "-qm", "hooks"], { encoding: "utf8" });
    Bun.spawnSync(["git", "-C", repo, "config", "core.hooksPath", ".githooks"], { encoding: "utf8" });
    const result = run(repo, ["hooks", "install"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("tracked by git");
  });

  it("codex-hook injects prime context on SessionStart and refreshes once after PostCompact", () => {
    const repo = workspace();
    json<unknown>(repo, ["init"]);
    const markerEnv = { TK_HOOK_MARKER_DIR: join(repo, "markers") };
    const session = run(repo, ["codex-hook", "SessionStart"], JSON.stringify({ session_id: "s1", cwd: repo }), markerEnv);
    expect(session.status).toBe(0);
    const startPayload = JSON.parse(session.stdout) as { hookSpecificOutput?: { additionalContext?: string } };
    expect(startPayload.hookSpecificOutput?.additionalContext ?? "").toContain("tk");
    // PostCompact arms the marker; UserPromptSubmit consumes it once.
    run(repo, ["codex-hook", "PostCompact"], JSON.stringify({ session_id: "s1", cwd: repo }), markerEnv);

    const refresh = run(repo, ["codex-hook", "UserPromptSubmit"], JSON.stringify({ session_id: "s1", cwd: repo }), markerEnv);
    const refreshPayload = JSON.parse(refresh.stdout) as { hookSpecificOutput?: { hookEventName?: string } };
    expect(refreshPayload.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    // Second prompt: marker cleared — no context injection.
    const second = run(repo, ["codex-hook", "UserPromptSubmit"], JSON.stringify({ session_id: "s1", cwd: repo }), markerEnv);
    expect(second.stdout.trim()).toBe("");
  });

  it("cursor-hook returns {} no-op without a marker and restores once after preCompact", () => {
    const repo = workspace();
    json<unknown>(repo, ["init"]);
    const markerEnv = { TK_HOOK_MARKER_DIR: join(repo, "markers") };
    const payload = { conversation_id: "c1", workspace_roots: [repo] };
    const idle = run(repo, ["cursor-hook", "postToolUse"], JSON.stringify(payload), markerEnv);
    expect(idle.stdout.trim()).toBe("{}");
    run(repo, ["cursor-hook", "preCompact"], JSON.stringify(payload), markerEnv);
    const compacting = JSON.parse(run(repo, ["cursor-hook", "preCompact"], JSON.stringify(payload), markerEnv).stdout) as { user_message?: string };
    expect(compacting.user_message ?? "").toContain("compacting");
    const restored = JSON.parse(run(repo, ["cursor-hook", "postToolUse"], JSON.stringify(payload), markerEnv).stdout) as { additional_context?: string; continue?: boolean };
    expect(restored.continue).toBe(true);
    expect(restored.additional_context ?? "").toContain("[Tasks]");
    // Marker cleared: back to no-op.
    expect(run(repo, ["cursor-hook", "postToolUse"], JSON.stringify(payload), markerEnv).stdout.trim()).toBe("{}");
  });

  it("setup cursor writes managed hook entries and --remove strips only tk entries", () => {
    const repo = workspace();
    const hooksPath = join(repo, ".cursor", "hooks.json");
    json<unknown>(repo, ["setup", "cursor"]);
    const config = JSON.parse(readFileSync(hooksPath, "utf8")) as { version: number; hooks: Record<string, readonly { command: string }[]> };
    expect(config.version).toBe(1);
    expect(config.hooks.sessionStart?.[0]?.command).toBe("tk cursor-hook sessionStart");
    expect(config.hooks.preCompact?.[0]?.command).toBe("tk cursor-hook preCompact");
    expect(config.hooks.postToolUse?.[0]?.command).toBe("tk cursor-hook postToolUse");
    // User entry survives removal.
    config.hooks.postToolUse = [...(config.hooks.postToolUse ?? []), { command: "echo user-hook" }];
    writeFileSync(hooksPath, JSON.stringify(config, null, 2));
    json<unknown>(repo, ["setup", "cursor", "--remove"]);
    const after = JSON.parse(readFileSync(hooksPath, "utf8")) as { hooks: Record<string, readonly { command: string }[]> };
    expect(after.hooks.postToolUse?.map((entry) => entry.command)).toEqual(["echo user-hook"]);
    expect(after.hooks.sessionStart).toBeUndefined();
  });

  it("setup codex installs hooks.json entries and enables the feature flag; --remove undoes both", () => {
    const repo = workspace();
    json<unknown>(repo, ["setup", "codex"]);
    const hooksPath = join(repo, ".codex", "hooks.json");
    const config = JSON.parse(readFileSync(hooksPath, "utf8")) as { hooks: Record<string, readonly { hooks: readonly { command: string }[] }[]> };
    expect(config.hooks.SessionStart?.[0]?.hooks[0]?.command).toBe("tk codex-hook SessionStart");
    const toml = readFileSync(join(repo, ".codex", "config.toml"), "utf8");
    expect(toml).toContain("[features]");
    expect(toml).toContain("hooks = true");
    json<unknown>(repo, ["setup", "codex", "--remove"]);
    expect(existsSync(hooksPath)).toBe(false);
    const tomlAfter = readFileSync(join(repo, ".codex", "config.toml"), "utf8");
    expect(tomlAfter).not.toContain("hooks = true");
  });

  it("hooks list reports not installed outside a git repo", () => {
    const repo = workspace(); // not a git repo
    const list = json<{ hooks: readonly { name: string; installed: boolean }[] }>(repo, ["hooks", "list"]);
    expect(list.hooks.every((status) => !status.installed)).toBe(true);
  });
});
