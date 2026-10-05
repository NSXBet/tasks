/**
 * `tk skill` — emit, locate, or install the tasks agent skill.
 *
 * The skill is the authoritative machine-facing workflow for this CLI: the
 * shipped SKILL.md documents the command surface, attachment/plan/evidence
 * semantics, and common remedies. `tk skill path` returns a stable filesystem
 * location (agents resolve it again after upgrades); `tk skill install`
 * symlinks the skill directory into the standard skills root —
 * `.agents/skills` at the workspace root (default) or `~/.agents/skills`
 * (`--global`), the same convention skills.sh-style agents use. Existing
 * installs prompt before replacement; non-interactive runs require `--force`.
 */
import { mkdir, rm, symlink } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { join, resolve } from "node:path";
import { booleanFlag, stringFlag, type ParsedArgs } from "./args.js";
import { dim, green } from "./presentation.js";

const SKILL_FILENAME = "SKILL.md";
/** Slug under the skills root; the symlink target. */
const SKILL_SLUG = "tasks";
/** skills.sh-style skills roots: project-local (relative to workspace root) and global. */
const LOCAL_SKILLS_ROOT = join(".agents", "skills");
const GLOBAL_SKILLS_ROOT = () => join(homedir(), ".agents", "skills");

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
  /** Install only: where the skill symlink was written. */
  readonly target?: string;
  /** Install only: which skills root received the symlink. */
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
const chooseScope = async (args: ParsedArgs, root: string): Promise<"local" | "global"> => {
  const wantsGlobal = booleanFlag(args, "global");
  const wantsLocal = booleanFlag(args, "local");
  if (wantsGlobal && wantsLocal) throw new Error("skill install accepts either --global or --local, not both");
  if (wantsGlobal) return "global";
  if (wantsLocal) return "local";
  if (process.stdin.isTTY === true) {
    const answer = await ask(`Install the tasks skill to:\n  1. project (${join(root, LOCAL_SKILLS_ROOT)})\n  2. global (${join(homedir(), LOCAL_SKILLS_ROOT)})\nChoice [1]: `);
    if (answer === "" || answer === "1") return "local";
    if (answer === "2") return "global";
    throw new Error(`unrecognized choice: ${answer} (pick 1 or 2)`);
  }
  if (existsSync(join(root, LOCAL_SKILLS_ROOT))) return "local";
  if (existsSync(join(homedir(), LOCAL_SKILLS_ROOT))) return "global";
  return "local";
};

const installSkill = async (args: ParsedArgs, skillFile: string, root: string): Promise<SkillResult> => {
  // Escape hatch: `--install <dir>` links into an arbitrary skills directory
  // (e.g. ~/.pi/agent/skills); the `install` subcommand uses the standard
  // skills.sh roots.
  const explicit = stringFlag(args, "install");
  const scope = explicit === undefined ? await chooseScope(args, root) : undefined;
  const base = explicit !== undefined ? resolve(explicit) : scope === "global" ? GLOBAL_SKILLS_ROOT() : join(root, LOCAL_SKILLS_ROOT);
  const target = join(base, SKILL_SLUG);
  const skillDir = resolve(skillFile, "..");
  const other = scope === undefined ? undefined : scope === "local" ? "global" : "local";
  const hint = other === undefined ? "" : ` (or --${other} for the other scope)`;
  if (existsSync(target)) {
    if (booleanFlag(args, "force")) {
      // Replace below; --force also covers non-symlink installs (e.g. a vendored copy).
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
  await symlink(skillDir, target);
  return {
    path: skillFile,
    skill: "",
    target,
    scope,
    text: `${green("✓ Linked")} ${skillDir} → ${target} ${dim(`(${scope ?? "custom dir"}; symlink tracks upgrades)`)}`,
  };
};

export const runSkill = async (args: ParsedArgs, moduleDir: string, root: string | null): Promise<SkillResult> => {
  const skillPath = findSkillFile(moduleDir);
  if (args.positionals[1] === "install" || stringFlag(args, "install") !== undefined) return installSkill(args, skillPath, root ?? process.cwd());
  if (args.positionals[1] === "path") return { path: skillPath, skill: "", text: skillPath };
  const skill = readFileSync(skillPath, "utf8");
  return { path: skillPath, skill, text: skill };
};
