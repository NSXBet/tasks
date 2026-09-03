/**
 * Agent hooks.json management, ported from beads (`cmd/bd/setup/cursor.go`,
 * `codex.go`, `hooks_json.go`). tk owns only the entries whose command carries
 * the `tk cursor-hook ` / `tk codex-hook ` prefix; user entries are preserved
 * verbatim, and `version: 1` is stamped when absent.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

type HooksConfig = Record<string, unknown>;

export const CURSOR_EVENTS: readonly string[] = ["sessionStart", "preCompact", "postToolUse"];
export const CODEX_EVENTS: readonly string[] = ["SessionStart", "PreCompact", "PostCompact", "UserPromptSubmit"];
const CURSOR_COMMAND_PREFIX = "tk cursor-hook ";
const CODEX_COMMAND_PREFIX = "tk codex-hook ";

/** Empty/whitespace input reads as an empty config; malformed JSON throws. */
export function parseHooksJson(data: string): HooksConfig {
  if (data.trim() === "") return {};
  const parsed: unknown = JSON.parse(data);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("hooks.json must be a JSON object");
  return parsed as HooksConfig;
}

/** Two-space indent + trailing newline — the shared on-disk format. */
export function marshalHooksJson(config: HooksConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

// =============================================================================
// Cursor: .cursor/hooks.json (project) or ~/.cursor/hooks.json (--global)
// =============================================================================

/** Where Cursor hooks live for a scope. Project rules are a Cursor-Settings concern; hooks.json is the only file surface. */
export function cursorHooksTargetPath(global: boolean, projectDir = process.cwd()): string {
  return global ? join(homedir(), ".cursor", "hooks.json") : resolve(projectDir, ".cursor", "hooks.json");
}

function cursorManagedHooks(): Readonly<Record<string, string>> {
  return { sessionStart: `${CURSOR_COMMAND_PREFIX}sessionStart`, preCompact: `${CURSOR_COMMAND_PREFIX}preCompact`, postToolUse: `${CURSOR_COMMAND_PREFIX}postToolUse` };
}

/** Managed event names present in a parsed config — the shared detection source for setup and doctor. */
export function cursorManagedHookEvents(config: HooksConfig): readonly string[] {
  const hooks = config["hooks"];
  if (hooks === undefined || hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) return [];
  const found: string[] = [];
  for (const event of CURSOR_EVENTS) {
    if (toEntries((hooks as HooksConfig)[event]).some(cursorHookEntryManaged)) found.push(event);
  }
  return found;
}

export async function installCursorHooks(path: string): Promise<void> {
  const config = (await readHooksJson(path)) ?? {};
  upsertCursorManagedHooks(config);
  await writeHooksJson(path, config);
}

export async function removeCursorHooks(path: string): Promise<void> {
  const config = await readHooksJson(path);
  if (config === null) return;
  const hooks = config["hooks"];
  if (hooks !== null && typeof hooks === "object" && !Array.isArray(hooks)) {
    const hookMap = hooks as Record<string, unknown>;
    for (const event of CURSOR_EVENTS) {
      const filtered = toEntries(hookMap[event]).filter((entry) => !cursorHookEntryManaged(entry));
      if (filtered.length === 0) delete hookMap[event];
      else hookMap[event] = filtered;
    }
    if (Object.keys(hookMap).length === 0) delete config["hooks"];
  }
  if (hooksConfigEmpty(config)) {
    await rm(path, { force: true });
    return;
  }
  await writeHooksJson(path, config);
}

export async function cursorHooksInstalled(path: string): Promise<boolean> {
  const config = await readHooksJson(path);
  if (config === null) return false;
  const hooks = config["hooks"];
  if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) return false;
  const managed = cursorManagedHooks();
  return Object.entries(managed).every(([event, command]) => toEntries((hooks as Record<string, unknown>)[event]).some((entry) => entryCommand(entry) === command));
}

function upsertCursorManagedHooks(config: HooksConfig): void {
  let hooks = config["hooks"];
  if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) { hooks = {}; config["hooks"] = hooks; }
  const hookMap = hooks as Record<string, unknown>;
  for (const [event, command] of Object.entries(cursorManagedHooks())) {
    const entries = toEntries(hookMap[event]).filter((entry) => !cursorHookEntryManaged(entry));
    entries.push({ command });
    hookMap[event] = entries;
  }
}

function cursorHookEntryManaged(entry: unknown): boolean {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
  const command = (entry as Record<string, unknown>)["command"];
  return typeof command === "string" && command.startsWith(CURSOR_COMMAND_PREFIX);
}

function entryCommand(entry: unknown): string {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return "";
  const command = (entry as Record<string, unknown>)["command"];
  return typeof command === "string" ? command : "";
}

// =============================================================================
// Codex: <projectDir|.codex|CODEX_HOME>/hooks.json gated by [features] hooks
// =============================================================================

