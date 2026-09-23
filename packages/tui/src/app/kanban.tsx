import { useKeyboard } from "@opentui/react";
import { useEffect, useRef } from "react";
import { useApp } from "./context.js";
import { colors, priorityLabel, statusGlyph, typeEmoji } from "../theme.js";
import { padStart, relativeAge, truncate } from "../format.js";
import { kanbanGroups, visibleIssues, type KanbanCard, type KanbanGroup } from "../store.js";
import type { Issue } from "@tasks/domain";

const cardPitch = 4; // three text rows + one blank spacer

/** Full-width kanban: flow columns, three-line cards, keyboard + mouse. */
export const KanbanBoard = () => {
  const { state, actions } = useApp();
  const groups = kanbanGroups(visibleIssues(state.board, state.filter, state.search, state.actor), state.board.fetchedAt);
  const columns = groups.filter((group) => group.key !== "parked" || group.cards.length > 0);
  const lastClick = useRef(0);

  const sel = state.boardSel;
  const colCount = columns.length;
  const col = Math.min(sel.col, colCount - 1);
  const row = Math.min(sel.row, Math.max(0, (columns[col]?.cards.length ?? 1) - 1));

  useKeyboard((key) => {
    if (state.composer.mode !== "closed" || state.helpOpen || state.modalId !== null || state.paletteOpen) return;
    if (key.name === "h" || key.name === "left") actions.setBoardSel({ col: Math.max(0, col - 1), row: 0 });
    else if (key.name === "l" || key.name === "right") actions.setBoardSel({ col: Math.min(colCount - 1, col + 1), row: 0 });
    else if (key.name === "j" || key.name === "down") actions.setBoardSel({ col, row: Math.min((columns[col]?.cards.length ?? 1) - 1, row + 1) });
    else if (key.name === "k" || key.name === "up") actions.setBoardSel({ col, row: Math.max(0, row - 1) });
    else if (key.name === "return" || key.name === "enter") {
      const card = columns[col]?.cards[row];
      if (card !== undefined) actions.openModal(card.id);
    } else if (key.sequence === "x") {
      const card = columns[col]?.cards[row];
      const blocker = card === undefined ? null : firstBlocker(card.id, state.board.issues);
      if (blocker !== null) actions.openGraph(blocker);
    }
  });

  return (
    <box style={{ flexGrow: 1, flexDirection: "row", backgroundColor: colors.bg, gap: 1 }}>
      {columns.map((group, groupIndex) => (
        <KanbanColumnView
          key={group.key}
          group={group}
          active={groupIndex === col}
          selectedRow={groupIndex === col ? row : -1}
          wipLimit={group.key === "in_progress" ? state.wipLimit : null}
          onCardMouseDown={(cardId: string) => {
            const now = Date.now();
            const cardIndex = group.cards.findIndex((card) => card.id === cardId);
            actions.setBoardSel({ col: groupIndex, row: Math.max(0, cardIndex) });
            if (now - lastClick.current < 350 && cardIndex >= 0) actions.openModal(group.cards[cardIndex]!.id);
          }}
        />
      ))}
      {columns.length === 0 ? <text fg={colors.dim} content="no issues — press n to create one" /> : null}
    </box>
  );
};

const firstBlocker = (id: string, issues: readonly Issue[]): string | null => {
  const issue = issues.find((candidate) => candidate.id === id);
  if (issue === undefined) return null;
  const blocker = issue.dependencies.find((edge) =>
    edge.type === "blocks" && issues.some((other) => other.id === edge.target && other.status !== "closed"));
  return blocker?.target ?? null;
};

interface ColumnProps {
  readonly group: KanbanGroup;
  readonly active: boolean;
  readonly selectedRow: number;
  readonly wipLimit: number | null;
  readonly onCardMouseDown: (cardId: string) => void;
}

const KanbanColumnView = ({ group, active, selectedRow, wipLimit, onCardMouseDown }: ColumnProps) => {
  const scrollerRef = useRef<{ scrollTo: (position: number | { top: number }) => void } | null>(null);
  const blockedCount = group.cards.filter((card) => card.blocked).length;
  const overWip = wipLimit !== null && group.cards.length > wipLimit;
  const header = ` ${group.title} (${group.cards.length})${blockedCount > 0 ? ` ⛔${blockedCount}` : ""}${overWip ? " ⚠" : ""} `;

  useEffect(() => {
    if (selectedRow >= 0) scrollerRef.current?.scrollTo({ top: selectedRow * cardPitch });
  }, [selectedRow]);
  return (
    <box
      style={{ flexGrow: 1, flexBasis: 0, flexDirection: "column" }}
      borderStyle="rounded"
      borderColor={active ? colors.band : colors.violet}
      title={header}
    >
      {group.cards.length === 0 ? (
        <box style={{ flexGrow: 1 }} />
      ) : (
        <scrollbox
          style={{ flexGrow: 1, width: "100%" }}
          stickyScroll={false}
        >
            {group.cards.map((card, cardIndex) => (
            <CardRow
              key={card.id}
              card={card}
              selected={cardIndex === selectedRow}
              dim={card.status === "closed"}
              onMouseDown={onCardMouseDown}
            />
          ))}
        </scrollbox>
      )}
    </box>
  );
};

const CardRow = ({ card, selected, dim, onMouseDown }: {
  readonly card: KanbanCard;
  readonly selected: boolean;
  readonly dim: boolean;
  readonly onMouseDown: (id: string) => void;
}) => {
  const fg = dim ? colors.dim : colors.text;
  const meta = [
    `${relativeAge(card.age, new Date())} ago`,
    ...card.labels.slice(0, 2).map((label) => `#${label}`),
    card.labels.length > 2 ? `+${card.labels.length - 2}` : "",
    card.blocked ? "⛔" : "",
    card.comments > 0 ? `💬${card.comments}` : "",
  ].filter((part) => part !== "").join(" · ");
  return (
    <box
      style={{ flexDirection: "column", paddingLeft: 1, marginBottom: 1, backgroundColor: selected ? colors.selection : colors.bg }}
      onMouseDown={() => { onMouseDown(card.id); }}
    >
      <text>
        <span fg={dim ? colors.dim : colors.accent}>{typeEmoji(card.type)}</span>
        <span fg={dim ? colors.dim : colors.band}> {statusGlyph(card.status, card.blocked)} </span>
        <span fg={dim ? colors.dim : colors.band}>{card.id}</span>
        <span fg={colors.dim}> {padStart(priorityLabel(card.priority), 2)}</span>
      </text>
      <text fg={fg} content={truncate(card.title, 28)} />
      <text fg={colors.dim} content={truncate(meta, 30)} />
    </box>
  );
};