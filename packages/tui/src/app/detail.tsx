import { useMemo } from "react";
import { useApp } from "./context.js";
import { colors, priorityColor, priorityLabel, statusColor } from "../theme.js";
import { relativeAge, truncate } from "../format.js";
import { dependencyTree } from "../store.js";

type MdLine = { readonly kind: "h" | "li" | "code" | "quote" | "text" | "blank"; readonly text: string };

/** Minimal markdown shaping: headers, list bullets, code fences, quotes. */
const mdLines = (source: string): readonly MdLine[] => {
  const out: MdLine[] = [];
  let inCode = false;
  for (const raw of source.split("\n")) {
    if (raw.startsWith("```")) { inCode = !inCode; continue; }
    if (inCode) { out.push({ kind: "code", text: raw }); continue; }
    if (raw.trim() === "") { out.push({ kind: "blank", text: "" }); continue; }
    if (/^#{1,6}\s/.test(raw)) out.push({ kind: "h", text: raw.replace(/^#{1,6}\s*/, "").trim() });
    else if (/^\s*[-*]\s+/.test(raw)) out.push({ kind: "li", text: raw.replace(/^(\s*)[-*]\s+/, "$1· ") });
    else if (/^>\s?/.test(raw)) out.push({ kind: "quote", text: raw.replace(/^>\s?/, "") });
    else out.push({ kind: "text", text: raw });
  }
  return out;
};

/** Right pane: full issue detail. Owns its scroll; closes with Escape. */
export const IssueDetail = () => {
  const { state } = useApp();
  const issue = state.board.issues.find((candidate) => candidate.id === state.detailId) ?? null;

  const tree = useMemo(() => (issue === null ? [] : dependencyTree(state.board.issues, issue.id, "up", 2)), [issue, state.board.issues]);

  if (issue === null) return <box style={{ flexGrow: 1 }} />;
  const statusFg = statusColor(issue.status);
  const age = relativeAge(issue.updatedAt, state.board.fetchedAt);
  const description = mdLines(issue.description);

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
        <text fg={colors.dim} content={`age ${issue.updatedAt.toISOString().slice(0, 10)} · deps ${issue.dependencies.length} · comments ${issue.commentCount}`} style={{ marginBottom: 1 }} />
        {description.length > 0 ? (
          <box style={{ flexDirection: "column", marginBottom: 1 }}>
            {description.map((line, index) => {
              if (line.kind === "blank") return <text key={index} content=" " />;
              if (line.kind === "h") return <text key={index} fg={colors.text}>{line.text}</text>;
              if (line.kind === "code") return <text key={index} fg={colors.cyan} content={`  ${line.text}`} />;
              if (line.kind === "quote") return <text key={index}><span fg={colors.dim}>▎</span><span fg={colors.dim}>{line.text}</span></text>;
              return <text key={index} fg={colors.text} content={line.text} />;
            })}
          </box>
        ) : null}
        {issue.notes !== null && issue.notes !== "" ? <text fg={colors.dim} content={`notes: ${issue.notes}`} style={{ marginBottom: 1 }} /> : null}
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
            {comment.text.split("\n").map((line, index) => (
              <text key={`${comment.id}:${index}`}><span fg={colors.dim}>▎</span><span fg={colors.dim}>{` ${truncate(line, 96)}`}</span></text>
            ))}
          </box>
        ))}
      </scrollbox>
      <box style={{ flexDirection: "row", gap: 1, height: 1 }}>
        <text fg={colors.green} content="s:start" />
        <text fg={colors.yellow} content="r:rev" />
        <text fg={colors.dim} content="d:done" />
        <text fg={colors.accent} content="e:edit" />
        <text fg={colors.red} content="esc:close" />
      </box>
    </box>
  );
};
