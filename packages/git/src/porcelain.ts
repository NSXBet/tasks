/** Parsing of git's machine-readable (`--porcelain`) output. Pure text in, entries out. */

export interface WorktreeEntry {
  readonly path: string;
  readonly branch: string | null;
  readonly bare: boolean;
  readonly locked: boolean;
}

/** Parses `git worktree list --porcelain`; the main worktree is always first. */
export function parseWorktreePorcelain(text: string): readonly WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let path: string | null = null;
  let branch: string | null = null;
  let bare = false;
  let locked = false;
  const flush = (): void => {
    if (path !== null) entries.push({ path, branch, bare, locked });
    path = null;
    branch = null;
    bare = false;
    locked = false;
  };
  for (const line of text.split("\n")) {
    if (line === "") { flush(); continue; }
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line.startsWith("branch ")) branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    else if (line === "bare") bare = true;
    else if (line.startsWith("locked")) locked = true;
  }
  flush();
  return entries;
}