export const CODEX_LEGACY_SESSION_START_COMMAND = "bd SessionStart";

/** Codex config root for a scope: $CODEX_HOME (global) or <project>/.codex. */
export function codexConfigRoot(global: boolean, projectDir: string): string {
  if (global) return process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
  return join(projectDir, ".codex");
}

export const codexHooksPath = (global: boolean, projectDir: string): string => join(codexConfigRoot(global, projectDir), "hooks.json");

/** The managed Codex hook table; matchers mirror the beads upstream hooks.json. */
function codexManagedHooks(): Readonly<Record<string, unknown>> {
  return {
    SessionStart: [codexHookEntry("startup|resume|clear", `${CODEX_COMMAND_PREFIX}SessionStart`, "Loading Tasks context")],
    PreCompact: [codexHookEntry("manual|auto", `${CODEX_COMMAND_PREFIX}PreCompact`, "Checking Tasks context")],
    PostCompact: [codexHookEntry("manual|auto", `${CODEX_COMMAND_PREFIX}PostCompact`, "Scheduling Tasks context refresh")],
    UserPromptSubmit: [codexHookEntry("", `${CODEX_COMMAND_PREFIX}UserPromptSubmit`, "Refreshing Tasks context")],
  };
}

function codexHookEntry(matcher: string, command: string, status: string): HooksConfig {
  const entry: HooksConfig = { hooks: [{ type: "command", command, statusMessage: status }] };
  if (matcher !== "") entry["matcher"] = matcher;
  return entry;
}

/** Installs managed Codex hook entries into hooks.json and enables `[features] hooks` in config.toml. */
export async function installCodexHooks(global: boolean, projectDir: string): Promise<void> {
  const path = codexHooksPath(global, projectDir);
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  const config = (await readHooksJson(path)) ?? {};
  const hooks = asRecord(config["hooks"]) ?? {};
  config["hooks"] = hooks;
  for (const [event, entries] of Object.entries(codexManagedHooks())) {
    removeCodexManagedHookEvent(hooks, event);
    hooks[event] = [...toEntries(hooks[event]), ...(entries as readonly unknown[])];
  }
  await writeHooksJson(path, config);
  const configToml = join(codexConfigRoot(global, projectDir), "config.toml");
  const toml = await readFile(configToml, "utf8").catch(() => "");
  await writeFile(configToml, upsertCodexHooksFeature(toml), { mode: 0o644 });
}

/** Removes tk-managed Codex hook entries and the feature flag; deletes hooks.json when nothing user-owned remains. */
export async function removeCodexHooks(global: boolean, projectDir: string): Promise<void> {
  const path = codexHooksPath(global, projectDir);
  const data = await readFile(path, "utf8").catch(() => null);
  if (data === null) return;
  const config = parseHooksJson(data);
  const hooks = asRecord(config["hooks"]);
  if (hooks !== undefined) {
    for (const event of CODEX_EVENTS) removeCodexManagedHookEvent(hooks, event);
    if (Object.keys(hooks).length === 0) delete config["hooks"];
  }
  if (hooksConfigEmpty(config)) {
    await rm(path, { force: true });
  } else {
    await writeHooksJson(path, config);
  }
  const configToml = join(codexConfigRoot(global, projectDir), "config.toml");
  const toml = await readFile(configToml, "utf8").catch(() => null);
  if (toml !== null) await writeFile(configToml, removeCodexHooksFeature(toml), { mode: 0o644 });
}

/** True when every managed entry is present and no legacy SessionStart pipeline lingers. */
export async function codexHooksInstalled(global: boolean, projectDir: string): Promise<boolean> {
  const data = await readFile(codexHooksPath(global, projectDir), "utf8").catch(() => null);
  if (data === null) return false;
  const config = parseHooksJson(data);
  const hooks = asRecord(config["hooks"]);
  if (hooks === undefined) return false;
  for (const entry of toEntries(hooks["SessionStart"])) {
    if (entryCommands(entry).some((command) => command.trim() === CODEX_LEGACY_SESSION_START_COMMAND)) return false;
  }
  const managed = codexManagedHooks();
  for (const [event, wantEntries] of Object.entries(managed)) {
    for (const want of wantEntries as readonly unknown[]) {
      if (!toEntries(hooks[event]).some((entry) => JSON.stringify(entry) === JSON.stringify(want))) return false;
    }
  }
  return true;
}

/** True when any tk-managed Codex entry (or the legacy pipeline) exists in the parsed config. */
export function codexManagedHookEvents(config: HooksConfig): readonly string[] {
  const hooks = asRecord(config["hooks"]);
  if (hooks === undefined) return [];
  const found: string[] = [];
  for (const event of CODEX_EVENTS) {
    for (const entry of toEntries(hooks[event])) {
      if (codexHookEntryManaged(entry) || (event === "SessionStart" && entryCommands(entry).some((command) => command.trim() === CODEX_LEGACY_SESSION_START_COMMAND))) { found.push(event); break; }
    }
  }
  return found;
}

