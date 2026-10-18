import { useMemo, useEffect, useRef, useState } from "react";
import { NativeImage } from "@opentui/core";
import { useApp } from "./context.js";
import { colors, priorityColor, priorityLabel, statusColor } from "../theme.js";
import { relativeAge, truncate } from "../format.js";
import { dependencyTree, fittedImageCells } from "../store.js";
import { isBlobAttachment } from "@tasks/domain";
import type { BlobContent } from "@tasks/surface";

type MdLine = { readonly kind: "h" | "li" | "code" | "quote" | "img" | "text" | "blank"; readonly text: string };

/** An `evidence:<id>` ref exactly as produced by `tk attach` / comment ingest. */
const EVIDENCE_CHUNK_RE = /^evidence:ev-[a-z0-9]{6}$/;

/** Minimal markdown shaping: headers, list bullets, code fences, quotes. Evidence refs become img lines. */
const mdLines = (source: string): readonly MdLine[] => {
  const out: MdLine[] = [];
  let inCode = false;
  for (const chunk of source.split(/(evidence:ev-[a-z0-9]{6})/)) {
    if (EVIDENCE_CHUNK_RE.test(chunk)) { out.push({ kind: "img", text: chunk.slice("evidence:".length) }); continue; }
    for (const raw of chunk.split("\n")) {
      if (raw.startsWith("```")) { inCode = !inCode; continue; }
      if (inCode) { out.push({ kind: "code", text: raw }); continue; }
      if (raw.trim() === "") { out.push({ kind: "blank", text: "" }); continue; }
      if (/^#{1,6}\s/.test(raw)) out.push({ kind: "h", text: raw.replace(/^#{1,6}\s*/, "").trim() });
      else if (/^\s*[-*]\s+/.test(raw)) out.push({ kind: "li", text: raw.replace(/^(\s*)[-*]\s+/, "$1· ") });
      else if (/^>\s?/.test(raw)) out.push({ kind: "quote", text: raw.replace(/^>\s?/, "") });
      else out.push({ kind: "text", text: raw });
    }
  }
  return out;
};

/**
 * One evidence image, fetched through the surface. Loading → pending mark;
 * unknown bytes → missing mark.
 *
 * The bytes are decoded and area-kernel-resized to exactly the half-block pixel
 * grid of the fitted cell box, then rendered with `fit="fill"`: every native
 * blocks-protocol sample maps 1:1 onto a prescaled pixel, so downscaled
 * screenshots keep their structure (raw 1600×880 bytes point-sample to noise —
 * pixel-proven in .agents/tests/tui-test-tasks-5aof). Undecodable bytes fall
 * back to the raw-bytes render. Kitty/sixel stay pinned off: Ghostty 1.3.x
 * never paints their virtual placements.
 */
const BlobImage = ({ issueId, refId }: { readonly issueId: string; readonly refId: string }) => {
  const { state } = useApp();
  const [content, setContent] = useState<BlobContent | null | "loading">("loading");
  const [scaled, setScaled] = useState<NativeImage | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);
  // Holds the image handed to <image>; the renderable retains it independently,
  // so our dispose only drops the component's reference.
  const owned = useRef<NativeImage | null>(null);

  useEffect(() => {
    let alive = true;
    void state.store.surface
      .evidenceRead(issueId, `evidence:${refId}`)
      .then((outcome) => { if (alive) setContent(outcome.ok ? outcome.value : null); });
    return () => { alive = false; };
  }, [state.store.surface, issueId, refId]);

  useEffect(() => {
    owned.current?.dispose();
    owned.current = null;
    if (content === "loading" || content === null || !content.meta.mime.startsWith("image/")) { setScaled(null); return; }
    setDecodeFailed(false);
    try {
      const source = NativeImage.decode(content.bytes);
      const cells = fittedImageCells(source.width, source.height, state.imageSize);
      const resized = source.resize({ width: cells.width, height: cells.height * 2, kernel: "area" });
      source.dispose();
      owned.current = resized;
      setScaled(resized);
    } catch {
      setDecodeFailed(true);
      setScaled(null);
    }
  }, [content, state.imageSize.width, state.imageSize.height]);
  useEffect(() => () => { owned.current?.dispose(); owned.current = null; }, []);

  if (content === "loading") return <text fg={colors.dim} content={`   ▣ ${refId} …`} />;
  if (content === null) return <text fg={colors.red} content={`   ▣ ${refId} (missing bytes)`} />;
  if (!content.meta.mime.startsWith("image/")) return <text fg={colors.dim} content={`   ▣ ${content.meta.name} (${content.meta.mime})`} />;
  // Half-block SGR renders in every terminal and capture path (VHS, herdr), so
  // the TUI pins it; stream escapes from @tasks/terminal-image serve the CLI only.
  // fill + the exact fitted cell size keeps the pre-scaled source 1:1 (fill uses
  // the box size directly; fit would re-derive the grid from a cellAspectRatio).
  if (scaled !== null) {
    return <image source={scaled} fit="fill" protocol="blocks" style={{ width: scaled.width, height: scaled.height / 2, marginLeft: 2 }} />;
  }
  if (decodeFailed) return <image source={content.bytes} fit="fit" protocol="blocks" style={{ width: state.imageSize.width, height: state.imageSize.height, marginLeft: 2 }} />;
  return null;
};

