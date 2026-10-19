/**
 * `tk onboard` — managed onboarding block for agent instruction files.
 *
 * Ported from beads (cmd/bd/setup/agents.go, internal/templates/agents/render.go,
 * cmd/bd/setup/utils.go) with the same contracts, tk names:
 *
 * - The managed section is the span between a `<!-- BEGIN TK INTEGRATION` and
 *   `<!-- END TK INTEGRATION -->` marker. Only that span is tk-owned: user
 *   content outside it survives install, update, and removal byte-for-byte,
 *   with no whitespace normalization — replacement consumes exactly one
 *   trailing newline after the END marker.
 * - The rendered begin marker is versioned and hashed:
 *   `<!-- BEGIN TK INTEGRATION v:1 hash:<8 hex> -->` where the hash is the
 *   first 8 hex chars of the sha256 of the body. `check` compares the parsed
 *   hash against the freshly rendered body hash (current vs stale); install
 *   into an already-current file is a byte-identical no-op. Legacy
 *   unversioned markers (`<!-- BEGIN TK INTEGRATION -->`) parse as stale and
 *   still splice correctly.
 * - The section body ships as a data file (templates/agents/tk-section.md)
 *   carrying the legacy markers, stripped at render time — the same file
 *   convention as beads' defaults/beads-section.md, including the CRLF
 *   normalization that prevents doubled markers on Windows checkouts
 *   (beads #3552).
 * - Writes are atomic (temp file in the target directory + rename) and refuse
 *   to write through a symlink (utils.go atomicWriteFile).
 */
import { access, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { stringFlag, type ParsedArgs } from "./args.js";
import { output } from "./presentation.js";

export const MARKER_VERSION = 1;
const beginPrefix = "<!-- BEGIN TK INTEGRATION";
const legacyBeginMarker = "<!-- BEGIN TK INTEGRATION -->";
const endMarker = "<!-- END TK INTEGRATION -->";

/** Instruction files per tool, mirroring beads' per-tool integrations (claude.go → CLAUDE.md, gemini.go → GEMINI.md, the rest → AGENTS.md). */
const TOOL_FILES: Readonly<Record<string, string>> = {
  agents: "AGENTS.md",
  claude: "CLAUDE.md",
  gemini: "GEMINI.md",
  codex: "AGENTS.md",
  cursor: "AGENTS.md",
  pi: "AGENTS.md",
};
const TOOL_NAMES = Object.keys(TOOL_FILES).join(", ");

/** Template lookup: src → ../templates/agents/, built tree one level deeper (mirrors skill.ts skillCandidates). */
const templateCandidates = (moduleDir: string): readonly string[] => [
  resolve(moduleDir, "../templates/agents/tk-section.md"),
  resolve(moduleDir, "../../templates/agents/tk-section.md"),
];

const findTemplate = async (moduleDir: string): Promise<string> => {
  for (const candidate of templateCandidates(moduleDir)) {
    if (await access(candidate).then(() => true, () => false)) return candidate;
  }
  throw new Error(`tk-section.md template not found (looked in ${templateCandidates(moduleDir).join(", ")})`);
};

/**
 * Body of the managed section from the data file: CRLF normalized, trailing
 * newlines trimmed, legacy begin/end markers stripped (render.go
 * templateBodyWithOpts; the marker-in-file convention keeps the file readable
 * standalone and lets render strip Windows CRLFs before the hash).
 */
const templateBody = async (moduleDir: string): Promise<string> => {
  const raw = await readFile(await findTemplate(moduleDir), "utf8");
  const body = raw.replace(/\r\n/g, "\n").trimEnd();
  if (body.startsWith(legacyBeginMarker + "\n") && body.endsWith("\n" + endMarker)) {
    return body.slice(legacyBeginMarker.length + 1, -(endMarker.length + 1));
  }
  return body;
};

/** First 8 hex chars of the sha256 of the body (render.go computeHash). */
export const computeHash = (body: string): string => createHash("sha256").update(body).digest("hex").slice(0, 8);

/** The managed section wrapped in versioned, hash-stamped markers (render.go RenderSection). */
export const renderSection = (body: string): string =>
  `<!-- BEGIN TK INTEGRATION v:${MARKER_VERSION} hash:${computeHash(body)} -->\n${body}\n${endMarker}\n`;

export interface SectionMeta {
  readonly version: number;
  readonly hash: string;
}

/** Parses a BEGIN marker line; the legacy unversioned marker parses as {version: 0, hash: ""} (render.go ParseMarker). */
export const parseMarker = (line: string): SectionMeta | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith(beginPrefix)) return null;
  const inner = trimmed
    .slice(beginPrefix.length)
    .trimEnd()
    .replace(/-->$/, "")
    .trim();
  if (inner === "") return { version: 0, hash: "" };
  const meta = { version: 0, hash: "" };
  for (const part of inner.split(/\s+/)) {
    const cut = part.indexOf(":");
    if (cut === -1) continue;
    const key = part.slice(0, cut);
    const value = part.slice(cut + 1);
    if (key === "v" && /^\d+$/.test(value)) meta.version = Number(value);
    else if (key === "hash") meta.hash = value;
  }
  return meta;
};

