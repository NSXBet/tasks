import { useMemo } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { navWidth, useApp } from "./context.js";
import { DoorsLine } from "./doors.js";
import { EvidenceImage } from "./evidence-image.js";
import { EVIDENCE_CHUNK_RE, mdLines } from "./markdown.js";
import { MdLineView } from "./markdown-view.js";
import type { RouteEntry } from "./routes.js";
import { colors, priorityColor, priorityLabel, statusColor } from "../theme.js";
import { relativeAge, truncate } from "../format.js";
import { dependencyTree } from "../store.js";
import { agentLine, isBlobAttachment } from "@tasks/domain";

/** Right pane: full issue detail. Owns its scroll; closes with Escape. */
export const IssueDetail = () => {
  const { state } = useApp();
  const { width: termWidth } = useTerminalDimensions();
  // Mirror of App.tsx layout: the NavRail (18 columns, 0 when hidden) + 50% detail split, minus
  // the pane's rounded border (2) and the image's marginLeft (2); floored with a floor guard.
  const imageMaxCellWidth = Math.max(4, Math.floor((termWidth - navWidth(state)) / 2) - 4);
  const issue = state.board.issues.find((candidate) => candidate.id === state.detailId) ?? null;

  const tree = useMemo(() => (issue === null ? [] : dependencyTree(state.board.issues, issue.id, "up", 2)), [issue, state.board.issues]);

  if (issue === null) return <box style={{ flexGrow: 1 }} />;
  const statusFg = statusColor(issue.status);
  const age = relativeAge(issue.updatedAt, state.board.fetchedAt);
  const description = mdLines(issue.description);
  const agent = agentLine(issue);

  return (
    <box
      title={` ${issue.id} `}
      titleAlignment="left"
      borderStyle="rounded"
      borderColor={colors.border}
      style={{ flexGrow: 1, flexDirection: "column", backgroundColor: colors.bg }}
    >
      <scrollbox style={{ flexGrow: 1 }} stickyScroll={false}>
        <text>
          <span fg={colors.text}>{issue.title}</span>
        </text>
        <text>
          <span fg={statusFg}>{issue.status}</span>
          <span fg={colors.dim}> │ </span>
          <span fg={priorityColor(issue.priority)}>{priorityLabel(issue.priority)}</span>
          <span fg={colors.dim}> │ </span>
          <span fg={colors.text}>{issue.assignee ?? "unassigned"}</span>
          <span fg={colors.dim}> │ </span>
          <span fg={colors.dim}>{age}</span>
          {issue.labels.map((label) => (
            <span key={label} fg={colors.cyan}>{` #${label}`}</span>
          ))}
        </text>
        <text fg={colors.dim} content={`age ${issue.updatedAt.toISOString().slice(0, 10)} · deps ${issue.dependencies.length} · comments ${issue.commentCount}`} />
        {agent === null ? null : <text fg={colors.text} content={agent} />}
        <box style={{ marginBottom: 1 }}><DoorsLine id={issue.id} /></box>
        {description.length > 0 ? (
          <box style={{ flexDirection: "column", marginBottom: 1 }}>
            {description.map((line, index) => <MdLineView key={index} line={line} issueId={issue.id} maxCellWidth={imageMaxCellWidth} />)}
          </box>
        ) : null}
        {issue.notes !== null && issue.notes !== "" ? <text fg={colors.dim} content={`notes: ${issue.notes}`} style={{ marginBottom: 1 }} /> : null}
        {issue.attachments.length > 0 ? (
          <box style={{ flexDirection: "column", marginBottom: 1 }}>
            <text fg={colors.band} content="attachments" />
            {issue.attachments.map((attachment) =>
              isBlobAttachment(attachment) ? (
                <box key={attachment.id} style={{ flexDirection: "column" }}>
                  <text>
                    <span fg={colors.dim}>▎</span>
                    <span fg={colors.cyan}>{` ${attachment.name}`}</span>
                    <span fg={colors.dim}>{` ${attachment.id} · ${attachment.kind} · ${(attachment.size / 1024).toFixed(1)} kB`}</span>
                  </text>
                  {attachment.mime.startsWith("image/") ? <EvidenceImage issueId={issue.id} refId={attachment.id} maxCellWidth={imageMaxCellWidth} /> : null}
                </box>
              ) : (
                <text key={attachment.path}>
                  <span fg={colors.dim}>▎</span>
                  <span fg={colors.cyan}>{` ${attachment.path}`}</span>
                </text>
              ),
            )}
          </box>
        ) : null}
        {tree.length > 1 ? (
          <box style={{ flexDirection: "column", marginBottom: 1 }}>
            <text fg={colors.band} content="blocked by" />
            {tree.map((row) => (
              <text key={`${row.id}:${row.prefix}`}>
                <span fg={colors.dim}>{row.prefix}</span>
                <span fg={row.blocked ? colors.red : statusColor(state.board.issues.find((candidate) => candidate.id === row.id)?.status ?? "open")}>●</span>
                <span fg={row.id === issue.id ? colors.text : colors.dim}>{` ${row.id}`}</span>
                {row.cycle ? <span fg={colors.red}> (cycle)</span> : null}
                {row.reference ? <span fg={colors.dim}> (ref)</span> : null}
              </text>
            ))}
          </box>
        ) : null}
        {issue.comments.map((comment) => (
          <box key={comment.id} style={{ flexDirection: "column" }}>
            <text><span fg={colors.dim}>▎</span><span fg={colors.cyan}>{` ${comment.author}`}</span><span fg={colors.dim}>{` (${relativeAge(comment.createdAt, state.board.fetchedAt)} ago)`}</span></text>
            {comment.text.split(/(evidence:ev-[a-z0-9]{6})/).map((chunk, index) => {
              if (EVIDENCE_CHUNK_RE.test(chunk)) return <EvidenceImage key={`${comment.id}:${index}`} issueId={issue.id} refId={chunk.slice("evidence:".length)} maxCellWidth={imageMaxCellWidth} />;
              if (chunk === "") return null;
              return chunk.split("\n").map((line, lineIndex) => (
                <text key={`${comment.id}:${index}:${lineIndex}`}><span fg={colors.dim}>▎</span><span fg={colors.dim}>{` ${truncate(line, 96)}`}</span></text>
              ));
            })}
          </box>
        ))}
      </scrollbox>
      <box style={{ flexDirection: "row", gap: 1, height: 1 }}>
        {/* D-03: work on a ready-to-review task has begun — offer its diff, never start-work. */}
        {issue.status === "ready-to-review"
          ? <text key="open-diff" fg={colors.accent} content="v:open diff" />
          : <text key="start" fg={colors.green} content="s:start" />}
        <text fg={colors.band} content="t:task" />
        <text fg={colors.yellow} content="r:rev" />
        <text fg={colors.dim} content="d:done" />
        <text fg={colors.accent} content="e:edit" />
        <text fg={colors.red} content="esc:close" />
      </box>
    </box>
  );
};

/** Deep link `tk://task/<id>` — the list view with this issue's detail pane open. */
export const detailRoute: RouteEntry = {
  kind: "detail",
  path: ["task", ":id"],
  apply: (sink, params) => {
    const id = params["id"];
    if (id !== undefined) sink.openDetail(id);
  },
};