/** Right pane: full issue detail. Owns its scroll; closes with Escape. */
export const IssueDetail = () => {
  const { state } = useApp();
  const issue = state.board.issues.find((candidate) => candidate.id === state.detailId) ?? null;

  const tree = useMemo(() => (issue === null ? [] : dependencyTree(state.board.issues, issue.id, "up", 2)), [issue, state.board.issues]);

  if (issue === null) return <box style={{ flexGrow: 1 }} />;
  const statusFg = statusColor(issue.status);
  const age = relativeAge(issue.updatedAt, state.board.fetchedAt);
  const description = mdLines(issue.description);

  return (
    <box
      title={` ${issue.id} `}
      titleAlignment="left"
      borderStyle="rounded"
      borderColor={colors.border}
      style={{ flexGrow: 1, flexDirection: "column", backgroundColor: colors.bg }}
    >
      <scrollbox style={{ flexGrow: 1 }} stickyScroll={false}>
        <text>
          <span fg={colors.text}>{issue.title}</span>
        </text>
        <text>
          <span fg={statusFg}>{issue.status}</span>
          <span fg={colors.dim}> │ </span>
          <span fg={priorityColor(issue.priority)}>{priorityLabel(issue.priority)}</span>
          <span fg={colors.dim}> │ </span>
          <span fg={colors.text}>{issue.assignee ?? "unassigned"}</span>
          <span fg={colors.dim}> │ </span>
          <span fg={colors.dim}>{age}</span>
          {issue.labels.map((label) => (
            <span key={label} fg={colors.cyan}>{` #${label}`}</span>
          ))}
        </text>
        <text fg={colors.dim} content={`age ${issue.updatedAt.toISOString().slice(0, 10)} · deps ${issue.dependencies.length} · comments ${issue.commentCount}`} style={{ marginBottom: 1 }} />
        {description.length > 0 ? (
          <box style={{ flexDirection: "column", marginBottom: 1 }}>
            {description.map((line, index) => {
              if (line.kind === "img") return <BlobImage key={index} issueId={issue.id} refId={line.text} />;
              if (line.kind === "blank") return <text key={index} content=" " />;
              if (line.kind === "h") return <text key={index} fg={colors.text}>{line.text}</text>;
              if (line.kind === "code") return <text key={index} fg={colors.cyan} content={`  ${line.text}`} />;
              if (line.kind === "quote") return <text key={index}><span fg={colors.dim}>▎</span><span fg={colors.dim}>{line.text}</span></text>;
              return <text key={index} fg={colors.text} content={line.text} />;
            })}
          </box>
        ) : null}
        {issue.notes !== null && issue.notes !== "" ? <text fg={colors.dim} content={`notes: ${issue.notes}`} style={{ marginBottom: 1 }} /> : null}
        {issue.attachments.length > 0 ? (
          <box style={{ flexDirection: "column", marginBottom: 1 }}>
            <text fg={colors.band} content="attachments" />
            {issue.attachments.map((attachment) =>
              isBlobAttachment(attachment) ? (
                <box key={attachment.id} style={{ flexDirection: "column" }}>
                  <text>
                    <span fg={colors.dim}>▎</span>
                    <span fg={colors.cyan}>{` ${attachment.name}`}</span>
                    <span fg={colors.dim}>{` ${attachment.id} · ${attachment.kind} · ${(attachment.size / 1024).toFixed(1)} kB`}</span>
                  </text>
                  {attachment.mime.startsWith("image/") ? <BlobImage issueId={issue.id} refId={attachment.id} /> : null}
                </box>
              ) : (
                <text key={attachment.path}>
                  <span fg={colors.dim}>▎</span>
                  <span fg={colors.cyan}>{` ${attachment.path}`}</span>
                </text>
              ),
            )}
          </box>
        ) : null}
        {tree.length > 1 ? (
          <box style={{ flexDirection: "column", marginBottom: 1 }}>
            <text fg={colors.band} content="blocked by" />
            {tree.map((row) => (
              <text key={`${row.id}:${row.prefix}`}>
                <span fg={colors.dim}>{row.prefix}</span>
                <span fg={row.blocked ? colors.red : statusColor(state.board.issues.find((candidate) => candidate.id === row.id)?.status ?? "open")}>●</span>
                <span fg={row.id === issue.id ? colors.text : colors.dim}>{` ${row.id}`}</span>
                {row.cycle ? <span fg={colors.red}> (cycle)</span> : null}
                {row.reference ? <span fg={colors.dim}> (ref)</span> : null}
              </text>
            ))}
          </box>
        ) : null}
        {issue.comments.map((comment) => (
          <box key={comment.id} style={{ flexDirection: "column" }}>
            <text><span fg={colors.dim}>▎</span><span fg={colors.cyan}>{` ${comment.author}`}</span><span fg={colors.dim}>{` (${relativeAge(comment.createdAt, state.board.fetchedAt)} ago)`}</span></text>
            {comment.text.split(/(evidence:ev-[a-z0-9]{6})/).map((chunk, index) => {
              if (EVIDENCE_CHUNK_RE.test(chunk)) return <BlobImage key={`${comment.id}:${index}`} issueId={issue.id} refId={chunk.slice("evidence:".length)} />;
              if (chunk === "") return null;
              return chunk.split("\n").map((line, lineIndex) => (
                <text key={`${comment.id}:${index}:${lineIndex}`}><span fg={colors.dim}>▎</span><span fg={colors.dim}>{` ${truncate(line, 96)}`}</span></text>
              ));
            })}
          </box>
        ))}
      </scrollbox>
      <box style={{ flexDirection: "row", gap: 1, height: 1 }}>
        <text fg={colors.green} content="s:start" />
        <text fg={colors.yellow} content="r:rev" />
        <text fg={colors.dim} content="d:done" />
        <text fg={colors.accent} content="e:edit" />
        <text fg={colors.red} content="esc:close" />
      </box>
    </box>
  );
};