export type ReplaceResult =
  | { readonly outcome: "no-section" }
  | { readonly outcome: "malformed"; readonly message: string }
  | { readonly outcome: "current"; readonly content: string }
  | { readonly outcome: "replaced"; readonly content: string };

/**
 * Splices a freshly rendered section over an existing one. No BEGIN →
 * "no-section" (caller appends); END missing or before BEGIN → "malformed"
 * with the offending offsets; hash already current → unchanged content;
 * otherwise the section span is replaced, consuming exactly one trailing
 * newline after the END marker and leaving all surrounding bytes untouched
 * (render.go ReplaceSectionWithOpts).
 */
export const replaceSection = (content: string, currentHash: string, rendered: string): ReplaceResult => {
  const beginIdx = content.indexOf(beginPrefix);
  if (beginIdx === -1) return { outcome: "no-section" };
  const endIdx = content.indexOf(endMarker);
  if (endIdx === -1) {
    return { outcome: "malformed", message: `BEGIN marker at offset ${beginIdx} but no END marker` };
  }
  if (endIdx < beginIdx) {
    return { outcome: "malformed", message: `END marker at offset ${endIdx} before BEGIN at ${beginIdx}` };
  }
  const firstLineEnd = content.indexOf("\n", beginIdx);
  const firstLine = firstLineEnd === -1 ? content.slice(beginIdx) : content.slice(beginIdx, firstLineEnd);
  const meta = parseMarker(firstLine);
  if (meta !== null && meta.hash === currentHash) return { outcome: "current", content };
  let endOfEndMarker = endIdx + endMarker.length;
  if (content[endOfEndMarker] === "\n") endOfEndMarker += 1;
  return { outcome: "replaced", content: content.slice(0, beginIdx) + rendered + content.slice(endOfEndMarker) };
};

/** Removes the managed section (BEGIN prefix through END marker plus one trailing newline); surrounding content untouched. */
export const removeSection = (content: string): readonly [string, boolean] => {
  const beginIdx = content.indexOf(beginPrefix);
  if (beginIdx === -1) return [content, false];
  const endIdx = content.indexOf(endMarker, beginIdx);
  if (endIdx === -1) return [content, false];
  let endOfEndMarker = endIdx + endMarker.length;
  if (content[endOfEndMarker] === "\n") endOfEndMarker += 1;
  return [content.slice(0, beginIdx) + content.slice(endOfEndMarker), true];
};

/** Atomic write: temp file in the target directory + rename (utils.go atomicWriteFile). */
const atomicWrite = async (file: string, data: string): Promise<void> => {
  const tmp = join(dirname(file), `.tk-onboard-${process.pid}-${Date.now()}.tmp`);
  await writeFile(tmp, data, { mode: 0o644 });
  await rename(tmp, file);
};

/** Target file: `--file <path>` wins (any path); else `--tool <name>` (per-tool file mapping); else AGENTS.md. */
const targetFile = (args: ParsedArgs, start: string): string => {
  const explicit = stringFlag(args, "file");
  if (explicit !== undefined) return isAbsolute(explicit) ? explicit : resolve(start, explicit);
  const tool = stringFlag(args, "tool");
  if (tool !== undefined) {
    const name = TOOL_FILES[tool];
    if (name === undefined) throw new Error(`unknown --tool: ${tool} (expected ${TOOL_NAMES})`);
    return join(start, name);
  }
  return join(start, "AGENTS.md");
};

const readOptional = async (file: string): Promise<string | null> => readFile(file, "utf8").then(
  (content) => content,
  () => null,
);

export type InstallAction = "created" | "added" | "updated" | "skipped-symlink";

