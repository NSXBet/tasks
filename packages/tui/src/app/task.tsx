import { useEffect, useRef, useState } from "react";
import { hostname } from "node:os";
import { isAbsolute, relative } from "node:path";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { commentSummary, commentsLine, readPrRecord, reviewDoors } from "@tasks/domain";
import type { SessionRow } from "@tasks/surface";
import { artifactGroups, changesTree, minimapBars, threadLocation, type ArtifactRow, type ChangesRow, type MinimapBar } from "@tasks/review/taskview";
import { navWidth, useApp, type ReviewState } from "./context.js";
import type { RouteEntry } from "./routes.js";
import { TASKS_MIN_WIDTH, TASKS_WIDTH, TaskList, workingTasks } from "./tasklist.js";
import { colors, priorityLabel, statusColor } from "../theme.js";
import { relativeAge, truncate } from "../format.js";

/**
 * The task view (`5`, `tk://task`) — spec VIEW 1. The center column leads
 * with the work: title, a meta line, the chips row (`worktree <path>`,
 * `<branch> → <base>`), the primary action `◧ v open diff`, the description,
 * the ARTIFACTS evidence list and the COMMENTS preview, then the review doors.
 * Sessions, changes, workspace and minimap live in a tabbed right rail
 * (`tab` / `shift+tab`, `j`/`k`, `↵` opens the diff modal). There is no
 * start-work key here. Below 100 columns the rail is hidden and the chips row
 * keeps only the worktree chip, so the worktree never drops out of sight.
 * From 130 columns a left TASKS column (tasklist.tsx) lists the working tasks;
 * a click or `[` / `]` retargets the view (App keys TaskView by the shown id,
 * so per-task state resets on a switch).
 * `ensureReview` keeps the review session (and its 04-01 live watch) warm,
 * so CHANGES / MINIMAP / WORKSPC show the worktree's live state.
 */

export type RailTab = "sessions" | "changes" | "workspace" | "minimap";

export const RAIL_TABS: readonly { readonly tab: RailTab; readonly label: string }[] = [
  { tab: "sessions", label: "SESSIONS" },
  { tab: "changes", label: "CHANGES" },
  { tab: "workspace", label: "WORKSPC" },
  { tab: "minimap", label: "MINIMAP" },
];

/** The tab row text, `SESSIONS │ CHANGES │ WORKSPC │ MINIMAP`. */
export const RAIL_TAB_ROW = RAIL_TABS.map((entry) => entry.label).join(" │ ");

/** CHANGES footer while the 04-01 live watch runs (`ReviewState.watching`). */
export const LIVE_LINE = "live from the worktree";

/** Below this terminal width the rail is hidden (D-03). */
export const NARROW_WIDTH = 100;
const RAIL_WIDTH = 42;
/** Rail content width: the rail minus its left border and padding. */
const RAIL_INNER = RAIL_WIDTH - 3;

/** `left … right` on one line of `width` cells, the right part flush right. */
const spread = (left: string, right: string, width: number): string => {
  const room = Math.max(1, width - right.length - 1);
  const head = truncate(left, room);
  return `${head}${" ".repeat(Math.max(1, width - head.length - right.length))}${right}`;
};

/** A rows window of `size` around `cursor`, so huge changesets never render every row (T-09-06). */
const windowed = <T,>(rows: readonly T[], cursor: number, size: number): { readonly start: number; readonly rows: readonly T[] } => {
  const start = Math.max(0, Math.min(cursor - size + 1, rows.length - size));
  const from = Math.max(0, Math.min(start, cursor));
  return { start: from, rows: rows.slice(from, from + size) };
};

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** Worktree path relative to the workspace root when under it, else absolute. */
const displayPath = (path: string, root: string): string => {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path;
};

const defaultTab = (review: ReviewState | null): RailTab => {
  const source = review?.source ?? null;
  if (source === null) return "sessions";
  // Changes first when there is something to show there: files, the
  // tk-work hint, or the source error.
  return source.files.length > 0 || source.empty !== null || source.error !== null ? "changes" : "sessions";
};

