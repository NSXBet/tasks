import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { ComposerRow } from "./composer.js";
import { useApp } from "./context.js";
import { colors } from "../theme.js";
import {
  fixtureArtifactComments,
  fixtureArtifacts,
  fixtureCodeContent,
  fixtureIssueId,
} from "../fixture.js";

/**
 * Phase 0 mock: the artifact review surface — artifacts rail on the left,
 * the selected artifact front and center (docs render with SUMMARY/AUTO
 * tabs, code as file content with +/− colored lines), and the review
 * thread beside it with per-comment resolve state. Selecting an artifact
 * is local mock state; navigating to the diff keeps the existing action,
 * other actions report WIP.
 */
export const ArtifactView = () => {
  const { actions } = useApp();
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<"summary" | "auto">("summary");

  useKeyboard((key) => {
    switch (key.sequence) {
      case "r": actions.notify("WIP"); break;
      case "v": actions.setView("diff"); break;
      case "t": setTab((current) => (current === "summary" ? "auto" : "summary")); break;
      default: break;
    }
  });

  const artifact = fixtureArtifacts[sel] ?? fixtureArtifacts[0];
  if (artifact === undefined) return null;
  const resolvedCount = fixtureArtifactComments.filter((c) => c.resolved).length;
  const allResolved = resolvedCount === fixtureArtifactComments.length;

  const code = artifact.kind === "code" ? fixtureCodeContent[artifact.path] : undefined;
  const isDoc = artifact.kind === "doc" && artifact.summary !== undefined && artifact.body !== undefined;

  return (
    <box style={{ flexGrow: 1, flexDirection: "row" }} border>
      {/* artifacts rail */}
      <box style={{ width: "26%", flexShrink: 0, flexDirection: "column", paddingLeft: 1 }}>
        <text fg={colors.dim} content={`ARTIFACTS ${fixtureIssueId}`} />
        {fixtureArtifacts.map((a, i) => (
          <box
            key={a.path}
            style={{ height: 1, flexDirection: "row", ...(i === sel ? { backgroundColor: colors.selection } : {}) }}
            onMouseDown={() => setSel(i)}
          >
            <text>
              <span fg={i === sel ? colors.text : colors.dim}>{a.path}</span>
              <span fg={colors.green}>{` +${a.added}`}</span>
              <span fg={colors.red}>{`/−${a.removed}`}</span>
              <span fg={colors.dim}>{` · ${a.comments} comments`}</span>
            </text>
          </box>
        ))}
        <box style={{ flexGrow: 1 }} />
        <text>
          <span fg={colors.accent}>[ open diff ]</span>
          <span fg={colors.dim}> t tabs · r reply · esc back</span>
        </text>
      </box>

      {/* selected artifact */}
      <box style={{ flexGrow: 1, flexDirection: "column", padding: 1 }}>
        <text>
          <span fg={colors.dim}>{`${fixtureIssueId} / `}</span>
          <span fg={colors.text}>{artifact.path}</span>
        </text>
        <box style={{ flexDirection: "row", backgroundColor: colors.band, paddingRight: 1, height: 1 }}>
          <text fg={colors.bandFg} content={` ${artifact.path} `} />
          <box style={{ flexGrow: 1 }} />
          {isDoc ? (
            <text
              fg={colors.bandFg}
              bg={tab === "summary" ? colors.green : colors.violet}
              content=" SUMMARY "
            />
          ) : null}
          {isDoc ? (
            <text
              fg={colors.bandFg}
              bg={tab === "auto" ? colors.green : colors.violet}
              content=" AUTO "
            />
          ) : (
            <text bg={colors.green} fg={colors.bandFg} content={` ${artifact.added}+/−${artifact.removed} `} />
          )}
        </box>
        <box style={{ flexDirection: "column", marginTop: 1 }}>
          {isDoc && tab === "summary"
            ? artifact.summary?.map((line) => (
                <text key={line} fg={colors.text} content={`§ ${line}`} />
              ))
            : null}
          {isDoc && tab === "auto"
            ? artifact.body?.map((line) => <text key={line} fg={colors.text} content={line} />)
            : null}
          {code?.map((l, i) => (
            <box key={`${i}-${l.no}-${l.kind}`} style={{ flexDirection: "row", height: 1 }}>
              <text fg={colors.dim} content={`${String(l.no).padStart(4)} `} />
              <text
                fg={l.kind === "add" ? colors.green : l.kind === "del" ? colors.red : colors.dim}
                content={`${l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "} ${l.text}`}
              />
            </box>
          ))}
        </box>
        <box style={{ flexGrow: 1 }} />
        <text fg={colors.dim} content="v diff · esc back" />
      </box>

      {/* review thread */}
      <box style={{ width: "30%", flexShrink: 0, flexDirection: "column", paddingLeft: 1 }}>
        <text fg={colors.dim} content={allResolved ? "REVIEW · all resolved ✓" : `REVIEW · ${fixtureArtifactComments.length - resolvedCount} OPEN · ${resolvedCount} ✓`} />
        {fixtureArtifactComments.map((c) => (
          <box key={c.author + c.text} style={{ flexDirection: "column", paddingTop: 1 }}>
            <text>
              <span fg={c.agent ? colors.cyan : colors.text}>{c.author}</span>
              <span fg={colors.dim}>{c.resolved ? "  ✓ resolved" : "  open"}</span>
            </text>
            <text fg={c.resolved ? colors.dim : colors.text} content={c.text} />
            {c.resolvedBy !== undefined ? <text fg={colors.green} content={`  ✓ ${c.resolvedBy}`} /> : null}
          </box>
        ))}
        <ComposerRow placeholder="Reply or comment…" />
        <box style={{ flexGrow: 1 }} />
        <text fg={colors.dim} content={`${resolvedCount}/${fixtureArtifactComments.length} resolved`} />
      </box>
    </box>
  );
};
