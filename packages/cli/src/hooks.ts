/**
 * Git hooks integration, ported from beads (`cmd/bd/hooks.go`).
 *
 * Hooks are installed as marked sections inside the target hook file: only the
 * content between `# --- BEGIN TK INTEGRATION` and `# --- END TK INTEGRATION`
 * markers is managed by tk; user content outside the markers survives installs,
 * upgrades, and uninstalls. The section shells out to `tk hooks run <name>`
 * with a best-effort soft deadline (GNU coreutils timeout, perl alarm fallback)
 * and maps tk's "no workspace" silent exit to success so git operations are
 * never blocked.
 */
import { access, lstat, mkdir, readFile, readdir, rename, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { cwd } from "node:process";
import { VERSION } from "./presentation.js";
import { gitCommonDir, gitToplevel, mainWorktreeRoot } from "./git.js";
/** Git hooks managed by tk; content is generated dynamically by generateHookSection(). */
export const managedHookNames: readonly string[] = ["pre-commit", "post-merge", "pre-push", "post-checkout", "prepare-commit-msg"];

const hookSectionBeginPrefix = "# --- BEGIN TK INTEGRATION";
const hookSectionEndPrefix = "# --- END TK INTEGRATION";
const hookVersionPrefix = "# tk-hooks-version: ";
const shimVersionPrefix = "# tk-shim ";
/** Inline one-liner hooks created by legacy `tk init` — wholly tk-owned. */
const inlineHookMarker = "# tk (tasks)";
/** Legacy beads inline marker; also wholly tracker-owned. */
const legacyInlineMarker = "# bd (beads)";
/** Soft deadline for a hook run; overridable per-hook via TK_HOOK_TIMEOUT. */
const HOOK_TIMEOUT_SECONDS = 300;

const exists = async (path: string): Promise<boolean> => access(path).then(() => true, () => false);
const hookSectionBeginLine = (): string => `${hookSectionBeginPrefix} v${VERSION} ---`;
const hookSectionEndLine = (): string => `${hookSectionEndPrefix} v${VERSION} ---`;

interface GitOutput { readonly ok: boolean; readonly stdout: string; readonly stderr: string }

/** Sync git plumbing inside hooks. `scrub` strips GIT_* hook env so git rediscovers the repo from cwd. */
const git = (args: readonly string[], options: { readonly cwd?: string; readonly scrub?: boolean } = {}): GitOutput => {
  const env = options.scrub === true ? scrubGitHookEnv(process.env) : { ...process.env };
  const result = spawnSync("git", args, { cwd: options.cwd, env, encoding: "utf8" });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

/**
 * Returns env minus the GIT_* variables that would poison git's repo/worktree
 * auto-discovery or index routing, so git falls back to discovery from cwd.
 * GIT_CONFIG is matched without "=" so the whole family is covered
 * (GIT_CONFIG_COUNT, GIT_CONFIG_KEY_n, GIT_CONFIG_PARAMETERS, ...).
 */
export function scrubGitHookEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const prefixes = ["GIT_DIR=", "GIT_WORK_TREE=", "GIT_INDEX_FILE=", "GIT_COMMON_DIR=", "GIT_PREFIX=", "GIT_OBJECT_DIRECTORY=", "GIT_ALTERNATE_OBJECT_DIRECTORIES=", "GIT_CEILING_DIRECTORIES=", "GIT_DISCOVERY_ACROSS_FILESYSTEM=", "GIT_CONFIG"];
  return Object.fromEntries(Object.entries(env).filter(([key]) => !prefixes.some((prefix) => key.startsWith(prefix))));
}

/** Root of the worktree whose hook we run in, from the inherited GIT_DIR; "" when unset/unresolvable. */
export function hookWorkTreeRoot(): string {
  const gitDir = process.env["GIT_DIR"];
  if (gitDir === undefined || gitDir === "") return "";
  let root = "";
  try {
    // In a linked worktree GIT_DIR points at main/.git/worktrees/<name>, whose
    // `gitdir` file holds the absolute path of the worktree's .git FILE.
    const dotGit = readFileSync(join(gitDir, "gitdir"), "utf8").trim();
    if (dotGit !== "") root = dirname(dotGit);
  } catch { /* not a linked worktree */ }
  if (root === "" && basename(gitDir) === ".git") root = dirname(gitDir);
  if (root === "") return "";
  return resolve(root);
}

/** Effective hooks directory git will use: core.hooksPath (tilde-expanded, root-relative) or <commonDir>/hooks. */
export async function gitHooksDir(cwd: string): Promise<string | null> {
  const config = git(["config", "--get", "core.hooksPath"], { cwd });
  let hooksPath = config.ok ? config.stdout.trim() : "";
  if (hooksPath !== "") {
    if (hooksPath === "~") hooksPath = homedir();
    else if (hooksPath.startsWith("~/") || hooksPath.startsWith("~\\")) hooksPath = join(homedir(), hooksPath.slice(2));
    if (isAbsolute(hooksPath)) return hooksPath;
    const root = await gitToplevel(cwd);
    return resolve(root ?? cwd, hooksPath);
  }
  const commonDir = await gitCommonDir(cwd);
  return commonDir === null ? null : join(commonDir, "hooks");
}

/**
 * The section shell: checks tk availability, applies a best-effort soft
 * deadline (GNU coreutils only — Windows timeout.exe is incompatible; perl
 * alarm fallback), and maps timeouts (124/142) and tk's no-workspace exit 3
 * to success so git operations are never blocked. User content after the
 * section still runs on success.
 */
export function generateHookSection(hookName: string): string {
  const t = String(HOOK_TIMEOUT_SECONDS);
  return `${hookSectionBeginLine()}
# This section is managed by tk. Do not remove these markers.
if command -v tk >/dev/null 2>&1; then
  export TK_GIT_HOOK=1
  _tk_timeout=\${TK_HOOK_TIMEOUT:-${t}}
  case "$_tk_timeout" in
    *[!0-9]*|'') _tk_timeout_invalid=1 ;;
    *[1-9]*) _tk_timeout_invalid=0 ;;
    *) _tk_timeout_invalid=1 ;;
  esac
  if [ "$_tk_timeout_invalid" -eq 1 ]; then
    echo >&2 "tk: invalid TK_HOOK_TIMEOUT; using ${t} seconds"
    _tk_timeout=${t}
  fi
  _tk_timeout_backend=none
  _tk_timeout_command=
  for _tk_timeout_candidate in timeout gtimeout; do
    if command -v "$_tk_timeout_candidate" >/dev/null 2>&1; then
      if _tk_timeout_version="$("$_tk_timeout_candidate" --version 2>/dev/null)"; then
        case "$_tk_timeout_version" in
          "timeout (GNU coreutils) "*) _tk_timeout_command=$_tk_timeout_candidate; break ;;
        esac
      fi
    fi
  done
  if [ -n "$_tk_timeout_command" ]; then
    _tk_timeout_backend=coreutils
    if "$_tk_timeout_command" -- "$_tk_timeout" tk hooks run ${hookName} "$@"; then
      _tk_exit=0
    else
      _tk_exit=$?
    fi
  elif command -v perl >/dev/null 2>&1; then
    _tk_timeout_backend=perl
    if perl -e 'alarm shift; exec @ARGV' -- "$_tk_timeout" tk hooks run ${hookName} "$@"; then
      _tk_exit=0
    else
      _tk_exit=$?
    fi
  else
    echo >&2 "tk: hook '${hookName}' running without timeout; install coreutils or perl to enable TK_HOOK_TIMEOUT"
    if tk hooks run ${hookName} "$@"; then
      _tk_exit=0
    else
      _tk_exit=$?
    fi
  fi
  if { [ "$_tk_timeout_backend" = coreutils ] && [ "$_tk_exit" -eq 124 ]; } || { [ "$_tk_timeout_backend" = perl ] && [ "$_tk_exit" -eq 142 ]; }; then
    echo >&2 "tk: hook '${hookName}' timed out after \${_tk_timeout}s — continuing without tk"
    _tk_exit=0
  fi
  if [ "$_tk_exit" -eq 3 ]; then
    echo >&2 "tk: database not initialized — skipping hook '${hookName}'"
    _tk_exit=0
  fi
  if [ "$_tk_exit" -ne 0 ]; then exit "$_tk_exit"; fi
fi
${hookSectionEndLine()}
`;
}

/**
 * Merges the tk section into existing hook content: replaces between markers
 * when present, cleans broken/orphaned markers first, injects above a
 * trailing `exec` chain (appending below `exec` would be unreachable), and
 * appends otherwise.
 */
export function injectHookSection(existing: string, section: string): string {
  return injectHookSectionWithDepth(existing, section, 0);
}
const maxInjectDepth = 5;

function injectHookSectionWithDepth(existing: string, section: string, depth: number): string {
  if (depth > maxInjectDepth) return `${existing.endsWith("\n") ? existing : `${existing}\n`}\n${section}`;
  const beginIdx = existing.indexOf(hookSectionBeginPrefix);
  const endIdx = existing.indexOf(hookSectionEndPrefix);
  if (beginIdx !== -1 && endIdx !== -1 && beginIdx < endIdx) {
    const lineStart = existing.lastIndexOf("\n", beginIdx) === -1 ? 0 : existing.lastIndexOf("\n", beginIdx) + 1;
    let endOfEndMarker = endIdx + hookSectionEndPrefix.length;
    const nl = existing.slice(endOfEndMarker).indexOf("\n");
    endOfEndMarker = nl === -1 ? existing.length : endOfEndMarker + nl + 1;
    return existing.slice(0, lineStart) + section + existing.slice(endOfEndMarker);
  } else if (beginIdx !== -1) {
    return injectHookSectionWithDepth(removeOrphanedBeginBlock(existing, beginIdx), section, depth + 1);
  } else if (endIdx !== -1) {
    return injectHookSectionWithDepth(removeMarkerLine(existing, endIdx, hookSectionEndPrefix), section, depth + 1);
  }
  // No markers: a file ending in a terminating `exec` chain would make an
  // appended section unreachable — inject above the exec block instead.
  const injectAt = findExecBlockInjectionPoint(existing);
  if (injectAt >= 0) return existing.slice(0, injectAt) + section + "\n" + existing.slice(injectAt);
  return `${existing.endsWith("\n") ? existing : `${existing}\n`}\n${section}`;
}

/**
 * Returns the offset where a section should be injected when the file ends in
 * a terminating `exec` chain (optionally inside an if/elif/else ladder whose
 * other branches only echo/exit): just above the enclosing control structure.
 * -1 means append at the bottom is safe. Line-based heuristic, not a parser —
 * same limitations as the beads original.
 */
export function findExecBlockInjectionPoint(content: string): number {
  const lines = content.replace(/\n$/, "").split("\n");
  let lastExecLine = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = lines[i]!.trim();
    if (isExecLine(trimmed)) { lastExecLine = i; break; }
    if (!isAllowedAfterExec(trimmed)) return -1;
  }
  if (lastExecLine === -1) return -1;
  let blockStartLine = lastExecLine;
  for (let i = lastExecLine - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("elif ") || trimmed === "else" || trimmed.startsWith("else ") || trimmed === "then") continue;
    if (line !== trimmed) continue; // indented body of an enclosing block
    if (trimmed.startsWith("if ")) blockStartLine = i;
    break;
  }
  return lines.slice(0, blockStartLine).reduce((offset, line) => offset + line.length + 1, 0);
}

