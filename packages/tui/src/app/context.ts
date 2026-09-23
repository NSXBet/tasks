import { createContext, useContext } from "react";
import type { UpdatePatch } from "@tasks/surface";
import type { Board, FilterKind, TuiStore } from "../store.js";
import type { WatchEvent } from "@tasks/surface";

export type ViewKind = "list" | "board" | "graph" | "insights";

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
  | "search";

/** A destructive edit waiting on y/n. Rendered verbatim as `label — y/n`. */
export interface ConfirmRequest {
  readonly kind: "close" | "dep-remove";
  readonly id: string;
  readonly target: string | null;
  readonly label: string;
}

export interface ComposerState {
  readonly mode: ComposerMode;
  readonly forId: string | null;
  /** Prefill for edit modes (current title, current assignee, current search). */
  readonly initial: string;
  readonly confirm: ConfirmRequest | null;
}

/**
 * App-level state shared through context. Local component state stays
 * local; anything crossing panels (selection, filter, live data) lives here.
 */
export interface AppState {
  readonly store: TuiStore;
  readonly actor: string;
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
  readonly openComposer: (mode: Exclude<ComposerMode, "closed">, forId?: string | null, initial?: string) => void;
  readonly closeComposer: () => void;
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