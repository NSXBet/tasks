import { useApp } from "./context.js";
import type { RouteEntry } from "./routes.js";
import { colors } from "../theme.js";

const sections: readonly { readonly title: string; readonly lines: readonly string[] }[] = [
  { title: "navigate", lines: [
    "nav rail (left): click views or use 1/2/3/4 · b/g/i shortcuts too · \\ hides / shows the rail",
    "a task's pages — t task view · v diff · o artifact — open from the list, board or detail; esc returns",
    ": command palette — every command with its key, type to filter",
    "/ search · n new issue · ? this help · ctrl+c/ctrl+q quit",
  ] },
  { title: "task modal (enter on a board card, or e)", lines: [
    "board stays visible behind; esc closes; ↵ edit title in composer",
    "s/r/o status · +/- priority · a claim · d close (asks ↵/y · n)",
    "ready-to-review: v opens the diff · s only toasts (no start-work)",
    "! sprint toggle (active sprint ⇄ backlog) · icebox tab = archived",
    "E description · c comment · @ assignee · , labels · D/X dependencies",
  ] },
  { title: "list", lines: ["j/k move · enter detail · tab filters", "t open the highlighted task's task view · v its diff (click the doors line too) · s on a ready-to-review task only toasts (no start-work)"] },
  { title: "task view (t on a task · tk://task)", lines: [
    "◧ v open diff · V diff modal · c comment · q quit — no start-work key",
    "tab / shift+tab rail tabs: SESSIONS │ CHANGES │ WORKSPC │ MINIMAP · j/k rail rows · ↵ diff modal (CHANGES / MINIMAP)",
    "V diff modal · v full diff",
    "J/K artifacts · o open artifact (or the CHANGES file row after j/k) · c comment",
    "[ / ]  previous / next working task · click a TASKS row  open that task",
    "WORKSPC: C commit (tracked + staged, message prompt, never pushed) · P open pr (tk pr create)",
    "below 130 columns the TASKS column hides; below 100 the rail hides; the worktree chip stays",
  ] },
  { title: "diff modal (↵ on a CHANGES file / MINIMAP bar, V)", lines: [
    "the task stays behind · j/k hunk · c comment on the hunk's line · C comment on the whole file",
    "f ⤢ full view on the same file and hunk · esc close (back to the task, rail kept)",
  ] },
  { title: "artifact view (o on an artifact · tk://artifact)", lines: [
    "CODE: numbered lines · DOC (.md): shaped blocks · EVIDENCE: the image + its ▣ evidence:<id> row",
    "j/k line (code) or block (doc) · g/G first/last",
    "c comment on the line / block (path:line, path:a-b) · C comment on the whole file",
    "esc back to the task · reads stay inside the task worktree (refused: outside the worktree)",
  ] },
  { title: "board", lines: ["h/l column · j/k card · enter modal · x jump to top blocker"] },
  { title: "graph", lines: ["j/k walk nodes · enter center (enter again → detail)"] },
  { title: "insights", lines: ["tab next panel · j/k row · enter detail"] },
  { title: "review (tk review <id> · v on a task)", lines: [
    "keys are hunk's own: ] [ hunk · . , file · 1 2 unified/split · g G first/last hunk · q quit",
    "c note · R reply · E edit note · J K next/prev thread",
    "x ✓ done · D ✕ remove (again: reopen) · S send open comments to the agent (one batch)",
    "e edit hunk inline (ctrl+s save · esc cancel) — writes the worktree file",
    "aliases: j k step hunk · p split",
    "s files pane · l line numbers · a notes rail · t theme (cycles)",
    "z context (whole diff, ±25 lines; hunk's z is per hunk)",
    "/ search files · v select hunks · y copy (OSC 52) · esc clear selection",
    "EVIDENCE · N under the files: ] past the last file walks into evidence · c comments at evidence:<id>",
    "o open the selected file (or evidence entry) as a file in the artifact view",
    "live: commits and edits in the task worktree re-render the diff (no refresh key)",
    "watching worktree ● = live watcher running",
  ] },
  { title: "anywhere", lines: ["esc close/back/clear search · statusbar shows counts + hints"] },
];

/** Full-screen key reference; any key closes it. */
export const HelpOverlay = () => {
  const { state } = useApp();
  void state;
  return (
    <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 2, paddingTop: 1 }} borderStyle="rounded" borderColor={colors.band} title=" tk-tui keys ">
      <scrollbox style={{ flexGrow: 1 }}>
        {sections.map((section) => (
          <box key={section.title} style={{ flexDirection: "column", marginBottom: 1 }}>
            <text fg={colors.band} content={section.title} />
            {section.lines.map((line) => (
              <text key={line} fg={colors.text} content={`  ${line}`} />
            ))}
          </box>
        ))}
      </scrollbox>
    </box>
  );
};

/** Deep link `tk://help`. */
export const helpRoute: RouteEntry = { kind: "help", path: ["help"], apply: (sink) => { sink.openHelp(); } };