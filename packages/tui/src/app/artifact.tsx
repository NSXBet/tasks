import { useEffect, useRef, useState, type ReactNode } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { reviewLocationLabel, reviewThreadCounts, type ReviewThread } from "@tasks/review";
import { commentStatusBadge, reviewHeaderLabel } from "@tasks/review/lifecycle";
import { docBlocks, isDocPath, threadLocation, type DocBlock } from "@tasks/review/taskview";
import { navWidth, useApp, type ArtifactTarget, type ReviewState } from "./context.js";
import type { RouteEntry } from "./routes.js";
import { colors } from "../theme.js";
import { truncate } from "../format.js";
import { readGuardedFile, type GuardedRead } from "../review/edit.js";
import { ReviewKeybar, reviewEvidence, reviewTarget } from "./diff.js";
import { EvidenceImage } from "./evidence-image.js";
import { mdLines } from "./markdown.js";
import { MdLineView } from "./markdown-view.js";

/**
 * The artifact view (`6`, `tk://artifact`) — spec VIEW 2, D-05. One artifact
 * of the task opened as a file, separate from the diff:
 *
 *   CODE      numbered lines with a cursor; `c` comments the cursor line
 *             (`path:line`), `C` the whole file (`path`); line threads render
 *             inline under their line
 *   DOC       `.md` shaped like the detail pane, one `docBlocks` block per
 *             cursor stop; `c` comments the block's range (`path:line-endLine`)
 *   EVIDENCE  the `EvidenceImage` with its caption row; `c` / `C` comment at
 *             `evidence:<id>`
 *
 * Header `<id> / <path>` with the `N OPEN · K ✓` count of this artifact's
 * threads and the mode tag; the right panel lists every comment on the
 * artifact (file-level first, then by line). File reads go through the 04-02
 * worktree guard (`readGuardedFile`): the task worktree when the review source
 * has one, else the workspace root. `esc` returns to the task view.
 */

type Mode = "CODE" | "DOC" | "EVIDENCE";


/** Rows the page chrome takes around the body: header, spacer, key bar, composer, status bar. */
const CHROME_ROWS = 8;

const targetKey = (target: ArtifactTarget): string => (target.kind === "file" ? `file:${target.path}` : `evidence:${target.id}`);

/** The comment location every view keys threads by. */
const targetLocation = (target: ArtifactTarget): string => (target.kind === "file" ? target.path : `evidence:${target.id}`);

/** The explicit target, else the review session's selected file or evidence entry. */
const effectiveTarget = (explicit: ArtifactTarget | null, review: ReviewState | null, evidence: Parameters<typeof reviewTarget>[1]): ArtifactTarget | null => {
  if (explicit !== null) return explicit;
  if (review === null) return null;
  const selected = reviewTarget(review, evidence);
  if (selected === null) return null;
  if (selected.kind === "evidence") return { kind: "evidence", id: selected.entry.id, name: selected.entry.name };
  return selected.file.path === undefined || selected.file.path === "" ? null : { kind: "file", path: selected.file.path };
};

const displayBody = (body: string): string => body.replace(/^\[review [^\]]*\]\s*/, "");

const threadColor = (thread: ReviewThread): string =>
  thread.status === "resolved" ? colors.green : thread.status === "dismissed" ? colors.dim : colors.text;

/** File-level threads first, then by line. */
const byPlacement = (left: ReviewThread, right: ReviewThread): number => (left.line ?? 0) - (right.line ?? 0);

/** `N OPEN · K ✓`, `ALL RESOLVED`, or `NO COMMENTS` for the threads on one artifact. */
const artifactLabel = (threads: readonly ReviewThread[]): string => {
  const counts = reviewThreadCounts(threads);
  return reviewHeaderLabel({ counts, allResolved: counts.total > 0 && counts.unresolved === 0 }).toUpperCase();
};

/** One inline thread row under its line or block: `▸ author: body · badge`. */
const InlineThread = ({ thread, width }: { readonly thread: ReviewThread; readonly width: number }) => {
  const first = thread.comments[0];
  const replies = thread.comments.length - 1;
  const tail = ` · ${commentStatusBadge(thread.status)}${replies > 0 ? ` · ${replies} repl${replies === 1 ? "y" : "ies"}` : ""}`;
  const head = `      ▸ ${first?.author ?? "?"}: `;
  return (
    <text>
      <span fg={colors.accent}>{head}</span>
      <span fg={threadColor(thread)}>{truncate(displayBody(first?.body ?? "").split("\n")[0] ?? "", Math.max(4, width - head.length - tail.length))}</span>
      <span fg={colors.dim}>{tail}</span>
    </text>
  );
};

