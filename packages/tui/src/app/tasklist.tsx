import type { Issue } from "@tasks/domain";
import { useApp } from "./context.js";
import { colors, statusColor } from "../theme.js";
import { truncate } from "../format.js";

/**
 * The task view's left `TASKS` column (spec VIEW 1, R34): the working tasks,
 * one `●` status dot + title per row, the shown task highlighted with the
 * NavRail's `▎` band. A click or `[` / `]` (task.tsx) retargets the task view
 * through `actions.openTask`. It sits between the VIEWS NavRail and the
 * center column (R47 additive) and is hidden below `TASKS_MIN_WIDTH`.
 */

export const TASKS_WIDTH = 24;
/** Below this terminal width the TASKS column is hidden. */
export const TASKS_MIN_WIDTH = 130;

/** Statuses that are not working tasks. */
const PARKED = new Set(["closed", "archived", "deferred"]);

/**
 * Working tasks in board order: every issue whose status is not closed,
 * archived or deferred, plus the shown task (appended) when it was filtered.
 */
export const workingTasks = (issues: readonly Issue[], shownId: string | null): readonly Issue[] => {
  const working = issues.filter((issue) => !PARKED.has(issue.status));
  if (shownId === null || working.some((issue) => issue.id === shownId)) return working;
  const shown = issues.find((issue) => issue.id === shownId);
  return shown === undefined ? working : [...working, shown];
};

/** A window of at most `size` rows that keeps `cursor` in view, roughly centered (T-09-25). */
const windowAround = <T,>(rows: readonly T[], cursor: number, size: number): { readonly start: number; readonly rows: readonly T[] } => {
  const room = Math.max(1, size);
  const start = Math.max(0, Math.min(cursor - Math.floor(room / 2), rows.length - room));
  return { start, rows: rows.slice(start, start + room) };
};

export const TaskList = ({ shownId, height }: { readonly shownId: string; readonly height: number }) => {
  const { state, actions } = useApp();
  const tasks = workingTasks(state.board.issues, shownId);
  const at = Math.max(0, tasks.findIndex((issue) => issue.id === shownId));
  // Top padding, header, footer hint, status bar and composer slack.
  const view = windowAround(tasks, at, height - 6);
  const titleWidth = TASKS_WIDTH - 5;

  return (
    <box style={{ width: TASKS_WIDTH, flexShrink: 0, flexDirection: "column", paddingTop: 1 }} border={["right"]} borderStyle="single" borderColor={colors.border}>
      <text fg={colors.dim} content="TASKS" />
      {view.rows.map((issue) => {
        const active = issue.id === shownId;
        return (
          <box
            key={issue.id}
            onMouseDown={() => actions.openTask(issue.id)}
            style={{ flexDirection: "row", ...(active ? { backgroundColor: colors.selection } : {}) }}
          >
            <text>
              <span fg={active ? colors.band : colors.dim}>{active ? "▎" : " "}</span>
              <span fg={statusColor(issue.status)}>{"● "}</span>
              {active
                ? <span fg={colors.text}><strong>{truncate(issue.title, titleWidth)}</strong></span>
                : <span fg={colors.dim}>{truncate(issue.title, titleWidth)}</span>}
            </text>
          </box>
        );
      })}
      <box style={{ flexGrow: 1 }} />
      <text fg={colors.dim} content="[ ] switch task" />
    </box>
  );
};
