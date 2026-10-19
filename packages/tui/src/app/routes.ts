import type { ComposerMode, ComposerState, ViewKind } from "./context.js";
import type { AppActions, AppState } from "./context.js";
import { composerRoute } from "./composer.js";
import { detailRoute } from "./detail.js";
import { diffModalRoute, diffViewRoute } from "./diff.js";
import { graphRoute } from "./graph.js";
import { helpRoute } from "./help.js";
import { artifactRoute } from "./artifact.js";
import { boardRoute } from "./kanban.js";
import { listRoute } from "./list.js";
import { taskModalRoute } from "./modal.js";
import { insightsRoute } from "./insights.js";
import { taskViewRoute } from "./task.js";

/**
 * Deep-link grammar: `tk://<route>[?param=value&…]`.
 *
 * One resolver, two clients — boot (`main.tsx` argv) and the CommandPalette
 * (`navigate` action) both call `resolveTarget`. Routes are co-located with
 * the component they open; the `RouteTable` below is exhaustive over
 * `AddressableKind`, so a new page without a route fails typecheck.
 *
 * Deep links address navigation/state only — mutations keep flowing through
 * `@tasks/surface` ops, never through this grammar.
 */

/** Overlays addressable like views: panes and modals are first-class surfaces. */
export type OverlayKind = "detail" | "diff-modal" | "help" | "composer" | "task-modal";

export type AddressableKind = ViewKind | OverlayKind;

/** Where a resolved route writes. Boot collects into props; the palette wraps live actions. */
export interface RouteSink {
  readonly setView: (view: ViewKind) => void;
  readonly openDetail: (id: string) => void;
  readonly openGraph: (id: string) => void;
  readonly openDiffModal: () => void;
  /** Open the diff review page, targeting one issue when the route carries an id. */
  readonly openReview: (id: string | null) => void;
  readonly openModal: (id: string) => void;
  readonly openComposer: (mode: Exclude<ComposerMode, "closed">, forId?: string | null, initial?: string) => void;
  readonly openHelp: () => void;
}

export type RouteParams = Readonly<Record<string, string>>;

export interface RouteEntry {
  readonly kind: AddressableKind;
  /** Path segments after `tk://`; ":id" consumes one segment, ":id?" zero or one. */
  readonly path: readonly string[];
  /** Optional segment validation; a rejecting entry falls through to the unknown-route error. */
  readonly accepts?: (params: RouteParams) => boolean;
  readonly apply: (sink: RouteSink, params: RouteParams) => void;
}

/** Every addressable kind needs exactly one route — the compiler, not discipline, enforces coverage. */
export type RouteTable = { readonly [K in AddressableKind]: RouteEntry };

// Lazy: view files import types from this module, so a top-level table would
// read their entry constants mid-cycle. First resolveTarget call happens long
// after the module graph has settled.
let table: RouteTable | null = null;
const routeTable = (): RouteTable => {
  if (table === null) {
    table = {
      list: listRoute,
      board: boardRoute,
      graph: graphRoute,
      insights: insightsRoute,
      task: taskViewRoute,
      artifact: artifactRoute,
      diff: diffViewRoute,
      detail: detailRoute,
      "diff-modal": diffModalRoute,
      help: helpRoute,
      composer: composerRoute,
      "task-modal": taskModalRoute,
    };
  }
  return table;
};

export interface RouteTarget {
  readonly kind: AddressableKind;
  /** Addressed issue id when the route carries one, else null. */
  readonly id: string | null;
  readonly apply: (sink: RouteSink) => void;
}

export type ResolveResult =
  | { readonly ok: true; readonly target: RouteTarget }
  | { readonly ok: false; readonly error: string };

const SCHEME = "tk://";

/**
 * Match concrete segments against a route path. Optional params are only
 * supported in final position (every current route ends either in a
 * literal or a param).
 */
const matchPath = (path: readonly string[], segments: readonly string[]): RouteParams | null => {
  const params: Record<string, string> = {};
  let index = 0;
  for (const part of path) {
    const optional = part.endsWith("?");
    const name = optional ? part.slice(0, -1) : part;
    const value = segments[index];
    if (name.startsWith(":")) {
      if (value !== undefined) {
        params[name.slice(1)] = value;
        index += 1;
      } else if (!optional) {
        return null;
      }
    } else {
      if (value !== name) return null;
      index += 1;
    }
  }
  return index === segments.length ? params : null;
};

