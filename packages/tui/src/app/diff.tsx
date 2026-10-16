import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { ComposerRow } from "./composer.js";
import { useApp } from "./context.js";
import { colors } from "../theme.js";
import { padStart, truncate } from "../format.js";
import {
  fixtureAgentNote,
  fixtureBase,
  fixtureBranch,
  fixtureDiffFiles,
  fixtureDiffStats,
  fixtureIssueId,
  fixtureLineComments,
  type DiffFile,
  type DiffLine,
} from "../fixture.js";

/**
 * Phase 0 mock: the diff surface with hunk's UI grammar — unified/split
 * layouts, files pane, line-number gutters, `@@` hunk-header bands, and
 * `▾ N unchanged lines` fold bars — over the fixture scenario. Layout keys
 * avoid hunk's `1`/`2` because the shell owns the digit view switcher.
 */

const GUTTER = 5;

const fileGlyph: Record<DiffFile["status"], string> = { A: "A", M: "M", D: "D" };
const lineFg = (kind: DiffLine["kind"]): string =>
  kind === "ctx" ? colors.dim : kind === "del" ? colors.red : colors.green;
const prefix = (kind: DiffLine["kind"]): string => (kind === "del" ? "-" : kind === "add" ? "+" : " ");
const gutter = (n: number | null): string => padStart(n === null ? "" : String(n), GUTTER);

/** Consecutive del/add runs pair row-by-row for the split layout. */
const splitRows = (lines: readonly DiffLine[]): readonly { left: DiffLine | null; right: DiffLine | null }[] => {
  const rows: { left: DiffLine | null; right: DiffLine | null }[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind === "ctx") {
      rows.push({ left: lines[i]!, right: lines[i]! });
      i += 1;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    let j = i;
    while (j < lines.length && lines[j]!.kind !== "ctx") {
      (lines[j]!.kind === "del" ? dels : adds).push(lines[j]!);
      j += 1;
    }
    const count = Math.max(dels.length, adds.length);
    for (let k = 0; k < count; k += 1) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
    i = j;
  }
  return rows;
};

interface BodyOpts {
  readonly layout: "unified" | "split";
  readonly numbers: boolean;
  readonly headers: boolean;
}

const SplitRow = ({ row, numbers }: { row: { left: DiffLine | null; right: DiffLine | null }; numbers: boolean }) => (
  <box style={{ flexDirection: "row", height: 1 }}>
    <box style={{ flexDirection: "row", width: "50%", ...(row.left?.kind === "del" ? { backgroundColor: colors.panel } : {}) }}>
      {numbers ? <text fg={colors.dim} content={gutter(row.left?.oldNo ?? null)} /> : null}
      {row.left === null ? null : <text fg={lineFg(row.left.kind)} content={prefix(row.left.kind) + row.left.text} />}
    </box>
    <box style={{ flexDirection: "row", width: "50%", ...(row.right?.kind === "add" ? { backgroundColor: colors.panel } : {}) }}>
      {numbers ? <text fg={colors.dim} content={gutter(row.right?.newNo ?? null)} /> : null}
      {row.right === null ? null : <text fg={lineFg(row.right.kind)} content={prefix(row.right.kind) + row.right.text} />}
    </box>
  </box>
);

