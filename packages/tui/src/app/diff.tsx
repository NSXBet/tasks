import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { HUNK_DIFF_THEME_NAMES, HunkDiffView, HunkFileNav } from "@tasks/review/opentui";
import { HunkEditBuffer } from "./hunkEdit.js";
import { navWidth as shellNavWidth, useApp, type ReviewState } from "./context.js";
import { EvidenceImage } from "./evidence-image.js";
import type { RouteEntry } from "./routes.js";
import { colors } from "../theme.js";
import { truncate } from "../format.js";
import { reviewThreadCounts, type ReviewThread } from "@tasks/review";
import { commentStatusBadge, reviewHeaderLabel, sendableCount } from "@tasks/review/lifecycle";
import { threadLocation } from "@tasks/review/taskview";
import { isBlobAttachment, type Issue, type IssueBlobAttachment } from "@tasks/domain";
import type { HunkDiffFile } from "@tasks/review/opentui";

/**
 * The live diff review page: the vendored hunk component over the task's
 * tk-derived diff (worktree against the pinned base). The session is live —
 * commits and edits in the worktree re-render it — editable (`e` writes the
 * selected hunk back to the worktree file), and commentable: threads are
 * anchored to hunks and persisted on the task record that `tk show` reads.
 * The keys are hunk's own (`]`/`[` hunk, `.`/`,` file, `1`/`2` layout,
 * `c`/`E`/`R` notes, `s`/`l`/`a`/`t`/`z` view, `/` search, `v`/`y` select
 * and copy, `q` quit); see the map above `useReviewKeys`.
 */

/** Key bar: line 1 is the spec bar minus `r refresh` (D-02); line 2 the tk extras. */
const keysLines: readonly string[] = [
  "q quit  c note  ]/[ hunk  ./, file  1/2 layout  s files  l line numbers  z context  / search  v select  y copy  a notes  t theme  ? help",
  "R reply  E edit note  e edit hunk  x ✓ done · D ✕ remove · S send to agent  J/K note  o open as file  esc back",
];

const fileGlyph = (isBinary: boolean): string => (isBinary ? "B" : "+");

const statsLine = (source: { additions: number; deletions: number; branch: string | null; base: string | null }): string =>
  `${source.branch ?? "(no branch)"} ← ${source.base === null ? "(no base)" : shortRev(source.base)} · +${source.additions} −${source.deletions}`;

/** A full 40/64-hex object id shortened to 12 chars; refs and short ids pass through. */
const shortRev = (rev: string): string => (/^[0-9a-f]{40,64}$/.test(rev) ? rev.slice(0, 12) : rev);

/** Threads at one location (a file path or `evidence:<id>`), in stored order. */
export const locationThreads = (threads: readonly ReviewThread[], location: string | null): readonly ReviewThread[] =>
  location === null ? [] : threads.filter((thread) => threadLocation(thread) === location);

/** The task's evidence entries (blob attachments), in attach order — listed after the files (D-06). */
export const reviewEvidence = (issue: Issue | null | undefined): readonly IssueBlobAttachment[] =>
  issue === null || issue === undefined ? [] : issue.attachments.filter(isBlobAttachment);

/**
 * What the review selection points at: `fileIndex` walks the changed files,
 * then past them into the evidence entries (`fileIndex - files.length`).
 * `location` is the thread location (`threadLocation`) of the target.
 */
export type ReviewTarget =
  | { readonly kind: "file"; readonly file: HunkDiffFile; readonly location: string }
  | { readonly kind: "evidence"; readonly entry: IssueBlobAttachment; readonly index: number; readonly location: string };

export const reviewTarget = (review: ReviewState, evidence: readonly IssueBlobAttachment[]): ReviewTarget | null => {
  const files = review.source?.files ?? [];
  const file = files[review.fileIndex];
  if (file !== undefined) return { kind: "file", file, location: file.path ?? "" };
  const index = review.fileIndex - files.length;
  const entry = index >= 0 ? evidence[index] : undefined;
  return entry === undefined ? null : { kind: "evidence", entry, index, location: `evidence:${entry.id}` };
};

/** Open + sent threads at a location (the `💬 N` count). */
const liveCount = (threads: readonly ReviewThread[], location: string): number =>
  locationThreads(threads, location).filter((thread) => thread.status === "open" || thread.status === "sent").length;

