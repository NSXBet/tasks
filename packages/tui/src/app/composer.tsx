import { useKeyboard } from "@opentui/react";
import { useMemo, useRef } from "react";
import type { TextareaRenderable } from "@opentui/core";
import { useApp } from "./context.js";
import { colors } from "../theme.js";
import { truncate } from "../format.js";
import type { ComposerMode } from "./context.js";

const modeLabels: Record<Exclude<ComposerMode, "closed">, string> = {
  create: "✎ new issue",
  comment: "✎ comment",
  title: "✎ title",
  description: "✎ description (ctrl+s submit)",
  assignee: "@ assignee (empty clears)",
  labels: ", labels (+add −remove)",
  "dep-add": "D dep+ (id or fuzzy)",
  "dep-remove": "dep− pick edge",
  confirm: "confirm",
  search: "/ search",
};

/**
 * Bottom composer. One component, many modes: single-line inputs for the
 * scalar edits, a textarea for descriptions (ctrl+s submits, reads the
 * renderable's plainText), a select for dep removal, and a y/n confirm line
 * for destructive ops. Every submit closes the composer; failures surface
 * through the shell's toast path.
 */
export const Composer = () => {
  const { state, actions } = useApp();
  const { mode, forId, initial, confirm } = state.composer;
  const descRef = useRef<TextareaRenderable | null>(null);
  const issue = forId === null ? null : state.board.issues.find((candidate) => candidate.id === forId) ?? null;

  const edgeOptions = useMemo(() => {
    if (mode !== "dep-remove" || issue === null) return [];
    return issue.dependencies
      .filter((edge) => edge.type === "blocks" && state.board.issues.some((other) => other.id === edge.target))
      .map((edge) => {
        const target = state.board.issues.find((other) => other.id === edge.target);
        return {
          name: `blocks ← ${edge.target} ${truncate(target?.title ?? "", 40)}`,
          description: "",
          value: edge.target,
        };
      });
  }, [mode, issue]);

  const finish = (): void => actions.closeComposer();

  const submitInput = (value: string): void => {
    const body = value.trim();
    switch (mode) {
      case "create": void actions.create(body, 2, []).then(finish); break;
      case "comment": if (forId !== null && body !== "") void actions.comment(forId, body).then(finish); else finish(); break;
      case "title": if (forId !== null && body !== "") void actions.update(forId, { title: body }).then(finish); else finish(); break;
      case "assignee": if (forId !== null) void actions.assign(forId, body === "" ? null : body).then(finish); else finish(); break;
      case "labels":
        if (forId === null) { finish(); break; }
        for (const token of body.split(/\s+/).filter((token) => token.length > 0)) {
          if (token.startsWith("-")) void actions.labelRemove(forId, token.slice(1));
          else void actions.labelAdd(forId, token.replace(/^\+/, ""));
        }
        finish();
        break;
      case "dep-add": {
        if (forId === null || body === "") { finish(); break; }
        const normalized = body.startsWith("tk-") ? body : `tk-${body}`;
        const exact = state.board.issues.find((candidate) => candidate.id === normalized);
        const fuzzy = state.board.issues.filter((candidate) => candidate.id.includes(body.toLowerCase()));
        const target = exact?.id ?? (fuzzy.length === 1 ? fuzzy[0]!.id : null);
        if (target === null) {
          actions.notify(fuzzy.length === 0 ? `no issue matches ${body}` : `ambiguous: ${fuzzy.slice(0, 3).map((candidate) => candidate.id).join(" ")}`);
          finish();
          break;
        }
        void actions.depAdd(forId, target).then(finish);
        break;
      }
      case "search": actions.setSearch(value.trim()); finish(); break;
      default: finish();
    }
  };

  useKeyboard((key) => {
    if (mode === "closed" || state.helpOpen) return;
    if (key.name === "escape") {
      if (mode === "search") actions.setSearch(initial);
      finish();
      return;
    }
    if (mode === "confirm") {
      if (key.sequence === "y" && confirm !== null) {
        if (confirm.kind === "close") void actions.setStatus(confirm.id, "closed");
        else if (confirm.kind === "dep-remove" && confirm.target !== null) void actions.depRemove(confirm.id, confirm.target);
        finish();
      } else if (key.sequence === "n") finish();
    }
  });

  if (mode === "closed") return null;

  if (mode === "confirm") {
    return (
      <box style={{ height: 3, paddingLeft: 1, backgroundColor: colors.panel }} borderStyle="rounded" borderColor={colors.red} title={` ${modeLabels.confirm} `}>
        <text fg={colors.text} content={`${confirm?.label ?? "confirm?"} y/n`} />
      </box>
    );
  }

  if (mode === "dep-remove") {
    return (
      <box style={{ height: Math.min(10, edgeOptions.length + 2), paddingLeft: 1 }} borderStyle="rounded" borderColor={colors.red} title=" dep− pick edge ">
        <select
          options={edgeOptions}
          focused={true}
          showDescription={false}
          showScrollIndicator={edgeOptions.length > 8}
          backgroundColor={colors.bg}
          onSelect={(_index: number, option: { readonly value?: unknown } | null) => {
            if (option?.value !== undefined && forId !== null) {
              actions.requestConfirm({ kind: "dep-remove", id: forId, target: String(option.value), label: `cut dep ${forId} ← ${String(option.value)}?` });
            }
          }}
          selectedBackgroundColor={colors.selection}
        />
      </box>
    );
  }

  if (mode === "description") {
    return (
      <box style={{ height: 7, paddingLeft: 1, paddingRight: 1 }} borderStyle="rounded" borderColor={colors.borderFocus} title={` ${modeLabels.description} ${forId ?? ""} `}>
        <textarea
          ref={(node) => { descRef.current = node; }}
          focused={true}
          initialValue={initial}
          height={5}
          textColor={colors.text}
          backgroundColor={colors.bg}
          onKeyDown={(key) => {
            if (key.name === "s" && key.ctrl && forId !== null) {
              const body = (descRef.current?.plainText ?? initial).trim();
              void actions.update(forId, { description: body }).then(finish);
            }
          }}
        />
      </box>
    );
  }

  const placeholder =
    mode === "create" ? "new issue title"
    : mode === "comment" ? `comment on ${forId ?? ""}`
    : mode === "title" ? "new title"
    : mode === "assignee" ? "assignee (empty clears)"
    : mode === "labels" ? "+tag −tag"
    : mode === "dep-add" ? "target id (tk-abc12 or fuzzy)"
    : "search";

  return (
    <box key={`${mode}:${forId ?? ""}:${initial}`} style={{ height: 3, paddingLeft: 1, paddingRight: 1 }} borderStyle="rounded" borderColor={mode === "search" ? colors.yellow : colors.borderFocus} title={` ${modeLabels[mode]}${forId !== null && mode !== "search" ? ` ${forId}` : ""} `}>
      <input
        ref={(node: unknown) => {
          if (node !== null && node !== undefined && initial !== "") {
            (node as { setText?: (text: string) => void }).setText?.(initial);
          }
        }}
        focused={true}
        placeholder={placeholder}
        textColor={colors.text}
        backgroundColor={colors.bg}
        onSubmit={(payload: unknown) => submitInput(typeof payload === "string" ? payload : String((payload as { value?: string } | null)?.value ?? ""))}
      />
    </box>
  );
};