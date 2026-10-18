/**
 * The one place that decides where a new worktree lives.
 *
 * Pure, synchronous, zero I/O: it never writes, never checks existence —
 * races surface as git's own 'already exists' error at the caller
 * (`gitWorktreeAdd` via `tk worktree create`).
 *
 * Precedence, highest wins:
 *   1. per-task override (caller-supplied, e.g. an issue's `worktree_dir`) —
 *      used verbatim as the worktree path, relative paths resolved against
 *      the repo root.
 *   2. `worktree.dir` from `.tasks/config.json` (workspace-wide placement) —
 *      a directory pool: `{name}` expands per worktree, otherwise the name is
 *      appended; relative paths resolve against the repo root.
 *   3. sibling default: `<parent-of-repo-root>/<name>`.
 *
 * Names with spaces or path separators pass through unchanged — validating
 * them is the caller's responsibility.
 */
import { isAbsolute, join, resolve } from "node:path";

export interface WorktreeResolverInput {
  readonly repoRoot: string;
  readonly name: string;
  readonly dir?: string | null;
  readonly override?: string | null;
}

export interface WorktreeResolution {
  readonly path: string;
  readonly source: "override" | "config" | "default";
}

export function resolveWorktreePath(input: WorktreeResolverInput): WorktreeResolution {
  const source = input.override != null ? "override" : input.dir != null ? "config" : "default";
  if (source === "override") {
    const expanded = input.override!.replace(/\{name\}/g, input.name);
    const path = isAbsolute(expanded) ? resolve(expanded) : resolve(input.repoRoot, expanded);
    return { path, source };
  }
  if (source === "config") {
    const dir = input.dir!;
    const expanded = dir.includes("{name}") ? dir.replace(/\{name\}/g, input.name) : join(dir, input.name);
    const path = isAbsolute(expanded) ? resolve(expanded) : resolve(input.repoRoot, expanded);
    return { path, source };
  }
  return { path: resolve(join(input.repoRoot, "..", input.name)), source };
}