/** The spec's blue "needs review" dot. */
const REVIEW_DOT = colors.accent;

const sessionColor = (state: string): string => (state === "done" ? colors.green : state === "running" ? colors.yellow : colors.dim);

export const TaskView = () => {
  const { state, actions } = useApp();
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const issue = state.board.issues.find((candidate) => candidate.id === state.detailId) ?? state.board.issues[0];
  const review = state.review !== null && state.review.issueId === issue?.id ? state.review : null;
  const source = review?.source ?? null;
  const [chosenTab, setChosenTab] = useState<RailTab | null>(null);
  const [cursors, setCursors] = useState<Record<RailTab, number>>({ sessions: 0, changes: 0, workspace: 0, minimap: 0 });
  const [sessions, setSessions] = useState<readonly SessionRow[] | null>(null);
  // ARTIFACTS cursor (`J`/`K`) and which list `o` opens from: the artifacts, or the rail's CHANGES row.
  const [artifactCursor, setArtifactCursor] = useState(0);
  const artifactCursorRef = useRef(0);
  artifactCursorRef.current = artifactCursor;
  const [focus, setFocus] = useState<"artifacts" | "rail" | null>(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const tab = chosenTab ?? defaultTab(review);
  const wide = termWidth >= NARROW_WIDTH;
  const showTasks = termWidth >= TASKS_MIN_WIDTH;
  // Keys can arrive before useKeyboard re-binds after a state change (tab, then
  // j, then ↵ in one burst): the handler reads the live tab and cursors from
  // refs that it also updates synchronously.
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const cursorsRef = useRef(cursors);
  cursorsRef.current = cursors;
  // `[` `]` bursts: the second press can land before the keyed remount, so step from a ref.
  const shownRef = useRef<string | null>(null);
  if (shownRef.current === null) shownRef.current = issue?.id ?? null;

  // Keep the review session warm for this task so the rail shows live data.
  useEffect(() => {
    if (issue !== undefined) actions.ensureReview(issue.id);
  }, [issue?.id, actions.ensureReview]);

  // SESSIONS: re-read on the board poll (fetchedAt) so new runs show up.
  const fetchedAt = state.board.fetchedAt.getTime();
  useEffect(() => {
    if (issue === undefined) return;
    let alive = true;
    void state.store.surface.taskSessions(issue.id).then(
      (rows) => { if (alive) setSessions(rows); },
      () => { if (alive) setSessions([]); },
    );
    return () => { alive = false; };
  }, [issue?.id, fetchedAt, state.store.surface]);

  const stats = source?.stats ?? [];
  const threads = review?.threads ?? [];
  const changes: readonly ChangesRow[] = changesTree(stats, threads);
  const bars: readonly MinimapBar[] = minimapBars(stats);
  const rowCount = (which: RailTab): number =>
    which === "changes" ? changes.length : which === "minimap" ? bars.length : which === "sessions" ? sessions?.length ?? 0 : 0;
  const cursorOf = (which: RailTab): number => Math.max(0, Math.min(cursorsRef.current[which], rowCount(which) - 1));
  const artifactRows: readonly ArtifactRow[] = issue === undefined ? [] : artifactGroups(issue.attachments, stats, threads).groups.flatMap((group) => group.rows);
  const artifactAt = Math.max(0, Math.min(artifactCursor, artifactRows.length - 1));
  // `o` opens from the list last moved in; before any move, the artifacts when there are any.
  const opensFrom = (): "artifacts" | "rail" => focusRef.current ?? (artifactRows.length > 0 ? "artifacts" : "rail");
  const setFocusNow = (next: "artifacts" | "rail"): void => { focusRef.current = next; setFocus(next); };

  useKeyboard((key) => {
    // The diff modal, composer and overlays own their keys.
    if (state.diffOpen || state.composer.mode !== "closed" || state.modalId !== null || state.paletteOpen || state.helpOpen) return;
    if (key.sequence === "[" || key.sequence === "]") {
      // R34: previous / next working task, wrapping. The diff view's hunk
      // `[` / `]` never reach here (other view; the modal is guarded above).
      const shown = shownRef.current;
      if (shown === null) return;
      const tasks = workingTasks(state.board.issues, shown);
      if (tasks.length < 2) return;
      const at = Math.max(0, tasks.findIndex((candidate) => candidate.id === shown));
      const next = tasks[(at + (key.sequence === "]" ? 1 : tasks.length - 1)) % tasks.length]!;
      shownRef.current = next.id;
      actions.openTask(next.id);
      return;
    }
    if (key.name === "tab") {
      if (!wide) return;
      const step = key.shift ? RAIL_TABS.length - 1 : 1;
      const at = RAIL_TABS.findIndex((entry) => entry.tab === tabRef.current);
      const next = RAIL_TABS[(at + step) % RAIL_TABS.length]!.tab;
      tabRef.current = next;
      setChosenTab(next);
      setFocusNow("rail");
      return;
    }
    if (key.sequence === "J" || key.sequence === "K") {
      const max = Math.max(0, artifactRows.length - 1);
      const next = Math.max(0, Math.min(max, Math.min(artifactCursorRef.current, max) + (key.sequence === "J" ? 1 : -1)));
      artifactCursorRef.current = next;
      setArtifactCursor(next);
      setFocusNow("artifacts");
      return;
    }
    if (key.sequence === "o") {
      // D-05: open the selected artifact (or the CHANGES file row) as a file.
      if (opensFrom() === "artifacts") {
        const row = artifactRows[Math.max(0, Math.min(artifactCursorRef.current, artifactRows.length - 1))];
        if (row === undefined) return;
        if (row.kind === "evidence" && row.evidenceId !== null) actions.openArtifact({ kind: "evidence", id: row.evidenceId, name: row.name });
        else if (row.path !== null) actions.openArtifact({ kind: "file", path: row.path });
        return;
      }
      if (wide && tabRef.current === "changes") {
        const row = changes[cursorOf("changes")];
        if (row !== undefined && row.kind === "file") actions.openArtifact({ kind: "file", path: row.path });
      }
      return;
    }
    if (wide && (key.name === "j" || key.name === "down" || key.name === "k" || key.name === "up")) {
      const delta = key.name === "j" || key.name === "down" ? 1 : -1;
      const active = tabRef.current;
      const max = Math.max(0, rowCount(active) - 1);
      const current = cursorsRef.current;
      const next = { ...current, [active]: Math.max(0, Math.min(max, Math.min(current[active], max) + delta)) };
      cursorsRef.current = next;
      setCursors(next);
      setFocusNow("rail");
      return;
    }
    if (wide && (key.name === "return" || key.name === "enter")) {
      if (tabRef.current === "changes") {
        const row = changes[cursorOf("changes")];
        // D-04: a file row opens the modal at that file; a dir row at the first file needing review.
        if (row !== undefined && row.kind === "file") actions.openDiffModalAt(row.path, null);
        else actions.openDiffModalAt(null, null);
      } else if (tabRef.current === "minimap") {
        const bar = bars[cursorOf("minimap")];
        if (bar !== undefined) actions.openDiffModalAt(bar.path, bar.hunkIndex);
      }
      return;
    }
    // 11-05 WORKSPC actions: C commit (composer) · P open pr — only on the WORKSPC tab.
    if (wide && tabRef.current === "workspace" && (key.sequence === "C" || key.sequence === "P")) {
      if (issue === undefined) return;
      if (key.sequence === "C") actions.openComposer("commit", issue.id);
      else void actions.openPr(issue.id);
      return;
    }
    switch (key.sequence) {
      case "v": actions.setView("diff"); break;
      case "V": actions.openDiffModalAt(null, null); break;
      case "c": if (issue !== undefined) actions.openComposer("comment", issue.id); break;
      case "q": actions.quit(); break;
      default: break;
    }
  });

  if (issue === undefined) return null;
  const doors = reviewDoors(issue.id, state.board.webBase);
  const root = state.store.surface.store.root;
  const centerWidth = Math.max(20, termWidth - navWidth(state) - (showTasks ? TASKS_WIDTH : 0) - (wide ? RAIL_WIDTH : 0) - 3);
  const recorded = typeof issue.metadata["worktree"] === "string" && issue.metadata["worktree"] !== "" ? issue.metadata["worktree"] : null;
  const worktreePath = recorded ?? source?.worktree ?? null;
  const worktreeChip = worktreePath === null ? `[ no worktree — tk work ${issue.id} ]` : `[ worktree ${displayPath(worktreePath, root)} ]`;
  const baseShort = (source?.base ?? null) === null ? "—" : source!.base!.slice(0, 7);
  const branchChip = issue.branch === null || issue.branch === "" ? null : `[ ${issue.branch} → ${baseShort} ]`;
  const branchInline = branchChip !== null && worktreeChip.length + 2 + branchChip.length <= centerWidth;
  const description = issue.description === "" ? ["(no description)"] : issue.description.split("\n").slice(0, 20);
  const artifacts = artifactGroups(issue.attachments, stats, threads);
  const { counts } = artifacts;
  const panelRows = Math.max(3, termHeight - 10);
  const artifactsFocused = (focus ?? (artifactRows.length > 0 ? "artifacts" : "rail")) === "artifacts";

  const tabRow = (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      <text>
        {RAIL_TABS.map((entry, index) => (
          <span key={entry.tab} fg={entry.tab === tab ? colors.accent : colors.dim}>{`${index === 0 ? "" : " │ "}${entry.label}`}</span>
        ))}
      </text>
      <text>
        {RAIL_TABS.map((entry, index) => (
          <span key={entry.tab} fg={entry.tab === tab ? colors.accent : colors.border}>
            {`${index === 0 ? "" : "───"}${(entry.tab === tab ? "━" : "─").repeat(entry.label.length)}`}
          </span>
        ))}
      </text>
    </box>
  );

  const hint = (text: string) => <text fg={colors.dim} content={truncate(text, RAIL_INNER)} />;
  const sourceHint = source === null
    ? hint(review?.loading ?? true ? "resolving…" : "no review source")
    : source.error !== null
      ? <text fg={colors.red} content={truncate(source.error, RAIL_INNER)} />
      : source.empty === "no-branch"
        ? hint(`no branch yet — run tk work ${source.issueId}`)
        : null;

  const panel = (() => {
    if (tab === "sessions") {
      if (sessions === null) return hint("loading…");
      const cursor = cursorOf("sessions");
      const view = windowed(sessions, cursor, panelRows);
      return (
        <box style={{ flexDirection: "column" }}>
          <text fg={colors.dim} content="AGENT RUNS ON THE TASK" />
          <text fg={colors.dim} content={spread("STATUS  SESSION", "UPD", RAIL_INNER)} />
          {sessions.length === 0 ? hint("no agent sessions recorded") : view.rows.map((row, offset) => {
            const active = view.start + offset === cursor;
            const status = row.state.toUpperCase().padEnd(7);
            const age = relativeAge(new Date(row.updatedAt), state.board.fetchedAt);
            return (
              <text key={row.id}>
                <span fg={sessionColor(row.state)} bg={active ? colors.selection : colors.bg}>{status}</span>
                <span fg={colors.text} bg={active ? colors.selection : colors.bg}>{` ${spread(row.label, age, RAIL_INNER - status.length - 1)}`}</span>
              </text>
            );
          })}
          {hint("sessions live in the rail — the center column belongs to the work")}
        </box>
      );
    }
    if (tab === "changes") {
      if (sourceHint !== null) return sourceHint;
      if (changes.length === 0) return hint("no changes in the worktree");
      const cursor = cursorOf("changes");
      const view = windowed(changes, cursor, panelRows);
      return (
        <box style={{ flexDirection: "column" }}>
          {view.rows.map((row, offset) => {
            const active = view.start + offset === cursor;
            const label = `${"  ".repeat(row.depth)}${row.kind === "dir" ? `▸ ${row.name}` : `${row.name} [${row.status ?? "?"}]`}`;
            return (
              <text key={`${row.kind}:${row.path}`}>
                <span fg={active ? colors.accent : colors.text} bg={active ? colors.selection : colors.bg}>{truncate(label, RAIL_INNER - 2).padEnd(RAIL_INNER - 2)}</span>
                <span fg={REVIEW_DOT}>{row.needsReview ? " ●" : "  "}</span>
              </text>
            );
          })}
          {hint("↵ diff modal · tab next")}
          {review?.watching === true ? (
            <text>
              <span fg={colors.dim}>{`${LIVE_LINE} `}</span>
              <span fg={colors.green}>●</span>
            </text>
          ) : null}
        </box>
      );
    }
    if (tab === "workspace") {
      if (source !== null && source.empty === "no-branch") return sourceHint;
      const dirty = source?.dirty ?? null;
      const pr = readPrRecord(issue.metadata);
      const line = (label: string, value: string, fg: string = colors.text) => (
        <text>
          <span fg={colors.dim}>{label.padEnd(9)}</span>
          <span fg={fg}>{truncate(value, RAIL_INNER - 9)}</span>
        </text>
      );
      return (
        <box style={{ flexDirection: "column" }}>
          {line("branch", `${issue.branch ?? "—"} → ${baseShort}`, colors.green)}
          {line("worktree", worktreePath === null ? "—" : displayPath(worktreePath, root))}
          {line("host", hostname())}
          {line("state", dirty === null ? "—" : dirty === 0 ? "clean" : `${dirty} dirty`, dirty !== null && dirty > 0 ? colors.yellow : colors.text)}
          {line("pr", pr === null ? "—" : `PR #${pr.number} · ${pr.state}`, pr === null ? colors.text : colors.accent)}
          {source !== null && source.error !== null ? <text fg={colors.red} content={truncate(source.error, RAIL_INNER)} /> : null}
          {hint("[C] commit  [P] open pr")}
        </box>
      );
    }
    if (sourceHint !== null) return sourceHint;
    if (bars.length === 0) return hint("no hunks to map");
    const cursor = cursorOf("minimap");
    const view = windowed(bars, cursor, panelRows);
    const labelWidth = Math.min(20, Math.max(...bars.map((bar) => `${basename(bar.path)}#${bar.hunkIndex + 1}`.length)));
    return (
      <box style={{ flexDirection: "column" }}>
        {view.rows.map((bar, offset) => {
          const active = view.start + offset === cursor;
          const label = truncate(`${basename(bar.path)}#${bar.hunkIndex + 1}`, labelWidth).padEnd(labelWidth);
          return (
            <text key={`${bar.path}#${bar.hunkIndex}`}>
              <span fg={active ? colors.accent : colors.text} bg={active ? colors.selection : colors.bg}>{label}</span>
              <span fg={bar.tone === "add" ? colors.green : colors.red}>{` ${"█".repeat(Math.max(1, Math.round(bar.size * 12)))}`}</span>
            </text>
          );
        })}
        {hint("↵ open in the diff modal")}
      </box>
    );
  })();

  return (
    <box style={{ flexGrow: 1, flexDirection: "row" }}>
      {/* left: the working tasks (R34), beside the VIEWS nav */}
      {showTasks ? <TaskList shownId={issue.id} height={termHeight} /> : null}
      {/* center: the work, front and center */}
      <scrollbox style={{ flexGrow: 1 }} stickyScroll={false}>
        <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
          <text fg={colors.text} content={truncate(issue.title, centerWidth)} />
          <text>
            <span fg={colors.dim}>{`${issue.id} · `}</span>
            <span fg={statusColor(issue.status)}>{issue.status}</span>
            <span fg={colors.dim}>{` · @${issue.assignee ?? "unassigned"} · ${priorityLabel(issue.priority)}`}</span>
          </text>
          <text>
            <span fg={worktreePath === null ? colors.dim : colors.cyan}>{truncate(worktreeChip, centerWidth)}</span>
            {wide && branchChip !== null && branchInline ? <span fg={colors.green}>{`  ${branchChip}`}</span> : null}
          </text>
          {/* The branch chip wraps under the worktree chip when both don't fit (e.g. beside the TASKS column). */}
          {wide && branchChip !== null && !branchInline ? <text fg={colors.green} content={truncate(branchChip, centerWidth)} /> : null}
          <text style={{ marginTop: 1 }}>
            <span fg={colors.accent}>◧ v open diff</span>
            <span fg={colors.dim}> · V diff modal · c comment</span>
          </text>
          <box style={{ flexDirection: "column", marginTop: 1 }}>
            {description.map((line, index) => (
              <text key={index} fg={issue.description === "" ? colors.dim : colors.text} content={truncate(line, centerWidth)} />
            ))}
          </box>

          <text fg={colors.dim} style={{ marginTop: 1 }} content={truncate("ARTIFACTS — evidence on the task", centerWidth)} />
          <text>
            <span fg={colors.dim}>{`${counts.src} src · `}</span>
            <span fg={colors.yellow}>{`${counts.edit} edit`}</span>
            <span fg={colors.dim}> · </span>
            <span fg={colors.green}>{`${counts.new} new`}</span>
            <span fg={colors.dim}>{` · ${counts.other} other`}</span>
          </text>
          {artifacts.groups.map((group) => (
            <box key={group.label} style={{ flexDirection: "column" }}>
              <text fg={colors.dim} content={`${group.label} (${group.rows.length})`} />
              {group.rows.map((row) => {
                const active = artifactsFocused && artifactRows[artifactAt]?.key === row.key;
                return (
                  <text key={row.key}>
                    <span fg={active ? colors.accent : colors.text} bg={active ? colors.selection : colors.bg}>{truncate(`${active ? "▸" : " "} ${row.name}`, centerWidth - 6).padEnd(centerWidth - 6)}</span>
                    <span fg={row.comments > 0 ? REVIEW_DOT : colors.dim}>{row.comments > 0 ? `● ${row.comments}` : "—"}</span>
                  </text>
                );
              })}
            </box>
          ))}
          {artifactRows.length > 0 ? <text fg={colors.dim} content={truncate("J/K select · o open", centerWidth)} /> : null}

          <text style={{ marginTop: 1 }}>
            <span fg={colors.dim}>{`COMMENTS · ${threads.length}`}</span>
            <span fg={colors.border}>{truncate(`   ${commentsLine(commentSummary(issue))}`, Math.max(0, centerWidth - 14))}</span>
          </text>
          {threads.slice(0, 5).map((thread) => {
            const first = thread.comments[0];
            // The stored body carries its own `[review <location>] ` tag; the row prints the location itself.
            const body = ((first?.body ?? "").split("\n")[0] ?? "").replace(/^\[review [^\]]*\]\s*/, "");
            const where = `${threadLocation(thread)}${thread.line !== undefined ? `:${thread.line}` : ""}`;
            return (
              <text key={thread.id}>
                <span fg={colors.cyan}>{`${first?.author ?? "?"}: `}</span>
                <span fg={colors.text}>{truncate(body, Math.max(8, centerWidth - where.length - (first?.author.length ?? 1) - 6))}</span>
                <span fg={colors.dim}>{` → ${where}`}</span>
              </text>
            );
          })}

          <text fg={colors.dim} style={{ marginTop: 1 }} content={truncate(`review  TUI ${doors.tui}`, centerWidth)} />
          <text fg={colors.dim} content={truncate(`        web ${doors.web}`, centerWidth)} />
        </box>
      </scrollbox>

      {/* right: tabbed rail */}
      {wide ? (
        <box style={{ width: RAIL_WIDTH, flexShrink: 0, flexDirection: "column", paddingLeft: 1, }} border={["left"]} borderStyle="single" borderColor={colors.border}>
          {tabRow}
          {/* keyed per tab: a content-<text> never morphs into a span-<text> in place */}
          <box key={tab} style={{ flexDirection: "column", marginTop: 1, flexGrow: 1 }}>{panel}</box>
        </box>
      ) : null}
    </box>
  );
};

/** Deep link `tk://task` — the task→review page (per-issue records are `tk://task/<id>`). */
export const taskViewRoute: RouteEntry = { kind: "task", path: ["task"], apply: (sink) => { sink.setView("task"); } };