/** Parse `tk://…` into a route target, or a human-readable error. Never throws. */
export function resolveTarget(query: string): ResolveResult {
  const raw = query.trim();
  if (!raw.startsWith(SCHEME)) return { ok: false, error: `deep links are ${SCHEME} URIs (got "${raw}")` };
  const rest = raw.slice(SCHEME.length);
  const question = rest.indexOf("?");
  const pathPart = question === -1 ? rest : rest.slice(0, question);
  const params: Record<string, string> = {};
  if (question !== -1) {
    for (const pair of rest.slice(question + 1).split("&")) {
      if (pair === "") continue;
      const equals = pair.indexOf("=");
      const key = equals === -1 ? pair : pair.slice(0, equals);
      const value = equals === -1 ? "" : pair.slice(equals + 1);
      try {
        params[decodeURIComponent(key)] = decodeURIComponent(value);
      } catch {
        params[key] = value;
      }
    }
  }
  const segments = pathPart.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) return { ok: false, error: `empty deep link (try ${SCHEME}insights or ${SCHEME}task/<id>)` };
  for (const entry of Object.values(routeTable())) {
    const matched = matchPath(entry.path, segments);
    if (matched === null) continue;
    if (entry.accepts !== undefined && !entry.accepts(matched)) continue;
    return { ok: true, target: { kind: entry.kind, id: matched["id"] ?? null, apply: (sink) => entry.apply(sink, matched) } };
  }
  return { ok: false, error: `unknown deep-link route "${SCHEME}${pathPart}"` };
}

/** Initial App state slots a deep link may set at boot; App merges unset slots with its defaults. Mutable: bootSink writes into the record. */
export interface BootSlots {
  view: ViewKind;
  detailId: string | null;
  helpOpen: boolean;
  modalId: string | null;
  diffOpen: boolean;
  /** Issue id for the diff review session; null = plain diff view. */
  reviewId: string | null;
  graphId: string | null;
  composer: ComposerState;
  /** The issue id the link addressed — drives the lenient post-fetch existence check; null when no id. */
  targetId: string | null;
}

/** Sink that records route writes into a plain BootSlots object for App's initial state. */
export const bootSink = (): { readonly sink: RouteSink; readonly slots: BootSlots } => {
  const slots: BootSlots = {
    view: "list",
    detailId: null,
    helpOpen: false,
    modalId: null,
    diffOpen: false,
    reviewId: null,
    graphId: null,
    composer: { mode: "closed", forId: null, initial: "", confirm: null, review: null },
    targetId: null,
  };
  const sink: RouteSink = {
    setView: (view) => {
      slots.view = view;
    },
    openDetail: (id) => {
      slots.detailId = id;
      slots.view = "list";
      slots.targetId = id;
    },
    openGraph: (id) => {
      slots.graphId = id;
      slots.view = "graph";
      slots.targetId = id;
    },
    openDiffModal: () => {
      slots.diffOpen = true;
    },
    openReview: (id) => {
      slots.view = "diff";
      slots.reviewId = id;
      if (id !== null) slots.targetId = id;
    },
    openModal: (id) => {
      slots.modalId = id;
      slots.targetId = id;
    },
    openComposer: (mode, forId = null, initial = "") => {
      slots.composer = { mode, forId, initial, confirm: null, review: null };
      slots.targetId = forId;
    },
    openHelp: () => {
      slots.helpOpen = true;
    },
  };
  return { sink, slots };
};

/** Sink that applies route writes to the running app through AppActions. */
export const appSink = (state: AppState, actions: AppActions): RouteSink => {
  return {
  setView: actions.setView,
  openReview: actions.openReview,
  openDetail: actions.openDetail,
  openGraph: actions.openGraph,
  openDiffModal: actions.openDiffModal,
  openModal: actions.openModal,
  openComposer: actions.openComposer,
  openHelp: () => {
    if (!state.helpOpen) actions.toggleHelp();
  },
  };
};
