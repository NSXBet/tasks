import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { UpdatePatch, WatchEvent } from "@tasks/surface";
import { taskStoreCommentStore, type ReviewCommentStore } from "@tasks/review";
import { hunkAnchorLine, resolveReviewSource } from "../review/source.js";
import type { BootSlots } from "./routes.js";
import { AppContext, useApp, type AppActions, type AppContextValue, type AppState, type ReviewState, type ViewKind } from "./context.js";
import { Composer } from "./composer.js";
import { HelpOverlay } from "./help.js";
import { NavRail } from "./nav.js";
import { TaskView } from "./task.js";
import { ArtifactView } from "./artifact.js";
import { DiffView, DiffModal } from "./diff.js";
import { IssueList } from "./list.js";
import { KanbanBoard } from "./kanban.js";
import { IssueDetail } from "./detail.js";
import { DependencyGraph } from "./graph.js";
import { Insights } from "./insights.js";
import { TaskModal } from "./modal.js";
import { CommandPalette } from "./palette.js";
import { kanbanCardAt, kanbanGroups, visibleIssues, DEFAULT_IMAGE_SIZE, type Board, type FilterKind, type ImageSize, type TuiStore } from "../store.js";
import { StatusBar } from "./statusbar.js";

interface AppProps {
  readonly store: TuiStore;
  readonly actor: string;
  readonly onQuit: () => void;
  /** WIP limit for the In-Progress column warning; null disables. */
  readonly wipLimit?: number | null;
  /** Attachment-image cell size; resolved by main.tsx (flag > config > default). */
  readonly imageSize?: ImageSize;
  /** Deep-link boot slots from main.tsx; null = plain launch. */
  readonly boot?: BootSlots | null;
}

const clampPriority = (value: number): number => Math.min(4, Math.max(0, value));

const emptyBoard: Board = { issues: [], activeSprintId: null, counts: { open: 0, inProgress: 0, readyToReview: 0, blocked: 0, closed: 0, archived: 0 }, fetchedAt: new Date(0) };

/**
 * Root component: owns all app state (board, selection, view, composer) and
 * one change-detection poll subscription. Panels consume through `useApp()`;
 * no panel touches the store directly. Mutating keys resolve one target id
 * here — the detail pane when open, else the focused row/card — so the same
 * key never hits two panes.
 */