const isExecLine = (trimmed: string): boolean => trimmed === "exec" || trimmed.startsWith("exec ") || trimmed.startsWith("exec\t");

/** Harmless filler below a terminating exec: closers, else branches, exits, comments, blanks. */
function isAllowedAfterExec(trimmed: string): boolean {
  if (trimmed === "" || trimmed.startsWith("#")) return true;
  if (["fi", "else", "done", "esac", "}", ";;"].includes(trimmed)) return true;
  if (trimmed.startsWith("elif ") || trimmed.startsWith("else ") || trimmed.startsWith("exit") || trimmed.startsWith("echo ")) return true;
  return false;
}

/** Removes an orphaned BEGIN block: from the BEGIN line to the next blank line, next BEGIN, or EOF. */
function removeOrphanedBeginBlock(content: string, beginIdx: number): string {
  const lineStart = content.lastIndexOf("\n", beginIdx) === -1 ? 0 : content.lastIndexOf("\n", beginIdx) + 1;
  const parts = content.slice(beginIdx).split(/(?<=\n)/);
  let scanned = beginIdx;
  let blockEnd = content.length;
  for (let i = 0; i < parts.length; i += 1) {
    const line = parts[i]!;
    if (i === 0) { scanned += line.length; continue; }
    const trimmed = line.trim();
    if (trimmed === "") { blockEnd = scanned + line.length; break; }
    if (line.includes(hookSectionBeginPrefix)) { blockEnd = scanned; break; }
    scanned += line.length;
  }
  return content.slice(0, lineStart) + content.slice(blockEnd);
}

