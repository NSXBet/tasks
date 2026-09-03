/**
 * Agent lifecycle hooks (`tk codex-hook`, `tk cursor-hook`), ported from beads
 * (`cmd/bd/codex_hook.go`, `cursor_hook.go`, `agent_hook.go`).
 *
 * Each agent keeps its own event names and input/output schemas, but the
 * prime-runner and one-shot refresh-marker mechanics are shared. Hooks exec
 * `tk prime` as a subprocess (never in-process) to avoid re-entrant store
 * initialization.
 */
import { existsSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { PRIME } from "./presentation.js";

/** 30s ceiling on the prime subprocess inside an interactive hook. */
const AGENT_HOOK_TIMEOUT_MS = 30_000;
/** Marker-directory override for tests. Read at call time: module-load order must not freeze it. */
const markerDirOverride = (): string => process.env["TK_HOOK_MARKER_DIR"] ?? "";

/** User cache dir per platform conventions (XDG_CACHE_HOME, ~/Library/Caches, ~/.cache). */
function userCacheDir(): string {
  const xdg = process.env["XDG_CACHE_HOME"];
  if (xdg !== undefined && xdg !== "") return xdg;
  return process.platform === "darwin" ? join(homedir(), "Library", "Caches") : join(homedir(), ".cache");
}

/** Base dir for one-shot post-compaction refresh markers of one agent. */
export function agentHookMarkerBaseDir(subdir: string): string {
  const override = markerDirOverride();
  if (override !== "") return override;
  return join(userCacheDir(), "tasks", subdir);
}
/**
 * Per-session, per-workspace marker path so concurrent agent sessions don't
 * clobber each other's state; empty keys fall back to stable placeholders.
 */
export function agentHookMarkerPath(base: string, sessionKey: string, workspaceKey: string): string {
  const session = sessionKey === "" ? "unknown-session" : sessionKey;
  const workspace = workspaceKey === "" ? "unknown-workspace" : workspaceKey;
  const sum = createHash("sha256").update(`${session}\u0000${workspace}`).digest("hex");
  return join(base, `${sum}.refresh`);
}

/** Creates the marker directory and writes the one-shot refresh marker. */
async function writeAgentHookMarker(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, "1\n", { mode: 0o600 });
}
/**
 * Shells out to `tk prime` as a subprocess (never in-process) to avoid
 * re-entrant store initialization. The tk entrypoint is resolved from argv[1]
 * only when it really is tk (the module is imported by tk itself); otherwise
 * `tk` must be on PATH — mirroring bd's PATH requirement for agent hooks.
 */
export function runTkPrime(memoriesOnly: boolean, cwd: string): { readonly ok: boolean; readonly output: string; readonly error: string } {
  const args = memoriesOnly ? ["prime", "--memories-only"] : ["prime"];
  const self = process.argv[1];
  if (self !== undefined && self.endsWith("/tk.ts") && existsSync(self)) {
    const result = spawnSync(process.execPath, [self, ...args], { cwd, encoding: "utf8", timeout: AGENT_HOOK_TIMEOUT_MS });
    if (result.status === 0) return { ok: true, output: (result.stdout ?? "").trimEnd(), error: "" };
    return { ok: false, output: "", error: result.stderr?.trim() || `exit ${result.status ?? "null"}` };
  }
  const result = spawnSync("tk", args, { cwd, encoding: "utf8", timeout: AGENT_HOOK_TIMEOUT_MS });
  if (result.status === 0) return { ok: true, output: (result.stdout ?? "").trimEnd(), error: "" };
  // Not installed as tk on PATH — degrade to the embedded context text.
  return { ok: true, output: PRIME, error: "" };
}


// =============================================================================
// Codex (hooks.json protocol: hookSpecificOutput.additionalContext)
// =============================================================================

const codexHookSessionStart = "SessionStart";
const codexHookPreCompact = "PreCompact";
const codexHookPostCompact = "PostCompact";
const codexHookUserPromptSubmit = "UserPromptSubmit";

interface CodexHookInput {
  readonly session_id?: string;
  readonly transcript_path?: string;
  readonly cwd?: string;
  readonly hook_event_name?: string;
  readonly model?: string;
  readonly trigger?: string;
}

interface CodexHookResponse {
  readonly continue?: boolean;
  readonly systemMessage?: string;
  readonly hookSpecificOutput?: { readonly hookEventName?: string; readonly additionalContext?: string };
}

