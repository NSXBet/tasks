import { useTerminalDimensions } from "@opentui/react";
import { reviewDoors } from "@tasks/domain";
import { useApp } from "./context.js";
import { colors } from "../theme.js";
import { truncate } from "../format.js";

/**
 * One dim footer line with both review doors for the focused task —
 * `review tk review <id> · <web base>/tasks/<id>` — shared by the list,
 * kanban and detail views (one line for the focused task, never per row).
 * The web base is the board's registered web runtime (no probing).
 */
export const DoorsLine = ({ id }: { readonly id: string }) => {
  const { state } = useApp();
  const { width } = useTerminalDimensions();
  const doors = reviewDoors(id, state.board.webBase);
  return <text style={{ height: 1, flexShrink: 0 }} fg={colors.dim} content={truncate(`review ${doors.tui} · ${doors.web}`, Math.max(20, width))} />;
};
