import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { UpdatePatch, WatchEvent } from "@tasks/surface";
import { AppContext, useApp, type AppActions, type AppContextValue, type AppState, type ViewKind } from "./context.js";
import { Composer } from "./composer.js";
import { HelpOverlay } from "./help.js";
import { NavRail } from "./nav.js";
import { IssueList } from "./list.js";
import { KanbanBoard } from "./kanban.js";
import { IssueDetail } from "./detail.js";
import { DependencyGraph } from "./graph.js";
import { Insights } from "./insights.js";
import { TaskModal } from "./modal.js";
import { CommandPalette } from "./palette.js";
import { kanbanCardAt, kanbanGroups, visibleIssues, type Board, type FilterKind, type TuiStore } from "../store.js";
import { StatusBar } from "./statusbar.js";

interface AppProps {
  readonly store: TuiStore;
  readonly actor: string;
  readonly onQuit: () => void;
  /** WIP limit for the In-Progress column warning; null disables. */
  readonly wipLimit?: number | null;
}

const clampPriority = (value: number): number => Math.min(4, Math.max(0, value));

const emptyBoard: Board = { issues: [], currentId: null, counts: { open: 0, inProgress: 0, readyToReview: 0, blocked: 0, closed: 0 }, fetchedAt: new Date(0) };

/**
 * Root component: owns all app state (board, selection, view, composer) and
 * one change-detection poll subscription. Panels consume through `useApp()`;
 * no panel touches the store directly. Mutating keys resolve one target id
 * here — the detail pane when open, else the focused row/card — so the same
 * key never hits two panes.
 */
