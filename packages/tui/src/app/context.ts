import { createContext, useContext } from "react";
import type { UpdatePatch } from "@tasks/surface";
import type { HunkDiffFile, HunkDiffThemeName } from "@tasks/review/opentui";
import type { ReviewThread } from "@tasks/review";
import type { Board, FilterKind, ImageSize, TuiStore } from "../store.js";
import type { ReviewSource } from "../review/source.js";
import type { WatchEvent } from "@tasks/surface";

export type ViewKind = "list" | "board" | "graph" | "insights" | "task" | "artifact" | "diff";

export type ComposerMode =
  | "closed"
  | "create"
  | "comment"
  | "title"
  | "description"
  | "assignee"
  | "labels"
  | "dep-add"
  | "dep-remove"
  | "confirm"
  | "search"
  | "review-comment"
  | "review-reply"
  | "review-edit"
  | "review-search"
  | "commit";

/** A destructive edit waiting on y/n. Rendered verbatim as `label — y/n`. */
export interface ConfirmRequest {
  readonly kind: "close" | "dep-remove";
  readonly id: string;
  readonly target: string | null;
  readonly label: string;
}

/** Where a review composer writes: thread placement, reply target, or the comment being edited. */
export interface ReviewComposerContext {
  readonly filePath: string | null;
  readonly line: number | null;
  /** Last line of a `line..endLine` range (a doc block); null for a single line or no line. */
  readonly endLine: number | null;
  readonly threadId: string | null;
  readonly commentId: string | null;
  /** Set when the comment targets an evidence entry: placement `evidence:<id>`, line null. */
  readonly evidenceId: string | null;
}

export interface ComposerState {
  readonly mode: ComposerMode;
  readonly forId: string | null;
  /** Prefill for edit modes (current title, current assignee, current search). */
  readonly initial: string;
  readonly confirm: ConfirmRequest | null;
  /** Placement for the review composer modes; null everywhere else. */
  readonly review: ReviewComposerContext | null;
}

/** What the artifact view (`6`, `tk://artifact`) shows: a file by repo-relative path, or one evidence blob. */
export type ArtifactTarget =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "evidence"; readonly id: string; readonly name: string };

/** An explicit review-composer placement (the artifact view's line, block, file and evidence comments). */
export interface ReviewPlacement {
  readonly filePath: string;
  readonly line: number | null;
  readonly endLine: number | null;
  readonly evidenceId: string | null;
}

/** Live review session: the resolved diff source plus thread state for one issue. */
export interface ReviewState {
  readonly issueId: string;
  readonly source: ReviewSource | null;
  readonly threads: readonly ReviewThread[];
  readonly layout: "unified" | "split";
  readonly fileIndex: number;
  readonly hunkIndex: number | null;
  /** Selected thread row within the active file's threads. */
  readonly threadIndex: number;
  readonly loading: boolean;
  /** Open in-view hunk edit buffer (D-03); null when closed. */
  readonly edit: ReviewEditState | null;
  /** True while a live watch controller runs for this source (drives the `watching worktree` line). */
  readonly watching: boolean;
  /** `s`: the full-page file nav is shown. */
  readonly showFiles: boolean;
  /** `l`: the diff body draws line-number gutters. */
  readonly showLineNumbers: boolean;
  /** `a`: the full-page notes (thread) rail is shown. */
  readonly showNotes: boolean;
  /** `t`: the hunk diff theme; null = the component default. */
  readonly theme: HunkDiffThemeName | null;
  /** `z`: git's default hunk context, or the patch re-derived with `EXPANDED_CONTEXT_LINES`. */
  readonly context: "default" | "expanded";
  /** `v`: an active hunk-range selection anchored at a hunk index; null when none. */
  readonly selection: { readonly anchor: number } | null;
  /** Last `/` file-search query (prefills the next search). */
  readonly search: string;
}

