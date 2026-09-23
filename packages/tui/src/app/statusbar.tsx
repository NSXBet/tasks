import { useApp } from "./context.js";
import { colors } from "../theme.js";

/**
 * One-line statusbar: live counters left; contextual key hints right.
 * The nav rail owns view switching; the bar teaches the next action
 * (palette, modal state) instead of duplicating view chips.
 */
export const StatusBar = () => {
  const { state } = useApp();
  const counts = state.board.counts;
  const staleMark = state.stale ? " ⏳" : "";
  const toast = state.toast ?? "";
  const sprintChip = state.board.activeSprintId !== null ? ` ▸ ${state.board.activeSprintId}` : "";
  const left = `open ${counts.open} · wip ${counts.inProgress} · rev ${counts.readyToReview} · blk ${counts.blocked} · done ${counts.closed}${sprintChip}`;
  const wipOver = state.wipLimit !== null && counts.inProgress > state.wipLimit;
  const hint = state.modalId !== null
    ? `modal ${state.modalId} · esc close`
    : "1-4 views · : commands · ? keys";
  return (
    <box style={{ flexDirection: "row", justifyContent: "space-between", height: 1, backgroundColor: colors.panel, paddingLeft: 1, paddingRight: 1 }}>
      <text>
        <span fg={colors.dim}> {left}</span>
        {state.search !== "" ? <span fg={colors.yellow} bg={colors.panel}>{` · /${state.search.slice(0, 14)} `}</span> : null}
      </text>
      <text fg={toast === "" ? colors.dim : colors.green} content={
        (wipOver ? `⚠ wip ${counts.inProgress} > ${state.wipLimit} ` : "") + staleMark + (toast === "" ? ` ${hint}` : ` · ${toast}`)
      } />
    </box>
  );
};