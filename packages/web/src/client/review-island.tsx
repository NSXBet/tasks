/**
 * Review island: the live review surface mounted by app.html into `#reviewView`.
 *
 * One responsibility: render the issue's changeset diff with @pierre/diffs and
 * drive real comment threads through the server's ReviewCommentStore seam
 * (`/api/review/:id/threads`). It knows HTTP and the thread vocabulary —
 * never task stores or issue metadata (R-SEAM).
 *
 * app.html mounts it via `window.ReviewIsland.mount(el, { issueId, actor })`;
 * the island reloads payload + threads on issue change and after each write.
 * `mode: "file"` + `path` mounts the artifact view instead: one worktree file
 * rendered in full, every line commentable plus whole-file comments, over the
 * same thread store (D-05). `mode: "modal"` frames one file of the diff for the
 * task view's diff modal (09-07): `⤢ full view` / `esc close`, `initialHunk`.
 * Diff mode also renders the task's blob evidence after the file diff as
 * `<img>` blocks commentable at `evidence:<id>` (09-07, D-06).
 *
 * Edit mode (D-03): `edit` on a diff file rebuilds that file's diff from the
 * full base + worktree contents (`parseDiffFromFile`, so @pierre's Editor can
 * attach) and saves through `PUT /api/review/:id/file`. While the editor holds
 * unsaved changes, live `review` refreshes are deferred until save or discard.
 */
import { parseDiffFromFile, parsePatchFiles, type DiffLineAnnotation, type FileContents, type FileDiffMetadata, type LineAnnotation } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/edit";
import { EditProvider, File, FileDiff } from "@pierre/diffs/react";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReviewPayload } from "../review";
import type { ReviewCommentCardView, ReviewCommentSide, ReviewCommentStatus, ReviewSendResult, ReviewThread, ReviewThreadList } from "@tasks/review";
// Runtime rules from the browser-safe subpath only — the `@tasks/review` root pulls storage code (08-02).
import { commentControls, commentStatusBadge, reviewHeaderLabel, sendableCount } from "@tasks/review/lifecycle";
import { isDocPath } from "@tasks/review/taskview";

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

const messageOf = (cause: unknown, fallback: string): string =>
  cause instanceof Error ? cause.message : fallback;

/** A non-2xx answer; keeps the status so a view can tell "missing" (404) from a failure. */
class HttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const getJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url);
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new HttpError(data.error?.message ?? `HTTP ${res.status}`, res.status);
  return data;
};

const postJson = async (url: string, input: unknown, method: "POST" | "PUT" = "POST"): Promise<unknown> => {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  return data;
};

/* ------------------------------------------------------------------ */
/* Thread vocabulary mapped onto the diff's annotation sides           */
/* ------------------------------------------------------------------ */

/** @pierre annotation side ← thread side ("old" deletes, "new" adds). */
const sideToAnnotation = (side: ReviewCommentSide): "deletions" | "additions" =>
  side === "old" ? "deletions" : "additions";

/** Thread side ← @pierre annotation side. */
const annotationToSide = (side: "deletions" | "additions"): ReviewCommentSide =>
  side === "deletions" ? "old" : "new";

/** Metadata the island hangs on each diff-line annotation. */
interface AnnotationMeta {
  threads: ReviewThread[];
  draft: boolean;
}

type IslandAnnotation = DiffLineAnnotation<AnnotationMeta>;

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

const age = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

interface Draft {
  readonly filePath: string;
  readonly line: number;
  readonly side: ReviewCommentSide;
  /** Evidence comment target (D-06): posted as `{ evidenceId }`, stored at `evidence:<id>`. */
  readonly evidenceId?: string;
  /** Doc block range end (09-08, D-05): posted as `endLine` when past `line`. */
  readonly endLine?: number;
}

/** One open edit session: the full diff the Editor is attached to (D-03). */
interface EditSession {
  readonly path: string;
  /** Bumped per rebuild — keys the FileDiff remount and the editor's cache keys. */
  readonly gen: number;
  /** Base-side contents; null when the file is new on the branch. */
  readonly base: string | null;
  /** Worktree contents the session was built from (the clean state). */
  readonly contents: string;
  readonly fileDiff: FileDiffMetadata;
}

type IslandTheme = "dark" | "light";

interface IslandProps {
  readonly issueId: string;
  readonly actor: string;
  readonly onError?: (message: string) => void;
  /** Back to the task view (D-01); renders a `← task` button when present. */
  readonly onBack?: () => void;
  /** Preselects this file when it is in the patch (`/tasks/:id/diff?file=`). */
  readonly initialFile?: string;
  /** The app theme at mount; later `<html data-theme>` flips are followed live (D-04). */
  readonly theme?: IslandTheme;
  /**
   * `"diff"` (default): the changeset diff. `"file"`: the artifact view of `path` (VIEW 2).
   * `"modal"`: one file of the diff, framed for the task view's diff modal (09-07, D-04).
   */
  readonly mode?: "diff" | "file" | "modal";
  /** Repo-relative worktree path shown by the artifact view (`mode: "file"`). */
  readonly path?: string;
  /** Artifact view EVIDENCE mode (09-08, D-05): the evidence id (`/tasks/:id/file?evidence=`). */
  readonly evidenceId?: string;
  /** Diff view: opens the artifact view for a file row (`view file`). */
  readonly onOpenFile?: (path: string) => void;
  /** Modal mode: scroll this 0-based hunk of `initialFile` into view after the first render (MINIMAP bar). */
  readonly initialHunk?: number | null;
  /** Modal mode: `⤢ full view` — the host routes to `/tasks/:id/diff?file=<path>`. */
  readonly onExpand?: (path: string) => void;
  /** Modal mode: `esc close` / Escape. */
  readonly onClose?: () => void;
}

/** The app's theme source of truth: `<html data-theme>` (never the OS color scheme). */
const rootTheme = (fallback: IslandTheme): IslandTheme => {
  if (typeof document === "undefined") return fallback;
  const value = document.documentElement.dataset["theme"];
  return value === "light" ? "light" : value === "dark" ? "dark" : fallback;
};

/** D-04: follow the app theme (`<html data-theme>`), never the OS color-scheme media query. */
const useAppTheme = (themeProp: IslandTheme | undefined): IslandTheme => {
  const [theme, setTheme] = useState<IslandTheme>(themeProp ?? "dark");
  useEffect(() => {
    setTheme(rootTheme(themeProp ?? "dark"));
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setTheme((current) => rootTheme(current)));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [themeProp]);
  return theme;
};

/** Open-vs-settled counts with the 03-05 rule: open + sent are open, resolved is ✓, dismissed settles. */
const threadCounts = (threads: readonly ReviewThread[]): { open: number; resolved: number } => {
  let open = 0;
  let resolved = 0;
  for (const thread of threads) {
    const status = thread.status ?? (thread.resolved ? "resolved" : "open");
    if (status === "open" || status === "sent") open += 1;
    else if (status === "resolved") resolved += 1;
  }
  return { open, resolved };
};