/** Row colour by stored status: green resolved, dim dismissed, plain otherwise. */
const threadColor = (thread: ReviewThread): string =>
  thread.status === "resolved" ? colors.green : thread.status === "dismissed" ? colors.dim : colors.text;

/**
 * The rail header over ALL of the task's comments (not just the file's):
 * `COMMENTS · N open · K ✓`, `COMMENTS · All resolved`, or `COMMENTS · no comments`,
 * plus `S send N to agent` (null when nothing is open) so the pending batch size
 * is visible. The send hint gets its own rail row: beside the header it would
 * not fit the rail's width.
 */
export const commentsHeader = (threads: readonly ReviewThread[]): { readonly text: string; readonly send: string | null; readonly allResolved: boolean } => {
  const counts = reviewThreadCounts(threads);
  const allResolved = counts.total > 0 && counts.unresolved === 0;
  const sendable = sendableCount(counts);
  return { text: `COMMENTS · ${reviewHeaderLabel({ counts, allResolved })}`, send: sendable > 0 ? `S send ${sendable} to agent` : null, allResolved };
};

/** The live-watch line under the full-page workbench (spec §3), followed by a green `●`. */
export const WATCHING_LINE = "watching worktree — re-derives as commits land";

/** Thread rail width in columns; the diff body gets what is left. */
const RAIL_WIDTH = 36;

/** Full-page file nav width in columns (fixed: hunk's nav box is `width: 100%` and would otherwise grow). */
const NAV_WIDTH = 34;


/**
 * A stored review comment body without its `[review <loc>]` / `[review reply]`
 * storage prefix — the rail already shows the location on the thread line.
 */
const displayBody = (body: string): string => body.replace(/^\[review [^\]]*\]\s*/, "");

const ThreadList = ({ threads, all, sel, width = RAIL_WIDTH }: { threads: readonly ReviewThread[]; all: readonly ReviewThread[]; sel: number; width?: number }) => {
  const header = commentsHeader(all);
  const headerRow = (
    <box style={{ flexDirection: "column" }}>
      <text fg={header.allResolved ? colors.green : colors.dim} content={truncate(header.text, width - 2)} />
      {header.send === null ? null : <text fg={colors.accent} content={truncate(header.send, width - 2)} />}
    </box>
  );
  if (threads.length === 0) {
    return (
      <box style={{ flexDirection: "column" }}>
        {headerRow}
        <text fg={colors.dim} content="no threads — press c on a hunk to start one" />
      </box>
    );
  }
  return (
    <box style={{ flexDirection: "column" }}>
      {headerRow}
      {threads.map((thread, index) => (
        <box key={thread.id} style={{ flexDirection: "column" }}>
          <text
            fg={index === sel ? colors.borderFocus : threadColor(thread)}
            content={truncate(`${index === sel ? "▸" : " "} ${commentStatusBadge(thread.status)} ${thread.filePath}${thread.line !== undefined ? `:${thread.line}` : ""}`, width - 2)}
          />
          {thread.comments.map((comment) => (
            <text key={comment.id} fg={colors.text} content={truncate(`   ${comment.author}: ${displayBody(comment.body)}`, width - 2)} />
          ))}
        </box>
      ))}
    </box>
  );
};

/**
 * The full-page nav's evidence block (D-06): `EVIDENCE · N`, then one
 * `▣ <name> · 💬 N` row per entry, the selected one marked `▌`. The entries
 * sit after the files in the `]` / `.` walk.
 */
const EvidenceNav = ({ evidence, threads, selected, width }: {
  readonly evidence: readonly IssueBlobAttachment[];
  readonly threads: readonly ReviewThread[];
  readonly selected: number | null;
  readonly width: number;
}) => (
  <box style={{ flexDirection: "column", flexShrink: 0, marginTop: 1 }}>
    <text fg={colors.dim} content={truncate(`EVIDENCE · ${evidence.length}`, Math.max(1, width - 1))} />
    {evidence.map((entry, index) => {
      const active = index === selected;
      const count = liveCount(threads, `evidence:${entry.id}`);
      const tail = ` · 💬 ${count}`;
      return (
        <text key={entry.id}>
          <span fg={colors.borderFocus}>{active ? "▌" : " "}</span>
          <span fg={active ? colors.text : colors.dim}>{truncate(`▣ ${entry.name}`, Math.max(1, width - 2 - tail.length - 1))}</span>
          <span fg={count > 0 ? colors.accent : colors.dim}>{tail}</span>
        </text>
      );
    })}
  </box>
);