function removeMarkerLine(content: string, markerIdx: number, markerPrefix: string): string {
  const lineStart = content.lastIndexOf("\n", markerIdx) === -1 ? 0 : content.lastIndexOf("\n", markerIdx) + 1;
  let lineEnd = markerIdx + markerPrefix.length;
  const nl = content.slice(lineEnd).indexOf("\n");
  lineEnd = nl === -1 ? content.length : lineEnd + nl + 1;
  return content.slice(0, lineStart) + content.slice(lineEnd);
}

/** Removes only the tk section; handles valid pairs, orphaned BEGIN/END, and reversed markers. */
export function removeHookSection(content: string): readonly [string, boolean] {
  const beginIdx = content.indexOf(hookSectionBeginPrefix);
  const endIdx = content.indexOf(hookSectionEndPrefix);
  if (beginIdx === -1 && endIdx === -1) return [content, false];
  if (beginIdx !== -1 && endIdx !== -1 && beginIdx < endIdx) {
    let lineStart = content.lastIndexOf("\n", beginIdx) === -1 ? 0 : content.lastIndexOf("\n", beginIdx) + 1;
    let endOfSection = endIdx + hookSectionEndPrefix.length;
    const nl = content.slice(endOfSection).indexOf("\n");
    endOfSection = nl === -1 ? content.length : endOfSection + nl + 1;
    if (lineStart >= 2 && content[lineStart - 1] === "\n" && content[lineStart - 2] === "\n") lineStart -= 1;
    return [content.slice(0, lineStart) + content.slice(endOfSection), true];
  }
  let result = content;
  if (beginIdx !== -1) result = removeOrphanedBeginBlock(result, result.indexOf(hookSectionBeginPrefix));
  if (endIdx !== -1) {
    const newEnd = result.indexOf(hookSectionEndPrefix);
    if (newEnd !== -1) result = removeMarkerLine(result, newEnd, hookSectionEndPrefix);
  }
  while (result.endsWith("\n\n\n")) result = result.slice(0, -1);
  return [result, true];
}

/** True when content is only blanks/comments (shebang included) — nothing user-owned. */
function isOnlyShebangOrEmpty(content: string): boolean {
  return content.split("\n").every((line) => { const trimmed = line.trim(); return trimmed === "" || trimmed.startsWith("#"); });
}

/**
 * Decides whether a pre-existing hook file should be preserved into a
 * relocated hooks directory (possibly stripped of the tk/beads section,
 * husky-sanitized) — or skipped as wholly tracker-owned.
 */