/** A thread's stored lifecycle status (pre-lifecycle records fall back to `resolved`). */
const threadStatus = (thread: ReviewThread): ReviewCommentStatus =>
  thread.status ?? (thread.resolved ? "resolved" : "open");

/** Pill class per status: open → `open`, sent → `sent`, resolved → `res`, dismissed → `dis`. */
const pillClass = (status: ReviewCommentStatus): string => {
  switch (status) {
    case "sent": return "sent";
    case "resolved": return "res";
    case "dismissed": return "dis";
    default: return "open";
  }
};

/** Control titles (hover text) for the lifecycle buttons. */
const controlTitle: Record<"done" | "remove" | "reopen", string> = {
  done: "mark done",
  remove: "remove (dismiss)",
  reopen: "reopen",
};

/**
 * A stored comment body without its `[review <loc>]` / `[review reply]` prefix
 * (the record keeps it so `tk show` reads well; the card already shows the location).
 */
const displayBody = (body: string): string => body.replace(/^\[review [^\]]*\]\s*/, "");

/** Sends every open comment as one batch (D-03); one request in flight at a time. */
const useSendToAgent = (enc: string, reload: () => Promise<void> | void, onError?: (message: string) => void) => {
  const [sent, setSent] = useState<readonly ReviewCommentCardView[]>([]);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const send = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    try {
      const result = await postJson(`/api/review/${enc}/comments/send`, {}) as ReviewSendResult;
      if (result.sent.length === 0) onError?.("nothing open to send");
      else setSent(result.sent);
      await reload();
    } catch (cause) {
      onError?.(`send failed: ${messageOf(cause, "request failed")}`);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }, [enc, reload, onError]);
  const clear = useCallback(() => setSent([]), []);
  return { sent, sending, send, clear };
};

/** `COMMENTS · N open · K ✓` (or the `All resolved` banner) + the `send to agent (N)` batch button (D-02). */
const ReviewHeader = ({
  list,
  sending,
  onSend,
}: {
  list: ReviewThreadList | null;
  sending: boolean;
  onSend: () => void;
}) => {
  if (list === null) return null;
  const n = sendableCount(list.counts);
  return (
    <span className="rvi-hwrap">
      {list.allResolved
        ? <span className="rvi-banner" id="reviewHeader">All resolved</span>
        : <span className="rvi-head cmt" id="reviewHeader">COMMENTS · {reviewHeaderLabel(list)}</span>}
      <button
        className="rvi-send"
        id="reviewSend"
        disabled={n === 0 || sending}
        title="send every open comment to the agent as one batch"
        onClick={onSend}
      >
        send to agent ({n})
      </button>
    </span>
  );
};

/** The cards the last send handed to the agent: `location · author · body` (text nodes only). */
const SentPanel = ({ sent, onClear }: { sent: readonly ReviewCommentCardView[]; onClear: () => void }) => {
  if (sent.length === 0) return null;
  return (
    <div className="rvi-sent" id="reviewSent">
      <div className="rvi-sent-head">
        <span>sent to agent · {sent.length}</span>
        <button className="rvi-sent-x" title="clear" onClick={onClear}>×</button>
      </div>
      {sent.map((card) => (
        <div className="rvi-sent-row mono" key={card.id}>
          {card.location} · {card.author} · {displayBody(card.body)}
        </div>
      ))}
    </div>
  );
};

/** One stored thread, rendered inline on its diff line. */
const ThreadCard = ({
  issueId,
  thread,
  actor,
  reload,
  fail,
}: {
  issueId: string;
  thread: ReviewThread;
  actor: string;
  reload: () => void;
  fail: (message: string) => void;
}) => {
  const [reply, setReply] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const enc = encodeURIComponent(issueId);
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
      reload();
    } catch (cause) {
      fail(messageOf(cause, "action failed"));
    }
  };
  const status = threadStatus(thread);
  const closed = status === "resolved" || status === "dismissed";
  return (
    <div className={`rvi-thread ${closed ? "res" : ""} ${status === "dismissed" ? "dis" : ""}`}>
      <div className="rvi-trow">
        <span className={`pill ${pillClass(status)}`}>{commentStatusBadge(status)}</span>
        {thread.evidenceId !== undefined ? (
          <span className="rvi-loc mono">evidence:{thread.evidenceId}</span>
        ) : thread.line !== undefined ? (
          <span className="rvi-loc mono">
            {thread.side === "old" ? "old" : "new"} · {thread.endLine !== undefined && thread.endLine > thread.line ? `lines ${thread.line}–${thread.endLine}` : `line ${thread.line}`}
          </span>
        ) : (
          <span className="rvi-loc">file-level</span>
        )}
        <span className="rvi-ctrls">
          {commentControls(status).map((control) => (
            <button
              key={control.key}
              className={`btn rvi-ctrl ${control.key}`}
              title={controlTitle[control.key]}
              onClick={() => void run(() => postJson(`/api/review/${enc}/threads/${encodeURIComponent(thread.id)}/status`, { status: control.to }))}
            >
              {control.label}
            </button>
          ))}
        </span>
      </div>
      <div className="comments">
        {thread.comments.map((c) => (
          <div className="comment" key={c.id}>
            <span className="who">{c.author}</span>
            {c.author === actor ? <span className="agchip">you</span> : ""}
            <span className="at">{age(c.createdAt)} ago</span>
            <br />
            {editingId === c.id ? (
              <span>
                <textarea
                  className="rvi-edit"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={2}
                />
                <span className="rvi-actions">
                  <button
                    className="btn"
                    onClick={() => {
                      const text = editText.trim();
                      if (!text) return;
                      void run(() => postJson(`/api/review/${enc}/threads/${encodeURIComponent(thread.id)}/${encodeURIComponent(c.id)}`, { body: text }, "PUT")).then(() => setEditingId(null));
                    }}
                  >
                    save
                  </button>
                  <button className="btn" onClick={() => setEditingId(null)}>cancel</button>
                </span>
              </span>
            ) : (
              <span onDoubleClick={() => { setEditingId(c.id); setEditText(displayBody(c.body)); }}>
                {displayBody(c.body)}
                {c.editedAt !== undefined ? <span className="at"> · edited</span> : ""}
                {c.author === actor ? <button className="reply" onClick={() => { setEditingId(c.id); setEditText(displayBody(c.body)); }}>edit</button> : ""}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="cbox">
        <input
          placeholder="Reply…"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const body = reply.trim();
              if (!body) return;
              setReply("");
              void run(() => postJson(`/api/review/${enc}/threads/${encodeURIComponent(thread.id)}`, { body }));
            }
          }}
        />
        <button
          className="btn"
          onClick={() => {
            const body = reply.trim();
            if (!body) return;
            setReply("");
            void run(() => postJson(`/api/review/${enc}/threads/${encodeURIComponent(thread.id)}`, { body }));
          }}
        >
          Reply
        </button>
      </div>
    </div>
  );
};

/** Composer for a new thread anchored to a clicked line (or file-level). */
const DraftCard = ({
  issueId,
  draft,
  actor,
  cancel,
  reload,
  fail,
  persistent = false,
  inputId,
}: {
  issueId: string;
  draft: Draft;
  actor: string;
  cancel: () => void;
  reload: () => void;
  fail: (message: string) => void;
  /** An always-open composer (the evidence block's): no cancel button. */
  persistent?: boolean;
  /** DOM id for the textarea, so a click elsewhere (the evidence image) can focus it. */
  inputId?: string;
}) => {
  const [body, setBody] = useState("");
  const enc = encodeURIComponent(issueId);
  const create = async (): Promise<void> => {
    const text = body.trim();
    if (!text) return;
    try {
      await postJson(`/api/review/${enc}/threads`, draft.evidenceId !== undefined
        ? { evidenceId: draft.evidenceId, body: text }
        : {
          filePath: draft.filePath,
          body: text,
          ...(draft.line > 0 ? { line: draft.line, side: draft.side } : {}),
          ...(draft.line > 0 && draft.endLine !== undefined && draft.endLine > draft.line ? { endLine: draft.endLine } : {}),
        });
      setBody("");
      cancel();
      reload();
    } catch (cause) {
      fail(messageOf(cause, "comment failed"));
    }
  };
  return (
    <div className="rvi-thread draft">
      <div className="rvi-trow">
        <span className="pill open">new comment</span>
        <span className="rvi-loc mono">
          {draft.evidenceId !== undefined
            ? `evidence:${draft.evidenceId}`
            : `${draft.side === "old" ? "old" : "new"} · ${draft.line > 0 ? (draft.endLine !== undefined && draft.endLine > draft.line ? `lines ${draft.line}–${draft.endLine}` : `line ${draft.line}`) : "file"}`}
        </span>
        <span className="rvi-loc">{actor}</span>
      </div>
      <textarea
        className="rvi-edit"
        id={inputId}
        placeholder={draft.evidenceId !== undefined ? "comment on the evidence…" : draft.line > 0 ? (draft.endLine !== undefined && draft.endLine > draft.line ? "Comment on this block…" : "Comment on this line…") : "Comment on this file…"}
        value={body}
        rows={3}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void create();
        }}
      />
      <div className="rvi-actions">
        <button className="btn" onClick={() => void create()}>Comment</button>
        {persistent ? null : <button className="btn" onClick={cancel}>cancel</button>}
        <span className="at">⌘↵ to submit</span>
      </div>
    </div>
  );
};

