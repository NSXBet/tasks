import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const exists = async (path: string): Promise<boolean> => access(path).then(() => true, () => false);

/**
 * Directories to search for a workspace, nearest first.
 *
 * Workspace discovery walks upward, but an unbounded walk reaches `$HOME` and
 * beyond, so a stray `~/.tasks` or `~/.beads` silently captures every
 * repository on the machine. The walk therefore stops at the first enclosing
 * repository root (a directory containing `.git`), and never passes `$HOME`
 * even when no repository is found — a workspace above your home directory is
 * never the one you meant.
 */
export async function searchPath(from: string): Promise<readonly string[]> {
  const home = resolve(homedir());
  const visited: string[] = [];
  for (let path = resolve(from); ; path = dirname(path)) {
    visited.push(path);
    if (await exists(join(path, '.git'))) break;
    if (path === home || dirname(path) === path) break;
  }
  return visited;
}
