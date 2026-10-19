import { useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import { ComposerRow } from "./composer.js";
import { useApp } from "./context.js";
import type { RouteEntry } from "./routes.js";
import { colors, priorityLabel, statusColor } from "../theme.js";
import { truncate } from "../format.js";

/**
 * The task→review page: the task record front and center (description,
 * status, ownership), with the live review rail on the right — branch/base,
 * changed files, and open threads for the issue. Pressing `v` hands over to
 * the full diff review; `ensureReview` keeps the review session warm so the
 * rail always shows real git data, not fixtures.
 */

const Meta = ({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) => (
  <text>
    <span fg={colors.dim}>{`${label} `}</span>
    <span fg={valueColor ?? colors.text}>{truncate(value, 22)}</span>
  </text>
);

export const TaskView = () => {
  const { state, actions } = useApp();
  const issue = state.board.issues.find((candidate) => candidate.id === state.detailId) ?? state.board.issues[0];
  const review = state.review !== null && state.review.issueId === issue?.id ? state.review : null;

  // Keep the review session warm for this task so the rail shows live data.
  useEffect(() => {
    if (issue !== undefined) actions.ensureReview(issue.id);
  }, [issue?.id, actions.ensureReview]);

  useKeyboard((key) => {
    switch (key.sequence) {
      case "v": actions.setView("diff"); break;
      case "V": actions.openDiffModal(); break;
      case "c": if (issue !== undefined) actions.openComposer("comment", issue.id); break;
      case "q": actions.quit(); break;
      default: break;
    }
  });

  if (issue === undefined) return null;
  const changed = review?.source?.files ?? [];
  const openThreads = review?.threads.filter((thread) => !thread.resolved) ?? [];

  return (
    <box style={{ flexGrow: 1, flexDirection: "row" }}>
      {/* task record */}
      <box style={{ width: "22%", flexShrink: 0, flexDirection: "column", paddingLeft: 1 }}>
        <Meta label="id" value={issue.id} />
        <Meta label="status" value={issue.status} valueColor={statusColor(issue.status)} />
        <Meta label="assignee" value={issue.assignee ?? "—"} />
        <Meta label="priority" value={priorityLabel(issue.priority)} />
        <Meta label="labels" value={issue.labels.length > 0 ? issue.labels.join(", ") : "—"} />
        <Meta label="deps" value={issue.dependencies.length > 0 ? `${issue.dependencies.length}` : "—"} />
      </box>

      {/* description front and center */}
      <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
        <text fg={colors.text} content={truncate(issue.title, 70)} />
        <text fg={colors.dim} content={issue.description === "" ? "(no description)" : ""} />
        <box style={{ flexGrow: 1, flexDirection: "column" }}>
          {issue.description === "" ? null : (
            issue.description.split("\n").slice(0, 20).map((line, index) => (
              <text key={index} fg={colors.text} content={truncate(line, 70)} />
            ))
          )}
        </box>
        <text fg={colors.dim} content="v open diff · V diff modal · c comment" />
      </box>

      {/* live review rail */}
      <box style={{ width: "28%", flexShrink: 0, flexDirection: "column", paddingLeft: 1 }}>
        <text fg={colors.dim} content="REVIEW" />
        {review === null || review.source === null ? (
          <text fg={colors.dim} content={review?.loading ?? false ? "resolving…" : "no review source"} />
        ) : review.source.error !== null ? (
          <text fg={colors.red} content={truncate(review.source.error, 34)} />
        ) : (
          <box style={{ flexDirection: "column" }}>
            <Meta label="branch" value={review.source.branch ?? "—"} />
            <Meta label="base" value={review.source.base ?? "—"} />
            <Meta label="diff" value={`+${review.source.additions} −${review.source.deletions}`} />
            <text fg={colors.dim} content={`FILES ${changed.length}`} />
            {changed.slice(0, 12).map((file) => (
              <text key={file.id} fg={colors.text} content={`  ${truncate(file.id.split(":").pop() ?? file.id, 30)}`} />
            ))}
            <text fg={colors.dim} content={`THREADS ${openThreads.length} open`} />
            {openThreads.slice(0, 8).map((thread) => (
              <text key={thread.id} fg={colors.yellow} content={`  ${truncate(thread.filePath, 24)}${thread.line !== undefined ? `:${thread.line}` : ""}`} />
            ))}
          </box>
        )}
      </box>
    </box>
  );
};

/** Deep link `tk://task` — the task→review page (per-issue records are `tk://task/<id>`). */
export const taskViewRoute: RouteEntry = { kind: "task", path: ["task"], apply: (sink) => { sink.setView("task"); } };