/** Runs `tk codex-hook <event>`: reads the payload JSON from stdin, writes the response JSON to stdout. */
export async function runCodexHook(eventArg: string, stdinText: string): Promise<void> {
  let input: CodexHookInput = {};
  try { input = JSON.parse(stdinText) as CodexHookInput; } catch { /* empty payload is valid */ }
  if (input.hook_event_name !== undefined && input.hook_event_name !== "") eventArg = input.hook_event_name;
  const workspace = input.cwd ?? "";
  switch (eventArg) {
    case codexHookSessionStart: {
      const prime = runTkPrime(false, workspace);
      if (prime.ok && prime.output.trim() !== "") writeCodexAdditionalContext(codexHookSessionStart, prime.output);
      return;
    }
    case codexHookPreCompact: {
      const prime = runTkPrime(true, workspace);
      if (!prime.ok) writeCodexSystemMessage(`Tasks context check failed before compaction: ${prime.error}`);
      return;
    }
    case codexHookPostCompact: {
      await writeAgentHookMarker(agentHookMarkerPath(agentHookMarkerBaseDir("codex-hooks"), input.session_id ?? "", workspace));
      return;
    }
    case codexHookUserPromptSubmit: {
      const path = agentHookMarkerPath(agentHookMarkerBaseDir("codex-hooks"), input.session_id ?? "", workspace);
      const armed = await exists(path);
      if (!armed) return;
      const prime = runTkPrime(false, workspace);
      if (!prime.ok) { writeCodexSystemMessage(`Tasks context refresh after compaction failed: ${prime.error}`); return; }
      await rm(path, { force: true });
      if (prime.output.trim() === "") return;
      writeCodexAdditionalContext(codexHookUserPromptSubmit, prime.output);
      return;
    }
    default:
      throw new Error(`unsupported Codex hook event "${eventArg}"`);
  }
}

function writeCodexAdditionalContext(event: string, context: string): void {
  const response: CodexHookResponse = { continue: true, hookSpecificOutput: { hookEventName: event, additionalContext: context } };
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function writeCodexSystemMessage(message: string): void {
  const response: CodexHookResponse = { continue: true, systemMessage: message };
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

// =============================================================================
// Cursor (hooks.json protocol: additional_context / user_message)
// =============================================================================

const cursorHookSessionStart = "sessionStart";
const cursorHookPreCompact = "preCompact";
const cursorHookPostToolUse = "postToolUse";

interface CursorHookInput {
  readonly conversation_id?: string;
  readonly session_id?: string;
  readonly hook_event_name?: string;
  readonly workspace_roots?: readonly string[];
  readonly cwd?: string;
  readonly trigger?: string;
  readonly tool_name?: string;
}

/** All-optional response; `{}` is the documented no-op for a command hook. */
interface CursorHookResponse {
  readonly continue?: boolean;
  readonly additional_context?: string;
  readonly user_message?: string;
}

/** Runs `tk cursor-hook <event>`: reads the payload JSON from stdin, writes the response JSON to stdout. */
export async function runCursorHook(eventArg: string, stdinText: string): Promise<void> {
  let input: CursorHookInput = {};
  try { input = JSON.parse(stdinText) as CursorHookInput; } catch { /* empty payload is valid */ }
  // Cursor sends the canonical event name on stdin; prefer it over the arg.
  if (input.hook_event_name !== undefined && input.hook_event_name !== "") eventArg = input.hook_event_name;
  const conversation = input.conversation_id ?? input.session_id ?? "";
  const workspace = input.workspace_roots?.[0] ?? input.cwd ?? "";
  const markerPath = agentHookMarkerPath(agentHookMarkerBaseDir("cursor-hooks"), conversation, workspace);
  switch (eventArg) {
    case cursorHookSessionStart: {
      await rm(markerPath, { force: true }); // drop stale marker
      const prime = runTkPrime(false, workspace);
      const response: CursorHookResponse = prime.ok ? { continue: true, additional_context: prime.output.replace(/\n+$/, "") } : { continue: true };
      process.stdout.write(`${JSON.stringify(response)}\n`);
      return;
    }
    case cursorHookPreCompact: {
      await writeAgentHookMarker(markerPath);
      const response: CursorHookResponse = { user_message: "Tasks: context compacting — tk workflow context will be re-injected on the next tool call (or run `tk prime`)." };
      process.stdout.write(`${JSON.stringify(response)}\n`);
      return;
    }
    case cursorHookPostToolUse: {
      if (!(await exists(markerPath))) { process.stdout.write("{}\n"); return; }
      const prime = runTkPrime(false, workspace);
      if (!prime.ok || prime.output.trim() === "") { process.stdout.write("{}\n"); return; } // marker stays armed for a retry
      await rm(markerPath, { force: true });
      const restored = `[Tasks] Context was compacted. Restored tk workflow context below.\n\n${prime.output.replace(/\n+$/, "")}`;
      const response: CursorHookResponse = { continue: true, additional_context: restored };
      process.stdout.write(`${JSON.stringify(response)}\n`);
      return;
    }
    default:
      throw new Error(`unsupported Cursor hook event "${eventArg}"`);
  }
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}
