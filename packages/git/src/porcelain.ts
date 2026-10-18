/** Parsing of git's machine-readable (`--porcelain`) output. Pure text in, entries out. */

export interface WorktreeEntry {
  readonly path: string;
  readonly branch: string | null;
  readonly bare: boolean;
  readonly locked: boolean;
}

export interface LogOnelineEntry {
  readonly sha: string;
  readonly subject: string;
}

/** Parses `git log --oneline` output; one record per line, subject split at the FIRST space and kept verbatim. */
export function parseLogOneline(text: string): readonly LogOnelineEntry[] {
  const entries: LogOnelineEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const sep = line.indexOf(" ");
    entries.push(sep === -1 ? { sha: line, subject: "" } : { sha: line.slice(0, sep), subject: line.slice(sep + 1) });
  }
  return entries;
}

export interface NumstatEntry {
  readonly additions: number;
  readonly deletions: number;
  readonly path: string;
}

/**
 * Parses `git diff --numstat` output; rows are `<additions>\t<deletions>\t<path>`.
 * A `-` column (binary files) parses as 0 for that column; the path column is
 * kept verbatim (including git's `a => b` rewrite spelling — nothing joins on it).
 *
 * PHASE 3 CONSTRAINT: without `-z`, git C-quotes paths containing non-ASCII or
 * special characters (`"\"303\244.txt"` style, quotes included). Tokens are kept
 * verbatim — display-only today; any Phase 3 consumer that joins or opens these
 * paths must switch the producing command to `-z` first.
 */
export function parseNumstat(text: string): readonly NumstatEntry[] {
  const entries: NumstatEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const first = line.indexOf("\t");
    if (first === -1) continue;
    const second = line.indexOf("\t", first + 1);
    if (second === -1) continue;
    const additions = line.slice(0, first);
    const deletions = line.slice(first + 1, second);
    entries.push({
      additions: additions === "-" ? 0 : Number.parseInt(additions, 10) || 0,
      deletions: deletions === "-" ? 0 : Number.parseInt(deletions, 10) || 0,
      path: line.slice(second + 1),
    });
  }
  return entries;
}

export interface NameStatusEntry {
  readonly status: string;
  readonly path: string;
}

/**
 * Parses `git diff --name-status` output; rows are `<code>\t<path>` or
 * `<code>\t<old>\t<new>` for R/C. `status` is the full code token verbatim
 * (`A`, `M`, `D`, `T`, `U`, `R100`, `C75`, …); `path` is the LAST token
 * (destination) for two-path forms. Paths are kept verbatim — see the PHASE 3
 * CONSTRAINT note on `parseNumstat` regarding git's C-quoted path spelling.
 */
export function parseNameStatus(text: string): readonly NameStatusEntry[] {
  const entries: NameStatusEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const tokens = line.split("\t");
    if (tokens.length < 2) continue;
    entries.push({ status: tokens[0]!, path: tokens[tokens.length - 1]! });
  }
  return entries;
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