/** The right panel: `COMMENTS · …` and every thread on the artifact. */
const CommentsPanel = ({ threads, width }: { readonly threads: readonly ReviewThread[]; readonly width: number }) => {
  const inner = Math.max(4, width - 3);
  return (
    <box style={{ width, flexShrink: 0, flexDirection: "column", paddingLeft: 1, overflow: "hidden" }} border={["left"]} borderStyle="single" borderColor={colors.border}>
      <text fg={colors.dim} content={truncate(`COMMENTS · ${artifactLabel(threads)}`, inner)} />
      {threads.length === 0 ? <text fg={colors.dim} content={truncate("no comments — c line · C whole file", inner)} /> : null}
      {threads.map((thread) => (
        <box key={thread.id} style={{ flexDirection: "column", marginTop: 1 }}>
          <text fg={threadColor(thread)} content={truncate(`${commentStatusBadge(thread.status)} ${reviewLocationLabel(thread)}`, inner)} />
          {thread.comments.map((comment) => (
            <text key={comment.id} fg={colors.text} content={truncate(`  ${comment.author}: ${displayBody(comment.body)}`, inner)} />
          ))}
        </box>
      ))}
    </box>
  );
};

interface Row {
  readonly key: string;
  readonly node: ReactNode;
}

/**
 * Keeps the focused rows `[from, to]` in a `size`-row window, scrolling only
 * as far as needed (the previous start lives in `scroll`).
 */
const windowRows = (rows: readonly Row[], from: number, to: number, size: number, scroll: { current: number }): readonly Row[] => {
  let start = scroll.current;
  if (to >= start + size) start = to - size + 1;
  if (from < start) start = from;
  start = Math.max(0, Math.min(start, Math.max(0, rows.length - size)));
  scroll.current = start;
  return rows.slice(start, start + size);
};

type FileState = { readonly status: "loading" } | { readonly status: "read"; readonly outcome: GuardedRead };

const readMessage = (outcome: Exclude<GuardedRead, { ok: true }>, path: string): string =>
  outcome.reason === "escape"
    ? "refused: outside the worktree"
    : outcome.reason === "too-large"
      ? `file too large to render (${(outcome.size / (1024 * 1024)).toFixed(1)} MB)`
      : `not in the worktree: ${path}`;

