/**
 * Worktree lifecycle hooks (gw port) and post-creation package-manager setup.
 *
 * Hooks are plain shell strings run from inside the worktree path with `sh -c`.
 * Failures are surfaced to the caller as `{ ok: false, stderr }` and are always
 * non-fatal to the tk operation that fired them.
 */
import { access } from "node:fs/promises";
import { bunRunner, type ProcessRunner } from "./runner.js";

export interface HookOutcome {
  readonly ok: boolean;
  readonly stderr: string;
}

/** Runs one shell hook; empty/whitespace commands are a no-op success. */
export const runShellHook = async (command: string | undefined, cwd: string, runner: ProcessRunner = bunRunner): Promise<HookOutcome> => {
  if (command === undefined || command.trim() === "") return { ok: true, stderr: "" };
  const result = await runner.run(["sh", "-c", command], cwd);
  return { ok: result.code === 0, stderr: result.stderr };
};

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

const lockfiles: ReadonlyArray<readonly [string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];

/** Detects the package manager from lockfiles; null when none is present. */
export const detectPackageManager = async (cwd: string): Promise<PackageManager | null> => {
  for (const [file, pm] of lockfiles) {
    try {
      await access(`${cwd}/${file}`);
      return pm;
    } catch {
      continue;
    }
  }
  return null;
};

const installCommands: Record<PackageManager, readonly string[]> = {
  npm: ["npm", "install"],
  pnpm: ["pnpm", "install"],
  yarn: ["yarn", "install"],
  bun: ["bun", "install"],
};

export interface SetupOutcome {
  readonly ran: boolean;
  readonly ok: boolean;
  readonly stderr: string;
}

/**
 * Installs dependencies in a fresh worktree when the main worktree has a
 * lockfile and `pmSetup` is not disabled (default on). Never throws.
 */
export const runPackageManagerSetup = async (worktreePath: string, mainRoot: string, pmSetup = true, runner: ProcessRunner = bunRunner): Promise<SetupOutcome> => {
  if (!pmSetup) return { ran: false, ok: true, stderr: "" };
  const pm = await detectPackageManager(mainRoot);
  if (pm === null) return { ran: false, ok: true, stderr: "" };
  try {
    const result = await runner.run(installCommands[pm], worktreePath);
    return { ran: true, ok: result.code === 0, stderr: result.stderr };
  } catch (cause) {
    return { ran: true, ok: false, stderr: cause instanceof Error ? cause.message : String(cause) };
  }
};
