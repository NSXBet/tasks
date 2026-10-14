import { useApp } from "./context.js";
import { colors } from "../theme.js";
import { fixtureIssueId, fixtureArtifacts } from "../fixture.js";

/**
 * Phase 0 mock: changed-files list for the canonical scenario. Clicking an
 * artifact navigates to the diff view; other actions report WIP.
 */
export const ArtifactView = () => {
  const { actions } = useApp();
  return (
    <box style={{ flexGrow: 1, flexDirection: "column", padding: 1 }} border>
      <box style={{ flexDirection: "row", backgroundColor: colors.band, paddingLeft: 1, paddingRight: 1, height: 1 }}>
        <text fg={colors.bandFg} content={` ARTIFACTS ${fixtureIssueId} `} />
      </box>
      <box style={{ flexDirection: "column", marginTop: 1 }}>
        {fixtureArtifacts.map((a) => (
          <box key={a.path} onMouseDown={() => actions.setView("diff")} style={{ flexDirection: "row" }}>
            <text>
              <span fg={colors.text}>{a.path}</span>
              <span fg={colors.green}>{` +${a.added}`}</span>
              <span fg={colors.red}>{`/−${a.removed}`}</span>
              <span fg={colors.dim}>{` · ${a.comments} comments`}</span>
            </text>
          </box>
        ))}
      </box>
      <box style={{ flexGrow: 1 }} />
      <text fg={colors.dim} content="click artifact → diff · esc back" />
    </box>
  );
};