const ArtifactPage = ({ target, review }: { readonly target: ArtifactTarget; readonly review: ReviewState }) => {
  const { state, actions } = useApp();
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const mode: Mode = target.kind === "evidence" ? "EVIDENCE" : isDocPath(target.path) ? "DOC" : "CODE";
  const location = targetLocation(target);
  const threads = review.threads.filter((thread) => threadLocation(thread) === location).sort(byPlacement);
  const source = review.source;
  // The task worktree when the source located one, else the workspace root (path attachments).
  const root = source === null ? null : source.worktree !== null ? source.cwd : state.store.surface.store.root;
  const [file, setFile] = useState<FileState>({ status: "loading" });
  const [cursor, setCursor] = useState(0);
  const cursorRef = useRef(0);
  cursorRef.current = cursor;
  const scroll = useRef(0);

  // Re-read on every live re-derive of the source too, so worktree edits re-render.
  const filePath = target.kind === "file" ? target.path : null;
  useEffect(() => {
    if (filePath === null || root === null) return;
    let alive = true;
    void readGuardedFile(root, filePath).then((outcome) => { if (alive) setFile({ status: "read", outcome }); });
    return () => { alive = false; };
  }, [filePath, root, source]);

  const text = file.status === "read" && file.outcome.ok ? file.outcome.text : null;
  const binary = text !== null && text.includes("\u0000");
  const lines = text === null || binary ? [] : (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
  const blocks: readonly DocBlock[] = mode === "DOC" && text !== null && !binary ? docBlocks(text) : [];
  const stops = mode === "DOC" ? blocks.length : mode === "CODE" ? lines.length : 0;
  const at = Math.max(0, Math.min(cursor, stops - 1));

  useKeyboard((key) => {
    if (state.composer.mode !== "closed" || state.helpOpen || state.paletteOpen || state.modalId !== null || state.diffOpen) return;
    const move = (next: number): void => {
      const clamped = Math.max(0, Math.min(next, stops - 1));
      cursorRef.current = clamped;
      setCursor(clamped);
    };
    const current = Math.max(0, Math.min(cursorRef.current, stops - 1));
    const wholeFile = () => actions.openReviewComposer("file", { filePath: target.kind === "file" ? target.path : location, line: null, endLine: null, evidenceId: target.kind === "evidence" ? target.id : null });
    if (key.name === "escape") { actions.setView("task"); return; }
    if (key.name === "j" || key.name === "down") { move(current + 1); return; }
    if (key.name === "k" || key.name === "up") { move(current - 1); return; }
    switch (key.sequence) {
      case "g": move(0); break;
      case "G": move(stops - 1); break;
      case "C": wholeFile(); break;
      case "c": {
        if (mode === "CODE" && stops > 0 && target.kind === "file") {
          actions.openReviewComposer("comment", { filePath: target.path, line: current + 1, endLine: null, evidenceId: null });
        } else if (mode === "DOC" && stops > 0 && target.kind === "file") {
          const block = blocks[current]!;
          actions.openReviewComposer("comment", { filePath: target.path, line: block.line, endLine: block.endLine === block.line ? null : block.endLine, evidenceId: null });
        } else {
          // Evidence, or nothing to put a cursor on: the whole artifact.
          wholeFile();
        }
        break;
      }
      default: break;
    }
  });

  const available = Math.max(40, termWidth - navWidth(state));
  const panelWidth = Math.max(24, Math.floor(available * 0.32));
  const bodyWidth = Math.max(16, available - panelWidth - 2);
  const bodyRows = Math.max(4, termHeight - CHROME_ROWS - (state.composer.mode === "closed" ? 0 : 3));
  const label = artifactLabel(threads);
  const title = target.kind === "file" ? target.path : `evidence:${target.id} · ${target.name}`;
  const head = `${review.issueId} / `;
  const right = `${label}  ${mode}`;

  const body = ((): ReactNode => {
    if (target.kind === "evidence") {
      const live = threads.filter((thread) => thread.status === "open" || thread.status === "sent").length;
      return (
        <box key={`evidence:${target.id}`} style={{ flexDirection: "column" }}>
          <EvidenceImage issueId={review.issueId} refId={target.id} maxCellWidth={Math.max(4, bodyWidth - 4)} caption={{ comments: live }} />
          {threads.map((thread) => <InlineThread key={thread.id} thread={thread} width={bodyWidth} />)}
        </box>
      );
    }
    if (root === null) return <text fg={colors.dim} content={review.loading ? "resolving review source…" : "no review source"} />;
    if (file.status === "loading") return <text fg={colors.dim} content="reading…" />;
    if (!file.outcome.ok) return <text fg={colors.red} content={truncate(readMessage(file.outcome, target.path), bodyWidth)} />;
    if (binary) return <text fg={colors.dim} content="binary file — not rendered · C comments on the whole file" />;
    if (stops === 0) return <text fg={colors.dim} content="(empty file) · C comments on the whole file" />;

    const rows: Row[] = [];
    let focusFrom = 0;
    let focusTo = 0;
    if (mode === "CODE") {
      const gutter = String(lines.length).length;
      const byLine = new Map<number, ReviewThread[]>();
      for (const thread of threads) {
        if (thread.line === undefined) continue;
        byLine.set(thread.line, [...(byLine.get(thread.line) ?? []), thread]);
      }
      lines.forEach((line, index) => {
        const active = index === at;
        if (active) focusFrom = rows.length;
        rows.push({
          key: `l${index}`,
          node: (
            <text>
              <span fg={active ? colors.accent : colors.dim} bg={active ? colors.selection : colors.bg}>{`${String(index + 1).padStart(gutter)} │ `}</span>
              <span fg={colors.text} bg={active ? colors.selection : colors.bg}>{truncate(line.replace(/\t/g, "  "), Math.max(1, bodyWidth - gutter - 3))}</span>
            </text>
          ),
        });
        for (const thread of byLine.get(index + 1) ?? []) rows.push({ key: `t${thread.id}`, node: <InlineThread thread={thread} width={bodyWidth} /> });
        if (active) focusTo = rows.length - 1;
      });
    } else {
      // DOC: each thread renders under the first block its range overlaps.
      const placed = new Set<string>();
      blocks.forEach((block, index) => {
        const active = index === at;
        if (index > 0) rows.push({ key: `gap${index}`, node: <text content=" " /> });
        if (active) focusFrom = rows.length;
        mdLines(block.text).forEach((line, offset) => {
          rows.push({
            key: `b${index}:${offset}`,
            node: (
              <box style={{ flexDirection: "row" }}>
                <text fg={colors.accent} content={active ? "▌ " : "  "} />
                <MdLineView line={line} issueId={review.issueId} maxCellWidth={Math.max(4, bodyWidth - 6)} width={bodyWidth - 2} />
              </box>
            ),
          });
        });
        for (const thread of threads) {
          if (thread.line === undefined || placed.has(thread.id)) continue;
          const end = thread.endLine ?? thread.line;
          if (thread.line <= block.endLine && end >= block.line) {
            placed.add(thread.id);
            rows.push({ key: `t${thread.id}`, node: <InlineThread thread={thread} width={bodyWidth} /> });
          }
        }
        if (active) focusTo = rows.length - 1;
      });
    }
    return (
      <box key={`${mode}:${location}`} style={{ flexDirection: "column" }}>
        {windowRows(rows, focusFrom, focusTo, bodyRows, scroll).map((row) => (
          <box key={row.key} style={{ flexDirection: "column", flexShrink: 0 }}>{row.node}</box>
        ))}
      </box>
    );
  })();

  const block = mode === "DOC" ? blocks[at] : undefined;
  const keyLines: readonly string[] = mode === "CODE"
    ? ["j/k line  g/G first/last  c comment on the line  C comment on the file  esc back to task  ? help"]
    : mode === "DOC"
      ? [`j/k block  g/G first/last  whole file (C) · selection → lines ${block === undefined ? "a–b" : `${block.line}–${block.endLine}`} (c)  esc back to task  ? help`]
      : [`c / C comment on ${location}  esc back to task  ? help`];

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1 }}>
        <text style={{ flexGrow: 1 }}>
          <span fg={colors.dim}>{head}</span>
          <span fg={colors.text}><strong>{truncate(title, Math.max(1, available - head.length - right.length - 4))}</strong></span>
        </text>
        <text>
          <span fg={threads.length > 0 ? colors.accent : colors.dim}>{label}</span>
          <span fg={colors.dim}>{"  "}</span>
          <span fg={colors.cyan}>{mode}</span>
          <span>{" "}</span>
        </text>
      </box>
      <box style={{ flexDirection: "row", flexGrow: 1, marginTop: 1 }}>
        <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, overflow: "hidden" }}>{body}</box>
        <CommentsPanel threads={threads} width={panelWidth} />
      </box>
      <ReviewKeybar lines={keyLines} />
    </box>
  );
};