/** The review workbench: nav (files, then EVIDENCE) + diff or evidence body + thread rail. */
export const Workbench = ({ compact }: { compact: boolean }) => {
  const { state, actions } = useApp();
  const review = state.review;
  const { width: termWidth } = useTerminalDimensions();
  if (review === null || review.source === null) {
    return (
      <box style={{ paddingLeft: 1, paddingTop: 1, flexDirection: "column" }}>
        <text fg={colors.dim} content={review?.loading ?? false ? "resolving review source…" : "no review open — open a task and press v, or tk://diff/<id>"} />
      </box>
    );
  }
  const { source } = review;
  if (source.error !== null) {
    return (
      <box style={{ paddingLeft: 1, paddingTop: 1, flexDirection: "column" }}>
        <text fg={colors.red} content={truncate(`review: ${source.error}`, Math.max(1, termWidth - 2))} />
      </box>
    );
  }
  if (source.empty === "no-branch") {
    return (
      <box style={{ paddingLeft: 1, paddingTop: 1, flexDirection: "column" }}>
        <text fg={colors.dim} content={truncate(`no branch yet — run tk work ${source.issueId}`, Math.max(1, termWidth - 2))} />
        <text fg={colors.accent} content={truncate(`  tk work ${source.issueId}`, Math.max(1, termWidth - 2))} />
      </box>
    );
  }
  const evidence = reviewEvidence(state.board.issues.find((candidate) => candidate.id === review.issueId));
  const target = reviewTarget(review, evidence);
  const file = target?.kind === "file" ? target.file : null;
  const threads = locationThreads(review.threads, target?.location ?? null);
  const navWidth = compact ? Math.min(28, Math.floor(termWidth / 4)) : NAV_WIDTH;
  const showNav = compact || review.showFiles;
  const showRail = !compact && review.showNotes;
  const theme = review.theme ?? undefined;
  // The body width must match the columns actually left over: an over-wide
  // body clips unified lines and word-wraps split's new side out of its row.
  // Hidden panes (`s` files, `a` notes) hand their columns to the body.
  const bodyWidth = compact
    ? termWidth - 32
    : termWidth - shellNavWidth(state) - (showNav ? NAV_WIDTH : 0) - 1 - (showRail ? RAIL_WIDTH : 0);
  const selection = review.selection === null ? null : {
    from: Math.min(review.selection.anchor, review.hunkIndex ?? review.selection.anchor),
    to: Math.max(review.selection.anchor, review.hunkIndex ?? review.selection.anchor),
  };
  return (
    <box style={{ flexDirection: "row", flexGrow: 1 }}>
      {showNav ? (
        <box style={{ width: navWidth, flexShrink: 0, flexDirection: "column" }}>
          <HunkFileNav
            files={[...source.files]}
            selectedFileId={file?.id ?? undefined}
            width={navWidth}
            theme={theme}
            onSelectFile={(fileId: string) => {
              const index = source.files.findIndex((candidate) => candidate.id === fileId);
              if (index >= 0) actions.setReviewFile(index);
            }}
          />
          {!compact && evidence.length > 0 ? (
            <EvidenceNav evidence={evidence} threads={review.threads} selected={target?.kind === "evidence" ? target.index : null} width={navWidth} />
          ) : null}
        </box>
      ) : null}
      <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1 }}>
        <text
          fg={colors.dim}
          content={`${statsLine({ additions: source.additions, deletions: source.deletions, branch: source.branch, base: source.base })}${selection === null ? "" : ` · selecting hunks ${selection.from + 1}–${selection.to + 1}`}`}
        />
        <box style={{ flexGrow: 1 }}>
          {target?.kind === "evidence" ? (
            // Keyed per entry: the body swaps between a diff and an image without morphing nodes in place.
            <box key={`evidence:${target.entry.id}`} style={{ flexDirection: "column" }}>
              <text fg={colors.text} content={truncate(`evidence · ${target.entry.name}`, Math.max(1, bodyWidth))} />
              <EvidenceImage
                issueId={review.issueId}
                refId={target.entry.id}
                maxCellWidth={Math.max(4, bodyWidth - 4)}
                caption={{ comments: liveCount(review.threads, target.location) }}
              />
            </box>
          ) : file === null ? (
            <text key="no-files" fg={colors.dim} content="no changed files" />
          ) : (
            <HunkDiffView
              key="diff"
              diff={file}
              width={Math.max(20, bodyWidth)}
              canonicalLayout={review.layout}
              selectedHunkIndex={review.hunkIndex ?? undefined}
              showLineNumbers={review.showLineNumbers}
              theme={theme}
              highlight={true}
            />
          )}
        </box>
        {!compact && review.edit !== null ? <HunkEditBuffer /> : null}
      </box>
      {showRail ? (
        <box style={{ width: RAIL_WIDTH, flexShrink: 0, flexDirection: "column", paddingLeft: 1 }}>
          <ThreadList threads={threads} all={review.threads} sel={review.threadIndex} />
        </box>
      ) : null}
    </box>
  );
};