export const App = ({ store, actor, onQuit, wipLimit = null, imageSize = DEFAULT_IMAGE_SIZE, boot = null }: AppProps) => {
  const [board, setBoard] = useState(emptyBoard);
  const [stale, setStale] = useState(true);
  const [view, setView] = useState<ViewKind>(boot?.view ?? "list");
  const [modalId, setModalId] = useState<string | null>(boot?.modalId ?? null);
  const [helpOpen, setHelpOpen] = useState(boot?.helpOpen ?? false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(boot?.detailId ?? null);
  const [composer, setComposer] = useState<AppState["composer"]>(boot?.composer ?? { mode: "closed", forId: null, initial: "", confirm: null, review: null });
  const [boardSel, setBoardSel] = useState({ col: 0, row: 0 });
  const [graphId, setGraphId] = useState<string | null>(boot?.graphId ?? null);
  const [graphWalk, setGraphWalk] = useState(0);
  const [diffOpen, setDiffOpen] = useState(boot?.diffOpen ?? false);
  const [reviewId, setReviewId] = useState<string | null>(boot?.reviewId ?? null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const commentStoreRef = useRef<ReviewCommentStore | null>(null);
  const [insightsSel, setInsightsSel] = useState({ panel: 0, row: 0 });
  const [toast, setToast] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<WatchEvent | null>(null);
  const toastTimer = useRef<NodeJS.Timeout | undefined>(undefined);

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

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const notify = useCallback((message: string): void => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Lenient boot: a deep link naming an absent issue still boots; once the
  // board is fetched (stale false) and proves the id missing, toast it.
  useEffect(() => {
    const targetId = boot?.targetId ?? null;
    if (targetId === null || stale || board.issues.some((issue) => issue.id === targetId)) return;
    notify(`unknown issue ${targetId}`);
  }, [board, boot, stale, notify]);

  // Live review session: resolve the diff source and threads for reviewId.
  const reviewStore = useCallback((): ReviewCommentStore => {
    if (commentStoreRef.current === null) commentStoreRef.current = taskStoreCommentStore(store.surface.store);
    return commentStoreRef.current;
  }, [store]);

  useEffect(() => {
    if (reviewId === null) { setReview(null); return; }
    let cancelled = false;
    setReview({ issueId: reviewId, source: null, threads: [], layout: "unified", fileIndex: 0, hunkIndex: null, threadIndex: 0, loading: true });
    void (async () => {
      const issue = board.issues.find((candidate) => candidate.id === reviewId) ?? null;
      let threads: ReviewState["threads"] = [];
      try {
        threads = (await reviewStore().listThreads(reviewId)).threads;
      } catch {
        notify("review threads unavailable");
      }
      let source: ReviewState["source"];
      if (issue === null) {
        source = { issueId: reviewId, branch: null, cwd: store.surface.store.root, base: null, files: [], additions: 0, deletions: 0, error: `unknown issue ${reviewId}` };
      } else {
        source = await resolveReviewSource(issue, store.surface.store.root);
      }
      if (cancelled) return;
      setReview((current) => (current === null || current.issueId !== reviewId ? current : { ...current, source, threads, loading: false }));
    })();
    return () => { cancelled = true; };
  }, [reviewId, board, store, notify, reviewStore]);

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
    openComposer: (mode, forId = null, initial = "") => setComposer({ mode, forId: forId ?? null, initial, confirm: null, review: null }),
    setBoardSel,
    requestConfirm: (request) => setComposer({ mode: "confirm", forId: request.id, initial: "", confirm: request, review: null }),
    closeComposer: () => setComposer({ mode: "closed", forId: null, initial: "", confirm: null, review: null }),
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
    sprintToggle: async (id) => {
      const issue = board.issues.find((candidate) => candidate.id === id);
      const inSprint = issue !== undefined && issue.sprintId !== null && issue.sprintId === board.activeSprintId;
      const outcome = inSprint ? await store.surface.sprintRemove(id) : await store.surface.sprintAdd(id);
      if (reportError(outcome, `sprint ${id}`)) notify(inSprint ? `${id} → backlog` : `${id} → sprint`);
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
    openDiffModal: () => setDiffOpen(true),
    closeDiffModal: () => setDiffOpen(false),
    openReview: (id) => { setReviewId(id); setView("diff"); setHelpOpen(false); setPaletteOpen(false); },
    ensureReview: (id) => setReviewId(id),
    setReviewLayout: (layout) => setReview((current) => current === null ? null : { ...current, layout }),
    setReviewFile: (index) => setReview((current) => current === null ? null : { ...current, fileIndex: Math.max(0, index), hunkIndex: null, threadIndex: 0 }),
    setReviewHunk: (index) => setReview((current) => current === null ? null : { ...current, hunkIndex: index }),
    setReviewThread: (index) => setReview((current) => current === null ? null : { ...current, threadIndex: Math.max(0, index) }),
    openReviewComposer: (kind) => {
      if (review === null) return;
      const file = review.source?.files[review.fileIndex] ?? null;
      const fileThreads = file === null ? review.threads : review.threads.filter((thread) => thread.filePath === file.path);
      const thread = fileThreads[review.threadIndex] ?? null;
      if (kind === "comment") {
        if (file === null) return;
        const anchor = review.hunkIndex === null ? null : hunkAnchorLine(file, review.hunkIndex);
        setComposer({ mode: "review-comment", forId: review.issueId, initial: "", confirm: null, review: { filePath: file.path ?? "", line: anchor, threadId: null, commentId: null } });
        return;
      }
      if (thread === null) return;
      const comment = kind === "edit" ? thread.comments[thread.comments.length - 1] ?? null : null;
      if (kind === "edit" && comment === null) return;
      setComposer({
        mode: kind === "reply" ? "review-reply" : "review-edit",
        forId: review.issueId,
        initial: comment?.body ?? "",
        confirm: null,
        review: { filePath: thread.filePath, line: thread.line ?? null, threadId: thread.id, commentId: comment?.id ?? null },
      });
    },
    submitReview: async (body) => {
      if (review === null || composer.review === null) return;
      const api = reviewStore();
      const placement = composer.review;
      try {
        if (composer.mode === "review-comment" && placement.filePath !== null) {
          await api.createThread(review.issueId, placement.line === null ? { filePath: placement.filePath, body, author: actor } : { filePath: placement.filePath, line: placement.line, body, author: actor });
          notify("thread created");
        } else if (composer.mode === "review-reply" && placement.threadId !== null) {
          await api.appendReply(review.issueId, placement.threadId, { body, author: actor });
          notify("reply added");
        } else if (composer.mode === "review-edit" && placement.threadId !== null && placement.commentId !== null) {
          await api.editThreadComment(review.issueId, placement.threadId, placement.commentId, body);
          notify("comment edited");
        }
        const threads = (await api.listThreads(review.issueId)).threads;
        setReview((current) => current === null ? null : { ...current, threads });
        setComposer({ mode: "closed", forId: null, initial: "", confirm: null, review: null });
      } catch {
        notify("review comment failed");
      }
    },
    toggleReviewResolved: async () => {
      if (review === null) return;
      const file = review.source?.files[review.fileIndex] ?? null;
      const fileThreads = file === null ? review.threads : review.threads.filter((thread) => thread.filePath === file.path);
      const thread = fileThreads[review.threadIndex] ?? null;
      if (thread === null) return;
      try {
        await reviewStore().setThreadResolved(review.issueId, thread.id, { resolved: !thread.resolved, actor });
        const threads = (await reviewStore().listThreads(review.issueId)).threads;
        setReview((current) => current === null ? null : { ...current, threads });
        notify(thread.resolved ? "thread reopened" : "thread resolved");
      } catch {
        notify("resolve failed");
      }
    },
    notify,
    quit: onQuit,
  }), [store, refresh, notify, reportError, onQuit, review, composer, actor, reviewStore]);

  const state: AppState = useMemo(() => ({
    store, actor, imageSize, board, stale, view, helpOpen, modalId, paletteOpen, filter, search, selected, detailId, composer,
    boardSel: { ...boardSel }, graphId, graphWalk, diffOpen, review, insightsSel: { ...insightsSel }, wipLimit, toast,
  }), [store, actor, imageSize, board, stale, view, helpOpen, modalId, paletteOpen, filter, search, selected, detailId, composer, boardSel, graphId, graphWalk, diffOpen, review, insightsSel, wipLimit, toast]);

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
              ) : view === "task" ? (
                <TaskView />
              ) : view === "artifact" ? (
                <ArtifactView />
              ) : view === "diff" ? (
                <DiffView />
              ) : (
                <Insights />
              )}
              <Composer />
              <StatusBar />
            </box>
          </box>
        )}
        <TaskModal key={modalId ?? "none"} />
        {diffOpen && !paletteOpen && !helpOpen ? <DiffModal /> : null}
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
    if (state.diffOpen) { if (key.name === "escape") actions.closeDiffModal(); return; }
    const viewKey = ({ "1": "list", "2": "board", "3": "graph", "4": "insights", "5": "task", "6": "artifact", "7": "diff", b: "board", g: "graph", i: "insights" } as const)[key.sequence];
    if (viewKey !== undefined) { actions.setView(viewKey); return; }
    if (state.view === "task" || state.view === "artifact" || state.view === "diff") {
      // Mock views own their keys (WIP actions / diff navigation); shell only
      // provides escape-to-list.
      if (key.name === "escape") actions.setView("list");
      return;
    }
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
        const groups = kanbanGroups(visibleIssues(state.board, state.filter, state.search, state.actor), state.board.fetchedAt);
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
      case "!": void actions.sprintToggle(targetId); break;
      case "/": actions.openComposer("search", null, state.search); break;
      case "n": actions.openComposer("create"); break;
      default: break;
    }
  });
  return null;
};