const installOnboard = async (args: ParsedArgs, start: string, moduleDir: string): Promise<{ file: string; action: InstallAction }> => {
  const file = targetFile(args, start);
  const info = await lstat(file).catch(() => null);
  if (info !== null && info.isSymbolicLink()) {
    // utils.go atomicWriteFile refuses symlink writes; warn and leave the file alone.
    return { file, action: "skipped-symlink" };
  }
  const body = await templateBody(moduleDir);
  const currentHash = computeHash(body);
  const rendered = renderSection(body);
  const content = await readOptional(file);
  let next: string;
  let action: InstallAction;
  if (content === null || content === "") {
    // New-file scaffold, adapted from beads createNewAgentsFileWithOpts.
    next = `# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

${rendered}
## Build & Test

_Add your build and test commands here_

\`\`\`bash
# Example:
# npm install
# npm test
\`\`\`

## Architecture Overview

_Add a brief overview of your project architecture_

## Conventions & Patterns

_Add your project-specific conventions here_
`;
    action = "created";
  } else {
    const result = replaceSection(content, currentHash, rendered);
    if (result.outcome === "malformed") throw new Error(`malformed TK markers in ${basename(file)}: ${result.message}`);
    if (result.outcome === "no-section") {
      // beads appends with a blank-line join; the rendered section already ends in "\n".
      next = `${content}\n\n${rendered}`;
      action = "added";
    } else {
      next = result.outcome === "current" ? content : result.content;
      action = "updated";
    }
  }
  await mkdir(dirname(file), { recursive: true });
  await atomicWrite(file, next);
  return { file, action };
};

export type CheckState = "missing" | "no-section" | "stale" | "current";

const checkOnboard = async (args: ParsedArgs, start: string, moduleDir: string): Promise<{ file: string; state: CheckState }> => {
  const file = targetFile(args, start);
  const content = await readOptional(file);
  if (content === null) {
    process.exitCode = 1;
    return { file, state: "missing" };
  }
  if (!content.includes(beginPrefix)) {
    process.exitCode = 1;
    return { file, state: "no-section" };
  }
  const beginIdx = content.indexOf(beginPrefix);
  const firstLineEnd = content.indexOf("\n", beginIdx);
  const firstLine = firstLineEnd === -1 ? content.slice(beginIdx) : content.slice(beginIdx, firstLineEnd);
  const meta = parseMarker(firstLine);
  if (meta !== null && meta.hash === computeHash(await templateBody(moduleDir))) {
    return { file, state: "current" };
  }
  process.exitCode = 1;
  return { file, state: "stale" };
};

const removeOnboard = async (args: ParsedArgs, start: string): Promise<{ file: string; removed: boolean }> => {
  const file = targetFile(args, start);
  const content = await readOptional(file);
  if (content === null) return { file, removed: false };
  const [next, removed] = removeSection(content);
  if (!removed) return { file, removed: false };
  await atomicWrite(file, next);
  return { file, removed: true };
};

const describeInstall = ({ file, action }: { file: string; action: InstallAction }): string => {
  const agentsFile = basename(file);
  if (action === "created") return `✓ Created new ${agentsFile} with tk integration`;
  if (action === "added") return `✓ Added tk section to existing ${agentsFile}`;
  if (action === "skipped-symlink") return `⚠ ${file} is a symlink — refusing to write through it (remove the link or pass --file)`;
  return `✓ Updated existing tk section in ${agentsFile}`;
};

const describeCheck = ({ file, state }: { file: string; state: CheckState }): string => {
  const agentsFile = basename(file);
  if (state === "missing") return `✗ ${agentsFile} not found\n  Run: tk onboard install (to create)`;
  if (state === "no-section") return `⚠ ${agentsFile} exists but no tk section found\n  Run: tk onboard install (to add the section)`;
  if (state === "stale") return `⚠ tk section installed but stale: ${file}\n  Run: tk onboard install (to update)`;
  return `✓ tk section installed: ${file} (current)`;
};

const describeRemove = ({ file, removed }: { file: string; removed: boolean }): string => {
  if (removed) return `✓ Removed tk section from ${basename(file)}`;
  return `No tk section found in ${basename(file)}`;
};

/**
 * `tk onboard [install|check|remove]` — bare prints the section body.
 * `check` mirrors beads: missing/no-section/stale exit 1, current exits 0
 * (set via process.exitCode so JSON output still flows).
 */
export const runOnboard = async (args: ParsedArgs, start: string, json: boolean, moduleDir: string): Promise<void> => {
  const sub = args.positionals[1];
  if (sub === "install") {
    const result = await installOnboard(args, start, moduleDir);
    if (json) output(result, true);
    else console.log(describeInstall(result));
    return;
  }
  if (sub === "check") {
    const result = await checkOnboard(args, start, moduleDir);
    if (json) output(result, true);
    else console.log(describeCheck(result));
    return;
  }
  if (sub === "remove") {
    const result = await removeOnboard(args, start);
    if (json) output(result, true);
    else console.log(describeRemove(result));
    return;
  }
  if (sub !== undefined) throw new Error(`unknown onboard subcommand: ${sub} (expected install, check, remove)`);
  const body = await templateBody(moduleDir);
  if (json) output({ text: body }, true);
  else process.stdout.write(`${body}\n`);
};
