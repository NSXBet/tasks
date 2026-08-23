import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { searchPath } from './search-path.js';

/**
 * Where beads issue data actually lives.
 *
 * Beads 1.x keeps issues in an embedded Dolt database under
 * `.beads/embeddeddolt/`; `.beads/issues.jsonl` is only a passive export that
 * is empty unless `export.auto` is enabled. Reading the JSONL alone silently
 * migrates zero issues, so `bd export` is the only trustworthy source.
 */
export type BeadsSourceKind = 'cli' | 'jsonl';
export interface BeadsSource { readonly kind: BeadsSourceKind; readonly directory: string; readonly path?: string }
export interface BeadsWorkspace {
  readonly directory: string;
  /** True when an embedded Dolt database is present — CLI export is mandatory. */
  readonly dolt: boolean;
  readonly jsonl: string | null;
}

const exists = async (path: string): Promise<boolean> => access(path).then(() => true, () => false);

/** Locate the nearest `.beads/` directory within the enclosing project. */
export async function findBeadsWorkspace(from: string): Promise<BeadsWorkspace | null> {
  for (const root of await searchPath(from)) {
    const directory = join(root, '.beads');
    if (!(await exists(directory))) continue;
    const jsonlPath = join(directory, 'issues.jsonl');
    return { directory, dolt: await exists(join(directory, 'embeddeddolt')), jsonl: (await exists(jsonlPath)) ? jsonlPath : null };
  }
  return null;
}

/**
 * Infer the issue prefix from migrated issue IDs.
 *
 * `issue-prefix` in `.beads/config.yaml` is commented out by default, so the
 * IDs themselves are the only reliable evidence. Adopting the prefix matters:
 * a workspace that imported `tasks-2ou` but numbers new issues `tk-1` has two
 * competing ID spaces.
 */
export function inferPrefix(ids: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const separator = id.lastIndexOf('-');
    if (separator <= 0) continue;
    const prefix = id.slice(0, separator);
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  let winner: string | null = null;
  let best = 0;
  for (const [prefix, count] of counts) if (count > best) { winner = prefix; best = count; }
  return winner;
}

/** Non-empty JSONL is usable; otherwise the CLI must produce the export. */
export async function readJsonlSource(workspace: BeadsWorkspace): Promise<string | null> {
  if (workspace.jsonl === null) return null;
  const text = await readFile(workspace.jsonl, 'utf8');
  return text.trim() === '' ? null : text;
}
