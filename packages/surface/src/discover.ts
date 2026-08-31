import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { searchPath } from '@tasks/beads';
import { gitCommonDir, mainWorktreeRoot } from './git.js';

/**
 * Workspace discovery, moved from the CLI (rootFrom): only `.tasks/` is a
 * tasks workspace; a `.beads/` directory is a migration source, not a root.
 * The upward walk stops at the first enclosing `.git`, which is exactly where
 * a linked worktree's own tree ends — it has no `.tasks/` of its own by
 * design. Fall back to the main worktree sharing this repo's `.git`, the same
 * discovery `git worktree` itself uses.
 */
export const rootFrom = async (from: string): Promise<string | null> => {
  for (const path of await searchPath(from)) {
    try { await access(join(path, '.tasks')); return path; } catch { /* keep searching */ }
  }
  const commonDir = await gitCommonDir(from);
  if (commonDir === null) return null;
  const mainRoot = mainWorktreeRoot(commonDir);
  try { await access(join(mainRoot, '.tasks')); return mainRoot; } catch { return null; }
};
