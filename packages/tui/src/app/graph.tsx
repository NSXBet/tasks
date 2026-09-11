import { useKeyboard } from "@opentui/react";
import { useMemo } from "react";
import { useApp } from "./context.js";
import { colors, statusColor } from "../theme.js";
import { truncate } from "../format.js";
import { chainLengths, dependencyTree, isBlocked, unblockGains } from "../store.js";
import type { TreeRow } from "../store.js";
import type { Issue } from "@tasks/domain";

type NavRow =
  | { readonly kind: "center"; readonly id: string }
  | { readonly kind: "up" | "down"; readonly id: string; readonly row: TreeRow };

/** Dependency graph centered on one issue: blockers below the center, then dependents. */
export const DependencyGraph = () => {
  const { state, actions } = useApp();
  const graphId = state.graphId ?? state.detailId ?? state.board.issues.find((issue) => issue.status !== "closed")?.id ?? state.board.issues[0]?.id ?? null;

  const { up, down, center } = useMemo(() => {
    if (graphId === null) return { up: [] as readonly TreeRow[], down: [] as readonly TreeRow[], center: null as Issue | null };
    const byId = new Map<string, Issue>(state.board.issues.map((issue) => [issue.id, issue]));
    const root = byId.get(graphId) ?? null;
    const upTree = dependencyTree(state.board.issues, graphId, "up", 2).filter((row) => row.depth > 0);
    const downTree = dependencyTree(state.board.issues, graphId, "down", 2).filter((row) => row.depth > 0);
    return { up: upTree, down: downTree, center: root };
  }, [graphId, state.board.issues]);

  const nav = useMemo((): readonly NavRow[] => {
    const rows: NavRow[] = [];
    if (center !== null) rows.push({ kind: "center", id: center.id });
    for (const row of up) rows.push({ kind: "up", id: row.id, row });
    for (const row of down) rows.push({ kind: "down", id: row.id, row });
    return rows;
  }, [center, up, down]);

  const index = Math.min(state.graphWalk, nav.length - 1);

  useKeyboard((key) => {
    if (state.composer.mode !== "closed" || state.helpOpen || state.modalId !== null || state.paletteOpen) return;
    if (key.name === "j" || key.name === "down") actions.setGraphWalk(Math.min(nav.length - 1, index + 1));
    else if (key.name === "k" || key.name === "up") actions.setGraphWalk(Math.max(0, index - 1));
    else if (key.name === "return" || key.name === "enter") {
      const entry = nav[index];
      if (entry === undefined) return;
      if (entry.kind === "center") actions.openDetail(entry.id);
      else actions.setGraphId(entry.id);
    }
  });

  if (center === null) return <box style={{ flexGrow: 1 }}><text fg={colors.dim} content="no issues to graph" /></box>;

  const chains = chainLengths(state.board.issues);
  const gains = unblockGains(state.board.issues);
  const centerBlocked = isBlocked(center, state.board.issues);
  const metrics = `deps ${up.length} · dependents ${down.length} · chain ${chains.get(center.id) ?? 0} · unblocks ${gains.get(center.id) ?? 0}`;

  return (
    <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 1, backgroundColor: colors.bg }}>
      <CenterRow id={center.id} title={center.title} status={center.status} active={index === 0} blocked={centerBlocked} />
      {up.length > 0 ? <SectionHeader label={`▲ blocked by (${up.length})`} fg={colors.red} /> : null}
      {up.map((row, rowIndex) => (
        <GraphRow key={`up:${row.id}:${rowIndex}`} row={row} active={index === 1 + rowIndex} />
      ))}
      {down.length > 0 ? <SectionHeader label={`▼ blocks (${down.length})`} fg={colors.green} /> : null}
      {down.map((row, rowIndex) => (
        <GraphRow key={`down:${row.id}:${rowIndex}`} row={row} active={index === 1 + up.length + rowIndex} />
      ))}
      <box style={{ height: 1 }} />
      <text fg={colors.dim} content={metrics} />
      <text fg={colors.dim} content="j/k move · enter focus or open · esc back" />
    </box>
  );
};


const CenterRow = ({ id, title, status, active, blocked }: {
  readonly id: string; readonly title: string; readonly status: string; readonly active: boolean; readonly blocked: boolean;
}) => (
  <text>
    <span fg={statusColor(status)}>{blocked ? "◆" : "●"}</span>
    <span fg={colors.band} bg={active ? colors.band : colors.bg}>{` ${id}`}</span>
    <span fg={colors.text} bg={active ? colors.selection : colors.bg}>{` ${truncate(title, 60)}`}</span>
  </text>
);

const SectionHeader = ({ label, fg }: { readonly label: string; readonly fg: string }) => (
  <text fg={fg} content={label} />
);

const GraphRow = ({ row, active }: { readonly row: TreeRow; readonly active: boolean }) => {
  return (
    <text>
      <span fg={row.cycle ? colors.red : row.reference ? colors.dim : statusColor("open")}>{row.blocked ? "◆" : "●"}</span>
      <span fg={colors.text} bg={active ? colors.selection : colors.bg}>{` ${row.id}`}</span>
      {row.cycle ? <span fg={colors.red}> (cycle)</span> : null}
      {row.reference ? <span fg={colors.dim}> (ref)</span> : null}
    </text>
  );
};