/**
 * The artifact view. With no explicit target it opens the review session's
 * selected file (or evidence entry); with no review yet it warms one for the
 * task the task view shows.
 */
export const ArtifactView = () => {
  const { state, actions } = useApp();
  const issueId = state.review?.issueId ?? state.detailId ?? state.board.issues[0]?.id ?? null;
  useEffect(() => {
    if (state.review === null && issueId !== null) actions.ensureReview(issueId);
  }, [state.review === null, issueId, actions.ensureReview]);
  const review = state.review;
  const evidence = reviewEvidence(state.board.issues.find((candidate) => candidate.id === review?.issueId));
  const target = effectiveTarget(state.artifact, review, evidence);
  if (review === null || target === null) return <ArtifactEmpty loading={review?.loading ?? true} />;
  return <ArtifactPage key={targetKey(target)} target={target} review={review} />;
};

const ArtifactEmpty = ({ loading }: { readonly loading: boolean }) => {
  const { state, actions } = useApp();
  useKeyboard((key) => {
    if (state.composer.mode !== "closed" || state.helpOpen || state.paletteOpen || state.modalId !== null || state.diffOpen) return;
    if (key.name === "escape") actions.setView("task");
  });
  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box style={{ paddingLeft: 1, paddingTop: 1, flexDirection: "column", flexGrow: 1 }}>
        <text fg={colors.dim} content={loading ? "resolving review source…" : "no artifact open — in the task view, J/K select an artifact and o opens it"} />
      </box>
      <ReviewKeybar lines={["esc back to task  ? help"]} />
    </box>
  );
};

/** Deep link `tk://artifact`. */
export const artifactRoute: RouteEntry = { kind: "artifact", path: ["artifact"], apply: (sink) => { sink.setView("artifact"); } };