/** FNV-1a over the patch text — a cheap content key, not a security hash. */
const patchHash = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

/** Every element matching `selector` under `root`, descending into open shadow roots (FileDiff renders in one). */
const queryDeep = (root: ParentNode, selector: string): Element[] => {
  const found = [...root.querySelectorAll(selector)];
  for (const el of root.querySelectorAll("*")) if (el.shadowRoot !== null) found.push(...queryDeep(el.shadowRoot, selector));
  return found;
};

/**
 * Scrolls hunk `index` of `file` into view inside `container` (MINIMAP → modal, D-04).
 * Rendered lines carry `data-line-index="<unified>,<split>"`, so the hunk's first row is
 * the one whose unified index is `hunk.unifiedLineStart`. False until FileDiff has rendered it.
 */
const scrollToHunk = (container: HTMLElement | null, file: FileDiffMetadata, index: number): boolean => {
  const hunk = file.hunks[index];
  if (container === null || hunk === undefined) return false;
  const first = queryDeep(container, `[data-line-index^="${hunk.unifiedLineStart},"]`)[0];
  if (first === undefined) return false;
  first.scrollIntoView({ block: "center" });
  return true;
};

/** Status letter → pill tone, the task view's CHANGES palette (A new, M/R edit, D delete). */
const STATUS_TONE: Record<string, string> = { A: "open", M: "amber", R: "amber", D: "del" };

/** @pierre change type → the status letter the CHANGES rail shows. */
const CHANGE_LETTER: Record<string, string> = { change: "M", "rename-pure": "R", "rename-changed": "R", new: "A", deleted: "D" };

/** Threads pinned to one evidence item (`evidenceId`, or the stored `evidence:<id>` location). */
const evidenceThreadsOf = (threads: readonly ReviewThread[], id: string): ReviewThread[] =>
  threads.filter((thread) => thread.evidenceId === id || thread.filePath === `evidence:${id}`);

/** The mounted island's refetch hook; null while nothing is mounted. */
let activeRefresh: ((issueId: string) => void) | null = null;

