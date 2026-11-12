import { useRef } from "react";
import type { TextareaRenderable } from "@opentui/core";
import { useApp } from "./context.js";
import { colors } from "../theme.js";

/**
 * Inline hunk edit buffer (D-03), rendered inside the diff view under the
 * diff body: a focused textarea over the selected hunk's new-side lines.
 * ctrl+s writes them back into the worktree file; esc cancels.
 */
export const HunkEditBuffer = () => {
  const { state, actions } = useApp();
  const ref = useRef<TextareaRenderable | null>(null);
  const edit = state.review?.edit ?? null;
  if (edit === null) return null;
  const end = edit.count === 0 ? edit.start : edit.start + edit.count - 1;
  const height = Math.min(12, Math.max(1, edit.count) + 2);
  return (
    <box
      style={{ height: height + 3, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}
      borderStyle="rounded"
      borderColor={colors.borderFocus}
      title={` ✎ edit ${edit.filePath}:${edit.start}-${end} `}
    >
      <text fg={colors.dim} content="ctrl+s save · esc cancel" />
      <textarea
        ref={(node) => { ref.current = node; }}
        focused={true}
        initialValue={edit.original}
        height={height}
        textColor={colors.text}
        backgroundColor={colors.bg}
        onKeyDown={(key) => {
          if (key.name === "s" && key.ctrl) {
            void actions.saveHunkEdit(ref.current?.plainText ?? edit.original);
            return;
          }
          if (key.name === "escape") actions.cancelHunkEdit();
        }}
      />
    </box>
  );
};