/**
 * The app-shell view-switch keys the review views (diff, artifact) take over,
 * because hunk binds them: `1`/`2` unified/split layout, `g` first hunk.
 * `b` stays a view switch — hunk's page-up isn't adopted.
 */
export const HUNK_SHELL_KEYS: ReadonlySet<string> = new Set(["1", "2", "g"]);

/*
 * Review key map — hunk's own defaults (hunk 0.24.1 command table), plus tk
 * aliases that don't collide with a hunk default:
 *
 *   ]  [   review.nextHunk / previousHunk; full page: past the last file's
 *          last hunk `]` walks into the EVIDENCE entries, `[` walks back (D-06)
 *   .  ,   review.nextFile / previousFile (clamped; full page: files, then evidence)
 *   1  2   view.layoutUnified / layoutSplit        (`0` auto: no auto layout here)
 *   g  G   review.jumpToTop / jumpToBottom         (first / last hunk)
 *   c      review.startNote (also in the compact modal; on evidence: `evidence:<id>`)
 *   C      compact modal: a whole-file note (no line)
 *   f      compact modal: ⤢ expand to the full diff view (same file and hunk)
 *   E      review.editActiveNote
 *   R      review.replyToActiveNote
 *   q      app.quit                                (`?` app.toggleHelp is global)
 *   e      review.editSelectedFile → tk: in-view hunk edit (SC-3)
 *   j  k   tk alias: step the hunk selection inside the file (no-ops on evidence)
 *   p      tk alias: split
 *   x      tk: ✓ done (resolved; again: reopen)
 *   D      tk: ✕ remove (dismissed; again: reopen)
 *   S      tk: send every open comment to the agent (one batch)
 *   J  K   tk: next / previous thread
 *   o      tk: open the selected file (or evidence entry) in the artifact view (D-05)
 *
 * Full page only, the rest of the spec bar (TUI adaptations noted):
 *   s      view.toggleFilesPane                    (hide the file nav)
 *   l      view.toggleLineNumbers
 *   a      view.toggleAgentNotes → the notes (thread) rail
 *   t      view.openThemeSelector → cycle HUNK_DIFF_THEME_NAMES (no popup)
 *   z      review.toggleHunkGap → whole-diff context toggle (re-derived at
 *          ±EXPANDED_CONTEXT_LINES; the vendored view has no per-hunk gap)
 *   /      file search (hunk's review filter has no default key)
 *   v  y   review.startVisualSelection / copySelection → hunk-granular range,
 *          copied through OSC 52 (no line cursor here); esc clears it
 *
 * Deliberately unbound: `r` (hunk app.refresh — D-02: live re-render, no
 * refresh key), `u` (hunk halfPageUp — the old tk unified alias collided).
 * `s` stays lowercase for the files pane; `S` is the send.
 */
