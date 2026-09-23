import { useKeyboard } from "@opentui/react";
import { useMemo, useRef } from "react";
import { useApp } from "./context.js";
import { colors, priorityColor, priorityLabel, statusColor, statusGlyph } from "../theme.js";
import { padStart, relativeAge, truncate, type ListRow } from "../format.js";
import { isBlocked, visibleIssues, type FilterKind } from "../store.js";

const tabs: readonly { readonly name: string; readonly filter: FilterKind }[] = [
  { name: "all", filter: "all" },
  { name: "ready", filter: "ready" },
  { name: "open", filter: "open" },
  { name: "wip", filter: "in_progress" },
  { name: "review", filter: "ready-to-review" },
  { name: "closed", filter: "closed" },
  { name: "mine", filter: "mine" },
  { name: "sprint", filter: "sprint" },
  { name: "icebox", filter: "archived" },
];

/**
 * Filter tabs + issue list. Rows carry the state glyph, priority chip,
 * status, id, truncated title and a right-aligned age. Closed rows dim
 * whole-row (beads_viewer depth-by-dimming rule). Nav + Enter live here;
 * mutation keys resolve in the shell.
 */
export const IssueList = () => {
  const { state, actions } = useApp();
  const lastClick = useRef(0);
  const rows = useMemo((): readonly ListRow[] => {
    const now = state.board.fetchedAt;
    return visibleIssues(state.board, state.filter, state.search, state.actor).map((issue) => ({
      id: issue.id,
      status: issue.status,
      priority: issue.priority,
      title: truncate(issue.title, 22),
      assignee: issue.assignee,
      labels: issue.labels,
      blocked: isBlocked(issue, state.board.issues),
      age: relativeAge(issue.updatedAt, now),
      comments: issue.commentCount,
      deps: issue.dependencies.length,
    }));
  }, [state.board, state.filter, state.search, state.actor]);
  const selected = Math.min(state.selected, Math.max(0, rows.length - 1));

  useKeyboard((key) => {
    if (state.composer.mode !== "closed" || state.helpOpen || state.modalId !== null || state.paletteOpen) return;
    if (key.name === "j" || key.name === "down") actions.setSelected(Math.min(rows.length - 1, state.selected + 1));
    else if (key.name === "k" || key.name === "up") actions.setSelected(Math.max(0, state.selected - 1));
    else if (key.name === "return" || key.name === "enter") {
      const row = rows[state.selected];
      if (row !== undefined) actions.openDetail(row.id);
    }
  });

  const activeFilter = tabs.find((tab) => tab.filter === state.filter) ?? tabs[0]!;

  return (
    <box style={{ flexGrow: 1, flexDirection: "column", backgroundColor: colors.bg }}>
      <box style={{ height: 1, flexDirection: "row", backgroundColor: colors.panel }}>
        {tabs.map((tab) => (
          <box
            key={tab.name}
            style={{ flexDirection: "row" }}
            backgroundColor={tab.filter === state.filter ? colors.band : colors.panel}
            onMouseDown={() => actions.setFilter(tab.filter)}
          >
            <text fg={tab.filter === state.filter ? colors.bandFg : colors.dim} content={` ${tab.name} `} />
          </box>
        ))}
        {state.search !== "" ? <text fg={colors.yellow} content={` /${state.search}`} /> : null}
      </box>
      <scrollbox style={{ flexGrow: 1 }} stickyScroll={false}>
        {rows.length === 0 ? <text fg={colors.dim} content={` no ${activeFilter.name} issues`} /> : null}
        {rows.map((row, index) => (
          <ListRowView
            key={row.id}
            row={row}
            selected={index === selected}
            onMouseDown={() => {
              actions.setSelected(index);
              const now = Date.now();
              if (now - lastClick.current < 350) actions.openDetail(row.id);
              lastClick.current = now;
            }}
          />
        ))}
      </scrollbox>
    </box>
  );
};

const ListRowView = ({ row, selected, onMouseDown }: {
  readonly row: ListRow;
  readonly selected: boolean;
  readonly onMouseDown: () => void;
}) => {
  const dim = row.status === "closed";
  const bg = selected ? colors.selection : colors.bg;
  const fg = dim ? colors.dim : colors.text;
  return (
    <box style={{ height: 1, flexDirection: "row" }} backgroundColor={bg} onMouseDown={onMouseDown}>
      <text>
        <span fg={statusColor(row.status)}>{statusGlyph(row.status, row.blocked)}</span>
        <span fg={priorityColor(row.priority)}>{` ${padStart(priorityLabel(row.priority), 2)}`}</span>
        <span fg={dim ? colors.dim : colors.text}>{` ${truncate(row.status, 6)} ${row.id}`}</span>
        <span fg={fg}>{` ${row.title}`}</span>
        <span fg={colors.dim}>{` ${row.age}${row.comments > 0 ? ` 💬${row.comments}` : ""}`}</span>
      </text>
    </box>
  );
};