export const App = ({ store, actor, onQuit, wipLimit = null }: AppProps) => {
  const [board, setBoard] = useState(emptyBoard);
  const [stale, setStale] = useState(true);
  const [view, setView] = useState<ViewKind>("list");
  const [modalId, setModalId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [composer, setComposer] = useState<AppState["composer"]>({ mode: "closed", forId: null, initial: "", confirm: null });
  const [boardSel, setBoardSel] = useState({ col: 0, row: 0 });
  const [graphId, setGraphId] = useState<string | null>(null);
  const [graphWalk, setGraphWalk] = useState(0);
  const [insightsSel, setInsightsSel] = useState({ panel: 0, row: 0 });
  const [toast, setToast] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<WatchEvent | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await store.loadBoard();
      setBoard(next);
      setStale(false);
    } catch (cause) {
      setStale(true);
      setToast(cause instanceof Error ? cause.message.slice(0, 60) : "refresh failed");
    }
  }, [store]);

  useEffect(() => {
    void refresh();
    const stop = store.watch((event) => {
      setLastEvent(event);
      void refresh();
    });
    return () => { stop(); };
  }, [store, refresh]);

  useEffect(() => () => { if (toastTimer.current !== null) clearTimeout(toastTimer.current); }, []);

  const notify = useCallback((message: string): void => {
    setToast(message);
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const reportError = useCallback((outcome: { ok: boolean; error?: { message: string } }, label: string): boolean => {
    if (outcome.ok) return true;
    notify(`${label}: ${outcome.error?.message?.slice(0, 50) ?? "failed"}`);
    return false;
  }, [notify]);

  const actions: AppActions = useMemo(() => ({
    refresh,
    setView: (next) => { setView(next); setHelpOpen(false); setPaletteOpen(false); },
    toggleHelp: () => { setHelpOpen((open) => !open); },
    openModal: (id) => { setModalId(id); setPaletteOpen(false); },
    closeModal: () => setModalId(null),
    setPaletteOpen: (open) => { setPaletteOpen(open); if (open) setHelpOpen(false); },
    setFilter: (next) => { setFilter(next); setSelected(0); },
    setSearch,
    setSelected,
    openDetail: (id) => { setDetailId(id); setView("list"); },
    closeDetail: () => setDetailId(null),
    openComposer: (mode, forId = null, initial = "") => setComposer({ mode, forId: forId ?? null, initial, confirm: null }),
    setBoardSel,
    requestConfirm: (request) => setComposer({ mode: "confirm", forId: request.id, initial: "", confirm: request }),
    closeComposer: () => setComposer({ mode: "closed", forId: null, initial: "", confirm: null }),
    setStatus: async (id, status) => {
      const outcome = await store.surface.status(id, { status });
      if (reportError(outcome, `status ${id}`)) notify(`${id} → ${status}`);
      await refresh();
    },
    claim: async (id) => {
      const outcome = await store.surface.claim(id);
      if (reportError(outcome, `claim ${id}`)) notify(`claimed ${id}`);
      await refresh();
    },
    comment: async (id, body) => {
      const outcome = await store.surface.comment(id, body);
      if (reportError(outcome, `comment ${id}`)) notify(`commented ${id}`);
      await refresh();
    },
    create: async (title, priority, labels) => {
      const outcome = await store.surface.create({ title, priority, labels });
      if (reportError(outcome, "create")) {
        const created = outcome.ok ? outcome.value : null;
        notify(`created ${created?.id ?? ""}`);
      }
      await refresh();
    },
    update: async (id, patch) => {
      const outcome = await store.surface.update(id, patch);
      if (reportError(outcome, `update ${id}`)) notify(`updated ${id}`);
      await refresh();
    },
    assign: async (id, assignee) => {
      const outcome = assignee === null || assignee === ""
        ? await store.surface.update(id, { assignee: null })
        : await store.surface.assign(id, assignee);
      if (reportError(outcome, `assign ${id}`)) notify(assignee === null || assignee === "" ? `unassigned ${id}` : `${id} → ${assignee}`);
      await refresh();
    },
    setPriority: async (id, priority) => {
      const outcome = await store.surface.priority(id, priority);
      if (reportError(outcome, `priority ${id}`)) notify(`${id} → P${priority}`);
      await refresh();
    },
    labelAdd: async (id, label) => {
      const outcome = await store.surface.labelAdd(id, label);
      if (reportError(outcome, `label ${id}`)) notify(`+${label} ${id}`);
      await refresh();
    },
    labelRemove: async (id, label) => {
      const outcome = await store.surface.labelRemove(id, label);
      if (reportError(outcome, `label ${id}`)) notify(`-${label} ${id}`);
      await refresh();
    },
    depAdd: async (id, target, type = "blocks") => {
      const outcome = await store.surface.depAdd(id, target, type);
      if (reportError(outcome, `dep ${id}`)) notify(`${id} ← ${target}`);
      await refresh();
    },
    depRemove: async (id, target) => {
      const outcome = await store.surface.depRemove(id, target);
      if (reportError(outcome, `dep ${id}`)) notify(`cut ${id} ← ${target}`);
      await refresh();
    },
    setGraphId,
    setGraphWalk,
    setInsightsSel,
    openGraph: (id) => { setGraphId(id); setView("graph"); setHelpOpen(false); },
    notify,
    quit: onQuit,
  }), [store, refresh, notify, reportError, onQuit]);

  const state: AppState = useMemo(() => ({
    store, actor, board, stale, view, helpOpen, modalId, paletteOpen, filter, search, selected, detailId, composer,
    boardSel: { ...boardSel }, graphId, graphWalk, insightsSel: { ...insightsSel }, wipLimit, toast,
  }), [store, actor, board, stale, view, helpOpen, modalId, paletteOpen, filter, search, selected, detailId, composer, boardSel, graphId, graphWalk, insightsSel, wipLimit, toast]);

  const value: AppContextValue = useMemo(() => ({ state, actions, lastEvent }), [state, actions, lastEvent]);

  return (
    <AppContext.Provider value={value}>
      <box style={{ flexGrow: 1, flexDirection: "column", backgroundColor: "#16161e" }}>
        <ShellKeys />
        {paletteOpen ? (
          <box style={{ flexDirection: "column", flexGrow: 1 }}>
            <CommandPalette />
            <StatusBar />
          </box>
        ) : helpOpen ? (
          <HelpOverlay />
        ) : (
          <box style={{ flexDirection: "row", flexGrow: 1 }}>
            <NavRail />
            <box style={{ flexDirection: "column", flexGrow: 1 }}>
              {view === "list" ? (
                <box style={{ flexDirection: "row", flexGrow: 1 }}>
                  <box style={{ width: "50%", flexDirection: "column" }}><IssueList /></box>
                  <box style={{ width: "50%", flexDirection: "column" }}><IssueDetail /></box>
                </box>
              ) : view === "board" ? (
                <KanbanBoard />
              ) : view === "graph" ? (
                <DependencyGraph />
              ) : (
                <Insights />
              )}
              <Composer />
              <StatusBar />
            </box>
          </box>
        )}
        <TaskModal key={modalId ?? "none"} />
      </box>
    </AppContext.Provider>
  );
};

/**
 * Global key layer. Issue-action keys apply to one resolved target:
 * kanban card in board view, detail issue when open, else the highlighted
 * list row. Navigation keys stay in the view components; the composer and
 * help overlay swallow everything else.
 */
const ShellKeys = (): null => {
  const { state, actions } = useApp();
  useKeyboard((key) => {
    if (state.paletteOpen) {
      if (key.sequence === ":") actions.setPaletteOpen(false);
      return;
    }
    if (state.modalId !== null) return;
    if (state.helpOpen) {
      actions.toggleHelp();
      return;
    }
    if (state.composer.mode !== "closed") return;
    if (key.sequence === ":" ) { actions.setPaletteOpen(true); return; }
    if (key.sequence === "?" ) { actions.toggleHelp(); return; }
    const viewKey = ({ "1": "list", "2": "board", "3": "graph", "4": "insights", b: "board", g: "graph", i: "insights" } as const)[key.sequence];
    if (viewKey !== undefined) { actions.setView(viewKey); return; }
    if (key.name === "escape") {
      if (state.detailId !== null) { actions.closeDetail(); return; }
      if (state.view !== "list") { actions.setView("list"); return; }
      if (state.search !== "") { actions.setSearch(""); }
      return;
    }
    if (key.sequence === "/") { actions.openComposer("search", null, state.search); return; }
    if (key.sequence === "n") { actions.openComposer("create"); return; }
    const targetId = (() => {
      if (state.view === "board") {
        const groups = kanbanGroups(state.board.issues, state.board.fetchedAt);
        return kanbanCardAt(groups, state.boardSel.col, state.boardSel.row);
      }
      const rows = visibleIssues(state.board, state.filter, state.search, state.actor);
      return rows[state.selected]?.id ?? null;
    })();
    if (targetId === null) return;
    const issue = state.board.issues.find((candidate) => candidate.id === targetId);
    if (issue === undefined) return;

    switch (key.sequence) {
      case "s": void actions.setStatus(targetId, "in_progress"); break;
      case "r": void actions.setStatus(targetId, "ready-to-review"); break;
      case "d": actions.requestConfirm({ kind: "close", id: targetId, target: null, label: `close ${targetId}?` }); break;
      case "o": void actions.setStatus(targetId, "open"); break;
      case "a": void actions.claim(targetId); break;
      case "c": actions.openComposer("comment", targetId); break;
      case "e": actions.openComposer("title", targetId, issue.title); break;
      case "E": actions.openComposer("description", targetId, issue.description); break;
      case "@": actions.openComposer("assignee", targetId, issue.assignee ?? ""); break;
      case ",": actions.openComposer("labels", targetId, ""); break;
      case "D": actions.openComposer("dep-add", targetId, ""); break;
      case "X": actions.openComposer("dep-remove", targetId); break;
      case "+": void actions.setPriority(targetId, clampPriority(issue.priority + 1)); break;
      case "-": void actions.setPriority(targetId, clampPriority(issue.priority - 1)); break;
      case "/": actions.openComposer("search", null, state.search); break;
      case "n": actions.openComposer("create"); break;
      default: break;
    }
  });
  return null;
};