/** The hunk being edited: its worktree file, new-side range, and the text it opened with. */
export interface ReviewEditState {
  readonly filePath: string;
  readonly start: number;
  readonly count: number;
  /** The on-disk region when the buffer opened; a save refuses if it changed since. */
  readonly original: string;
}

/**
 * App-level state shared through context. Local component state stays
 * local; anything crossing panels (selection, filter, live data) lives here.
 */
export interface AppState {
  readonly store: TuiStore;
  readonly actor: string;
  /** Attachment-image cell size; resolved once at boot (flag > config > default). */
  readonly imageSize: ImageSize;
  readonly board: Board;
  readonly stale: boolean;
  readonly view: ViewKind;
  readonly helpOpen: boolean;
  readonly filter: FilterKind;
  readonly search: string;
  /** Highlighted row index into the filtered list. */
  readonly selected: number;
  /** Task-modal issue id, when the in-place editor overlay is open. */
  readonly modalId: string | null;
  /** Command palette (`:`) visibility. */
  readonly paletteOpen: boolean;
  /** Detail pane issue id, when open. */
  readonly detailId: string | null;
  readonly composer: ComposerState;
  /** Kanban selection: column and row within the column. */
  readonly boardSel: { readonly col: number; readonly row: number };
  /** Graph view center issue. */
  readonly graphId: string | null;
  /** Graph view walk index across center+tree rows. */
  readonly graphWalk: number;
  /** Insights selection: panel and row within the panel. */
  readonly insightsSel: { readonly panel: number; readonly row: number };
  /** Configured WIP limit for the In-Progress column warning; null = off. */
  readonly wipLimit: number | null;
  /** Diff-modal visibility (diff view variant rendered as overlay). */
  readonly diffOpen: boolean;
  /** Live review session for the diff/artifact/task views; null until opened. */
  readonly review: ReviewState | null;
  /** The artifact view's target; null = the review's selected file. */
  readonly artifact: ArtifactTarget | null;
  readonly toast: string | null;
}