export const useReviewKeys = (compact: boolean): void => {
  const { state, actions } = useApp();
  const renderer = useRenderer();
  useKeyboard((key) => {
    const review = state.review;
    // The open composer, help and palette own the keyboard: typed text must not fire review keys.
    if (review === null || review.edit !== null || state.composer.mode !== "closed" || state.helpOpen || state.paletteOpen) return;
    const files = review.source?.files ?? [];
    const evidence = reviewEvidence(state.board.issues.find((candidate) => candidate.id === review.issueId));
    // The compact modal is file-scoped: the evidence walk is full-page only.
    const total = files.length + (compact ? 0 : evidence.length);
    const target = reviewTarget(review, evidence);
    const file = target?.kind === "file" ? target.file : null;
    const onEvidence = target?.kind === "evidence";
    const hunkCount = file?.metadata.hunks.length ?? 0;
    const threads = locationThreads(review.threads, target?.location ?? null);
    const stepHunk = (): boolean => {
      if (hunkCount === 0 || (review.hunkIndex !== null && review.hunkIndex + 1 >= hunkCount)) return false;
      actions.setReviewHunk(review.hunkIndex === null ? 0 : review.hunkIndex + 1);
      return true;
    };
    const prevHunk = (): void => {
      if (review.hunkIndex !== null) actions.setReviewHunk(review.hunkIndex === 0 ? null : review.hunkIndex - 1);
    };
    /** `]`: next hunk; past the last hunk of the last file it walks into the evidence entries (D-06). */
    const forward = (): void => {
      if (stepHunk()) return;
      if (review.fileIndex >= files.length - 1 && review.fileIndex + 1 < total) actions.setReviewFile(review.fileIndex + 1);
    };
    /** `[`: previous hunk; on evidence, the previous entry, then the last file's last hunk. */
    const backward = (): void => {
      if (!onEvidence) { prevHunk(); return; }
      const previous = review.fileIndex - 1;
      if (previous < 0) return;
      actions.setReviewFile(previous);
      const hunks = files[previous]?.metadata.hunks.length ?? 0;
      if (previous < files.length && hunks > 0) actions.setReviewHunk(hunks - 1);
    };
    switch (key.sequence) {
      case "]": forward(); break;
      case "[": backward(); break;
      // j/k step hunks inside the file only — no-ops on an evidence entry.
      case "j": stepHunk(); break;
      case "k": prevHunk(); break;
      case ".": actions.setReviewFile(Math.max(0, Math.min(Math.max(1, total) - 1, review.fileIndex + 1))); break;
      case ",": actions.setReviewFile(Math.max(0, review.fileIndex - 1)); break;
      case "g": actions.setReviewHunk(hunkCount > 0 ? 0 : null); break;
      case "G": actions.setReviewHunk(hunkCount > 0 ? hunkCount - 1 : null); break;
      case "1": actions.setReviewLayout("unified"); break;
      case "2": case "p": actions.setReviewLayout("split"); break;
      // `c` notes the selected hunk's line (or the evidence entry); the compact modal takes it too (04-04 deferral).
      case "c": actions.openReviewComposer("comment"); break;
      case "C": if (compact) actions.openReviewComposer("file"); break;
      case "f": if (compact) { actions.closeDiffModal(); actions.setView("diff"); } break;
      case "R": if (!compact) actions.openReviewComposer("reply"); break;
      case "E": if (!compact) actions.openReviewComposer("edit"); break;
      case "e": if (!compact) void actions.openHunkEdit(); break;
      case "x": if (!compact) void actions.setReviewThreadStatus("done"); break;
      case "D": if (!compact) void actions.setReviewThreadStatus("remove"); break;
      case "S": if (!compact) void actions.sendReviewComments(); break;
      case "J": if (!compact) actions.setReviewThread(Math.min(threads.length - 1, review.threadIndex + 1)); break;
      case "K": if (!compact) actions.setReviewThread(Math.max(0, review.threadIndex - 1)); break;
      case "q": if (!compact) actions.quit(); break;
      // D-05: the selected file (not a deleted one) or evidence entry opens in the artifact view.
      case "o": if (!compact) {
        if (target?.kind === "evidence") actions.openArtifact({ kind: "evidence", id: target.entry.id, name: target.entry.name });
        else if (file !== null && file.metadata.type !== "deleted" && file.path !== undefined && file.path !== "") actions.openArtifact({ kind: "file", path: file.path });
        else if (file !== null) actions.notify("deleted file — nothing to open");
      } break;
      case "s": if (!compact) actions.setReviewView({ showFiles: !review.showFiles }); break;
      case "l": if (!compact) actions.setReviewView({ showLineNumbers: !review.showLineNumbers }); break;
      case "a": if (!compact) actions.setReviewView({ showNotes: !review.showNotes }); break;
      case "t": if (!compact) {
        const current = review.theme === null ? -1 : HUNK_DIFF_THEME_NAMES.indexOf(review.theme);
        const theme = HUNK_DIFF_THEME_NAMES[(current + 1) % HUNK_DIFF_THEME_NAMES.length]!;
        actions.setReviewView({ theme });
        actions.notify(`theme ${theme}`);
      } break;
      case "z": if (!compact) void actions.toggleReviewContext(); break;
      case "/": if (!compact) actions.openComposer("review-search", review.issueId, review.search); break;
      case "v": if (!compact) {
        if (review.selection !== null) actions.setReviewSelection(null);
        else if (hunkCount > 0) {
          if (review.hunkIndex === null) actions.setReviewHunk(0);
          actions.setReviewSelection(review.hunkIndex ?? 0);
        }
      } break;
      case "y": if (!compact) actions.copyReviewSelection((text) => renderer.copyToClipboardOSC52(text)); break;
      default:
        if (key.name === "escape" && !compact && review.selection !== null) actions.setReviewSelection(null);
        break;
    }
  });
};