export function shouldPreserveHookContent(content: string, fromHusky: boolean): readonly [string, boolean] {
  if (content.includes(inlineHookMarker) || content.includes(legacyInlineMarker)) return ["", false];
  let result = content;
  if (result.includes(hookSectionBeginPrefix)) {
    const [stripped] = removeHookSection(result);
    if (isOnlyShebangOrEmpty(stripped)) return ["", false];
    result = stripped.replaceAll("\r\n", "\n");
  }
  if (fromHusky) result = sanitizeHuskyHook(result);
  return [result, true];
}

export interface HookStatus { readonly name: string; readonly installed: boolean; readonly version: string; readonly isShim: boolean; readonly outdated: boolean }

/** Status of each managed hook in the effective hooks directory. */
export async function checkGitHooks(cwd: string): Promise<readonly HookStatus[]> {
  const hooksDir = await gitHooksDir(cwd);
  return Promise.all(managedHookNames.map(async (name) => {
    const info = hooksDir === null ? null : await getHookVersion(join(hooksDir, name)).catch(() => null);
    if (info === null) return { name, installed: false, version: "", isShim: false, outdated: false };
    const outdated = !info.isShim && info.isTkHook && info.version !== VERSION;
    return { name, installed: true, version: info.version, isShim: info.isShim, outdated };
  }));
}

interface HookVersionInfo { readonly version: string; readonly isShim: boolean; readonly isTkHook: boolean }

/** Extracts version info from a hook file; section markers can appear anywhere. */
export async function getHookVersion(path: string): Promise<HookVersionInfo> {
  const content = await readFile(path, "utf8");
  for (const line of content.split("\n")) {
    if (line.startsWith(hookSectionBeginPrefix)) {
      const version = parseMarkerVersion(line, hookSectionBeginPrefix);
      return { version, isShim: true, isTkHook: true };
    }
    if (line.startsWith(shimVersionPrefix)) return { version: line.slice(shimVersionPrefix.length).trim(), isShim: true, isTkHook: true };
    if (line.startsWith(hookVersionPrefix)) return { version: line.slice(hookVersionPrefix.length).trim(), isShim: false, isTkHook: true };
  }
  if (content.includes(inlineHookMarker) || content.includes(legacyInlineMarker)) return { version: "", isShim: false, isTkHook: true };
  return { version: "", isShim: false, isTkHook: false };
}

function parseMarkerVersion(line: string, prefix: string): string {
  let after = line.slice(prefix.length).trim();
  if (after.startsWith("v")) after = after.slice(1);
  if (after.endsWith("---")) after = after.slice(0, -3);
  return after.trim();
}

/**
 * Refuses hook writes that would silently modify files tk does not own: a
 * symlinked hook path (WriteFile would rewrite the link target) or a git
 * tracked file (would dirty every clone). `allowTracked` exempts shared
 * installs (.tasks-hooks/ is deliberately committed).
 */
async function guardHookWritePath(hookPath: string, allowTracked: boolean): Promise<void> {
  let info;
  try { info = await lstat(hookPath); } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return; // creating a new file
    throw new Error(`failed to stat ${hookPath}`);
  }
  if (info.isSymbolicLink()) {
    let target = "unresolvable target";
    try { target = await realpath(hookPath); } catch { /* keep placeholder */ }
    throw new Error(`${hookPath} is a symlink to ${target}; writing would rewrite the link target, not the hook\nRemove the symlink (or leave that hook to its owner) and re-run`);
  }
  if (allowTracked) return;
  if (isGitTrackedFile(hookPath) && !(await isTkOwnedHookFile(hookPath))) {
    throw new Error(`${hookPath} is tracked by git and not a tk-managed hook; tk will not modify committed files it does not own\nUntrack it (git rm --cached) or move hooks to an untracked directory and re-run`);
  }
}

const isGitTrackedFile = (path: string): boolean => git(["ls-files", "--error-unmatch", "--", basename(path)], { cwd: dirname(path) }).ok;

/** True when the hook file is tk-managed: section markers or legacy shim/inline forms. */
async function isTkOwnedHookFile(path: string): Promise<boolean> {
  const content = await readFile(path, "utf8").catch(() => "");
  if (content.includes(hookSectionBeginPrefix)) return true;
  return getHookVersion(path).then((info) => info.isTkHook).catch(() => false);
}

export interface InstallOptions { readonly shared?: boolean; readonly tasks?: boolean }

/**
 * Installs the managed hooks into the selected directory: `.git/hooks` by
 * default, `<mainRoot>/.tasks-hooks` with --shared (committed, versioned), or
 * `<mainRoot>/.tasks/hooks` with --tasks. For the overridden paths, hooks from
 * the previously effective hooks directory are preserved first (husky
 * sanitized), core.hooksPath is set, and pre-existing foreign hooks are
 * backed up once as `<name>.backup` before injection.
 */
