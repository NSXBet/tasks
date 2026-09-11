import { useKeyboard } from "@opentui/react";
import { useMemo } from "react";
import { useApp } from "./context.js";
import { colors, priorityLabel, statusColor } from "../theme.js";
import { padStart, relativeAge, truncate } from "../format.js";
import { chainLengths, criticalChain, detectCycles, graphDensity, isBlocked, isReady, unblockGains } from "../store.js";
import type { Issue } from "@tasks/domain";

interface PanelRow {
  readonly id: string;
  /** Left glyph or metric chip rendered before the id. */
  readonly chip: string;
  readonly title: string;
  readonly right: string;
  readonly dim: boolean;
  readonly fg: string;
}

/** Insights: ready work, unblock gains, the critical chain, graph health. */
export const Insights = () => {
  const { state, actions } = useApp();
  const issues = state.board.issues;

  const panels = useMemo((): readonly { readonly title: string; readonly rows: readonly PanelRow[] }[] => {
    const now = state.board.fetchedAt;
    const chains = chainLengths(issues);
    const gains = unblockGains(issues);
    const cycles = detectCycles(issues);
    const ready = issues
      .filter((issue) => isReady(issue, issues) && issue.status !== "closed")
      .sort((a, b) => a.priority - b.priority || b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 8)
      .map((issue) => ({
        id: issue.id,
        chip: padStart(priorityLabel(issue.priority), 2),
        title: truncate(issue.title, 34),
        right: relativeAge(issue.updatedAt, now),
        dim: false,
        fg: colors.text,
      }));
    const blockers = issues
      .filter((issue) => issue.status !== "closed" && (gains.get(issue.id) ?? 0) > 0)
      .sort((a, b) => (gains.get(b.id) ?? 0) - (gains.get(a.id) ?? 0))
      .slice(0, 8)
      .map((issue) => ({
        id: issue.id,
        chip: `+${gains.get(issue.id) ?? 0}`,
        title: truncate(issue.title, 34),
        right: `${issue.dependencies.filter((edge) => edge.type === "blocks").length} dep`,
        dim: false,
        fg: colors.yellow,
      }));
    const chain = criticalChain(issues).slice(0, 8).map((id) => {
      const issue = issues.find((candidate) => candidate.id === id);
      return {
        id,
        chip: `${chains.get(id) ?? 0}→`,
        title: truncate(issue?.title ?? "", 34),
        right: issue === undefined ? "" : issue.status,
        dim: issue?.status === "closed",
        fg: issue !== undefined && isBlocked(issue, issues) ? colors.red : colors.text,
      };
    });
    const health: readonly PanelRow[] = cycles.length > 0
      ? cycles.slice(0, 6).map((cycle) => ({
        id: cycle[0] ?? "",
        chip: "⟳",
        title: truncate(cycle.join(" → "), 44),
        right: `${cycle.length} nodes`,
        dim: false,
        fg: colors.red,
      }))
      : [{
        id: "",
        chip: "✓",
        title: "dependency graph is a clean DAG",
        right: `density ${graphDensity(issues).toFixed(3)}`,
        dim: true,
        fg: colors.green,
      }];
    return [
      { title: "ready now", rows: ready },
      { title: "blockers to clear", rows: blockers },
      { title: "critical chain", rows: chain },
      { title: "health", rows: health },
    ];
  }, [issues, state.board.fetchedAt]);

  const sel = state.insightsSel;
  const panel = Math.min(sel.panel, panels.length - 1);
  const row = Math.min(sel.row, Math.max(0, (panels[panel]?.rows.length ?? 1) - 1));

  useKeyboard((key) => {
    if (state.composer.mode !== "closed" || state.helpOpen || state.modalId !== null || state.paletteOpen) return;
    if (key.name === "tab") actions.setInsightsSel({ panel: (panel + 1) % panels.length, row: 0 });
    else if (key.name === "j" || key.name === "down") actions.setInsightsSel({ panel, row: Math.min((panels[panel]?.rows.length ?? 1) - 1, row + 1) });
    else if (key.name === "k" || key.name === "up") actions.setInsightsSel({ panel, row: Math.max(0, row - 1) });
    else if (key.name === "return" || key.name === "enter") {
      const entry = panels[panel]?.rows[row];
      if (entry !== undefined && entry.id !== "") actions.openDetail(entry.id);
    }
  });

  return (
    <box style={{ flexGrow: 1, flexDirection: "row", backgroundColor: colors.bg, gap: 1 }}>
      <box style={{ flexGrow: 1, flexDirection: "column", gap: 1 }}>
        <InsightPanel panel={panels[0]!} active={panel === 0} selectedRow={panel === 0 ? row : -1} />
        <InsightPanel panel={panels[2]!} active={panel === 2} selectedRow={panel === 2 ? row : -1} />
      </box>
      <box style={{ flexGrow: 1, flexDirection: "column", gap: 1 }}>
        <InsightPanel panel={panels[1]!} active={panel === 1} selectedRow={panel === 1 ? row : -1} />
        <InsightPanel panel={panels[3]!} active={panel === 3} selectedRow={panel === 3 ? row : -1} />
      </box>
    </box>
  );
};

const InsightPanel = ({ panel, active, selectedRow }: {
  readonly panel: { readonly title: string; readonly rows: readonly PanelRow[] };
  readonly active: boolean;
  readonly selectedRow: number;
}) => (
  <box
    style={{ flexGrow: 1, flexDirection: "column" }}
    borderStyle="rounded"
    borderColor={active ? colors.band : colors.violet}
    title={` ${panel.title} (${panel.rows.length}) `}
  >
    {panel.rows.length === 0 ? (
      <text fg={colors.dim} content=" · empty ·" />
    ) : (
      panel.rows.map((entry, entryIndex) => (
        <text key={`${entry.id}:${entryIndex}`}>
          <span fg={entry.dim ? colors.dim : colors.text} bg={entryIndex === selectedRow ? colors.selection : colors.bg}>{` ${entry.id}`}</span>
          <span fg={entry.dim ? colors.dim : colors.text}>{` ${entry.title}`}</span>
          <span fg={statusColor(entry.right) !== colors.text ? statusColor(entry.right) : colors.dim}>{`  ${entry.right}`}</span>
        </text>
      ))
    )}
  </box>
);