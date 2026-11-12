/**
 * Headless review smoke (D-07): opens a diff of any repo from plain node, no
 * TTY. All git goes through @tasks/git (`gitDiffPatch` and friends) — this
 * script never spawns anything itself (D-04); the review component only
 * turns the tk-derived patch into its diff model.
 *
 *   headless-smoke <repo> [--base <rev>] [--head <rev>]
 *
 * Head defaults to the working tree (uncommitted work counts). Base defaults
 * to the merge-base of head (or HEAD) with the default branch — the TUI review
 * source rule — falling back to HEAD. Prints one JSON line:
 * `{ repoRoot, base, head, files: [{ path, additions, deletions }], additions, deletions }`.
 * Never reads stdin.
 */
import { gitDefaultBranch, gitDiffPatch, gitMergeBase, gitToplevel } from "@tasks/git";
import { changesetFromPatch } from "../src/headless";

const fail = (message: string, code: number): never => {
  process.stderr.write(`headless-smoke: ${message}\n`);
  process.exit(code);
};

const argv = process.argv.slice(2);
let repo: string | null = null;
let baseArg: string | null = null;
let headArg: string | null = null;
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index]!;
  if (arg === "--base" || arg === "--head") {
    const value = argv[index + 1];
    if (value === undefined) fail(`${arg} needs a value`, 2);
    if (arg === "--base") baseArg = value!;
    else headArg = value!;
    index += 1;
  } else if (repo === null) {
    repo = arg;
  } else {
    fail(`unexpected argument: ${arg}`, 2);
  }
}
if (repo === null) fail("usage: headless-smoke <repo> [--base <rev>] [--head <rev>]", 2);

const repoRoot = await gitToplevel(repo!);
if (repoRoot === null) fail(`not a git repository: ${repo}`, 2);
const root = repoRoot!;

const head = headArg;
let base = baseArg;
if (base === null) {
  const defaultBranch = await gitDefaultBranch(root);
  const mergeBase = defaultBranch === null ? null : await gitMergeBase(root, head ?? "HEAD", defaultBranch);
  base = mergeBase ?? "HEAD";
}

const patch = await gitDiffPatch(root, base, head);
if (patch === null) fail(`git diff failed for ${head === null ? base : `${base}...${head}`}`, 1);

const changeset = changesetFromPatch(patch!, "headless-smoke", head ?? "working tree", null);
const files = changeset.files.map((file) => ({ path: file.path, additions: file.stats.additions, deletions: file.stats.deletions }));
const additions = files.reduce((sum, file) => sum + file.additions, 0);
const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
process.stdout.write(`${JSON.stringify({ repoRoot: root, base, head, files, additions, deletions })}\n`);