export async function installHooks(startDir: string, options: InstallOptions): Promise<{ readonly hooksDir: string }> {
  const mainRoot = await mainWorktreeRootOf(startDir);
  const hooksDir = options.tasks === true ? join(mainRoot ?? startDir, ".tasks", "hooks")
    : options.shared === true ? join(mainRoot ?? startDir, ".tasks-hooks")
    : await gitHooksDir(startDir) ?? fail("not a git repository");
  await mkdir(hooksDir, { recursive: true, mode: options.tasks === true ? 0o700 : 0o755 });
  if (options.tasks === true || options.shared === true) await preservePreexistingHooks(startDir, hooksDir, mainRoot);
  for (const hookName of managedHookNames) {
    const hookPath = join(hooksDir, hookName);
    if (options.shared !== true) await guardHookWritePath(hookPath, false);
    const section = generateHookSection(hookName);
    const existing = await readFile(hookPath, "utf8").catch(() => null);
    let newContent: string;
    if (existing === null) {
      newContent = `#!/usr/bin/env sh\n${section}`;
    } else if (existing.includes(hookSectionBeginPrefix)) {
      newContent = injectHookSection(existing, section);
    } else if (await isTkOwnedHookFile(hookPath)) {
      newContent = `#!/usr/bin/env sh\n${section}`; // legacy tk hook: replace wholesale
    } else {
      const backupPath = `${hookPath}.backup`;
      if (!(await exists(backupPath))) await writeFile(backupPath, existing, { mode: 0o755 });
      newContent = injectHookSection(existing, section);
    }
    await writeFile(hookPath, newContent.replaceAll("\r\n", "\n"), { mode: 0o755 });
  }
  if (options.tasks === true) await configureHooksPath(startDir, join(mainRoot ?? startDir, ".tasks", "hooks"));
  else if (options.shared === true) await configureHooksPath(startDir, join(mainRoot ?? startDir, ".tasks-hooks"));
  return { hooksDir };
}

function fail(message: string): never { throw new Error(message); }

// (guardHookWritePath throws on unsafe targets; no skip path exists.)

async function mainWorktreeRootOf(startDir: string): Promise<string | null> {
  const commonDir = await gitCommonDir(startDir);
  return commonDir === null ? null : resolve(mainWorktreeRoot(commonDir));
}

/**
 * Copies non-tracker hooks from the currently effective hooks directory into
 * the new target, so setting a local core.hooksPath never silently shadows a
 * global hooksPath or the default .git/hooks. Husky-sourced hooks are
 * sanitized (helper source lines dropped, node_modules/.bin added to PATH).
 */
async function preservePreexistingHooks(startDir: string, targetDir: string, mainRoot: string | null): Promise<void> {
  const currentDir = await gitHooksDir(startDir);
  if (currentDir === null || resolve(currentDir) === resolve(targetDir)) return;
  const managedRoots = [join(mainRoot ?? "", ".tasks", "hooks"), join(mainRoot ?? "", ".tasks-hooks"), join(mainRoot ?? "", ".beads", "hooks"), join(mainRoot ?? "", ".beads-hooks")];
  if (managedRoots.some((root) => root !== join("", "") && resolve(root) === resolve(currentDir))) return;
  const fromHusky = isHuskyDir(currentDir);
  for (const entry of await readdir(currentDir, { withFileTypes: true })) {
    if (entry.isDirectory() || entry.name.startsWith(".") || entry.name.endsWith(".sample")) continue;
    if (fromHusky && (entry.name === "h" || entry.name === "husky.sh")) continue;
    const content = await readFile(join(currentDir, entry.name), "utf8").catch(() => null);
    if (content === null) continue;
    const [preserved, keep] = shouldPreserveHookContent(content, fromHusky);
    if (!keep) continue;
    const dstPath = join(targetDir, entry.name);
    if (await exists(dstPath)) continue;
    await writeFile(dstPath, preserved, { mode: 0o755 }).then(
      () => console.log(`  Preserving existing ${entry.name} hook from ${currentDir}`),
      (cause: unknown) => console.error(`Warning: failed to preserve ${entry.name} hook from ${currentDir}: ${cause instanceof Error ? cause.message : cause}`),
    );
  }
  await fixHuskyHookLayout(currentDir, targetDir);
}

/**
 * Fixes two husky-specific issues after copying hooks out of a husky dir:
 * symlinks the `_/` helper dir (v8) and replaces copied v9 shims with the real
 * user hook content from the parent `.husky/` directory.
 */
