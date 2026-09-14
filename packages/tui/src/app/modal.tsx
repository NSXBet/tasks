import { useKeyboard } from "@opentui/react";
import { useApp } from "./context.js";
import { colors, priorityColor, priorityLabel, statusColor, statusGlyph, typeEmoji } from "../theme.js";
import { relativeAge, truncate } from "../format.js";

const clampPriority = (value: number): number => Math.min(4, Math.max(0, value));

/**
 * In-place task editor floating over the board (Mobbin task-modal pattern:
 * the board stays visible behind, edits land where you are, no view
 * redirect). Scalar verbs (s/r/o status, +/- priority, a claim) act on the
 * modal issue and keep it open; enter hands title editing to the composer;
 * esc closes.
 */
export const TaskModal = () => {
  const { state, actions } = useApp();
  const issue = state.modalId === null ? null : state.board.issues.find((candidate) => candidate.id === state.modalId) ?? null;

  if (issue === null) return null;

  const blockedBy = issue.dependencies
    .filter((edge) => edge.type === "blocks" && state.board.issues.some((other) => other.id === edge.target && other.status !== "closed"))
    .map((edge) => edge.target);
  const done = issue.status === "closed";

  useKeyboard((key) => {
    if (state.modalId === null) return;
    if (state.composer.mode !== "closed") return;
    if (key.name === "return" || key.name === "enter") { actions.closeModal(); actions.openComposer("title", issue.id, issue.title); return; }
    switch (key.sequence) {
      case "o": void actions.setStatus(issue.id, "open"); break;
      case "s": void actions.setStatus(issue.id, "in_progress"); break;
      case "r": void actions.setStatus(issue.id, "ready-to-review"); break;
      case "a": void actions.claim(issue.id); break;
      case "+": void actions.setPriority(issue.id, clampPriority(issue.priority + 1)); break;
      case "-": void actions.setPriority(issue.id, clampPriority(issue.priority - 1)); break;
      case "e": actions.closeModal(); actions.openComposer("title", issue.id, issue.title); break;
      case "E": actions.closeModal(); actions.openComposer("description", issue.id, issue.description); break;
      case "@": actions.closeModal(); actions.openComposer("assignee", issue.id, issue.assignee ?? ""); break;
      case ",": actions.closeModal(); actions.openComposer("labels", issue.id, ""); break;
      case "c": actions.closeModal(); actions.openComposer("comment", issue.id); break;
      case "D": actions.closeModal(); actions.openComposer("dep-add", issue.id, ""); break;
      case "X": actions.closeModal(); actions.openComposer("dep-remove", issue.id); break;
      case "d":
        if (!done) actions.requestConfirm({ kind: "close", id: issue.id, target: null, label: `close ${issue.id}?` });
        break;
      default: break;
    }
  });

  return (
    <box
      style={{
        position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 100,
        alignItems: "center", paddingTop: 1,
      }}
    >
      <box
        style={{
          width: "64%", flexDirection: "column", backgroundColor: colors.panel,
          borderStyle: "rounded", borderColor: colors.borderFocus, paddingLeft: 2, paddingRight: 2,
        }}
      >
        <text fg={colors.dim} content={`${issue.id} · ${typeEmoji(issue.type)} · updated ${relativeAge(issue.updatedAt, state.board.fetchedAt)} ago`} />
        <text fg={colors.text} content={` ${issue.title}`} />
        <box style={{ flexDirection: "row", marginTop: 1 }}>
          <text>
            {"  "}
            <span fg={statusColor(issue.status)}>{`${statusGlyph(issue.status, blockedBy.length > 0)} `}</span>
            <span fg={statusColor(issue.status)} bg={colors.selection}>{` ${issue.status} `}</span>
            {"  "}
            <span fg={priorityColor(issue.priority)} bg={colors.selection}>{` ${priorityLabel(issue.priority)} `}</span>
            {"  "}
            <span fg={colors.text} bg={colors.selection}>{` @${issue.assignee ?? "—"} `}</span>
          </text>
        </box>
        {blockedBy.length > 0 ? (
          <text fg={colors.red} content={`  ⛔ blocked by ${blockedBy.slice(0, 3).join(", ")}${blockedBy.length > 3 ? ` +${blockedBy.length - 3}` : ""}`} />
        ) : null}
        <box style={{ flexDirection: "row", marginTop: 1 }}>
          <text fg={colors.dim}>
            {"  "}
            {issue.labels.length > 0 ? <span fg={colors.cyan} bg={colors.selection}>{` ${issue.labels.join(", ")} `}</span> : null}
            {issue.labels.length === 0 ? "no labels" : ""}
            {` · ${issue.dependencies.length} deps · ${issue.commentCount} comments`}
          </text>
        </box>
        <box style={{ marginTop: 1, height: 3, paddingLeft: 2, paddingRight: 2 }} borderStyle="single" borderColor={colors.border}>
          <text fg={issue.description === "" ? colors.dim : colors.text} content={issue.description === "" ? "no description — E to edit" : truncate(issue.description.replace(/[#*`>]/g, "").replace(/\n+/g, " ⏎ "), 120)} />
        </box>
        <text fg={colors.dim} content="  ↵ title · s/r/o status · +/- prio · a claim · E desc · @ , D X edits · esc ✕" />
      </box>
    </box>
  );
};