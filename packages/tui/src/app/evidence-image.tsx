import { useEffect, useRef, useState, type ReactNode } from "react";
import { NativeImage } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { inlineImageMode } from "@tasks/terminal-image";
import type { BlobContent } from "@tasks/surface";
import { useApp } from "./context.js";
import { colors } from "../theme.js";
import { fittedImageCells } from "../store.js";

/** `▣ evidence:<id> · <name> · 💬 N` — the commentable row under (or instead of) an evidence image. */
export const evidenceCaption = (refId: string, name: string, comments: number): string => `▣ evidence:${refId} · ${name} · 💬 ${comments}`;

const CaptionRow = ({ refId, name, comments }: { readonly refId: string; readonly name: string; readonly comments: number }) => (
  <text style={{ marginLeft: 2 }}>
    <span fg={colors.dim}>{`▣ evidence:${refId} · ${name} · `}</span>
    <span fg={comments > 0 ? colors.accent : colors.dim}>{`💬 ${comments}`}</span>
  </text>
);

/**
 * One evidence image, fetched through the surface. Loading → pending mark;
 * unknown bytes → missing mark.
 *
 * Whether it paints at all is the `@tasks/terminal-image` `inlineImageMode`
 * decision (D-06): `kitty` when the renderer advertises kitty graphics,
 * `blocks` on any other TTY, `null` (no TTY, or not an image) → no `<image>`.
 * The paint itself stays inside OpenTUI `<image>` — no raw escapes are
 * written past the renderer. With `caption`, the `▣ evidence:<id>` row
 * (comment count in accent when > 0) always follows, so the entry stays a
 * comment target even when nothing paints.
 *
 * The bytes are decoded and area-kernel-resized to exactly the half-block pixel
 * grid of the fitted cell box, then rendered with `fit="fill"`: every native
 * blocks-protocol sample maps 1:1 onto a prescaled pixel, so downscaled
 * screenshots keep their structure (raw 1600×880 bytes point-sample to noise —
 * pixel-proven in .agents/tests/tui-test-tasks-5aof). The fitted box is clamped
 * to the caller's live cell width so narrow terminals prescale down instead of
 * clipping the image at the border. Undecodable bytes fall back to the
 * raw-bytes render. When the terminal advertises kitty graphics (Ghostty
 * 1.3.x paints direct-pixel f=24/32 placements; its PNG f=100 transport is
 * silently dropped), the original bytes go to `protocol="auto"` so the native
 * kitty path down- or upscales into the fitted box itself — the blocks
 * prescale (2 vertical px per cell) would waste that resolution.
 */
export const EvidenceImage = ({ issueId, refId, maxCellWidth, caption }: {
  readonly issueId: string;
  readonly refId: string;
  readonly maxCellWidth: number;
  readonly caption?: { readonly comments: number };
}) => {
  const { state } = useApp();
  // Capabilities settle during createCliRenderer (before React renders), and
  // images mount on navigation, long after detection. Not reactive: a
  // capability change after mount wouldn't re-render this component.
  const kittyGraphics = useRenderer().capabilities?.kitty_graphics === true;
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

  const mode = content === "loading" || content === null
    ? null
    : inlineImageMode({ mime: content.meta.mime, isTTY: Boolean(process.stdout.isTTY), kittyGraphics });

  useEffect(() => {
    owned.current?.dispose();
    owned.current = null;
    // T-09-07: decode only what will paint; a null mode never touches the decoder.
    if (content === "loading" || content === null || mode === null) { setScaled(null); return; }
    setDecodeFailed(false);
    try {
      const source = NativeImage.decode(content.bytes);
      const cells = fittedImageCells(source.width, source.height, { width: Math.min(state.imageSize.width, maxCellWidth), height: state.imageSize.height });
      const resized = source.resize({ width: cells.width, height: cells.height * 2, kernel: "area" });
      source.dispose();
      owned.current = resized;
      setScaled(resized);
    } catch {
      setDecodeFailed(true);
      setScaled(null);
    }
  }, [content, mode, state.imageSize.width, state.imageSize.height, maxCellWidth]);
  useEffect(() => () => { owned.current?.dispose(); owned.current = null; }, []);

  const withCaption = (node: ReactNode, name: string) => caption === undefined ? node : (
    <box style={{ flexDirection: "column" }}>
      {node}
      <CaptionRow refId={refId} name={name} comments={caption.comments} />
    </box>
  );

  if (content === "loading") return <text fg={colors.dim} content={`   ▣ ${refId} …`} />;
  if (content === null) return <text fg={colors.red} content={`   ▣ ${refId} (missing bytes)`} />;
  const { name } = content.meta;
  if (!content.meta.mime.startsWith("image/")) return withCaption(<text fg={colors.dim} content={`   ▣ ${name} (${content.meta.mime})`} />, name);
  // fill + the exact fitted cell size keeps the pre-scaled source 1:1 (fill uses
  // the box size directly; fit would re-derive the grid from a cellAspectRatio).
  if (mode !== null && scaled !== null) {
    // Native kitty path: hand it the full-resolution bytes; it decodes and
    // samples into the fitted box itself.
    const image = mode === "kitty"
      ? <image source={content.bytes} fit="fill" protocol="auto" style={{ width: scaled.width, height: scaled.height / 2, marginLeft: 2 }} />
      : <image source={scaled} fit="fill" protocol="blocks" style={{ width: scaled.width, height: scaled.height / 2, marginLeft: 2 }} />;
    return withCaption(image, name);
  }
  if (mode !== null && decodeFailed) {
    return withCaption(<image source={content.bytes} fit="fit" protocol="blocks" style={{ width: Math.min(state.imageSize.width, maxCellWidth), height: state.imageSize.height, marginLeft: 2 }} />, name);
  }
  // No inline mode: the caption row alone (or, uncaptioned, a plain name mark).
  if (mode === null) return caption === undefined ? <text fg={colors.dim} content={`   ▣ evidence:${refId} · ${name}`} /> : <CaptionRow refId={refId} name={name} comments={caption.comments} />;
  return withCaption(null, name);
};
