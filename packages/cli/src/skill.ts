/**
 * `tk skill` — emit the tasks agent skill, hunk-style.
 *
 * The skill is the authoritative machine-facing workflow for this CLI: the
 * shipped SKILL.md documents the command surface, attachment/plan semantics,
 * and common remedies. `tk skill path` returns a stable filesystem location
 * (agents resolve it again after upgrades); `tk skill --install <dir>`
 * symlinks it into an agent skills directory.
 */
import { symlink, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stringFlag, type ParsedArgs } from "./args.js";
import { green } from "./presentation.js";

const SKILL_FILENAME = "SKILL.md";

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
  /** Human-mode default printout: content, unless `path` subcommand. */
  readonly text: string;
}

export const runSkill = async (args: ParsedArgs, moduleDir: string): Promise<SkillResult> => {
  const skillPath = findSkillFile(moduleDir);
  const installDir = stringFlag(args, "install");
  if (installDir !== undefined) {
    const target = join(resolve(installDir), "tasks");
    await mkdir(resolve(installDir), { recursive: true });
    await symlink(skillPath, target);
    return { path: skillPath, skill: "", text: `${green("✓ Linked")} ${skillPath} → ${target}` };
  }
  if (args.positionals[1] === "path") return { path: skillPath, skill: "", text: skillPath };
  const skill = readFileSync(skillPath, "utf8");
  return { path: skillPath, skill, text: skill };
};