async function fixHuskyHookLayout(sourceDir: string, targetDir: string): Promise<void> {
  const srcHelper = join(sourceDir, "_");
  if (await isDirectory(srcHelper)) {
    const tgtHelper = join(targetDir, "_");
    if (!(await exists(tgtHelper))) {
      await symlink(relative(targetDir, srcHelper), tgtHelper).catch((cause: unknown) => console.error(`Warning: failed to symlink husky helper directory: ${cause instanceof Error ? cause.message : cause}`));
    }
  }
  const hContent = await readFile(join(sourceDir, "h"), "utf8").catch(() => null);
  if (hContent === null || !hContent.includes(`dirname "$(dirname`)) return; // not husky v9
  const userHooksDir = dirname(sourceDir);
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    if (entry.isDirectory() || entry.name === "h") continue;
    const hookPath = join(targetDir, entry.name);
    if (!(await exists(hookPath))) continue;
    const userContent = await readFile(join(userHooksDir, entry.name), "utf8").catch(() => null);
    if (userContent === null) continue;
    const replacement = userContent.startsWith("#!") ? userContent : `#!/usr/bin/env sh\n${userContent}`;
    await writeFile(hookPath, replacement, { mode: 0o755 }).catch((cause: unknown) => console.error(`Warning: failed to replace husky v9 shim ${entry.name}: ${cause instanceof Error ? cause.message : cause}`));
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

/** Husky-managed hooks dir: `.husky` itself or `.husky/_` (v9 helper dir). */
function isHuskyDir(dir: string): boolean {
  if (dir === "") return false;
  const base = basename(dir);
  const parent = basename(dirname(dir));
  return base === ".husky" || (base === "_" && parent === ".husky");
}

/**
 * Rewrites a husky hook body to run standalone without `.husky/_/husky.sh`
 * (v8) or `.husky/_/h` (v9): drops the helper-source line and prepends
 * `node_modules/.bin` to PATH. Non-husky hooks return unchanged.
 */
export function sanitizeHuskyHook(content: string): string {
  const normalized = content.replaceAll("\r\n", "\n");
  const kept: string[] = [];
  let sourcedHelper = false;
  for (const line of normalized.split("\n")) {
    const trimmed = line.trim();
    if (isHuskyHelperSourceLine(trimmed)) { sourcedHelper = true; continue; }
    kept.push(line);
  }
  if (!sourcedHelper) return content;
  const pathLine = `export PATH="$PWD/node_modules/.bin:$PATH"`;
  const result: string[] = [];
  let injected = false;
  kept.forEach((line, i) => {
    result.push(line);
    if (!injected && i === 0 && line.trim().startsWith("#!")) {
      result.push("# Injected by tk: husky helper layout not mirrored into this dir.", pathLine);
      injected = true;
    }
  });
  if (!injected) result.unshift(pathLine);
  return result.join("\n");
}

/** Matches husky v8 (`_/husky.sh`) and v9 (`/h`) helper-source lines, tolerating quoting variants. */
function isHuskyHelperSourceLine(line: string): boolean {
  if (line === "" || (!line.startsWith(". ") && !line.startsWith("source "))) return false;
  if (line.includes("/_/husky.sh") || line.includes("\\_\\husky.sh")) return true;
  return line.includes("dirname") && (line.endsWith(`/h"`) || line.endsWith(`/h'`) || line.endsWith("/h"));
}

/** Sets local core.hooksPath to an absolute, symlink-resolved path — relative paths break in linked worktrees, and on macOS /tmp is a /private symlink. */
async function configureHooksPath(startDir: string, hooksDir: string): Promise<void> {
  const absolute = resolve(hooksDir);
  const canonical = await realpath(absolute).catch(() => absolute);
  const result = git(["config", "core.hooksPath", canonical], { cwd: startDir });
  if (!result.ok) throw new Error(`git config failed: ${result.stderr.trim()}`);
}

/** Removes the tk section (or whole legacy hook) from each managed hook; restores .backup sidecars. */
export async function uninstallHooks(startDir: string): Promise<void> {
  const hooksDir = await gitHooksDir(startDir);
  if (hooksDir === null) return;
  for (const hookName of managedHookNames) {
    const hookPath = join(hooksDir, hookName);
    const content = await readFile(hookPath, "utf8").catch(() => null);
    if (content === null) continue;
    const [newContent, found] = removeHookSection(content);
    if (found) {
      const remaining = newContent.trim();
      if (remaining === "" || remaining === "#!/usr/bin/env sh" || remaining === "#!/bin/sh") await rm(hookPath);
      else await writeFile(hookPath, newContent, { mode: 0o755 });
      continue;
    }
    if (await isTkOwnedHookFile(hookPath)) {
      await rm(hookPath);
      const backupPath = `${hookPath}.backup`;
      if (await exists(backupPath)) await rename(backupPath, hookPath).catch((cause: unknown) => console.error(`Warning: failed to restore backup for ${hookName}: ${cause instanceof Error ? cause.message : cause}`));
    }
    // Not a tk hook at all — leave it alone.
  }
  await resetHooksPathIfTkManaged(startDir);
}

/** Unsets core.hooksPath when it points at a tk-managed dir and clears tasks.role. */
async function resetHooksPathIfTkManaged(startDir: string): Promise<void> {
  const mainRoot = await mainWorktreeRootOf(startDir) ?? await gitToplevel(startDir);
  if (mainRoot === null) return;
  const config = git(["config", "--get", "core.hooksPath"], { cwd: mainRoot });
  if (config.ok) {
    const hooksPath = config.stdout.trim();
    if (isTkManagedHooksPath(mainRoot, hooksPath) && !git(["config", "--unset", "core.hooksPath"], { cwd: mainRoot }).ok) {
      throw new Error(`hook files removed, but failed to reset core.hooksPath: ${config.stderr.trim()}`);
    }
  }
  const role = git(["config", "--get", "tasks.role"], { cwd: mainRoot });
  if (role.ok && !git(["config", "--unset", "tasks.role"], { cwd: mainRoot }).ok) {
    throw new Error(`hook files removed, but failed to reset tasks.role: ${role.stderr.trim()}`);
  }
  // Legacy beads keys are cleared too — uninstall must not leave stale markers.
  const legacyRole = git(["config", "--get", "beads.role"], { cwd: mainRoot });
  if (legacyRole.ok) void git(["config", "--unset", "beads.role"], { cwd: mainRoot });
}

/** Matches tk/beads-managed hooks paths (relative or absolute) against the known directories. */
function isTkManagedHooksPath(mainRoot: string, hooksPath: string): boolean {
  if (hooksPath === "") return false;
  const candidates = [join(mainRoot, ".tasks", "hooks"), join(mainRoot, ".tasks-hooks"), join(mainRoot, ".beads", "hooks"), join(mainRoot, ".beads-hooks")];
  return candidates.some((candidate) => resolve(candidate) === resolve(hooksPath));
}

// =============================================================================
// Hook Implementation Functions (called by installed sections via 'tk hooks run')
// =============================================================================

/**
 * Runs the chained `.old` hook (the pre-tk hook content saved by the legacy
 * chain install), skipping tk-owned files to prevent infinite recursion.
 * Returns the child's exit code; 0 when there is nothing to chain.
 */
export function runChainedHook(hooksDir: string, hookName: string, args: readonly string[]): number {
  const oldHookPath = join(hooksDir, `${hookName}.old`);
  let info;
  try { info = statSync(oldHookPath); } catch { return 0; }
  if (!(info.mode & 0o111)) return 0; // not executable
  // Skip tk/beads-owned .old hooks — they would call us again (GH#843, GH#1120).
  let raw = "";
  try { raw = readFileSync(oldHookPath, "utf8"); } catch { return 0; }
  if (raw.includes(inlineHookMarker) || raw.includes(legacyInlineMarker) || raw.includes(hookSectionBeginPrefix) || raw.startsWith(shimVersionPrefix) || raw.startsWith(hookVersionPrefix)) return 0;
  const result = spawnSync(oldHookPath, args, { stdio: "inherit" });
  if (result.error !== undefined) {
    console.error(`Warning: chained hook ${hookName} failed: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

/** True when the search path from `from` reaches a `.tasks` workspace before leaving the repo. */
async function findTasksWorkspace(from: string): Promise<string | null> {
  const home = resolve(homedir());
  for (let path = resolve(from); ; path = dirname(path)) {
    if (await exists(join(path, ".tasks"))) return path;
    if (await exists(join(path, ".git"))) return null;
    if (path === home || dirname(path) === path) return null;
  }
}

interface HookWorkspace { readonly workspace: string; readonly tasksDir: string; readonly config: Record<string, unknown> }

/**
 * Resolves the `.tasks` workspace for hook operations (export/import), trying
 * the upward walk first, then the main worktree — mirroring tk.ts rootFrom.
 */
async function hookWorkspace(startDir: string): Promise<HookWorkspace | null> {
  const workspace = await findTasksWorkspace(startDir);
  if (workspace !== null) return workspaceOf(workspace);
  const commonDir = await gitCommonDir(startDir);
  if (commonDir === null) return null;
  const mainRoot = mainWorktreeRoot(commonDir);
  return await exists(join(mainRoot, ".tasks")) ? workspaceOf(mainRoot) : null;
}

async function workspaceOf(workspace: string): Promise<HookWorkspace> {
  const tasksDir = join(workspace, ".tasks");
  const raw = await readFile(join(tasksDir, "config.json"), "utf8").catch(() => "{}");
  const parsed: unknown = JSON.parse(raw);
  return { workspace, tasksDir, config: parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {} };
}

const configFlag = (config: Record<string, unknown>, key: string, fallback: boolean): boolean => {
  const value = config[key];
  return typeof value === "boolean" ? value : fallback;
};

/** The self-referencing command: this tk entrypoint, so hooks never need tk on PATH. */
function selfCommand(args: readonly string[]): readonly string[] {
  const self = process.argv[1];
  if (self !== undefined && existsSync(self)) return [process.execPath, self, ...args];
  return ["tk", ...args];
}

/** Runs a tk subprocess; returns combined stdout and success. */
function runTk(args: readonly string[], options: { readonly cwd?: string; readonly input?: string; readonly scrub?: boolean } = {}): { readonly ok: boolean; readonly stdout: string; readonly stderr: string } {
  const [command, ...rest] = selfCommand(args);
  const result = spawnSync(command!, rest, {
    cwd: options.cwd,
    env: options.scrub === true ? scrubGitHookEnv(process.env) : { ...process.env },
    encoding: "utf8",
    input: options.input,
  });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * Exports issue state to the tracked JSONL file on pre-commit when
 * `export.auto` is enabled: skips when the file is staged for deletion (the
 * user ran `git rm` — re-adding would revive it), skips when nothing under
 * `.tasks` is staged, shells out to `tk export`, and optionally stages the
 * file (`export.git-add`). Warnings never block the commit.
 */
async function exportJsonlForCommit(startDir: string): Promise<void> {
  const found = await hookWorkspace(startDir);
  if (found === null) return;
  if (!configFlag(found.config, "export.auto", false)) return;
  const exportPath = typeof found.config["export.path"] === "string" ? found.config["export.path"] : "issues.jsonl";
  const fullPath = join(found.tasksDir, exportPath);
  if (isExportFileStagedForDeletion(fullPath)) return;
  if (!hasStagedTasksFiles(startDir)) return;
  const result = runTk(["export"], { cwd: found.workspace, scrub: true });
  if (!result.ok) {
    console.error(`tk: pre-commit export warning: ${result.stderr.trim()}`);
    return;
  }
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, result.stdout, { mode: 0o644 });
  if (configFlag(found.config, "export.git-add", false) && !configFlag(found.config, "no-git-ops", false)) {
    const added = await gitAddFile(fullPath);
    if (!added.ok) console.error(`tk: pre-commit git add warning: ${added.stderr.trim()}`);
  }
}

/** True when the export file at fullPath is staged for deletion (user ran `git rm`). Keeps the env intact: GIT_INDEX_FILE points at the pending index. */
function isExportFileStagedForDeletion(fullPath: string): boolean {
  const result = git(["diff", "--cached", "--diff-filter=D", "--name-only", "--", basename(fullPath)], { cwd: dirname(fullPath) });
  return result.ok && result.stdout.trim() !== "";
}

/** True when any staged path lives under `.tasks/` (scrubbed env: hook env must not poison discovery). */
function hasStagedTasksFiles(startDir: string): boolean {
  const root = hookWorkTreeRoot() || startDir;
  const result = git(["diff", "--cached", "--name-only", "--", ".tasks"], { cwd: root, scrub: true });
  return result.ok && result.stdout.trim() !== "";
}

/**
 * Imports the tracked JSONL after merge / branch-switch checkout when
 * `import.auto` is enabled (default true). Upsert-only, so re-importing an
 * unchanged file is a no-op; failures warn but never block.
 */
async function importJsonlForSync(startDir: string, reason: string): Promise<void> {
  const found = await hookWorkspace(startDir);
  if (found === null) return;
  if (!configFlag(found.config, "import.auto", true)) return;
  const importPath = typeof found.config["import.path"] === "string" ? found.config["import.path"]
    : typeof found.config["export.path"] === "string" ? found.config["export.path"] : "issues.jsonl";
  const fullPath = join(found.tasksDir, importPath);
  const info = await stat(fullPath).catch(() => null);
  if (info === null || info.size === 0) return;
  const content = await readFile(fullPath, "utf8").catch(() => "");
  if (content.trim() === "") return;
  const result = runTk(["import"], { cwd: found.workspace, input: content, scrub: true });
  if (!result.ok) console.error(`tk: ${reason} import warning: ${result.stderr.trim()}`);
}

/**
 * Stages one file with GIT_* hook env scrubbed, silently skipping when the
 * target lies outside the hook's worktree (the shared-workspace redirect case)
 * or when the index is locked.
 */
async function gitAddFile(path: string): Promise<GitOutput> {
  const workTree = hookWorkTreeRoot();
  if (workTree !== "" && !(await pathInsideDir(path, workTree))) return { ok: true, stdout: "", stderr: "" };
  const env = scrubGitHookEnv(process.env);
  if (existsSync(join(dirname(path), ".git", "index.lock"))) return { ok: false, stdout: "", stderr: "git index is locked; skipping auto-stage" };
  const result = spawnSync("git", ["add", "--", basename(path)], { cwd: dirname(path), env, encoding: "utf8" });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Resolves symlinks on both sides (parent of path, dir) to answer containment robustly on macOS /tmp. */
async function pathInsideDir(path: string, dir: string): Promise<boolean> {
  let absPath = resolve(path);
  let absDir = resolve(dir);
  try { absPath = join(await realpath(dirname(absPath)), basename(absPath)); } catch { return false; }
  try { absDir = await realpath(absDir); } catch { return false; }
  return absPath === absDir || absPath.startsWith(`${absDir}/`);
}

/**
 * Dispatch for `tk hooks run <name> [args...]`: runs the chained .old hook
 * first, then the tk behavior (pre-commit auto-export, post-merge/checkout
 * import, prepare-commit-msg trailers). Returns the process exit code.
 */
export async function runHookCommand(hookName: string, hookArgs: readonly string[], startDir: string): Promise<number> {
  const hooksDir = await gitHooksDir(startDir);
  if (hooksDir !== null) { const chained = runChainedHook(hooksDir, hookName, hookArgs); if (chained !== 0) return chained; }
  switch (hookName) {
    case "pre-commit":
      await exportJsonlForCommit(startDir);
      return 0;
    case "post-merge":
      await importJsonlForSync(startDir, "post-merge");
      return 0;
    case "pre-push":
      return 0;
    case "post-checkout":
      if (hookArgs.length >= 3 && hookArgs[2] === "1") await importJsonlForSync(startDir, "post-checkout");
      return 0;
    case "prepare-commit-msg":
      return prepareCommitMsg(hookArgs);
    default:
      console.error(`unknown hook: ${hookName}`);
      return 1;
  }
}

/**
 * Appends the `Executed-By: <actor>` trailer from TK_ACTOR (or BD_ACTOR) to
 * the commit message unless present or this is a merge commit.
 */
function prepareCommitMsg(args: readonly string[]): number {
  if (args.length < 1) return 0;
  const msgFile = args[0]!;
  const source = args[1] ?? "";
  if (source === "merge") return 0;
  const actor = process.env["TK_ACTOR"] ?? process.env["BD_ACTOR"] ?? "";
  if (actor === "") return 0;
  let content: string;
  try { content = readFileSync(msgFile, "utf8"); } catch (cause) {
    console.error(`Warning: could not read commit message: ${cause instanceof Error ? cause.message : cause}`);
    return 0;
  }
  if (content.split("\n").some((line) => line.startsWith("Executed-By:"))) return 0;
  const message = `${content.replace(/[\n\r\t ]+$/, "")}\n\nExecuted-By: ${actor}\n`;
  try { writeFileSync(msgFile, message, { mode: 0o600 }); } catch (cause) {
    console.error(`Warning: could not write commit message: ${cause instanceof Error ? cause.message : cause}`);
  }
  return 0;
}
