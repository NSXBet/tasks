/**
 * Live review session (D-02): watches the task's worktree tree and its branch
 * ref, and re-derives the tk patch through the vendored debounced watch
 * controller from `@tasks/review/watch`. Every git call goes through
 * @tasks/git; the review package itself never spawns git (D-04).
 */
import { dirname, join } from "node:path";
import { bunRunner, gitBranchHead, gitCommonDir, gitDiffPatch, type ProcessRunner } from "@tasks/git";
import { createWatchController, createWatchEventSource, type WatchPlan } from "@tasks/review/watch";
import type { ReviewSource } from "./source.js";

/**
 * Hybrid plan over the worktree tree (minus node_modules and .git), the
 * branch's loose ref file, and packed-refs in the common git dir.
 */
export const reviewWatchPlan = (source: ReviewSource, commonDir: string): WatchPlan => {
  const refFile = join(commonDir, "refs", "heads", ...(source.branch ?? "").split("/"));
  return {
    coverage: "hybrid",
    targets: [
      { kind: "directory-tree", directory: source.cwd, ignoredRoots: [join(source.cwd, "node_modules"), join(source.cwd, ".git")], sources: ["worktree"] },
      { kind: "directory-entries", directory: dirname(refFile), entries: [refFile], sources: ["vcs-metadata"] },
      { kind: "directory-entries", directory: commonDir, entries: [join(commonDir, "packed-refs")], sources: ["vcs-metadata"] },
    ],
  };
};

/** Branch head + hash of the same patch source.ts derives; a working-tree edit changes it too. */
export const reviewSignature = async (source: ReviewSource, runner: ProcessRunner = bunRunner): Promise<string> => {
  const head = source.branch === null ? null : await gitBranchHead(source.cwd, source.branch, runner);
  const patch = source.base === null ? "" : (await gitDiffPatch(source.cwd, source.base, null, {}, runner)) ?? "";
  return `${head ?? "-"}:${Bun.hash(patch).toString(16)}`;
};

export interface StartReviewWatchOptions {
  readonly source: ReviewSource;
  readonly runner?: ProcessRunner;
  readonly onChange: () => void | Promise<void>;
  readonly onError: (error: unknown) => void;
}

const noop = (): void => {};

/** What `startReviewWatch` started: its stop function and whether a controller actually runs. */
export interface ReviewWatchHandle {
  readonly stop: () => void;
  /** True only when a watch controller was created; drives the `watching worktree` line. */
  readonly watching: boolean;
}

const idle: ReviewWatchHandle = { stop: noop, watching: false };

/**
 * Starts the debounced watch for one resolved review source; resolves to a
 * handle with its stop function and `watching: true`. Errored, empty
 * (branchless), branch-null or base-null sources, and a missing git common
 * dir, get a no-op stop, `watching: false`, and no controller.
 */
export const startReviewWatch = async ({ source, runner = bunRunner, onChange, onError }: StartReviewWatchOptions): Promise<ReviewWatchHandle> => {
  if (source.error !== null || source.empty !== null || source.branch === null || source.base === null) return idle;
  const commonDir = await gitCommonDir(source.cwd, runner);
  if (commonDir === null) return idle;
  const plan = reviewWatchPlan(source, commonDir);
  const initialSignature = await reviewSignature(source, runner);
  const controller = createWatchController({
    initialSignature,
    getSignature: () => reviewSignature(source, runner),
    refresh: onChange,
    createEventSource: createWatchEventSource(plan),
    quietDelayMs: 250,
    maximumDelayMs: 1000,
    reportError: onError,
  });
  return { stop: () => controller.close(), watching: true };
};