export interface AppActions {
  readonly refresh: () => Promise<void>;
  readonly setView: (view: ViewKind) => void;
  readonly toggleHelp: () => void;
  readonly openModal: (id: string) => void;
  readonly closeModal: () => void;
  readonly setPaletteOpen: (open: boolean) => void;
  readonly requestConfirm: (request: ConfirmRequest) => void;
  readonly setFilter: (filter: FilterKind) => void;
  readonly setSearch: (search: string) => void;
  readonly setSelected: (index: number) => void;
  readonly closeDetail: () => void;
  readonly openDetail: (id: string) => void;
  /** Retarget the task view (`5`) to `id` without leaving it; closes the diff modal (R34 TASKS column, `[` / `]`). */
  readonly openTask: (id: string) => void;
  readonly openComposer: (mode: Exclude<ComposerMode, "closed">, forId?: string | null, initial?: string) => void;
  readonly closeComposer: () => void;
  /** WORKSPC `C` (11-05): `commitWorktree` — git commit --all in the task worktree, never pushed. */
  readonly commitTask: (id: string, message: string) => Promise<void>;
  /** WORKSPC `P` (11-05): `prCreate`, the same path as `tk pr create <id>`. */
  readonly openPr: (id: string) => Promise<void>;
  readonly setStatus: (id: string, status: string) => Promise<void>;
  readonly claim: (id: string) => Promise<void>;
  readonly comment: (id: string, body: string) => Promise<void>;
  readonly create: (title: string, priority: number, labels: readonly string[]) => Promise<void>;
  readonly update: (id: string, patch: UpdatePatch) => Promise<void>;
  readonly assign: (id: string, assignee: string | null) => Promise<void>;
  readonly setPriority: (id: string, priority: number) => Promise<void>;
  readonly labelAdd: (id: string, label: string) => Promise<void>;
  readonly labelRemove: (id: string, label: string) => Promise<void>;
  /** Move the issue into the active sprint, or back to the backlog when already there. */
  readonly sprintToggle: (id: string) => Promise<void>;
  readonly depAdd: (id: string, target: string, type?: string) => Promise<void>;
  readonly depRemove: (id: string, target: string) => Promise<void>;
  readonly setBoardSel: (sel: { readonly col: number; readonly row: number }) => void;
  readonly setGraphWalk: (index: number) => void;
  readonly setGraphId: (id: string | null) => void;
  readonly setInsightsSel: (sel: { readonly panel: number; readonly row: number }) => void;
  readonly openGraph: (id: string) => void;
  readonly openDiffModal: () => void;
  readonly closeDiffModal: () => void;
  /**
   * Open the file-scoped diff modal over the current view at `path` (repo-relative;
   * null → the first file still needing review, else the first file) and `hunkIndex`.
   */
  readonly openDiffModalAt: (path: string | null, hunkIndex: number | null) => void;
  /** Open the artifact view (D-05) on a file or an evidence blob of the review's task. */
  readonly openArtifact: (target: ArtifactTarget) => void;
  /** Open (or re-target) the live review session for one issue. */
  readonly openReview: (id: string | null) => void;
  /** Load (or retarget) the review session without changing the view. */
  readonly ensureReview: (id: string) => void;
  readonly setReviewLayout: (layout: "unified" | "split") => void;
  readonly setReviewFile: (index: number) => void;
  readonly setReviewHunk: (index: number | null) => void;
  readonly setReviewThread: (index: number) => void;
  /**
   * Open the review composer against the current selection: `comment` on the
   * selected hunk's line (or the selected evidence entry), `file` on the whole
   * file (line null), `reply` / `edit` on the selected thread. A `placement`
   * (the artifact view) overrides the selection for `comment` / `file`.
   */
  readonly openReviewComposer: (kind: "comment" | "file" | "reply" | "edit", placement?: ReviewPlacement) => void;
  /** Apply the open review composer: create thread, append reply, or edit comment. */
  readonly submitReview: (body: string) => Promise<void>;
  /**
   * Apply the selected comment's lifecycle control for `key`: `done` → resolved,
   * `remove` → dismissed — or reopen when the comment is already resolved/dismissed.
   */
  readonly setReviewThreadStatus: (key: "done" | "remove") => Promise<void>;
  /** Explicit batched send of every open comment of the review's task to the agent; never per-comment. */
  readonly sendReviewComments: () => Promise<void>;
  /** Open the inline edit buffer over the selected hunk's new-side lines. */
  readonly openHunkEdit: () => Promise<void>;
  /** Write the buffer into the worktree file (guarded, stale-checked) and re-derive the diff. */
  readonly saveHunkEdit: (next: string) => Promise<void>;
  /** Close the edit buffer without writing. */
  readonly cancelHunkEdit: () => void;
  /** Flip the review's view toggles (files pane, line numbers, notes rail, theme). */
  readonly setReviewView: (patch: Partial<Pick<ReviewState, "showFiles" | "showLineNumbers" | "showNotes" | "theme">>) => void;
  /** Toggle default/expanded context and re-derive the patch with it (whole diff). */
  readonly toggleReviewContext: () => Promise<void>;
  /** Select the next changed file (wrapping) whose path contains the query, case-insensitive; toasts on no match. */
  readonly searchReviewFiles: (query: string) => void;
  /** Start a hunk-range selection anchored at a hunk index, or clear it with null. */
  readonly setReviewSelection: (anchor: number | null) => void;
  /** Copy the selected hunks (else the selected hunk, else the file patch) through the injected clipboard writer. */
  readonly copyReviewSelection: (copy: (text: string) => boolean) => void;
  readonly notify: (message: string) => void;
  readonly quit: () => void;
}

export interface AppContextValue {
  readonly state: AppState;
  readonly actions: AppActions;
  /** Last watch event, for the statusbar pulse. */
  readonly lastEvent: WatchEvent | null;
}

export const AppContext = createContext<AppContextValue | null>(null);

export const useApp = (): AppContextValue => {
  const value = useContext(AppContext);
  if (value === null) throw new Error("AppContext used outside provider");
  return value;
};