const DiffBody = ({ sel, onSelect, opts }: { sel: number; onSelect: (i: number) => void; opts: BodyOpts }) => (
  <box style={{ flexDirection: "column" }}>
    {fixtureDiffFiles.map((f, fi) => (
      <box key={f.path} style={{ flexDirection: "column" }}>
        <box
          style={{ flexDirection: "row", height: 1, ...(fi === sel ? { backgroundColor: colors.selection } : {}) }}
          onMouseDown={() => onSelect(fi)}
        >
          <text fg={colors.text} content={f.path} />
          <box style={{ flexGrow: 1 }} />
          <text>
            <span fg={colors.green}>{`+${f.added} `}</span>
            <span fg={colors.red}>{`−${f.removed}`}</span>
          </text>
        </box>
        {f.hunks.map((h, hi) => (
          <box key={`${f.path}:${hi}`} style={{ flexDirection: "column" }}>
            {opts.headers && h.foldBefore > 0 ? <text fg={colors.dim} content={`▾ ${h.foldBefore} unchanged lines`} /> : null}
            {opts.headers ? (
              <text>
                <span fg={colors.dim}>{`${h.header} `}</span>
                {h.context === "" ? null : <span fg={colors.cyan}>{h.context}</span>}
              </text>
            ) : null}
            {opts.layout === "unified"
              ? h.lines.map((l, li) => (
                  <box key={li} style={{ flexDirection: "row", height: 1, ...(l.kind === "ctx" ? {} : { backgroundColor: colors.panel }) }}>
                    {opts.numbers ? <text fg={colors.dim} content={gutter(l.oldNo) + gutter(l.newNo)} /> : null}
                    <text fg={lineFg(l.kind)} content={prefix(l.kind) + l.text} />
                  </box>
                ))
              : splitRows(h.lines).map((row, ri) => <SplitRow key={ri} row={row} numbers={opts.numbers} />)}
          </box>
        ))}
        {fi === 0 ? (
          <box style={{ flexDirection: "column", paddingTop: 1 }}>
            <text>
              <span fg={colors.accent}>a</span>
              <span fg={colors.dim}> · agent notes</span>
            </text>
            <text fg={colors.dim} content={fixtureAgentNote} />
          </box>
        ) : null}
        {fi === 0 && fixtureLineComments.length > 0 ? (
          <box style={{ flexDirection: "row", paddingTop: 1 }}>
            <text fg={colors.dim} content="COMMENTS" />
            {fixtureLineComments.every((c) => c.resolved) ? (
              <text fg={colors.green} content=" · all resolved ✓" />
            ) : (
              <text fg={colors.dim} content={` · ${fixtureLineComments.filter((c) => c.resolved).length}/${fixtureLineComments.length} resolved`} />
            )}
          </box>
        ) : null}
        {fi === 0
          ? fixtureLineComments.map((c) => (
              <box key={c.author + c.line} style={{ flexDirection: "column", paddingTop: 1 }}>
                <text>
                  <span fg={c.agent ? colors.cyan : colors.text}>{c.author}</span>
                  <span fg={colors.dim}>{` on line ${c.line}`}</span>
                  {c.resolved ? (
                    <span fg={colors.green}>{` ✓ ${c.resolvedBy ?? "resolved"}`}</span>
                  ) : (
                    <span fg={colors.dim}> · open</span>
                  )}
                </text>
                <text fg={colors.text} content={c.text} />
                <text fg={colors.dim} content="E edit · R reply" />
                {c.reply === undefined ? null : (
                  <box style={{ flexDirection: "column", paddingLeft: 2 }}>
                    <text>
                      <span fg={c.reply.agent ? colors.cyan : colors.text}>{c.reply.author}</span>
                      <span fg={colors.dim}> replied</span>
                    </text>
                    <text fg={colors.text} content={c.reply.text} />
                  </box>
                )}
              </box>
            ))
          : null}
      </box>
    ))}
  </box>
);

const FilesPane = ({ sel, onSelect }: { sel: number; onSelect: (i: number) => void }) => (
  <box style={{ width: "30%", flexDirection: "column", paddingLeft: 1 }}>
    <text fg={colors.dim} content="FILES" />
    {fixtureDiffFiles.map((f, i) => (
      <box
        key={f.path}
        style={{ flexDirection: "row", height: 1, ...(i === sel ? { backgroundColor: colors.selection } : {}) }}
        onMouseDown={() => onSelect(i)}
      >
        <text>
          <span fg={f.status === "M" ? colors.yellow : colors.green}>{`${fileGlyph[f.status]} `}</span>
          <span fg={colors.text}>{truncate(f.path, 22)}</span>
        </text>
        <box style={{ flexGrow: 1 }} />
        <text>
          <span fg={colors.green}>{`+${f.added} `}</span>
          <span fg={colors.red}>{`−${f.removed}`}</span>
        </text>
      </box>
    ))}
    <box style={{ flexGrow: 1 }} />
    {/* One line even in the 30% pane: a wrap paints over the patch footer rows. */}
    <text fg={colors.dim} content={truncate("watching worktree — re-derives as commits land ●", 34)} />
  </box>
);