const Island = ({ issueId, actor, onError, onBack, initialFile, theme: themeProp, onOpenFile, mode, initialHunk, onExpand, onClose }: IslandProps) => {
  /** 09-07 (D-04): one file framed for the task view's diff modal — no file list, no edit mode. */
  const modal = mode === "modal";
  const bodyRef = useRef<HTMLDivElement>(null);
  const [payload, setPayload] = useState<ReviewPayload | null>(null);
  /** The whole `/threads` answer: threads plus the stored `counts` / `allResolved` the header reads (D-02). */
  const [list, setList] = useState<ReviewThreadList | null>(null);
  const threads = useMemo((): readonly ReviewThread[] => list?.threads ?? [], [list]);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(initialFile ?? null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const theme = useAppTheme(themeProp);

  const enc = encodeURIComponent(issueId);
  const fail = useCallback((message: string) => { setError(message); onError?.(message); }, [onError]);

  /* Edit mode (D-03) ------------------------------------------------ */
  const [editing, setEditing] = useState<EditSession | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<string | null>(null);
  const [discardArmed, setDiscardArmed] = useState(false);
  const editingRef = useRef<EditSession | null>(null);
  const dirtyRef = useRef(false);
  const draftContents = useRef<string | null>(null);
  const pendingRefresh = useRef(false);
  const editGen = useRef(0);
  editingRef.current = editing;
  dirtyRef.current = dirty;
  /** Save/load failures toast without replacing the view, so a draft is never lost. */
  const toast = useCallback((message: string) => { setSaveState(message); onError?.(message); }, [onError]);

  /** Fetches base + worktree contents of `path` and builds the full (non-partial) diff the editor needs. */
  const loadEdit = useCallback(async (path: string, force: boolean): Promise<void> => {
    const fileUrl = `/api/review/${enc}/file?path=${encodeURIComponent(path)}`;
    try {
      const [baseText, worktreeText] = await Promise.all([
        (getJson(`${fileUrl}&side=base`) as Promise<{ contents: string }>).then((r) => r.contents).catch((cause: unknown) => {
          if (cause instanceof HttpError && cause.status === 404) return null;
          throw cause;
        }),
        (getJson(fileUrl) as Promise<{ contents: string }>).then((r) => r.contents),
      ]);
      const current = editingRef.current;
      if (!force && current !== null && current.path === path && current.base === baseText && current.contents === worktreeText) return;
      editGen.current += 1;
      const gen = editGen.current;
      const oldFile: FileContents | null = baseText === null ? null : { name: path, contents: baseText, cacheKey: `${issueId}:${path}:base:${gen}` };
      const newFile: FileContents = { name: path, contents: worktreeText, cacheKey: `${issueId}:${path}:${gen}` };
      draftContents.current = worktreeText;
      setEditing({ path, gen, base: baseText, contents: worktreeText, fileDiff: parseDiffFromFile(oldFile, newFile) });
    } catch (cause) {
      toast(`cannot edit ${path}: ${messageOf(cause, "load failed")}`);
    }
  }, [enc, issueId, toast]);

  const leaveEdit = useCallback((): void => {
    setEditing(null);
    setDirty(false);
    setDiscardArmed(false);
    setSaveState(null);
    draftContents.current = null;
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const data = await getJson(`/api/review/${enc}`) as ReviewPayload;
      setPayload(data);
      setList(await getJson(`/api/review/${enc}/threads`) as ReviewThreadList);
      setError(null);
    } catch (cause) {
      fail(messageOf(cause, "failed to load review"));
    }
  }, [enc, fail]);
  const sender = useSendToAgent(enc, reload, onError);

  useEffect(() => {
    setPayload(null);
    setList(null);
    sender.clear();
    setSelectedPath(initialFile ?? null);
    setDraft(null);
    setError(null);
    setEditing(null);
    setDirty(false);
    void reload();
    // initialFile seeds the selection on (re)mount only; later file clicks own it.
  }, [reload]);

  // Live refresh (D-02): the page forwards server `review` SSE frames here; only
  // a frame for this island's issue re-fetches the payload + threads.
  // While the editor is dirty the frame is recorded and replayed on save/discard (D-02 × D-03).
  useEffect(() => {
    const refresh = (id: string): void => {
      if (id !== issueId) return;
      if (dirtyRef.current) { pendingRefresh.current = true; return; }
      void reload();
      const session = editingRef.current;
      if (session !== null) void loadEdit(session.path, false);
    };
    activeRefresh = refresh;
    return () => { if (activeRefresh === refresh) activeRefresh = null; };
  }, [issueId, reload, loadEdit]);

  const save = useCallback(async (): Promise<void> => {
    const session = editingRef.current;
    const contents = draftContents.current;
    if (session === null || contents === null) return;
    setSaveState("saving…");
    try {
      await postJson(`/api/review/${enc}/file?path=${encodeURIComponent(session.path)}`, { contents }, "PUT");
      setDirty(false);
      dirtyRef.current = false;
      setDiscardArmed(false);
      setSaveState("saved");
      pendingRefresh.current = false;
      // Re-render the diff around the saved edit (the watcher's frame then finds nothing new).
      void reload();
      await loadEdit(session.path, false);
    } catch (cause) {
      toast(`save failed: ${messageOf(cause, "write failed")}`);
    }
  }, [enc, reload, loadEdit, toast]);

  const discard = useCallback((): void => {
    const replay = pendingRefresh.current;
    pendingRefresh.current = false;
    leaveEdit();
    if (replay) void reload();
  }, [leaveEdit, reload]);

  // `discard?` disarms itself after 4s (no native confirm in the viewer).
  useEffect(() => {
    if (!discardArmed) return;
    const timer = setTimeout(() => setDiscardArmed(false), 4_000);
    return () => clearTimeout(timer);
  }, [discardArmed]);

  /** Creation-time editor options (one Editor per session): onChange tracks the draft through refs. */
  const editorOptions = useMemo(() => ({
    onChange: (file: FileContents): void => {
      draftContents.current = file.contents;
      const session = editingRef.current;
      const changed = session === null || file.contents !== session.contents;
      if (changed !== dirtyRef.current) { dirtyRef.current = changed; setDirty(changed); }
      if (changed) setSaveState(null);
    },
  }), [editing?.gen]); // eslint-disable-line react-hooks/exhaustive-deps

  const files = useMemo((): readonly FileDiffMetadata[] => {
    if (payload?.patch === null || payload?.patch === undefined || payload.patch === "") return [];
    // Content-derived cache keys: without them FileDiff keys its highlight
    // cache by file name and a live refresh (D-02) would repaint stale hunks.
    return parsePatchFiles(payload.patch, `p${patchHash(payload.patch)}`).flatMap((parsed) => parsed.files);
  }, [payload]);

  // Default selection: first file that still exists under its new name.
  // Waits for the payload so a seeded `initialFile` is not dropped before load.
  useEffect(() => {
    if (payload === null) return;
    if (selectedPath !== null && files.some((f) => f.name === selectedPath)) return;
    setSelectedPath(files.length > 0 ? files[0]!.name : null);
  }, [payload, files, selectedPath]);

  const selected = useMemo(
    () => (selectedPath === null ? null : files.find((f) => f.name === selectedPath) ?? null),
    [files, selectedPath],
  );

  // Stable options: a new object each render would force FileDiff to repaint under a live editor.
  const selectedPathRef = useRef(selectedPath);
  selectedPathRef.current = selectedPath;
  const diffOptions = useMemo(() => ({
    theme: { dark: "pierre-dark", light: "pierre-light" } as const,
    themeType: theme,
    onLineClick: (props: { lineNumber: number; annotationSide: "deletions" | "additions" }) => {
      const path = selectedPathRef.current;
      if (path !== null) setDraft({ filePath: path, line: props.lineNumber, side: annotationToSide(props.annotationSide) });
    },
  }), [theme]);

  /** File-level threads (no line) on the selected file, shown in the file bar. */
  const fileLevelThreads = useMemo(
    () => threads.filter((thread) => thread.filePath === selectedPath && (thread.line === undefined || thread.line <= 0)),
    [threads, selectedPath],
  );

  /** Threads + open draft grouped per diff line for the selected file. */
  const annotations = useMemo((): IslandAnnotation[] => {
    if (selectedPath === null) return [];
    const groups = new Map<string, IslandAnnotation>();
    const group = (side: "deletions" | "additions", line: number): IslandAnnotation => {
      const key = `${side}:${line}`;
      const found = groups.get(key);
      if (found !== undefined) return found;
      const created: IslandAnnotation = { side, lineNumber: line, metadata: { threads: [], draft: false } };
      groups.set(key, created);
      return created;
    };
    for (const thread of threads) {
      if (thread.filePath !== selectedPath || thread.line === undefined || thread.line <= 0) continue;
      group(sideToAnnotation(thread.side ?? "new"), thread.line).metadata.threads.push(thread);
    }
    if (draft !== null && draft.filePath === selectedPath && draft.line > 0) {
      group(sideToAnnotation(draft.side), draft.line).metadata.draft = true;
    }
    return [...groups.values()];
  }, [threads, draft, selectedPath]);

  /** Evidence on the task (D-06): rendered after the file diff in diff mode, each a comment target. */
  const evidence = useMemo(() => payload?.evidence ?? [], [payload]);

  // Modal mode: Escape closes (a focused field takes the first Escape — the page blurs it);
  // `C` opens the file-level composer on the shown file.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const inField = target !== null && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (e.key === "Escape") {
        if (inField) return;
        e.preventDefault();
        onCloseRef.current?.();
      } else if (e.key === "C" && !inField && !e.metaKey && !e.ctrlKey) {
        const path = selectedPathRef.current;
        if (path !== null) { e.preventDefault(); setDraft({ filePath: path, line: 0, side: "new" }); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modal]);

  // Modal mode: a MINIMAP bar opens the modal at that hunk — scroll once FileDiff has rendered it.
  const hunkDone = useRef(false);
  useEffect(() => {
    if (!modal || initialHunk === null || initialHunk === undefined || hunkDone.current) return;
    if (selected === null || selected.name !== initialFile) return;
    // FileDiff lays out in passes (plain, then highlighted, annotations), so the row moves while the
    // body grows: re-scroll each tick until the body height holds steady across a tick with the row found.
    let tries = 0;
    let lastHeight = -1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (): void => {
      const height = bodyRef.current?.getBoundingClientRect().height ?? 0;
      const found = scrollToHunk(bodyRef.current, selected, initialHunk);
      if (found && height === lastHeight) { hunkDone.current = true; return; }
      lastHeight = height;
      tries += 1;
      if (tries < 40) timer = setTimeout(attempt, 100);
    };
    attempt();
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [modal, initialHunk, initialFile, selected]);

  const modalClose = modal && onClose !== undefined
    ? <button className="btn" data-act="close" onClick={onClose}>esc close</button>
    : null;

  if (payload === null && error === null) return <div className="iempty">loading review…</div>;

  if (error !== null) {
    return (
      <div className="rvi-empty">
        <div className="iempty">{error}</div>
        <button className="btn" onClick={() => void reload()}>retry</button>
        {modalClose}
      </div>
    );
  }

  if (payload?.branch === null || payload?.branch === undefined) {
    return <div className="rvi-empty"><div className="iempty">no branch on {payload?.id} — nothing to review</div>{modalClose}</div>;
  }
  if (payload.patch === null) {
    return (
      <div className="rvi-empty">
        <div className="rvi-head">
          {modalClose}
          {onBack !== undefined ? <button className="btn" id="diffBack" onClick={onBack}>← task</button> : ""}
          <span className="fchip2 mono">{payload.branch} → {payload.base ?? "base"}</span>
          <span className="fchip2">{payload.commits.length} commits</span>
          <span className="fchip2">no changes against base</span>
        </div>
      </div>
    );
  }

  const renderAnnotation = (annotation: IslandAnnotation): ReturnType<typeof createElement> => {
    const meta = annotation.metadata;
    return (
      <div className="rvi-ann" key="ann">
        {meta.threads.map((thread) => (
          <ThreadCard key={thread.id} issueId={issueId} thread={thread} actor={actor} reload={reload} fail={fail} />
        ))}
        {meta.draft && draft !== null ? (
          <DraftCard
            issueId={issueId}
            draft={draft}
            actor={actor}
            cancel={() => setDraft(null)}
            reload={reload}
            fail={fail}
          />
        ) : null}
      </div>
    );
  };

  const canEdit = payload.worktree !== null && selected !== null && selected.type !== "deleted";

  const fileRow = (file: FileDiffMetadata): ReturnType<typeof createElement> => {
    const known = payload?.files.some((f) => f.path === file.name);
    const status = known
      ? payload?.files.find((f) => f.path === file.name)?.status ?? ""
      : "";
    return (
      <div key={file.name} className={`dflrow ${file.name === selectedPath ? "sel" : ""}`}>
        <button
          className={`dfl ${file.name === selectedPath ? "sel" : ""}`}
          onClick={() => {
            if (file.name === selectedPath) return;
            if (dirtyRef.current) { toast("unsaved edits — save or discard first"); return; }
            leaveEdit();
            setSelectedPath(file.name);
            setDraft(null);
          }}
        >
          <span className="st">{status}</span>
          <span className="mono">{file.name}</span>
        </button>
        {onOpenFile !== undefined && file.type !== "deleted" ? (
          <button className="dflview" title={`open ${file.name} in the artifact view`} onClick={() => onOpenFile(file.name)}>
            view file
          </button>
        ) : null}
      </div>
    );
  };

  const fileThreadsBlock = selected !== null && (fileLevelThreads.length > 0 || (draft !== null && draft.line === 0 && draft.evidenceId === undefined && draft.filePath === selected.name)) ? (
    <div className="rvi-ann dfthreads">
      {draft !== null && draft.line === 0 && draft.evidenceId === undefined && draft.filePath === selected.name ? (
        <DraftCard issueId={issueId} draft={draft} actor={actor} cancel={() => setDraft(null)} reload={reload} fail={fail} />
      ) : null}
      {fileLevelThreads.map((thread) => (
        <ThreadCard key={thread.id} issueId={issueId} thread={thread} actor={actor} reload={reload} fail={fail} />
      ))}
    </div>
  ) : null;

  if (modal) {
    // The committed changeset's letter when it lists the file, else the working-tree diff's own change type.
    const status = selected === null ? "" : String(payload.files.find((f) => f.path === selected.name)?.status ?? CHANGE_LETTER[selected.type] ?? "");
    const adds = selected?.hunks.reduce((n, h) => n + h.additionLines, 0) ?? 0;
    const dels = selected?.hunks.reduce((n, h) => n + h.deletionLines, 0) ?? 0;
    return (
      <div className="dwrap dmodal-frame">
        <div className="dmenu">
          <span className="mono dm-id">{issueId}</span>
          <span className="dm-sep">/</span>
          <b className="mono dm-path">{selected?.name ?? "no file"}</b>
          {status !== "" ? <span className={`pill ${STATUS_TONE[status.charAt(0)] ?? ""}`}>{status}</span> : null}
          <span className="fchip2"><span className="plus">+{adds}</span> <span className="minus">−{dels}</span></span>
          <span className="dm-acts">
            <button className="btn" data-act="expand" title="open the full diff view at this file" onClick={() => { if (selected !== null) onExpand?.(selected.name); }}>⤢ full view</button>
            {modalClose}
          </span>
        </div>
        <div className="dbody" ref={bodyRef}>
          {selected !== null ? (
            <div className="dfbar">
              <span className="mono">{selected.hunks[0]?.hunkSpecs ?? selected.name}</span>
              <button className="btn" id="diffFileComment" onClick={() => setDraft({ filePath: selected.name, line: 0, side: "new" })}>＋ comment on this file</button>
            </div>
          ) : null}
          {fileThreadsBlock}
          {selected === null ? (
            <div className="iempty">no changed file to show</div>
          ) : (
            <FileDiff
              key={selected.name}
              fileDiff={selected}
              lineAnnotations={annotations}
              renderAnnotation={renderAnnotation}
              options={diffOptions}
            />
          )}
          <div className="dwatch">click any line to comment · file-level via ＋ · comments land in the task's one store with their location</div>
        </div>
        <div className="dm-keys">
          <span><kbd>c</kbd> comment on a line</span>
          <span><kbd>C</kbd> comment on the file</span>
          <span><kbd>esc</kbd> close</span>
          <span className="dm-hint">⤢ full view — file · line · evidence</span>
        </div>
      </div>
    );
  }

  return (
    <div className="dwrap">
      <div className="dmenu">
        {onBack !== undefined ? <button className="btn" id="diffBack" onClick={onBack}>← task</button> : ""}
        <span className="brand">review</span>
        <span className="branch">
          <span className="fchip2 mono">{payload.branch} → {payload.base ?? "base"}</span>
          <span className="fchip2">
            <span className="plus">+{payload.counts.additions}</span> <span className="minus">−{payload.counts.deletions}</span>
          </span>
          <span className="fchip2">{payload.commits.length} commits</span>
          {payload.worktree !== null ? <span className="fchip2 mono">wt {payload.worktree.split("/").pop()}</span> : ""}
        </span>
        <ReviewHeader list={list} sending={sender.sending} onSend={() => void sender.send()} />
        {editing !== null ? (
          <span className="dedit">
            <span className="fchip2 mono">editing {editing.path}{dirty ? " ●" : ""}</span>
            <button className="btn" id="diffSave" disabled={!dirty} onClick={() => void save()}>save</button>
            <button
              className="btn"
              id="diffDone"
              onClick={() => {
                if (!dirtyRef.current) { discard(); return; }
                if (discardArmed) discard();
                else setDiscardArmed(true);
              }}
            >
              {discardArmed ? "discard?" : "done"}
            </button>
            {saveState !== null ? <span className="fchip2" id="diffSaveState">{saveState}</span> : ""}
          </span>
        ) : canEdit ? (
          <span className="dedit">
            <button className="btn" id="diffEdit" title={`edit ${selected?.name ?? ""} in the worktree`} onClick={() => { if (selected !== null) void loadEdit(selected.name, true); }}>edit</button>
            {saveState !== null ? <span className="fchip2" id="diffSaveState">{saveState}</span> : ""}
          </span>
        ) : ""}
      </div>
      <SentPanel sent={sender.sent} onClear={sender.clear} />
      <div className="dmain">
        <div className="dfiles">
          <div className="flhead">Files<span className="cnt">· {files.length}</span></div>
          {files.map(fileRow)}
          {evidence.length > 0 ? (
            <>
              <div className="flhead evhead">Evidence<span className="cnt">· {evidence.length}</span></div>
              {evidence.map((item) => {
                const n = threadCounts(evidenceThreadsOf(threads, item.id)).open;
                return (
                  <button
                    key={item.id}
                    className="dfl evrow"
                    data-ev={item.id}
                    title={`evidence:${item.id} — jump to it in the diff flow`}
                    onClick={() => document.getElementById(`ev-${item.id}`)?.scrollIntoView({ block: "start" })}
                  >
                    <span className="mono">{item.name}</span>
                    <span className={`evn ${n > 0 ? "on" : ""}`}>{n > 0 ? `💬 ${n}` : "—"}</span>
                  </button>
                );
              })}
            </>
          ) : null}
          <div className="dwatch">click a line to comment · threads persist on the task</div>
        </div>
        <div
          className="dbody"
          onKeyDown={(e) => {
            if (editingRef.current !== null && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              if (dirtyRef.current) void save();
            }
          }}
        >
          {selected !== null ? (
            <div className="dfbar">
              <span className="mono">{selected.name}</span>
              <button className="btn" id="diffFileComment" onClick={() => setDraft({ filePath: selected.name, line: 0, side: "new" })}>＋ comment on file</button>
            </div>
          ) : null}
          {fileThreadsBlock}
          <EditProvider createEditor={(options) => new Editor(options)}>
            {selected === null ? (
              <div className="iempty">no file selected</div>
            ) : editing !== null && editing.path === selected.name ? (
              <FileDiff
                key={`edit:${editing.path}:${editing.gen}`}
                fileDiff={editing.fileDiff}
                edit
                editorOptions={editorOptions}
                lineAnnotations={annotations}
                renderAnnotation={renderAnnotation}
                options={diffOptions}
              />
            ) : (
              <FileDiff
                key={selected.name}
                fileDiff={selected}
                lineAnnotations={annotations}
                renderAnnotation={renderAnnotation}
                options={diffOptions}
              />
            )}
          </EditProvider>
          {evidence.map((item) => {
            const composer = `ev-compose-${item.id}`;
            const focusComposer = (): void => { document.getElementById(composer)?.focus(); };
            return (
              <section key={item.id} id={`ev-${item.id}`} className="rvi-ev" data-evidence={item.id}>
                <div className="rvi-loc mono">evidence · {item.name}</div>
                {item.mime.startsWith("image/") ? (
                  <img
                    className="rvi-evimg"
                    src={`/api/issue/${enc}/blob/${encodeURIComponent(item.id)}`}
                    alt={item.name}
                    loading="lazy"
                    title="click to comment on the evidence"
                    onClick={focusComposer}
                  />
                ) : (
                  <span className="atchip" title={item.mime} onClick={focusComposer}>{item.name} · {item.mime}</span>
                )}
                <div className="rvi-ann">
                  {evidenceThreadsOf(threads, item.id).map((thread) => (
                    <ThreadCard key={thread.id} issueId={issueId} thread={thread} actor={actor} reload={reload} fail={fail} />
                  ))}
                  <DraftCard
                    issueId={issueId}
                    draft={{ filePath: `evidence:${item.id}`, line: 0, side: "new", evidenceId: item.id }}
                    actor={actor}
                    cancel={() => {}}
                    reload={reload}
                    fail={fail}
                    persistent
                    inputId={composer}
                  />
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Artifact view (VIEW 2): one worktree file, line + file comments     */
/* ------------------------------------------------------------------ */

/** Metadata the artifact view hangs on each file-line annotation. */
type ArtifactAnnotation = LineAnnotation<AnnotationMeta>;

/** One server-rendered doc block (`GET …/file?path=<doc>&render=doc`, sanitized server-side — 09-08). */
interface DocBlockView {
  readonly line: number;
  readonly endLine: number;
  readonly html: string;
}

/** Artifact view (VIEW 2, D-05): EVIDENCE mode for `?evidence=`, else a worktree file as DOC or CODE. */
const ArtifactView = (props: IslandProps) =>
  props.evidenceId !== undefined && props.evidenceId !== ""
    ? createElement(EvidenceArtifact, { ...props, evidenceId: props.evidenceId })
    : createElement(FileArtifact, props);

const FileArtifact = ({ issueId, actor, onError, onBack, path, theme: themeProp }: IslandProps) => {
  const filePath = path ?? "";
  const doc = isDocPath(filePath);
  const theme = useAppTheme(themeProp);
  const [contents, setContents] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<readonly DocBlockView[]>([]);
  const [list, setList] = useState<ReviewThreadList | null>(null);
  const threads = useMemo((): readonly ReviewThread[] => list?.threads ?? [], [list]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const enc = encodeURIComponent(issueId);
  // Write failures (comment, reply, resolve) toast without replacing the view.
  const fail = useCallback((message: string) => { onError?.(message); }, [onError]);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [file, list] = await Promise.all([
        getJson(`/api/review/${enc}/file?path=${encodeURIComponent(filePath)}${doc ? "&render=doc" : ""}`) as Promise<{ contents: string; blocks?: readonly DocBlockView[] }>,
        getJson(`/api/review/${enc}/threads`) as Promise<ReviewThreadList>,
      ]);
      setContents(file.contents);
      setBlocks(file.blocks ?? []);
      setList(list);
      setError(null);
    } catch (cause) {
      const message = cause instanceof HttpError && cause.status === 404
        ? `file not in the worktree: ${filePath}`
        : messageOf(cause, "failed to load file");
      setError(message);
    }
  }, [enc, filePath, doc]);
  const sender = useSendToAgent(enc, reload, onError);

  useEffect(() => {
    setContents(null);
    setBlocks([]);
    setList(null);
    sender.clear();
    setDraft(null);
    setError(null);
    void reload();
  }, [reload]);

  // Live refresh (D-02): a `review` frame for this task re-reads the file + threads.
  useEffect(() => {
    const refresh = (id: string): void => { if (id === issueId) void reload(); };
    activeRefresh = refresh;
    return () => { if (activeRefresh === refresh) activeRefresh = null; };
  }, [issueId, reload]);

  const fileThreads = useMemo(
    () => threads
      .filter((thread) => thread.filePath === filePath)
      .slice()
      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0)),
    [threads, filePath],
  );

  const annotations = useMemo((): ArtifactAnnotation[] => {
    const groups = new Map<number, ArtifactAnnotation>();
    const group = (line: number): ArtifactAnnotation => {
      const found = groups.get(line);
      if (found !== undefined) return found;
      const created: ArtifactAnnotation = { lineNumber: line, metadata: { threads: [], draft: false } };
      groups.set(line, created);
      return created;
    };
    for (const thread of fileThreads) if (thread.line !== undefined && thread.line > 0) group(thread.line).metadata.threads.push(thread);
    if (draft !== null && draft.line > 0) group(draft.line).metadata.draft = true;
    return [...groups.values()];
  }, [fileThreads, draft]);

  // Content-derived cache key so a live refresh never repaints a stale highlight (05-01 lesson).
  const file = useMemo(
    () => (contents === null ? null : { name: filePath, contents, cacheKey: `${issueId}:${filePath}:${patchHash(contents)}` }),
    [contents, filePath, issueId],
  );

  const back = onBack !== undefined ? <button className="btn" id="fileBack" onClick={onBack}>← task</button> : "";

  if (error !== null) {
    return (
      <div className="rvi-empty">
        <div className="rvi-head">{back}<span className="fchip2 mono">{issueId}/{filePath}</span></div>
        <div className="iempty">{error}</div>
        <button className="btn" onClick={() => void reload()}>retry</button>
      </div>
    );
  }
  if (file === null) return <div className="iempty">loading {filePath}…</div>;

  const counts = threadCounts(fileThreads);
  // DOC: each line thread renders under the first block its line..endLine overlaps (else the last block before it).
  const docThreads = new Map<number, ReviewThread[]>();
  if (doc) {
    for (const thread of fileThreads) {
      if (thread.line === undefined || thread.line <= 0) continue;
      const start = thread.line;
      const end = thread.endLine ?? thread.line;
      let index = blocks.findIndex((block) => block.line <= end && block.endLine >= start);
      if (index < 0) index = blocks.reduce((found, block, i) => (block.line <= start ? i : found), blocks.length > 0 ? 0 : -1);
      if (index < 0) continue;
      docThreads.set(index, [...(docThreads.get(index) ?? []), thread]);
    }
  }
  const hintBlock = draft !== null && draft.line > 0 ? { line: draft.line, endLine: draft.endLine ?? draft.line } : blocks[0];
  const hintRange = hintBlock === undefined ? "lines a–b" : `lines ${hintBlock.line}–${hintBlock.endLine}`;
  const newDraft = (line: number): void => setDraft({ filePath, line, side: "new" });
  const draftCard = (): ReturnType<typeof createElement> | null => draft === null ? null : (
    <DraftCard issueId={issueId} draft={draft} actor={actor} cancel={() => setDraft(null)} reload={reload} fail={fail} />
  );
  const renderAnnotation = (annotation: ArtifactAnnotation): ReturnType<typeof createElement> => (
    <div className="rvi-ann" key="ann">
      {annotation.metadata?.threads.map((thread) => (
        <ThreadCard key={thread.id} issueId={issueId} thread={thread} actor={actor} reload={reload} fail={fail} />
      ))}
      {annotation.metadata?.draft ? draftCard() : null}
    </div>
  );

  return (
    <div className="dwrap artifact">
      <div className="dmenu">
        {back}
        <span className="brand">file</span>
        <span className="mono">{issueId}/{filePath}</span>
        <span className="pill rvi-mode" id="fileMode">{doc ? "DOC" : "CODE"}</span>
        <span className="branch">
          <span className="fchip2" id="fileCounts">{counts.open} open · {counts.resolved} ✓</span>
          <button className="btn" id="fileComment" onClick={() => newDraft(0)}>＋ comment on file</button>
        </span>
      </div>
      <div className="dmain">
        {doc ? (
          <div className="dbody rvi-doc">
            {blocks.length === 0 ? <div className="iempty">empty document</div> : null}
            {blocks.map((block, index) => {
              const range = block.endLine > block.line ? `lines ${block.line}–${block.endLine}` : `line ${block.line}`;
              const own = docThreads.get(index) ?? [];
              const drafting = draft !== null && draft.line === block.line && draft.line > 0;
              return (
                <div className="rvi-docblock" data-line={block.line} data-end-line={block.endLine} key={`${block.line}-${block.endLine}`}>
                  <button
                    className="rvi-gut"
                    aria-label={`comment on ${range}`}
                    title={`comment on ${range}`}
                    onClick={() => setDraft({ filePath, line: block.line, side: "new", ...(block.endLine > block.line ? { endLine: block.endLine } : {}) })}
                  >
                    ＋
                  </button>
                  <div className="rvi-docmain">
                    {/* Server-rendered by Bun.markdown with raw HTML disabled and unsafe href/src scrubbed (09-08, T-09-18). */}
                    <div className="rvi-dochtml" dangerouslySetInnerHTML={{ __html: block.html }} />
                    {own.length > 0 || drafting ? (
                      <div className="rvi-ann">
                        {own.map((thread) => (
                          <ThreadCard key={thread.id} issueId={issueId} thread={thread} actor={actor} reload={reload} fail={fail} />
                        ))}
                        {drafting ? draftCard() : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="dbody">
            <File
              file={file}
              lineAnnotations={annotations}
              renderAnnotation={renderAnnotation}
              options={{
                theme: { dark: "pierre-dark", light: "pierre-light" },
                themeType: theme,
                onLineClick: (props) => newDraft(props.lineNumber),
              }}
            />
          </div>
        )}
        <aside className="apanel">
          <div className="flhead">Comments<span className="cnt">· {fileThreads.length}</span></div>
          <div className="apanel-head">
            <ReviewHeader list={list} sending={sender.sending} onSend={() => void sender.send()} />
          </div>
          <SentPanel sent={sender.sent} onClear={sender.clear} />
          {draft !== null && draft.line === 0 ? draftCard() : null}
          {fileThreads.map((thread) => (
            <ThreadCard key={thread.id} issueId={issueId} thread={thread} actor={actor} reload={reload} fail={fail} />
          ))}
          {fileThreads.length === 0 && (draft === null || draft.line > 0)
            ? <div className="dwatch">{doc ? "no comments on this doc · ＋ beside a block or ＋ comment on file" : "no comments on this file · click a line or ＋ comment on file"}</div>
            : null}
          {doc ? <div className="dwatch rvi-hint" id="docHint">whole file (＋ comment on file) · selection → {hintRange} (gutter ＋)</div> : null}
          <div className="dwatch rvi-note">docs render as docs · code renders as code · same comment surface on both</div>
        </aside>
      </div>
    </div>
  );
};

/** EVIDENCE mode (09-08, D-05/D-06): one evidence item, its comment cards, and a composer at `evidence:<id>`. */
const EvidenceArtifact = ({ issueId, actor, onError, onBack, evidenceId }: IslandProps & { evidenceId: string }) => {
  const [items, setItems] = useState<ReviewPayload["evidence"] | null>(null);
  const [list, setList] = useState<ReviewThreadList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enc = encodeURIComponent(issueId);
  const fail = useCallback((message: string) => { onError?.(message); }, [onError]);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [payload, threads] = await Promise.all([
        getJson(`/api/review/${enc}`) as Promise<ReviewPayload>,
        getJson(`/api/review/${enc}/threads`) as Promise<ReviewThreadList>,
      ]);
      setItems(payload.evidence ?? []);
      setList(threads);
      setError(null);
    } catch (cause) {
      setError(messageOf(cause, "failed to load evidence"));
    }
  }, [enc]);
  const sender = useSendToAgent(enc, reload, onError);

  useEffect(() => {
    setItems(null);
    setList(null);
    setError(null);
    void reload();
  }, [reload, evidenceId]);

  useEffect(() => {
    const refresh = (id: string): void => { if (id === issueId) void reload(); };
    activeRefresh = refresh;
    return () => { if (activeRefresh === refresh) activeRefresh = null; };
  }, [issueId, reload]);

  const threads = useMemo(() => evidenceThreadsOf(list?.threads ?? [], evidenceId), [list, evidenceId]);
  const back = onBack !== undefined ? <button className="btn" id="fileBack" onClick={onBack}>← task</button> : "";
  const item = items?.find((entry) => entry.id === evidenceId);

  if (error !== null || (items !== null && item === undefined)) {
    return (
      <div className="rvi-empty">
        <div className="rvi-head">{back}<span className="fchip2 mono">{issueId}/evidence:{evidenceId}</span></div>
        <div className="iempty">{error ?? `evidence not found: ${evidenceId}`}</div>
        <button className="btn" onClick={() => void reload()}>retry</button>
      </div>
    );
  }
  if (item === undefined) return <div className="iempty">loading evidence:{evidenceId}…</div>;

  const counts = threadCounts(threads);
  const composer = `ev-compose-${item.id}`;
  return (
    <div className="dwrap artifact evidence">
      <div className="dmenu">
        {back}
        <span className="brand">file</span>
        <span className="mono">{issueId} / {item.name}</span>
        <span className="pill rvi-mode" id="fileMode">EVIDENCE</span>
        <span className="branch">
          <span className="fchip2" id="fileCounts">{counts.open} open · {counts.resolved} ✓</span>
        </span>
      </div>
      <div className="dmain">
        <div className="dbody rvi-evbody">
          <div className="rvi-loc mono">evidence:{item.id} · {item.name} · {item.mime}</div>
          {item.mime.startsWith("image/") ? (
            <img
              className="rvi-evimg rvi-evfull"
              src={`/api/issue/${enc}/blob/${encodeURIComponent(item.id)}`}
              alt={item.name}
              title="click to comment on the evidence"
              onClick={() => document.getElementById(composer)?.focus()}
            />
          ) : (
            <span className="atchip" title={item.mime}>{item.name} · {item.mime}</span>
          )}
        </div>
        <aside className="apanel">
          <div className="flhead">Comments<span className="cnt">· {threads.length}</span></div>
          <div className="apanel-head">
            <ReviewHeader list={list} sending={sender.sending} onSend={() => void sender.send()} />
          </div>
          <SentPanel sent={sender.sent} onClear={sender.clear} />
          {threads.map((thread) => (
            <ThreadCard key={thread.id} issueId={issueId} thread={thread} actor={actor} reload={reload} fail={fail} />
          ))}
          <DraftCard
            issueId={issueId}
            draft={{ filePath: `evidence:${item.id}`, line: 0, side: "new", evidenceId: item.id }}
            actor={actor}
            cancel={() => {}}
            reload={reload}
            fail={fail}
            persistent
            inputId={composer}
          />
          <div className="dwatch rvi-note">docs render as docs · code renders as code · same comment surface on both</div>
        </aside>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Mount API consumed by app.html                                      */
/* ------------------------------------------------------------------ */

interface ReviewIslandApi {
  mount(container: HTMLElement, props: IslandProps): void;
  unmount(): void;
  /** Re-fetches the mounted review when it shows `issueId`; no-op otherwise. */
  refresh(issueId: string): void;
}

let root: Root | null = null;

const mount = (container: HTMLElement, props: IslandProps): void => {
  unmount();
  root = createRoot(container);
  root.render(createElement(props.mode === "file" ? ArtifactView : Island, props));
};

const unmount = (): void => {
  root?.unmount();
  root = null;
};

const refresh = (issueId: string): void => { activeRefresh?.(issueId); };

(globalThis as { ReviewIsland?: ReviewIslandApi }).ReviewIsland = { mount, unmount, refresh };
