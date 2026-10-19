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
 */
import { parsePatchFiles, type DiffLineAnnotation, type FileDiffMetadata } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/edit";
import { EditProvider, FileDiff } from "@pierre/diffs/react";
import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReviewPayload } from "../review";
import type { ReviewCommentSide, ReviewThread, ReviewThreadList } from "@tasks/review";

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

const messageOf = (cause: unknown, fallback: string): string =>
  cause instanceof Error ? cause.message : fallback;

const getJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url);
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
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
}

interface IslandProps {
  readonly issueId: string;
  readonly actor: string;
  readonly onError?: (message: string) => void;
}

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
  return (
    <div className={`rvi-thread ${thread.resolved ? "res" : ""}`}>
      <div className="rvi-trow">
        <span className={`pill ${thread.resolved ? "res" : "open"}`}>{thread.resolved ? "✓ resolved" : "open"}</span>
        {thread.line !== undefined ? (
          <span className="rvi-loc mono">
            {thread.side === "old" ? "old" : "new"} · line {thread.line}
          </span>
        ) : (
          <span className="rvi-loc">file-level</span>
        )}
        <button
          className="btn"
          onClick={() => void run(() => postJson(`/api/review/${enc}/threads/${encodeURIComponent(thread.id)}/resolve`, { resolved: !thread.resolved }))}
        >
          {thread.resolved ? "reopen" : "resolve"}
        </button>
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
              <span onDoubleClick={() => { setEditingId(c.id); setEditText(c.body); }}>
                {c.body}
                {c.editedAt !== undefined ? <span className="at"> · edited</span> : ""}
                {c.author === actor ? <button className="reply" onClick={() => { setEditingId(c.id); setEditText(c.body); }}>edit</button> : ""}
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
}: {
  issueId: string;
  draft: Draft;
  actor: string;
  cancel: () => void;
  reload: () => void;
  fail: (message: string) => void;
}) => {
  const [body, setBody] = useState("");
  const enc = encodeURIComponent(issueId);
  const create = async (): Promise<void> => {
    const text = body.trim();
    if (!text) return;
    try {
      await postJson(`/api/review/${enc}/threads`, {
        filePath: draft.filePath,
        body: text,
        ...(draft.line > 0 ? { line: draft.line, side: draft.side } : {}),
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
          {draft.side === "old" ? "old" : "new"} · {draft.line > 0 ? `line ${draft.line}` : "file"}
        </span>
        <span className="rvi-loc">{actor}</span>
      </div>
      <textarea
        className="rvi-edit"
        placeholder="Comment on this line…"
        value={body}
        rows={3}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void create();
        }}
      />
      <div className="rvi-actions">
        <button className="btn" onClick={() => void create()}>Comment</button>
        <button className="btn" onClick={cancel}>cancel</button>
        <span className="at">⌘↵ to submit</span>
      </div>
    </div>
  );
};

const Island = ({ issueId, actor, onError }: IslandProps) => {
  const [payload, setPayload] = useState<ReviewPayload | null>(null);
  const [threads, setThreads] = useState<readonly ReviewThread[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const enc = encodeURIComponent(issueId);
  const fail = useCallback((message: string) => { setError(message); onError?.(message); }, [onError]);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const data = await getJson(`/api/review/${enc}`) as ReviewPayload;
      setPayload(data);
      const list = await getJson(`/api/review/${enc}/threads`) as ReviewThreadList;
      setThreads(list.threads);
      setError(null);
    } catch (cause) {
      fail(messageOf(cause, "failed to load review"));
    }
  }, [enc, fail]);

  useEffect(() => {
    setPayload(null);
    setThreads([]);
    setSelectedPath(null);
    setDraft(null);
    setError(null);
    void reload();
  }, [reload]);

  const files = useMemo((): readonly FileDiffMetadata[] => {
    if (payload?.patch === null || payload?.patch === undefined || payload.patch === "") return [];
    return parsePatchFiles(payload.patch).flatMap((parsed) => parsed.files);
  }, [payload]);

  // Default selection: first file that still exists under its new name.
  useEffect(() => {
    if (selectedPath !== null && files.some((f) => f.name === selectedPath)) return;
    setSelectedPath(files.length > 0 ? files[0]!.name : null);
  }, [files, selectedPath]);

  const selected = useMemo(
    () => (selectedPath === null ? null : files.find((f) => f.name === selectedPath) ?? null),
    [files, selectedPath],
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
      if (thread.filePath !== selectedPath) continue;
      group(sideToAnnotation(thread.side ?? "new"), thread.line ?? 0).metadata.threads.push(thread);
    }
    if (draft !== null && draft.filePath === selectedPath) {
      group(sideToAnnotation(draft.side), draft.line).metadata.draft = true;
    }
    return [...groups.values()];
  }, [threads, draft, selectedPath]);

  if (payload === null && error === null) return <div className="iempty">loading review…</div>;

  if (error !== null) {
    return (
      <div className="rvi-empty">
        <div className="iempty">{error}</div>
        <button className="btn" onClick={() => void reload()}>retry</button>
      </div>
    );
  }

  if (payload?.branch === null || payload?.branch === undefined) {
    return <div className="iempty">no branch on {payload?.id} — nothing to review</div>;
  }
  if (payload.patch === null) {
    return (
      <div className="rvi-empty">
        <div className="rvi-head">
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

  const fileRow = (file: FileDiffMetadata): ReturnType<typeof createElement> => {
    const known = payload?.files.some((f) => f.path === file.name);
    const status = known
      ? payload?.files.find((f) => f.path === file.name)?.status ?? ""
      : "";
    return (
      <button
        key={file.name}
        className={`dfl ${file.name === selectedPath ? "sel" : ""}`}
        onClick={() => { setSelectedPath(file.name); setDraft(null); }}
      >
        <span className="st">{status}</span>
        <span className="mono">{file.name}</span>
      </button>
    );
  };

  return (
    <div className="dwrap">
      <div className="dmenu">
        <span className="brand">review</span>
        <span className="branch">
          <span className="fchip2 mono">{payload.branch} → {payload.base ?? "base"}</span>
          <span className="fchip2">
            <span className="plus">+{payload.counts.additions}</span> <span className="minus">−{payload.counts.deletions}</span>
          </span>
          <span className="fchip2">{payload.commits.length} commits</span>
          {payload.worktree !== null ? <span className="fchip2 mono">wt {payload.worktree.split("/").pop()}</span> : ""}
        </span>
      </div>
      <div className="dmain">
        <div className="dfiles">
          <div className="flhead">Files<span className="cnt">· {files.length}</span></div>
          {files.map(fileRow)}
          <div className="dwatch">click a line to comment · threads persist on the task</div>
        </div>
        <div className="dbody">
          <EditProvider createEditor={(options) => new Editor(options)}>
            {selected === null ? (
              <div className="iempty">no file selected</div>
            ) : (
              <FileDiff
                key={selected.name}
                fileDiff={selected}
                lineAnnotations={annotations}
                renderAnnotation={renderAnnotation}
                options={{
                  theme: typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches ? "pierre-light" : "pierre-dark",
                  onLineClick: (props) => {
                    setDraft({ filePath: selected.name, line: props.lineNumber, side: annotationToSide(props.annotationSide) });
                  },
                }}
              />
            )}
          </EditProvider>
        </div>
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
}

let root: Root | null = null;

const mount = (container: HTMLElement, props: IslandProps): void => {
  unmount();
  root = createRoot(container);
  root.render(createElement(Island, props));
};

const unmount = (): void => {
  root?.unmount();
  root = null;
};

(globalThis as { ReviewIsland?: ReviewIslandApi }).ReviewIsland = { mount, unmount };
