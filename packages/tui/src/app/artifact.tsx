import { useKeyboard } from "@opentui/react";
import { ComposerRow } from "./composer.js";
import { useApp } from "./context.js";
import type { RouteEntry } from "./routes.js";
import { colors } from "../theme.js";
import { useReviewKeys, Workbench } from "./diff.js";

/**
 * The artifact review page: the same live review session as the diff view,
 * framed around one selected file — the changed file is the artifact under
 * review. Keys and thread actions are shared with the diff view; the only
 * difference is the escape target (back to the task page).
 */
export const ArtifactView = () => {
  const { actions } = useApp();
  useReviewKeys(false);
  useKeyboard((key) => {
    if (key.sequence === "escape") actions.setView("task");
  });
  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <Workbench compact={false} />
      <ComposerRow placeholder="c comment · r reply · e edit · x resolve · esc back to task" />
    </box>
  );
};

/** Deep link `tk://artifact`. */
export const artifactRoute: RouteEntry = { kind: "artifact", path: ["artifact"], apply: (sink) => { sink.setView("artifact"); } };