function removeCodexManagedHookEvent(hooks: Record<string, unknown>, event: string): void {
  const filtered = toEntries(hooks[event]).filter((entry) => {
    if (codexHookEntryManaged(entry)) return false;
    if (event !== "SessionStart") return true;
    // Legacy exact pipeline: strip the command from the entry, keep the rest.
    const commands = asRecord(entry)?.["hooks"];
    if (!Array.isArray(commands)) return true;
    const remaining = commands.filter((command) => {
      const got = asRecord(command)?.["command"];
      return !(typeof got === "string" && got.trim() === CODEX_LEGACY_SESSION_START_COMMAND);
    });
    if (remaining.length === commands.length) return true;
    if (remaining.length === 0) return false;
    (entry as Record<string, unknown>)["hooks"] = remaining;
    return true;
  });
  if (filtered.length === 0) delete hooks[event];
  else hooks[event] = filtered;
}

function codexHookEntryManaged(entry: unknown): boolean {
  return entryCommands(entry).some((command) => command.startsWith(CODEX_COMMAND_PREFIX));
}

function entryCommands(entry: unknown): readonly string[] {
  const hooks = asRecord(entry)?.["hooks"];
  if (!Array.isArray(hooks)) return [];
  return hooks.map((hook) => asRecord(hook)?.["command"]).filter((command): command is string => typeof command === "string");
}

// =============================================================================
// config.toml [features] hooks flag (line-level TOML surgery, as upstream)
// =============================================================================

/** Sets `hooks = true` inside `[features]`, creating the table when missing; preserves all other lines. */
export function upsertCodexHooksFeature(content: string): string {
  const lines = content.split("\n");
  let inFeatures = false;
  let featuresSeen = false;
  let flagSeen = false;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) { inFeatures = trimmed === "[features]"; if (inFeatures) featuresSeen = true; continue; }
    const key = tomlLineKey(trimmed);
    if (inFeatures && key === "codex_hooks") { lines[i] = ""; continue; }
    if (inFeatures && key === "hooks") { lines[i] = "hooks = true"; flagSeen = true; }
  }
  if (featuresSeen && !flagSeen) {
    const out: string[] = [];
    let inserted = false;
    let sawFeatures = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        if (sawFeatures && !inserted) { out.push("hooks = true"); inserted = true; }
        sawFeatures = trimmed === "[features]";
      }
      if (trimmed !== "") out.push(line);
    }
    if (sawFeatures && !inserted) out.push("hooks = true");
    lines.length = 0;
    lines.push(...out);
  }
  let next = lines.join("\n").replace(/\n+$/, "");
  if (!featuresSeen) next = `${next === "" ? "" : `${next}\n\n`}[features]\nhooks = true`;
  return `${next}\n`;
}

/** Removes the `hooks`/`codex_hooks` keys from `[features]`; keeps the table itself. */
export function removeCodexHooksFeature(content: string): string {
  const out: string[] = [];
  let inFeatures = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) { inFeatures = trimmed === "[features]"; out.push(line); continue; }
    if (inFeatures && ["hooks", "codex_hooks"].includes(tomlLineKey(trimmed))) continue;
    out.push(line);
  }
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

/** True only when `[features]` contains `hooks = true`. */
export function codexHooksFeatureEnabled(content: string): boolean {
  let inFeatures = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) { inFeatures = trimmed === "[features]"; continue; }
    if (inFeatures && tomlLineKey(trimmed) === "hooks") {
      const parts = trimmed.split("=", 2);
      return parts.length === 2 && parts[1]!.trim() === "true";
    }
  }
  return false;
}

function tomlLineKey(trimmed: string): string {
  if (trimmed === "" || trimmed.startsWith("#")) return "";
  const separator = trimmed.indexOf("=");
  return separator === -1 ? "" : trimmed.slice(0, separator).trim();
}

// =============================================================================
// Shared I/O
// =============================================================================

/** Reads hooks.json; null when absent so callers distinguish "absent" from "empty". */
async function readHooksJson(path: string): Promise<HooksConfig | null> {
  const data = await readFile(path, "utf8").catch((cause: unknown) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`parse ${path}: ${cause instanceof Error ? cause.message : cause}`);
  });
  return data === null ? null : parseHooksJson(data);
}

async function writeHooksJson(path: string, config: HooksConfig): Promise<void> {
  if (config["version"] === undefined) config["version"] = 1;
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  await writeFile(path, marshalHooksJson(config), { mode: 0o644 });
}

function hooksConfigEmpty(config: HooksConfig): boolean {
  return Object.keys(config).every((key) => key === "version");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function toEntries(value: unknown): unknown[] {
  return Array.isArray(value) ? [...value] : [];
}
