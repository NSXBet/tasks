import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { commitWorktree, prCreate, readChangesetBase, storeTransact, WEB_DEFAULT_PORT, type UpdatePatch, type WatchEvent } from "@tasks/surface";
import { taskStoreCommentStore, type ReviewCommentStore } from "@tasks/review";
import { EXPANDED_CONTEXT_LINES, hunkAnchorLine, resolveReviewSource, type ResolveReviewOptions, type ReviewSource } from "../review/source.js";
import { reviewSelectionText } from "../review/selection.js";
import { startReviewWatch } from "../review/live.js";
import { applyHunkEdit, hunkEditRange, readHunkRegion } from "../review/edit.js";
import type { BootSlots } from "./routes.js";
import { AppContext, useApp, type AppActions, type AppContextValue, type AppState, type ArtifactTarget, type ReviewState, type ViewKind } from "./context.js";
import { Composer } from "./composer.js";
import { HelpOverlay } from "./help.js";
import { NavRail } from "./nav.js";
import { TaskView } from "./task.js";
import { ArtifactView } from "./artifact.js";
import { DiffView, DiffModal, HUNK_SHELL_KEYS, locationThreads, reviewEvidence, reviewTarget } from "./diff.js";
import { needsReview } from "@tasks/review/taskview";
import { IssueList } from "./list.js";
import { KanbanBoard } from "./kanban.js";
import { IssueDetail } from "./detail.js";
import { DependencyGraph } from "./graph.js";
import { Insights } from "./insights.js";
import { TaskModal } from "./modal.js";
import { CommandPalette } from "./palette.js";
import { kanbanCardAt, kanbanGroups, visibleIssues, DEFAULT_IMAGE_SIZE, type Board, type FilterKind, type ImageSize, type TuiStore } from "../store.js";
import { StatusBar } from "./statusbar.js";
import { collapseToasts, eventToast } from "../events.js";

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

/** Trailing debounce for event-log board reloads: one reload per burst (T-10-27). */
const WATCH_DEBOUNCE_MS = 100;
const clampPriority = (value: number): number => Math.min(4, Math.max(0, value));

/**
 * Folds a live-refreshed source into the session without losing the
 * reviewer's place: the selected file is kept by path (else the same index
 * when still in range, else 0) and the hunk index is clamped to the new
 * file's hunk count. Layout and thread selection are untouched.
 */
const mergeLiveSource = (current: ReviewState, source: ReviewSource): ReviewState => {
  // An evidence entry (past the files) keeps its place among the entries.
  const previousFiles = current.source?.files.length ?? 0;
  if (current.source !== null && current.fileIndex >= previousFiles) {
    return { ...current, source, fileIndex: source.files.length + (current.fileIndex - previousFiles), hunkIndex: null, loading: false };
  }
  const previousPath = current.source?.files[current.fileIndex]?.path ?? null;
  const byPath = previousPath === null ? -1 : source.files.findIndex((file) => file.path === previousPath);
  const fileIndex = byPath >= 0 ? byPath : current.fileIndex < source.files.length ? current.fileIndex : 0;
  const hunks = source.files[fileIndex]?.metadata.hunks.length ?? 0;
  const hunkIndex = current.hunkIndex === null || hunks === 0 ? null : Math.min(current.hunkIndex, hunks - 1);
  return { ...current, source, fileIndex, hunkIndex, loading: false };
};

