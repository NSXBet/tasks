import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { HunkDiffView, HunkFileNav } from "@tasks/review/opentui";
import { ComposerRow } from "./composer.js";
import { useApp } from "./context.js";
import type { RouteEntry } from "./routes.js";
import { colors } from "../theme.js";
import { truncate } from "../format.js";
import type { ReviewThread } from "@tasks/review";

/**
 * The live diff review page: the vendored hunk component over the issue's
 * real branch diff, with comment threads anchored to hunks and persisted to
 * the task store. Replaces the phase-0 fixture diff; every number on screen
 * comes from git and the store.
 */

const keysLine = "c comment · r reply · e edit · x resolve · u unified · p split · ] [ file · j k hunk · esc back";

const fileGlyph = (isBinary: boolean): string => (isBinary ? "B" : "+");

const statsLine = (source: { additions: number; deletions: number; branch: string | null; base: string | null }): string =>
  `${source.branch ?? "(no branch)"} ← ${source.base ?? "(no base)"} · +${source.additions} −${source.deletions}`;

/** Threads belonging to the selected file, in stored order. */
const fileThreads = (threads: readonly ReviewThread[], filePath: string | null): readonly ReviewThread[] =>
  filePath === null ? [] : threads.filter((thread) => thread.filePath === filePath);

const ThreadList = ({ threads, sel }: { threads: readonly ReviewThread[]; sel: number }) => {
  if (threads.length === 0) {
    return <text fg={colors.dim} content="no threads — press c on a hunk to start one" />;
  }
  return (
    <box style={{ flexDirection: "column" }}>
      {threads.map((thread, index) => (
        <box key={thread.id} style={{ flexDirection: "column" }}>
          <text
            fg={index === sel ? colors.borderFocus : thread.resolved ? colors.green : colors.text}
            content={`${index === sel ? "▸" : " "} ${thread.resolved ? "✓ resolved" : "open"} ${truncate(thread.filePath, 28)}${thread.line !== undefined ? `:${thread.line}` : ""}`}
          />
          {thread.comments.map((comment) => (
            <text key={comment.id} fg={colors.text} content={`   ${comment.author}: ${truncate(comment.body, 46)}`} />
          ))}
        </box>
      ))}
    </box>
  );
};

/** The review workbench: nav + diff body + thread rail. */
export const Workbench = ({ compact }: { compact: boolean }) => {
  const { state, actions } = useApp();
  const review = state.review;
  const { width: termWidth } = useTerminalDimensions();
  if (review === null || review.source === null) {
    return (
      <box style={{ paddingLeft: 1, paddingTop: 1, flexDirection: "column" }}>
        <text fg={colors.dim} content={review?.loading ?? false ? "resolving review source…" : "no review open — open a task and press v, or tk://diff/<id>"} />
      </box>
    );
  }
  const { source } = review;
  if (source.error !== null) {
    return (
      <box style={{ paddingLeft: 1, paddingTop: 1, flexDirection: "column" }}>
        <text fg={colors.red} content={truncate(`review: ${source.error}`, Math.max(1, termWidth - 2))} />
      </box>
    );
  }
  const file = source.files[review.fileIndex] ?? null;
  const threads = fileThreads(review.threads, file?.id ?? null);
  return (
    <box style={{ flexDirection: "row", flexGrow: 1 }}>
      <HunkFileNav
        files={[...source.files]}
        selectedFileId={file?.id ?? undefined}
        width={compact ? Math.min(28, Math.floor(termWidth / 4)) : 34}
        onSelectFile={(fileId: string) => {
          const index = source.files.findIndex((candidate) => candidate.id === fileId);
          if (index >= 0) actions.setReviewFile(index);
        }}
      />
      <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1 }}>
        <text fg={colors.dim} content={statsLine({ additions: source.additions, deletions: source.deletions, branch: source.branch, base: source.base })} />
        <box style={{ flexGrow: 1 }}>
          {file === null ? (
            <text fg={colors.dim} content="no changed files" />
          ) : (
            <HunkDiffView
              diff={file}
              width={Math.max(20, termWidth - (compact ? 32 : 40))}
              layout={review.layout === "split" ? "split" : undefined}
              selectedHunkIndex={review.hunkIndex ?? undefined}
              highlight={true}
            />
          )}
        </box>
      </box>
      {!compact ? (
        <box style={{ width: "30%", flexDirection: "column", paddingLeft: 1 }}>
          <ThreadList threads={threads} sel={review.threadIndex} />
        </box>
      ) : null}
    </box>
  );
};

export const useReviewKeys = (compact: boolean): void => {
  const { state, actions } = useApp();
  useKeyboard((key) => {
    const review = state.review;
    if (review === null) return;
    const { source } = review;
    const file = source?.files[review.fileIndex] ?? null;
    const hunkCount = file?.metadata.hunks.length ?? 0;
    const threads = fileThreads(review.threads, file?.path ?? null);
    switch (key.sequence) {
      case "]": actions.setReviewFile(Math.min(source?.files.length ?? 1, review.fileIndex + 1)); break;
      case "[": actions.setReviewFile(Math.max(0, review.fileIndex - 1)); break;
      case "j":
        if (review.hunkIndex === null) actions.setReviewHunk(hunkCount > 0 ? 0 : null);
        else if (review.hunkIndex + 1 < hunkCount) actions.setReviewHunk(review.hunkIndex + 1);
        break;
      case "k":
        if (review.hunkIndex !== null) actions.setReviewHunk(review.hunkIndex === 0 ? null : review.hunkIndex - 1);
        break;
      case "u": actions.setReviewLayout("unified"); break;
      case "p": actions.setReviewLayout("split"); break;
      case "c": if (!compact) actions.openReviewComposer("comment"); break;
      case "r": if (!compact) actions.openReviewComposer("reply"); break;
      case "e": if (!compact) actions.openReviewComposer("edit"); break;
      case "x": if (!compact) void actions.toggleReviewResolved(); break;
      case "J": if (!compact) actions.setReviewThread(Math.min(threads.length - 1, review.threadIndex + 1)); break;
      case "K": if (!compact) actions.setReviewThread(Math.max(0, review.threadIndex - 1)); break;
      default: break;
    }
  });
};

/** The diff rendered as a full page view over the live review session. */
export const DiffView = () => {
  useReviewKeys(false);
  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <Workbench compact={false} />
      <ComposerRow placeholder={keysLine} />
    </box>
  );
};

/** The same review session rendered as a modal overlay (read-only body). */
export const DiffModal = () => {
  useReviewKeys(true);
  return (
    <box style={{ position: "absolute", top: 1, left: 1, right: 1, bottom: 1, backgroundColor: colors.bg, flexDirection: "column" }}>
      <Workbench compact={true} />
      <text fg={colors.dim} content="esc closes the modal · full review: tk://diff" />
    </box>
  );
};

/** Deep link `tk://diff` or `tk://diff/<id>` — the full diff review page. */
export const diffViewRoute: RouteEntry = { kind: "diff", path: ["diff", ":id?"], apply: (sink, params) => { sink.openReview(params["id"] ?? null); } };

/** Deep link `tk://diff-modal` — the diff overlay over the current view. */
export const diffModalRoute: RouteEntry = { kind: "diff-modal", path: ["diff-modal"], apply: (sink) => { sink.openDiffModal(); } };
