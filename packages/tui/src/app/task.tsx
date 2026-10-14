import { useKeyboard } from "@opentui/react";
import { useApp } from "./context.js";
import { colors, priorityLabel } from "../theme.js";
import { padStart, truncate } from "../format.js";
import { fixtureAgents, fixtureArtifacts, fixtureBase, fixtureBranch, fixtureSessions, fixtureWorktree } from "../fixture.js";

/**
 * Phase 0 mock: the plan's task→review record — tasks rail on the left, the
 * canonical scenario in the center (description, actions, session table,
 * comments), artifacts rail on the right. Buttons are interaction shells:
 * start work / comment / edit report WIP, diff keys open the two review doors.
 */

const sessionCols = { status: 9, agent: 6, id: 11 };

const SessionTable = () => (
  <box style={{ flexDirection: "column" }}>
    <text fg={colors.dim} content={`SESSIONS${padStart("STATUS", sessionCols.status + 2)}${padStart("AGENT", sessionCols.agent + 1)}${padStart("SESSION", sessionCols.id + 1)}TOPIC` } />
    {fixtureSessions.map((s) => (
      <box key={s.id} style={{ flexDirection: "row", height: 1 }}>
        <text>
          <span fg={s.status === "running" ? colors.band : colors.dim}>{padStart(s.status, sessionCols.status)}</span>
          <span fg={colors.dim}>{"  "}</span>
          <span fg={colors.text}>{padStart(s.agent, sessionCols.agent)}</span>
          <span fg={colors.dim}>{" "}</span>
          <span fg={colors.text}>{padStart(s.id, sessionCols.id)}</span>
          <span fg={colors.dim}>{" "}</span>
          <span fg={colors.dim}>{truncate(s.topic, 20)}</span>
        </text>
        <box style={{ flexGrow: 1 }} />
        <text fg={colors.dim} content={s.duration} />
      </box>
    ))}
  </box>
);

export const TaskView = () => {
  const { state, actions } = useApp();
  useKeyboard((key) => {
    switch (key.sequence) {
      case "s": case "c": case "e": actions.notify("WIP"); break;
      case "v": actions.setView("diff"); break;
      case "V": actions.openDiffModal(); break;
      default: break;
    }
  });
  const issue = state.board.issues.find((candidate) => candidate.id === state.detailId) ?? state.board.issues[0];
  if (issue === undefined) return null;
  return (
    <box style={{ flexGrow: 1, flexDirection: "row" }} border>
      <box style={{ width: "20%", flexShrink: 0, flexDirection: "column", paddingLeft: 1 }}>
        <text fg={colors.dim} content="TASKS" />
        {state.board.issues.map((row) => (
          <box
            key={row.id}
            style={{ height: 1, flexDirection: "row", ...(row.id === issue.id ? { backgroundColor: colors.selection } : {}) }}
          >
            <text fg={row.id === issue.id ? colors.text : colors.dim}>{truncate(row.title, 18)}</text>
          </box>
        ))}
        <box style={{ flexGrow: 1 }} />
      </box>
      <box style={{ flexGrow: 1, flexDirection: "column", padding: 1 }}>
        <box style={{ flexDirection: "row", backgroundColor: colors.band, paddingRight: 1, height: 1 }}>
          <text fg={colors.bandFg} content={` ${issue.id} `} />
          <text fg={colors.bandFg} content={` ${issue.title} `} />
          <box style={{ flexGrow: 1 }} />
          <text fg={colors.bandFg} content={`${priorityLabel(issue.priority)} `} />
        </box>
        <box style={{ flexDirection: "row", height: 1 }}>
          <text>
            <span fg={colors.violet}>{fixtureBranch}</span>
            <span fg={colors.dim}>{` · ${fixtureBase} · ${fixtureWorktree}`}</span>
          </text>
        </box>
        <text fg={colors.text} content={issue.description ?? ""} />
        <box style={{ flexDirection: "row", height: 1 }}>
          <text>
            <span fg={colors.accent}>[ start work ]</span>
            <span fg={colors.dim}>  </span>
            <span fg={colors.accent}>[ open diff ]</span>
          </text>
        </box>
        <SessionTable />
        <text fg={colors.dim} content={`COMMENTS · ${issue.comments.length}`} />
        {issue.comments.map((c) => (
          <box key={c.id} style={{ flexDirection: "row", height: 1 }}>
            <text>
              {fixtureAgents[c.author] === true ? <span fg={colors.magenta}>[agent] </span> : null}
              <span fg={colors.text}>{`${c.author}: `}</span>
              <span fg={colors.dim}>{truncate(c.text, 46)}</span>
            </text>
          </box>
        ))}
        <box style={{ flexGrow: 1 }} />
        <text fg={colors.dim} content="s start work · v diff · V diff modal · c comment · e edit · esc back" />
      </box>
      <box style={{ width: "24%", flexShrink: 0, flexDirection: "column", paddingLeft: 1 }}>
        <text fg={colors.dim} content="ARTIFACTS" />
        {fixtureArtifacts.map((a) => (
          <box key={a.path} style={{ flexDirection: "row", height: 1 }} onMouseDown={() => actions.setView("diff")}>
            <text>
              <span fg={colors.text}>{truncate(a.path, 24)}</span>
              <span fg={colors.green}>{` +${a.added}`}</span>
              <span fg={colors.red}>{`/−${a.removed}`}</span>
            </text>
            <box style={{ flexGrow: 1 }} />
            <text fg={colors.dim} content={` ${a.comments}·`} />
          </box>
        ))}
        <box style={{ flexGrow: 1 }} />
      </box>
    </box>
  );
};