/** Option toggles shared by the page and modal surfaces. */
const useDiffOptions = () => {
  const { actions } = useApp();
  const [layout, setLayout] = useState<"unified" | "split">("unified");
  const [files, setFiles] = useState(true);
  const [numbers, setNumbers] = useState(true);
  const [headers, setHeaders] = useState(true);
  const [sel, setSel] = useState(0);
  useKeyboard((key) => {
    switch (key.sequence) {
      case "c": actions.notify("WIP"); break;
      case "u": setLayout("unified"); break;
      case "p": setLayout("split"); break;
      case "s": setFiles((v) => !v); break;
      case "l": setNumbers((v) => !v); break;
      case "m": setHeaders((v) => !v); break;
      case "]": case ".": setSel((v) => Math.min(fixtureDiffFiles.length - 1, v + 1)); break;
      case "[": case ",": setSel((v) => Math.max(0, v - 1)); break;
      default: break;
    }
  });
  return { layout, files, numbers, headers, sel, setSel };
};

const keysLine = "c note · u unified · p split · s files · l numbers · m hunk headers · ] [ file · esc back";

/** Phase 0 mock: the diff rendered as a full page view. */
export const DiffView = () => {
  const opts = useDiffOptions();
  return (
    <box style={{ flexGrow: 1, flexDirection: "column", padding: 1 }} border>
      <box style={{ flexDirection: "row", backgroundColor: colors.band, paddingLeft: 1, paddingRight: 1, height: 1 }}>
        <text fg={colors.bandFg} content={` DIFF ${fixtureIssueId} `} />
        <text fg={colors.bandFg} content={` ${fixtureBranch} → ${fixtureBase} `} />
        <box style={{ flexGrow: 1 }} />
        <text fg={colors.bandFg} content={`${fixtureDiffStats.files} files · +${fixtureDiffStats.added} −${fixtureDiffStats.removed} `} />
      </box>
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        {opts.files ? <FilesPane sel={opts.sel} onSelect={opts.setSel} /> : null}
        <box style={{ flexGrow: 1, flexDirection: "column" }}>
          <scrollbox style={{ flexGrow: 1 }} stickyScroll={false}>
            <DiffBody sel={opts.sel} onSelect={opts.setSel} opts={opts} />
          </scrollbox>
          <ComposerRow placeholder="Reply or comment…" />
          <text fg={colors.dim} content={`${opts.layout} · numbers:${opts.numbers ? "on" : "off"} · headers:${opts.headers ? "on" : "off"}`} />
          <text fg={colors.dim} content={keysLine} />
        </box>
      </box>
    </box>
  );
};

/** Phase 0 mock: the same diff rendered as a modal overlay. */
export const DiffModal = () => {
  const { actions } = useApp();
  const opts = useDiffOptions();
  useKeyboard((key) => {
    if (key.name === "escape") actions.closeDiffModal();
  });
  return (
    <box style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 100, alignItems: "center", paddingTop: 4 }}>
      <box style={{ flexDirection: "column", width: "78%", padding: 1, backgroundColor: colors.panel }} border>
        <box style={{ flexDirection: "row", height: 1 }}>
          <text fg={colors.bandFg} content={` DIFF ${fixtureIssueId} (modal) `} />
          <text fg={colors.bandFg} content={` ${fixtureBranch} → ${fixtureBase} `} />
          <box style={{ flexGrow: 1 }} />
          <box onMouseDown={() => actions.closeDiffModal()} style={{ flexDirection: "row" }}>
            <text fg={colors.accent} content="✕" />
          </box>
        </box>
        <box style={{ flexDirection: "row", flexGrow: 1 }}>
          {opts.files ? <FilesPane sel={opts.sel} onSelect={opts.setSel} /> : null}
          <box style={{ flexGrow: 1, flexDirection: "column" }}>
            <scrollbox style={{ flexGrow: 1 }} stickyScroll={false}>
              <DiffBody sel={opts.sel} onSelect={opts.setSel} opts={opts} />
            </scrollbox>
            <ComposerRow placeholder="Reply or comment…" />
            <text fg={colors.dim} content={`${opts.layout} · numbers:${opts.numbers ? "on" : "off"} · headers:${opts.headers ? "on" : "off"}`} />
          </box>
        </box>
        <text fg={colors.dim} content={keysLine} />
      </box>
      <box style={{ flexGrow: 1 }} onMouseDown={() => actions.closeDiffModal()} />
    </box>
  );
};
