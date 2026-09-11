import { useApp } from "./context.js";
import { colors } from "../theme.js";
import type { ViewKind } from "./context.js";

/**
 * Persistent left navigation rail — the discoverability layer. Views are
 * named with glyph, label, and live count so the 1-4 accelerators are always
 * visible (Mobbin kanban pattern: labeled rails + counts + active highlight).
 * Rail items are mouse-clickable; keyboard accelerators stay 1/b/g/i.
 */
interface ViewEntry {
  readonly key: string;
  readonly view: ViewKind;
  readonly glyph: string;
  readonly label: string;
}

const viewEntries: readonly ViewEntry[] = [
  { key: "1", view: "list", glyph: "≡", label: "List" },
  { key: "2", view: "board", glyph: "▦", label: "Board" },
  { key: "3", view: "graph", glyph: "⟐", label: "Graph" },
  { key: "4", view: "insights", glyph: "◎", label: "Insights" },
];

export const NavRail = () => {
  const { state, actions } = useApp();
  const boardCount = state.board.counts.open + state.board.counts.inProgress + state.board.counts.readyToReview;
  const depCount = state.board.issues.filter((issue) => issue.dependencies.length > 0).length;
  const counts: Record<ViewKind, string> = {
    list: String(state.board.issues.length),
    board: String(boardCount),
    graph: String(depCount),
    insights: "",
  };
  const count = (view: ViewKind): string => counts[view];

  return (
    <box style={{ width: 18, flexDirection: "column", backgroundColor: colors.panel, borderStyle: "single", borderColor: colors.border }}>
      <text fg={colors.dim} content="VIEWS" />
      {viewEntries.map((entry) => {
        const active = state.view === entry.view;
        return (
          <box
            key={entry.view}
            onMouseDown={() => actions.setView(entry.view)}
            style={{ flexDirection: "row", ...(active ? { backgroundColor: colors.selection } : {}) }}
          >
            <text style={{ flexGrow: 1 }}>
              <span fg={active ? colors.band : colors.dim}>{active ? "▎" : " "}</span>
              <span fg={active ? colors.band : colors.dim}>{` ${entry.key} `}</span>
              <span fg={active ? colors.text : colors.dim}>{entry.glyph}</span>
              <span fg={active ? colors.text : colors.dim}>{` ${entry.label}`}</span>
            </text>
            <text fg={active ? colors.band : colors.dim} content={count(entry.view)} />
          </box>
        );
      })}
      <text fg={colors.dim} content="" />
      <text fg={colors.dim} content="ACTIONS" />
      <box onMouseDown={() => actions.openComposer("create")} style={{ flexDirection: "row" }}>
        <text><span fg={colors.dim}>{" n "}</span><span fg={colors.text}>{"✎ new"}</span></text>
      </box>
      <box onMouseDown={() => actions.openComposer("search", null, state.search)} style={{ flexDirection: "row" }}>
        <text><span fg={colors.dim}>{" / "}</span><span fg={colors.text}>{"⌕ search"}</span></text>
      </box>
      <box onMouseDown={() => actions.setPaletteOpen(true)} style={{ flexDirection: "row" }}>
        <text><span fg={colors.dim}>{": "}</span><span fg={colors.text}>{"≡ commands"}</span></text>
      </box>
      <box onMouseDown={() => actions.toggleHelp()} style={{ flexDirection: "row" }}>
        <text><span fg={colors.dim}>{" ? "}</span><span fg={colors.text}>{"⎇ keys"}</span></text>
      </box>
      <box style={{ flexGrow: 1 }} />
      <text fg={colors.dim} content={`${state.actor}`} />
    </box>
  );
};