const emptyBoard: Board = { issues: [], activeSprintId: null, counts: { open: 0, inProgress: 0, readyToReview: 0, blocked: 0, closed: 0, archived: 0 }, fetchedAt: new Date(0), webBase: `http://localhost:${WEB_DEFAULT_PORT}` };

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
  const [navHidden, setNavHidden] = useState(false);
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
  const [artifact, setArtifact] = useState<ArtifactTarget | null>(null);
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

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const notify = useCallback((message: string): void => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Live board: tail the workspace event log (any writer). A burst of lines
  // coalesces into one board reload per 100ms window (trailing), and the
  // window's toasts collapse to the last one plus ` (+N)` dropped.
  useEffect(() => {
    void refresh();
    let timer: NodeJS.Timeout | undefined;
    let pending: string[] = [];
    const stop = store.watch((event) => {
      setLastEvent(event);
      const text = eventToast(event);
      if (text !== null) pending.push(text);
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        const toast = collapseToasts(pending);
        pending = [];
        void refresh();
        if (toast !== null) notify(toast);
      }, WATCH_DEBOUNCE_MS);
    });
    return () => { stop(); clearTimeout(timer); };
  }, [store, refresh, notify]);

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

  // The session re-resolves only when the reviewed issue's identity changes:
  // its id, its branch, or its pinned base. "pending" = board not fetched yet.
  const boardRef = useRef(board);
  boardRef.current = board;
  const reviewIssue = reviewId === null ? null : board.issues.find((candidate) => candidate.id === reviewId) ?? null;
  const reviewKey = reviewId === null
    ? null
    : reviewIssue === null
      ? (stale ? "pending" : "missing")
      : `${reviewIssue.branch ?? ""}|${readChangesetBase(reviewIssue.metadata)?.base ?? ""}`;

  useEffect(() => {
    if (reviewId === null) { setReview(null); return; }
    let cancelled = false;
    setReview({
      issueId: reviewId, source: null, threads: [], layout: "unified", fileIndex: 0, hunkIndex: null, threadIndex: 0, loading: true, edit: null,
      watching: false, showFiles: true, showLineNumbers: true, showNotes: true, theme: null, context: "default", selection: null, search: "",
    });
    if (reviewKey === "pending") return;
    void (async () => {
      const issue = boardRef.current.issues.find((candidate) => candidate.id === reviewId) ?? null;
      let threads: ReviewState["threads"] = [];
      try {
        threads = (await reviewStore().listThreads(reviewId)).threads;
      } catch {
        notify("review threads unavailable");
      }
      let source: ReviewState["source"];
      if (issue === null) {
        source = { issueId: reviewId, branch: null, cwd: store.surface.store.root, base: null, files: [], additions: 0, deletions: 0, empty: null, error: `unknown issue ${reviewId}`, stats: [], worktree: null, dirty: null };
      } else {
        source = await resolveReviewSource(issue, store.surface.store.root);
      }
      if (cancelled) return;
      setReview((current) => (current === null || current.issueId !== reviewId ? current : { ...current, source, threads, loading: false }));
    })();
    return () => { cancelled = true; };
  }, [reviewId, reviewKey, store, notify, reviewStore]);

  // Task-store events for the same issue only reload threads; the diff is
  // owned by the live watch below.
  useEffect(() => {
    if (reviewId === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const threads = (await reviewStore().listThreads(reviewId)).threads;
        if (cancelled) return;
        setReview((current) => (current === null || current.issueId !== reviewId || current.loading ? current : { ...current, threads }));
      } catch {
        /* threads keep their last value; the initial load already toasts */
      }
    })();
    return () => { cancelled = true; };
  }, [board, reviewId, reviewStore]);

  // Live re-render (D-02): commits and edits in the task's worktree re-derive
  // the patch through the debounced watch controller; the selection survives.
  const liveSource = review?.source ?? null;
  // Every re-derive (live refresh, edit save, `z`) uses the current context;
  // the initial resolve always starts at git's default.
  const reviewContextRef = useRef<ReviewState["context"]>("default");
  reviewContextRef.current = review?.context ?? "default";
  const resolveOptions = useCallback((): ResolveReviewOptions =>
    (reviewContextRef.current === "expanded" ? { contextLines: EXPANDED_CONTEXT_LINES } : {}), []);
  const liveSourceRef = useRef<ReviewSource | null>(null);
  liveSourceRef.current = liveSource;
  const liveKey = liveSource === null
    ? null
    : [liveSource.issueId, liveSource.cwd, liveSource.branch ?? "", liveSource.base ?? "", liveSource.error ?? "", liveSource.empty ?? ""].join("\u0000");
  useEffect(() => {
    const source = liveSourceRef.current;
    if (liveKey === null || source === null) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    let errored = false;
    const issueId = source.issueId;
    void startReviewWatch({
      source,
      onChange: async () => {
        const issue = boardRef.current.issues.find((candidate) => candidate.id === issueId) ?? null;
        if (issue === null || cancelled) return;
        const next = await resolveReviewSource(issue, store.surface.store.root, undefined, resolveOptions());
        if (cancelled) return;
        setReview((current) => (current === null || current.issueId !== issueId || current.loading ? current : mergeLiveSource(current, next)));
      },
      onError: (error) => {
        if (errored || cancelled) return;
        errored = true;
        notify(`review watch: ${(error instanceof Error ? error.message : String(error)).slice(0, 50)}`);
      },
    }).then((handle) => {
      if (cancelled) { handle.stop(); return; }
      stop = handle.stop;
      // The indicator follows the handle: it never claims a watch that didn't start.
      setReview((current) => (current === null || current.issueId !== issueId ? current : { ...current, watching: handle.watching }));
    }, (error: unknown) => {
      if (!cancelled) notify(`review watch: ${(error instanceof Error ? error.message : String(error)).slice(0, 50)}`);
    });
    return () => {
      cancelled = true;
      stop?.();
      setReview((current) => (current?.issueId === issueId && current.watching ? { ...current, watching: false } : current));
    };
  }, [liveKey, store, notify, resolveOptions]);

  const reportError = useCallback((outcome: { ok: boolean; error?: { message: string } }, label: string): boolean => {
    if (outcome.ok) return true;
    notify(`${label}: ${outcome.error?.message?.slice(0, 50) ?? "failed"}`);
    return false;
  }, [notify]);

  const actions: AppActions = useMemo(() => ({
    refresh,
    setView: (next) => { setView(next); setHelpOpen(false); setPaletteOpen(false); },
    toggleNav: () => { setNavHidden((hidden) => !hidden); setPaletteOpen(false); },
    toggleHelp: () => { setHelpOpen((open) => !open); },
    openModal: (id) => { setModalId(id); setPaletteOpen(false); },
    closeModal: () => setModalId(null),
    setPaletteOpen: (open) => { setPaletteOpen(open); if (open) setHelpOpen(false); },
    setFilter: (next) => { setFilter(next); setSelected(0); },
    setSearch,
    setSelected,
    openDetail: (id) => { setDetailId(id); setView("list"); },
    openTask: (id) => { setDetailId(id); setView("task"); setDiffOpen(false); },
    closeDetail: () => setDetailId(null),
    openComposer: (mode, forId = null, initial = "") => setComposer({ mode, forId: forId ?? null, initial, confirm: null, review: null }),
    setBoardSel,
    requestConfirm: (request) => setComposer({ mode: "confirm", forId: request.id, initial: "", confirm: request, review: null }),
    closeComposer: () => setComposer({ mode: "closed", forId: null, initial: "", confirm: null, review: null }),
    // 11-05 WORKSPC actions: the same surface operations as the web routes, in-process.
    commitTask: async (id, message) => {
      const surfaceStore = store.surface.store;
      try {
        const done = await commitWorktree({ cwd: surfaceStore.root, transact: storeTransact(surfaceStore) }, id, message);
        notify(`✓ committed ${done.sha.slice(0, 7)} on ${id}`);
      } catch (cause) {
        // Verbatim (not reportError's 50-char cut): the refusal / git / gh text is the instruction.
        notify(`commit ${id}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      await refresh();
    },
    openPr: async (id) => {
      const surfaceStore = store.surface.store;
      try {
        const done = await prCreate({ cwd: surfaceStore.root, transact: storeTransact(surfaceStore) }, id, {});
        notify(`✓ PR #${done.pr.number} ${done.pr.state} — ${done.pr.url}`);
      } catch (cause) {
        notify(`pr ${id}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      await refresh();
    },
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
    openDiffModalAt: (path, hunkIndex) => {
      setReview((current) => {
        if (current === null) return current;
        const files = current.source?.files ?? [];
        const found = path === null
          ? files.findIndex((file) => needsReview(file.path ?? "", current.threads))
          : files.findIndex((file) => file.path === path);
        // An unknown path leaves the selection alone; no path falls back to the first file.
        if (found < 0 && path !== null) return current;
        const fileIndex = Math.max(0, found);
        const hunks = files[fileIndex]?.metadata.hunks.length ?? 0;
        const hunk = hunkIndex === null || hunks === 0 ? null : Math.max(0, Math.min(hunkIndex, hunks - 1));
        return { ...current, fileIndex, hunkIndex: hunk, threadIndex: 0, selection: null };
      });
      setDiffOpen(true);
    },
    openArtifact: (target) => {
      setArtifact(target);
      setDiffOpen(false);
      setView("artifact");
      setHelpOpen(false);
      setPaletteOpen(false);
    },
    openReview: (id) => { setReviewId(id); setView("diff"); setHelpOpen(false); setPaletteOpen(false); },
    ensureReview: (id) => setReviewId(id),
    setReviewLayout: (layout) => setReview((current) => current === null ? null : { ...current, layout }),
    setReviewFile: (index) => setReview((current) => current === null ? null : { ...current, fileIndex: Math.max(0, index), hunkIndex: null, threadIndex: 0, selection: null }),
    setReviewHunk: (index) => setReview((current) => current === null ? null : { ...current, hunkIndex: index }),
    setReviewThread: (index) => setReview((current) => current === null ? null : { ...current, threadIndex: Math.max(0, index) }),
    openReviewComposer: (kind, placement) => {
      if (review === null) return;
      if (placement !== undefined && (kind === "comment" || kind === "file")) {
        // The artifact view's explicit placement: a line, a block range, the whole file, or evidence.
        setComposer({ mode: "review-comment", forId: review.issueId, initial: "", confirm: null, review: { ...placement, threadId: null, commentId: null } });
        return;
      }
      const target = reviewTarget(review, reviewEvidence(boardRef.current.issues.find((candidate) => candidate.id === review.issueId)));
      const here = target === null ? review.threads : locationThreads(review.threads, target.location);
      const thread = here[review.threadIndex] ?? null;
      if (kind === "comment" || kind === "file") {
        if (target === null) return;
        if (target.kind === "evidence") {
          // D-06: an evidence entry takes comments at `evidence:<id>` (no line).
          setComposer({ mode: "review-comment", forId: review.issueId, initial: "", confirm: null, review: { filePath: target.location, line: null, endLine: null, threadId: null, commentId: null, evidenceId: target.entry.id } });
          return;
        }
        // `file` (C) is a file-level thread: no line anchor.
        const anchor = kind === "file" || review.hunkIndex === null ? null : hunkAnchorLine(target.file, review.hunkIndex);
        setComposer({ mode: "review-comment", forId: review.issueId, initial: "", confirm: null, review: { filePath: target.file.path ?? "", line: anchor, endLine: null, threadId: null, commentId: null, evidenceId: null } });
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
        review: { filePath: thread.filePath, line: thread.line ?? null, endLine: thread.endLine ?? null, threadId: thread.id, commentId: comment?.id ?? null, evidenceId: thread.evidenceId ?? null },
      });
    },
    submitReview: async (body) => {
      if (review === null || composer.review === null) return;
      const api = reviewStore();
      const placement = composer.review;
      try {
        if (composer.mode === "review-comment" && placement.filePath !== null) {
          await api.createThread(
            review.issueId,
            placement.evidenceId !== null
              ? { filePath: placement.filePath, evidenceId: placement.evidenceId, body, author: actor }
              : placement.line === null ? { filePath: placement.filePath, body, author: actor }
              : placement.endLine === null ? { filePath: placement.filePath, line: placement.line, body, author: actor }
              : { filePath: placement.filePath, line: placement.line, endLine: placement.endLine, body, author: actor },
          );
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
    setReviewThreadStatus: async (key) => {
      if (review === null) return;
      const selected = reviewTarget(review, reviewEvidence(boardRef.current.issues.find((candidate) => candidate.id === review.issueId)));
      const here = selected === null ? review.threads : locationThreads(review.threads, selected.location);
      const thread = here[review.threadIndex] ?? null;
      if (thread === null) return;
      const closed = thread.status === "resolved" || thread.status === "dismissed";
      const target = closed ? "open" : key === "done" ? "resolved" : "dismissed";
      try {
        await reviewStore().setThreadStatus(review.issueId, thread.id, target, actor);
        const threads = (await reviewStore().listThreads(review.issueId)).threads;
        setReview((current) => current === null || current.issueId !== review.issueId ? current : { ...current, threads });
        notify(target === "open" ? "reopened" : target === "resolved" ? "✓ done" : "✕ removed");
      } catch {
        notify("comment status update failed");
      }
    },
    sendReviewComments: async () => {
      if (review === null) return;
      try {
        const result = await reviewStore().sendOpen(review.issueId);
        const threads = (await reviewStore().listThreads(review.issueId)).threads;
        setReview((current) => current === null || current.issueId !== review.issueId ? current : { ...current, threads });
        const n = result.sent.length;
        notify(n === 0 ? "nothing open to send" : `sent ${n} comment${n === 1 ? "" : "s"} to the agent`);
      } catch {
        notify("send failed");
      }
    },
    openHunkEdit: async () => {
      if (review === null || review.source === null || diffOpen) return;
      const file = review.source.files[review.fileIndex] ?? null;
      if (file === null) return;
      if (review.hunkIndex === null) { notify("select a hunk (j) to edit"); return; }
      const range = hunkEditRange(file, review.hunkIndex);
      if (range === null || file.path === undefined) { notify("this hunk has no editable lines"); return; }
      const filePath = file.path;
      const region = await readHunkRegion(review.source.cwd, filePath, range);
      if (!region.ok) { notify(`edit: ${region.message.slice(0, 60)}`); return; }
      const issueId = review.issueId;
      setReview((current) => current === null || current.issueId !== issueId ? current : { ...current, edit: { filePath, start: range.start, count: range.count, original: region.text } });
    },
    saveHunkEdit: async (next) => {
      const edit = review?.edit ?? null;
      if (review === null || review.source === null || edit === null) return;
      const issueId = review.issueId;
      const outcome = await applyHunkEdit(review.source.cwd, edit.filePath, { start: edit.start, count: edit.count }, edit.original, next);
      if (!outcome.ok) {
        notify(outcome.kind === "stale" ? "file changed under the edit — reopen with e" : `edit: ${outcome.message.slice(0, 60)}`);
        return;
      }
      setReview((current) => current === null || current.issueId !== issueId ? current : { ...current, edit: null });
      notify(`saved ${edit.filePath}`);
      // Re-derive now; the live watcher fires too, and the merge is idempotent.
      const issue = boardRef.current.issues.find((candidate) => candidate.id === issueId) ?? null;
      if (issue === null) return;
      const source = await resolveReviewSource(issue, store.surface.store.root, undefined, resolveOptions());
      setReview((current) => current === null || current.issueId !== issueId || current.loading ? current : mergeLiveSource(current, source));
    },
    cancelHunkEdit: () => setReview((current) => current === null ? null : { ...current, edit: null }),
    setReviewView: (patch) => setReview((current) => current === null ? null : { ...current, ...patch }),
    toggleReviewContext: async () => {
      if (review === null || review.source === null) return;
      const issueId = review.issueId;
      const context: ReviewState["context"] = review.context === "expanded" ? "default" : "expanded";
      reviewContextRef.current = context;
      setReview((current) => current === null || current.issueId !== issueId ? current : { ...current, context });
      notify(context === "expanded" ? "context expanded" : "context default");
      const issue = boardRef.current.issues.find((candidate) => candidate.id === issueId) ?? null;
      if (issue === null) return;
      const source = await resolveReviewSource(issue, store.surface.store.root, undefined, resolveOptions());
      // A later toggle wins: drop this result when the context moved on.
      if (reviewContextRef.current !== context) return;
      setReview((current) => current === null || current.issueId !== issueId || current.loading ? current : mergeLiveSource(current, source));
    },
    searchReviewFiles: (raw) => {
      const query = raw.trim();
      if (query === "" || review === null) return;
      const files = review.source?.files ?? [];
      setReview((current) => current === null ? null : { ...current, search: query });
      const needle = query.toLowerCase();
      for (let step = 1; step <= files.length; step += 1) {
        const index = (review.fileIndex + step) % files.length;
        if ((files[index]?.path ?? "").toLowerCase().includes(needle)) {
          setReview((current) => current === null ? null : { ...current, fileIndex: index, hunkIndex: null, threadIndex: 0, selection: null });
          return;
        }
      }
      notify(`no file matches ${query}`);
    },
    setReviewSelection: (anchor) => setReview((current) => current === null ? null : { ...current, selection: anchor === null ? null : { anchor } }),
    copyReviewSelection: (copy) => {
      if (review === null) return;
      const file = review.source?.files[review.fileIndex] ?? null;
      if (file === null) return;
      const { selection, hunkIndex } = review;
      const from = selection === null ? hunkIndex : Math.min(selection.anchor, hunkIndex ?? selection.anchor);
      const to = selection === null ? hunkIndex : Math.max(selection.anchor, hunkIndex ?? selection.anchor);
      const text = reviewSelectionText(file, from, to);
      if (text === "") { notify("nothing to copy"); return; }
      notify(copy(text) ? `copied ${text.split("\n").length} lines` : "clipboard unavailable");
      setReview((current) => current === null ? null : { ...current, selection: null });
    },
    notify,
    quit: onQuit,
  }), [store, refresh, notify, reportError, onQuit, review, composer, actor, reviewStore, diffOpen, resolveOptions]);

  const state: AppState = useMemo(() => ({
    store, actor, imageSize, board, stale, view, navHidden, helpOpen, modalId, paletteOpen, filter, search, selected, detailId, composer,
    boardSel: { ...boardSel }, graphId, graphWalk, diffOpen, review, artifact, insightsSel: { ...insightsSel }, wipLimit, toast,
  }), [store, actor, imageSize, board, stale, view, navHidden, helpOpen, modalId, paletteOpen, filter, search, selected, detailId, composer, boardSel, graphId, graphWalk, diffOpen, review, artifact, insightsSel, wipLimit, toast]);

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
            {navHidden ? null : <NavRail />}
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
                // Keyed by the shown task: a switch remounts it, so per-task rail/cursor/focus state and refs reset.
                <TaskView key={detailId ?? "first"} />
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
    // The inline hunk edit buffer owns every key (esc cancels it, not the view).
    if ((state.review?.edit ?? null) !== null) return;
    if (key.sequence === ":" ) { actions.setPaletteOpen(true); return; }
    if (key.sequence === "?" ) { actions.toggleHelp(); return; }
    if (key.sequence === "\\") { actions.toggleNav(); return; }
    if (state.diffOpen) { if (key.name === "escape") actions.closeDiffModal(); return; }
    // Hunk's layout and jump keys win over the view switches in the review views.
    if (state.view === "diff" && HUNK_SHELL_KEYS.has(key.sequence)) return;
    // The artifact view's `g` is its jump-to-top; its other keys are view switches as usual.
    if (state.view === "artifact" && key.sequence === "g") return;
    // The four views on the rail. Task, artifact and diff are pages of one task, reached from it (t / v / o), not switched to.
    const viewKey = ({ "1": "list", "2": "board", "3": "graph", "4": "insights", b: "board", g: "graph", i: "insights" } as const)[key.sequence];
    if (viewKey !== undefined) { actions.setView(viewKey); return; }
    if (state.view === "artifact") return; // ArtifactView owns all its keys (esc → task).
    if (state.view === "task" || state.view === "diff") {
      // Task and diff views own their keys (review navigation, comments,
      // edits); the shell only provides escape-to-list. An active hunk
      // selection takes the first esc (useReviewKeys clears it).
      if (key.name === "escape") {
        if (state.view === "diff" && (state.review?.selection ?? null) !== null) return;
        actions.setView("list");
      }
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
      case "s":
        // D-03: a ready-to-review task never offers start-work; its diff is the next step.
        if (issue.status === "ready-to-review") actions.notify("ready-to-review — v opens the diff");
        else void actions.setStatus(targetId, "in_progress");
        break;
      case "v": actions.openReview(targetId); break;
      case "t": actions.openTask(targetId); break;
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