/**
 * Packs one key-bar line into rows of at most `width` columns, breaking only
 * at its two-space key separators, so a narrow terminal wraps keys instead of
 * clipping them. A single key wider than `width` is truncated.
 */
export const wrapKeyLine = (line: string, width: number): readonly string[] => {
  const rows: string[] = [];
  let row = "";
  for (const key of line.split("  ")) {
    if (row !== "" && row.length + 2 + key.length > width) { rows.push(row); row = ""; }
    row = row === "" ? key : `${row}  ${key}`;
  }
  if (row !== "") rows.push(row);
  return rows.map((entry) => truncate(entry, Math.max(1, width)));
};

/**
 * Dim key hint bar under a full-page review: each line is one height-1 row
 * when it fits beside the shell's nav rail, else it wraps at key separators.
 */
export const ReviewKeybar = ({ lines }: { lines: readonly string[] }) => {
  const { width: termWidth } = useTerminalDimensions();
  const { state } = useApp();
  const rows = lines.flatMap((line) => wrapKeyLine(line, termWidth - shellNavWidth(state) - 2));
  return (
    <box style={{ flexDirection: "column", flexShrink: 0, paddingLeft: 1 }}>
      {rows.map((row, index) => (
        <box key={`${index}:${row}`} style={{ height: 1 }}>
          <text fg={colors.dim} content={row} />
        </box>
      ))}
    </box>
  );
};

/**
 * `watching worktree — re-derives as commits land ●` — exactly while a live
 * watch controller runs for a usable source; nothing otherwise (never lies).
 */
const WatchingIndicator = () => {
  const { state } = useApp();
  const review = state.review;
  if (review?.watching !== true || review.source === null || review.source.error !== null || review.source.empty !== null) return null;
  return (
    <box style={{ height: 1, flexShrink: 0, flexDirection: "row", paddingLeft: 1 }}>
      <text fg={colors.dim} content={`${WATCHING_LINE} `} />
      <text fg={colors.green} content="●" />
    </box>
  );
};

/** The diff rendered as a full page view over the live review session. */
export const DiffView = () => {
  useReviewKeys(false);
  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <Workbench compact={false} />
      <WatchingIndicator />
      <ReviewKeybar lines={keysLines} />
    </box>
  );
};

/** The diff modal's right-hand header hint (D-04). */
export const MODAL_EXPAND_HINT = "f ⤢ full view · esc close";

/** The diff modal's footer key line (spec DIFF · MODAL). */
const MODAL_FOOTER = "c comment on a line · C comment on the file · j/k hunk · esc close · f ⤢ full view — file · line · evidence";

