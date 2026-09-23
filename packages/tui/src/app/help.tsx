import { useApp } from "./context.js";
import { colors } from "../theme.js";

const sections: readonly { readonly title: string; readonly lines: readonly string[] }[] = [
  { title: "navigate", lines: [
    "nav rail (left): click views or use 1/2/3/4 · b/g/i shortcuts too",
    ": command palette — every command with its key, type to filter",
    "/ search · n new issue · ? this help · ctrl+c/ctrl+q quit",
  ] },
  { title: "task modal (enter on a board card, or e)", lines: [
    "board stays visible behind; esc closes; ↵ edit title in composer",
    "s/r/o status · +/- priority · a claim · d close (asks ↵/y · n)",
    "! sprint toggle (active sprint ⇄ backlog) · icebox tab = archived",
    "E description · c comment · @ assignee · , labels · D/X dependencies",
  ] },
  { title: "list", lines: ["j/k move · enter detail · tab filters"] },
  { title: "board", lines: ["h/l column · j/k card · enter modal · x jump to top blocker"] },
  { title: "graph", lines: ["j/k walk nodes · enter center (enter again → detail)"] },
  { title: "insights", lines: ["tab next panel · j/k row · enter detail"] },
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