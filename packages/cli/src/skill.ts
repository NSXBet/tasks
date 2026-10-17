/**
 * `tk skill` — emit, locate, or install the tasks agent skill.
 *
 * The skill is the authoritative machine-facing workflow for this CLI: the
 * shipped SKILL.md documents the command surface, attachment/plan/evidence
 * semantics, and common remedies. `tk skill path` returns a stable filesystem
 * location (agents resolve it again after upgrades); `tk skill install`
 * copies the skill directory into a standard skills root — pick the agent
 * with `--tool` (default `agents`; also `claude`, `omp`, `pi`, `codex`) and
 * the scope with `--local`/`--global`. Each tool keeps its own root layout:
 * project `<repo>/<tool>/skills`, global `~/<tool>/skills` — except omp
 * (`<repo>/.omp/skills`, `~/.omp/agent/skills`) and pi
 * (`~/.pi/agent/skills`). Copies are real files and do not track `tk`
 * upgrades, so re-run the install after upgrading. Existing installs prompt
 * before replacement; non-interactive runs require `--force`.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { join, resolve } from "node:path";
import { booleanFlag, stringFlag, type ParsedArgs } from "./args.js";
import { dim, green } from "./presentation.js";

const SKILL_FILENAME = "SKILL.md";
/** Slug under the skills root; the install target. */
const SKILL_SLUG = "tasks";
/** Per-agent skills roots: project-local (relative to workspace root) and global (off HOME). */
const SKILL_TOOLS = {
  agents: { project: join(".agents", "skills"), global: join(".agents", "skills") },
  claude: { project: join(".claude", "skills"), global: join(".claude", "skills") },
  omp: { project: join(".omp", "skills"), global: join(".omp", "agent", "skills") },
  pi: { project: join(".pi", "skills"), global: join(".pi", "agent", "skills") },
  codex: { project: join(".codex", "skills"), global: join(".codex", "skills") },
} as const;
type SkillTool = keyof typeof SKILL_TOOLS;
const SKILL_TOOL_NAMES = Object.keys(SKILL_TOOLS) as readonly SkillTool[];

/** Explicit `--tool <name>` selects the agent whose root receives the copy; default agents. */
const chooseTool = (args: ParsedArgs): SkillTool => {
  const requested = stringFlag(args, "tool") ?? "agents";
  const tool = SKILL_TOOL_NAMES.find((name) => name === requested);
  if (tool === undefined) throw new Error(`unknown --tool '${requested}' (choose: ${SKILL_TOOL_NAMES.join(", ")})`);
  return tool;
};

/** Source tree: packages/cli/src → packages/cli/skills/tasks/SKILL.md. */
const skillCandidates = (moduleDir: string): readonly string[] => [
  resolve(moduleDir, "../skills/tasks", SKILL_FILENAME),
  resolve(moduleDir, "../../skills/tasks", SKILL_FILENAME),
];

const findSkillFile = (moduleDir: string): string => {
  for (const candidate of skillCandidates(moduleDir)) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`tasks skill not found (looked in: ${skillCandidates(moduleDir).join(", ")})`);
};

export interface SkillResult {
  /** Path of the installed skill file. */
  readonly path: string;
  /** Full SKILL.md content. */
  readonly skill: string;
  /** Human-mode default printout: content, unless `path`/`install` subcommand. */
  readonly text: string;
  /** Install only: where the skill was installed. */
  readonly target?: string;
  /** Install only: which skills root received the copy. */
  readonly scope?: "local" | "global" | undefined;
}

/** One interactive prompt; resolves to "" when stdin is not a TTY so agents never hang. */
const ask = async (question: string): Promise<string> => {
  if (process.stdin.isTTY !== true) return "";
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await readline.question(question)).trim(); } finally { readline.close(); }
};

/**
 * Destination scope: explicit `--global`/`--local` win; otherwise interactive
 * runs offer the choice with the project dir as the default, and
 * non-interactive runs default to the existing project dir, then the existing
 * global dir, else the project dir.
 */
const chooseScope = async (args: ParsedArgs, root: string, tool: SkillTool): Promise<"local" | "global"> => {
  const wantsGlobal = booleanFlag(args, "global");
  const wantsLocal = booleanFlag(args, "local");
  if (wantsGlobal && wantsLocal) throw new Error("skill install accepts either --global or --local, not both");
  if (wantsGlobal) return "global";
  if (wantsLocal) return "local";
  if (process.stdin.isTTY === true) {
    const answer = await ask(`Install the tasks skill to:\n  1. project (${join(root, SKILL_TOOLS[tool].project)})\n  2. global (${join(homedir(), SKILL_TOOLS[tool].global)})\nChoice [1]: `);
    if (answer === "" || answer === "1") return "local";
    if (answer === "2") return "global";
    throw new Error(`unrecognized choice: ${answer} (pick 1 or 2)`);
  }
  if (existsSync(join(root, SKILL_TOOLS[tool].project))) return "local";
  if (existsSync(join(homedir(), SKILL_TOOLS[tool].global))) return "global";
  return "local";
};

const installSkill = async (args: ParsedArgs, skillFile: string, root: string): Promise<SkillResult> => {
  // Escape hatch: `--install <dir>` installs into an arbitrary skills directory
  // (e.g. ~/.pi/agent/skills); the `install` subcommand uses the standard
  // skills.sh roots.
  const explicit = stringFlag(args, "install");
  const tool = chooseTool(args);
  const scope = explicit === undefined ? await chooseScope(args, root, tool) : undefined;
  const base = explicit !== undefined ? resolve(explicit) : scope === "global" ? join(homedir(), SKILL_TOOLS[tool].global) : join(root, SKILL_TOOLS[tool].project);
  const target = join(base, SKILL_SLUG);
  const skillDir = resolve(skillFile, "..");
  const other = scope === undefined ? undefined : scope === "local" ? "global" : "local";
  const hint = other === undefined ? "" : ` (or --${other} for the other scope)`;
  if (existsSync(target)) {
    if (booleanFlag(args, "force")) {
      // Replace below; --force also skips the prompt on an existing install.
    } else if (process.stdin.isTTY === true) {
      const answer = await ask(`tasks already exists at ${target}\nOverwrite? [y/N] `);
      if (answer !== "y" && answer !== "yes") {
        return { path: skillFile, skill: "", text: `kept existing install at ${target} (re-run with --force to replace${hint})` };
      }
    } else {
      throw new Error(`tasks already exists at ${target}; re-run with --force to replace it${hint}`);
    }
  }
  await mkdir(base, { recursive: true });
  await rm(target, { force: true, recursive: true });
  await cp(skillDir, target, { recursive: true });
  return {
    path: skillFile,
    skill: "",
    target,
    scope,
    text: `${green("✓ Installed")} ${skillDir} → ${target} ${dim(`(${tool === "agents" ? "" : `${tool} `}${scope ?? "custom dir"}; re-run the install after upgrading tk)`)}`,
  };
};

export const runSkill = async (args: ParsedArgs, moduleDir: string, root: string | null): Promise<SkillResult> => {
  const skillPath = findSkillFile(moduleDir);
  if (args.positionals[1] === "install" || stringFlag(args, "install") !== undefined) return installSkill(args, skillPath, root ?? process.cwd());
  if (args.positionals[1] === "path") return { path: skillPath, skill: "", text: skillPath };
  const skill = readFileSync(skillPath, "utf8");
  return { path: skillPath, skill, text: skill };
};
