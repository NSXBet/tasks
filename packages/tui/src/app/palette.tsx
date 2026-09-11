import { useKeyboard } from "@opentui/react";
import { useMemo, useState } from "react";
import { useApp } from "./context.js";
import { colors } from "../theme.js";
import { kanbanGroups, kanbanCardAt, visibleIssues } from "../store.js";
import type { ViewKind } from "./context.js";

const clampPriority = (value: number): number => Math.min(4, Math.max(0, value));

/** One palette row: what it does, which group it belongs to, its key. */
interface Command {
  readonly glyph: string;
  readonly label: string;
  readonly group: string;
  readonly keycap: string;
  readonly run: () => void;
}

/**
 * Command palette over a dimmed shell (Superhuman/Fey pattern): every command
 * is listed with a right-aligned keycap, so the keymap teaches itself. Type
 * to filter, enter runs the highlighted row, mouse clicks run directly.
 */
export const CommandPalette = () => {
  const { state, actions } = useApp();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const targetId = useMemo((): string | null => {
    if (state.view === "board") {
      const groups = kanbanGroups(state.board.issues, state.board.fetchedAt);
      return kanbanCardAt(groups, state.boardSel.col, state.boardSel.row);
    }
    const rows = visibleIssues(state.board, state.filter, state.search, state.actor);
    return rows[state.selected]?.id ?? null;
  }, [state.view, state.board, state.boardSel, state.filter, state.search, state.actor, state.selected]);
  const issue = targetId === null ? null : state.board.issues.find((candidate) => candidate.id === targetId) ?? null;
  const commands = useMemo((): Command[] => {
    const views: Command[] = ([
      { key: "1", view: "list", glyph: "≡", label: "go to List" },
      { key: "2", view: "board", glyph: "▦", label: "go to Board" },
      { key: "3", view: "graph", glyph: "⟐", label: "go to Graph" },
      { key: "4", view: "insights", glyph: "◎", label: "go to Insights" },
    ] as const).map((entry) => ({
      glyph: entry.glyph, label: entry.label, group: "view", keycap: entry.key,
      run: (): void => actions.setView(entry.view),
    }));
    const globals: Command[] = [
      { glyph: "✎", label: "new issue", group: "global", keycap: "n", run: (): void => actions.openComposer("create") },
      { glyph: "⌕", label: "search issues", group: "global", keycap: "/", run: (): void => actions.openComposer("search", null, state.search) },
      { glyph: "⎇", label: "key reference", group: "global", keycap: "?", run: (): void => actions.toggleHelp() },
    ];
    if (issue === null) return [...views, ...globals];
    return [
      ...views,
      ...globals,
      { glyph: "⚡", label: "start (in progress)", group: "status", keycap: "s", run: (): void => { void actions.setStatus(issue.id, "in_progress"); } },
      { glyph: "👀", label: "ready-to-review", group: "status", keycap: "r", run: (): void => { void actions.setStatus(issue.id, "ready-to-review"); } },
      { glyph: "☑", label: "reopen", group: "status", keycap: "o", run: (): void => { void actions.setStatus(issue.id, "open"); } },
      { glyph: "✓", label: `close ${issue.id}`, group: "status", keycap: "d", run: (): void => actions.requestConfirm({ kind: "close", id: issue.id, target: null, label: `close ${issue.id}?` }) },
      { glyph: "P", label: "raise priority", group: "task", keycap: "+", run: (): void => { void actions.setPriority(issue.id, clampPriority(issue.priority + 1)); } },
      { glyph: "p", label: "lower priority", group: "task", keycap: "-", run: (): void => { void actions.setPriority(issue.id, clampPriority(issue.priority - 1)); } },
      { glyph: "👤", label: "claim", group: "task", keycap: "a", run: (): void => { void actions.claim(issue.id); } },
      { glyph: "✎", label: "edit title", group: "edit", keycap: "e", run: (): void => actions.openComposer("title", issue.id, issue.title) },
      { glyph: "≡", label: "edit description", group: "edit", keycap: "E", run: (): void => actions.openComposer("description", issue.id, issue.description) },
      { glyph: "@", label: "set assignee", group: "edit", keycap: "@", run: (): void => actions.openComposer("assignee", issue.id, issue.assignee ?? "") },
      { glyph: "#", label: "edit labels", group: "edit", keycap: ",", run: (): void => actions.openComposer("labels", issue.id, "") },
      { glyph: "💬", label: "add comment", group: "edit", keycap: "c", run: (): void => actions.openComposer("comment", issue.id) },
    ];
  }, [issue, state.search, actions]);

  const needle = query.trim().toLowerCase();
  const filtered = needle === "" ? commands
    : commands.filter((command) => `${command.label} ${command.group} ${command.keycap}`.toLowerCase().includes(needle));
  const selected = filtered.length === 0 ? null : filtered[Math.min(cursor, filtered.length - 1)]!;

  const close = (): void => actions.setPaletteOpen(false);

  useKeyboard((key) => {
    if (key.name === "escape") { close(); return; }
    if (key.name === "down") { setCursor((index) => Math.min(filtered.length - 1, index + 1)); return; }
    if (key.name === "up") { setCursor((index) => Math.max(0, index - 1)); return; }
  });

  // Flow layout (not absolute): input focus breaks inside absolute boxes,
  // so the palette docks above the views with the shell still visible below.
  return (
    <box style={{ flexDirection: "column", alignItems: "center", marginBottom: 1 }}>
      <box style={{ width: "56%", flexDirection: "column", backgroundColor: colors.panel, borderStyle: "rounded", borderColor: colors.borderFocus }}>
        <input
          ref={(node: unknown) => {
            (node as { focus?: () => void } | null)?.focus?.();
          }}
          focused={true}
          placeholder="type a command… (view, status, edit, dep)"
          textColor={colors.text}
          backgroundColor={colors.panel}
          onInput={(value: string) => { setQuery(value); setCursor(0); }}
          onSubmit={() => { if (selected !== null) { close(); selected.run(); } }}
        />
        <box style={{ flexDirection: "column", height: 10 }}>
          {filtered.slice(0, 10).map((command, index) => (
            <box
              key={`${command.keycap}:${command.label}`}
              onMouseDown={() => { close(); command.run(); }}
              style={{ flexDirection: "row", ...(command === selected ? { backgroundColor: colors.selection } : {}) }}
            >
              <text>
                {"  "}
                <span fg={command === selected ? colors.band : colors.dim}>{`${command.glyph} `}</span>
                <span fg={command === selected ? colors.text : colors.dim}>{command.label}</span>
              </text>
              <text fg={command === selected ? colors.band : colors.dim} content={` ${command.group.padEnd(6)} [${command.keycap}] `} />
            </box>
          ))}
        </box>
        <text fg={colors.dim} content="  ↑↓ select · ↵ run · esc close" />
      </box>
    </box>
  );
};