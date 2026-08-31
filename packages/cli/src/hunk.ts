import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Issue } from "@tasks/domain";

/** One parsed `hunk session comment list --json` entry. */
export interface HunkComment { readonly commentId: string; readonly filePath: string; readonly line?: number; readonly side?: string; readonly summary?: string; readonly author?: string; readonly createdAt?: string }

/** The issue → hunk argv plan. Returned instead of spawned under `--print`. */
export interface HunkPlan { readonly argv: readonly string[]; readonly cwd: string; readonly mode: "diff-branch" | "diff-worktree"; readonly agentContext: string }

/** Hunk's Git backend accepts one base revision, not an `a...b` range. */
export function planHunk(base: string | null, cwd: string, toplevel: string | null, extra: readonly string[], agentContext: string): HunkPlan {
  const argv = ["diff", ...(base === null ? [] : [base]), "--agent-context", agentContext, ...extra];
  return { argv: ["hunk", ...argv], cwd: toplevel ?? cwd, mode: base === null ? "diff-worktree" : "diff-branch", agentContext };
}

/** Agent-context sidecar: Hunk renders it next to the diff; no annotations yet. */
export async function writeAgentContext(issue: Pick<Issue, "id" | "title" | "description">, directory: string): Promise<string> {
  const path = join(directory, `${issue.id}-agent-context.json`);
  const summary = `${issue.id} — ${issue.title}${issue.description.trim() === "" ? "" : `\n\n${issue.description}`}`;
  await writeFile(path, `${JSON.stringify({ version: 1, summary, files: [] }, null, 2)}\n`);
  return path;
}

const isHunkComment = (value: unknown): value is HunkComment => typeof value === "object" && value !== null && typeof (value as HunkComment).commentId === "string" && typeof (value as HunkComment).filePath === "string";

/** Parse `hunk session comment list --json` output; unparseable output yields nothing. */
export function parseHunkComments(outputText: string): readonly HunkComment[] {
  let parsed: unknown;
  try { parsed = JSON.parse(outputText); } catch { return []; }
  const comments = (parsed as { comments?: unknown } | null)?.comments;
  return Array.isArray(comments) ? comments.filter(isHunkComment) : [];
}

/** Rendered task-comment body for one Hunk review note. */
export const formatHunkComment = (comment: HunkComment): string => {
  const where = comment.side === "old" ? `${comment.filePath}:${comment.line ?? "?"} (old)` : `${comment.filePath}:${comment.line ?? "?"}`;
  return `[hunk ${where}] ${comment.summary ?? "(no summary)"}`;
};

/** Dedupe key already-imported comments are stored under in issue metadata. */
export const hunkCommentMetaKey = "hunkComments";

export interface HunkSyncResult { readonly imported: readonly HunkComment[]; readonly skipped: number; readonly total: readonly HunkComment[] }

/** Which comments still need importing, given the ids already recorded in metadata. */
export function pendingHunkComments(all: readonly HunkComment[], knownIds: readonly string[]): HunkSyncResult {
  const known = new Set(knownIds);
  const pending = all.filter((comment) => !known.has(comment.commentId));
  return { imported: pending, skipped: all.length - pending.length, total: all };
}

/** Temp directory for the agent-context sidecar, so nothing lands in the repo. */
export const scratchDirectory = (): Promise<string> => mkdtemp(join(tmpdir(), "tk-hunk-"));
