import { useTerminalDimensions } from "@opentui/react";
import { reviewDoors } from "@tasks/domain";
import { useApp } from "./context.js";
import { colors } from "../theme.js";
import { truncate } from "../format.js";

/**
 * One footer line for the focused task, shared by the list, kanban and detail
 * views: two clickable doors into the task's pages — `❐ task` (`t`, the task
 * view) and `± diff` (`v`, the review) — then the dim review doors
 * `tk review <id> · <web base>/tasks/<id>` (one line for the focused task,
 * never per row). The web base is the board's registered web runtime.
 */
export const DoorsLine = ({ id }: { readonly id: string }) => {
  const { state, actions } = useApp();
  const { width } = useTerminalDimensions();
  const doors = reviewDoors(id, state.board.webBase);
  const buttons = " ❐ task t  ± diff v ";
  return (
    <box style={{ height: 1, flexShrink: 0, flexDirection: "row" }}>
      <box onMouseDown={() => actions.openTask(id)}>
        <text><span fg={colors.band}>{" ❐ task "}</span><span fg={colors.dim}>t</span></text>
      </box>
      <box onMouseDown={() => actions.openReview(id)}>
        <text><span fg={colors.accent}>{"  ± diff "}</span><span fg={colors.dim}>v</span></text>
      </box>
      <text fg={colors.dim} content={truncate(`  review ${doors.tui} · ${doors.web}`, Math.max(10, width - buttons.length))} />
    </box>
  );
};