/**
 * The diff as a file-scoped modal over the current view (D-04): a centred
 * frame with `<id> / <path> [S] +a −d` and `f ⤢ full view · esc close`, the
 * selected file's diff (no file nav), that file's threads, and the key line.
 * The view behind (the task view) stays drawn; the shared Composer row
 * below stays visible so `c` / `C` comments type in place. `f` expands to
 * the full diff view on the same file and hunk; `esc` closes (ShellKeys).
 * Hunk editing (`e`) and the lifecycle keys stay full-page only.
 */
export const DiffModal = () => {
  useReviewKeys(true);
  const { state } = useApp();
  const { width: termWidth } = useTerminalDimensions();
  const review = state.review;
  const innerWidth = Math.max(20, Math.floor(termWidth * 0.84) - 4);
  const source = review?.source ?? null;
  const evidence = reviewEvidence(state.board.issues.find((candidate) => candidate.id === review?.issueId));
  const target = review === null ? null : reviewTarget(review, evidence);
  const stat = target?.kind === "file" ? source?.stats.find((entry) => entry.path === target.file.path) ?? null : null;
  const label = target === null ? "" : target.kind === "file" ? target.file.path ?? "" : `evidence:${target.entry.id}`;
  const counts = stat === null ? "" : ` [${stat.status}] +${stat.additions} −${stat.deletions}`;
  const head = `${review?.issueId ?? ""} / `;
  const room = Math.max(1, innerWidth - MODAL_EXPAND_HINT.length - 2);
  const threads = review === null ? [] : locationThreads(review.threads, target?.location ?? null);
  const message = review === null || source === null
    ? (review?.loading ?? false ? "resolving review source…" : "no review open — open a task and press v, or tk://diff/<id>")
    : source.error !== null ? `review: ${source.error}`
    : source.empty === "no-branch" ? `no branch yet — run tk work ${source.issueId}`
    : target === null ? "no changed files" : null;
  return (
    <box
      borderStyle="rounded"
      borderColor={colors.borderFocus}
      style={{ position: "absolute", top: 2, bottom: 4, left: "8%", width: "84%", zIndex: 50, backgroundColor: colors.panel, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}
    >
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
        <text style={{ flexGrow: 1 }}>
          <span fg={colors.dim}>{truncate(head, room)}</span>
          <span fg={colors.text}><strong>{truncate(label, Math.max(1, room - head.length - counts.length))}</strong></span>
          <span fg={colors.dim}>{counts}</span>
        </text>
        <text fg={colors.accent} content={MODAL_EXPAND_HINT} />
      </box>
      <box style={{ flexGrow: 1, flexDirection: "column", overflow: "hidden" }}>
        {message !== null || review === null ? (
          <text key="message" fg={source?.error ? colors.red : colors.dim} content={truncate(message ?? "", innerWidth)} />
        ) : target?.kind === "evidence" ? (
          <box key={`evidence:${target.entry.id}`} style={{ flexDirection: "column" }}>
            <EvidenceImage issueId={review.issueId} refId={target.entry.id} maxCellWidth={Math.max(4, innerWidth - 4)} caption={{ comments: liveCount(review.threads, target.location) }} />
          </box>
        ) : target?.kind === "file" ? (
          <HunkDiffView
            key="diff"
            diff={target.file}
            width={innerWidth}
            canonicalLayout={review.layout}
            selectedHunkIndex={review.hunkIndex ?? undefined}
            showLineNumbers={review.showLineNumbers}
            theme={review.theme ?? undefined}
            highlight={true}
          />
        ) : null}
      </box>
      {review !== null && message === null ? (
        <box style={{ flexDirection: "column", flexShrink: 0, maxHeight: 8, overflow: "hidden" }}>
          <ThreadList threads={threads} all={review.threads} sel={review.threadIndex} width={innerWidth} />
        </box>
      ) : null}
      <text fg={colors.dim} style={{ flexShrink: 0 }} content={truncate(MODAL_FOOTER, innerWidth)} />
    </box>
  );
};

/** Deep link `tk://diff` or `tk://diff/<id>` — the full diff review page. */
export const diffViewRoute: RouteEntry = { kind: "diff", path: ["diff", ":id?"], apply: (sink, params) => { sink.openReview(params["id"] ?? null); } };

/** Deep link `tk://diff-modal` — the diff overlay over the current view. */
export const diffModalRoute: RouteEntry = { kind: "diff-modal", path: ["diff-modal"], apply: (sink) => { sink.openDiffModal(); } };
