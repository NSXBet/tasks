# tui-test-tasks-5aof — image render proof

Goal: prove `tasks-5aof`'s attachment `tk-tui-poc-list.png` (ev-080a21, 447.8 kB) renders inside the TUI detail view.

## Result 2 — FIXED: blocks + area pre-scale (2026-10-17)

Painting was never the whole problem: the native blocks sampler point-samples
each half-cell, so a 1600×880 source into ~28×14 cells dropped ~99.9% of
pixels → salt-and-pepper noise (`crop-BEFORE.png`).

Fix (no new deps, no OpenTUI fork): `packages/tui/src/app/detail.tsx`
`BlobImage` decodes via `NativeImage.decode`, area-resizes to exactly
`W × 2H` pixels (`NativeImage.resize({ kernel: "area" })`), and renders with
`fit="fill"` at the fitted cell grid (`fittedImageCells` in `store.ts`,
mirrors OpenTUI's `getFittedSize` cellAspectRatio=2 math). Identity 1:1
sampling; every source pixel lands. Decode failure falls back to the old
raw-bytes path.

Proof: `vhs run.tape` → `task-detail-image.png` shows a recognizable
downscale (title bar, sidebar, rows, selection highlight). A/B:
`crop-BEFORE.png` (noise) vs `crop-AFTER-1.png` (structured thumbnail).

## Result 1 — PASS with `blocks` protocol (default). Kitty fails everywhere tested.

| Surface | `OPENTUI_IMAGE_PROTOCOL=kitty` | default (`blocks`) |
|---|---|---|
| VHS headless print | ❌ placeholder (6 unique colors, 88% `#171717`) | ✅ painted (2617 unique colors) |
| Live herdr client pixels | ❌ blank cell | ✅ painted (see `herdr-blocks-live-crop.png`) |

## Why kitty fails
- VHS/ttyd has no kitty graphics support → drops placements, draws nothing.
- Ghostty 1.3.x never paints OpenTUI's kitty virtual placements + Unicode placeholders (empty box) — already documented in `packages/tui/src/main.tsx` (hence the `blocks` default).

## Why blocks works
Half-block SGR rendering is plain styled text — survives every capture path (VHS print, herdr pane read, cmux shot) and every terminal.

## Reproducible recipe
`run.tape` (headless): boots the TUI, `j`×9 → row 10 (`tasks-5aof`), Enter → detail, screenshot → `task-detail-image.png` / `print.gif`. Run `vhs run.tape` from this dir; relative paths only.

Live loop: `herdr pane split` → launch `bun packages/tui/src/main.tsx` in the pane → paced `herdr pane send-keys` (one key per call, ~200ms) → `pane read` to verify → for pixels, attach a herdr client and shot the surface (`cmux shot`).

## Evidence files
- `task-detail-image.png`, `print.gif` — headless VHS print, blocks protocol + area pre-scale (fixed render)
- `task-detail-image-BEFORE.png` — pre-fix capture (noise) kept for A/B
- `crop-BEFORE.png` / `crop-AFTER-1.png` / `crop-AFTER-2.png` — attachment-area crops, before vs after
- `herdr-blocks-live.png`, `herdr-blocks-live-crop.png` — live herdr client pixels, image painted
- `herdr-attach.png`, `herdr-detail-crop.png` — kitty attempt in live surface (negative evidence)
- `crop-3x.png`, `crop-image-area.png` — kitty-attempt crops (6 unique colors = placeholder)
- `crop-src.png` — blocks crop source
- `run.tape` — reproducible VHS recipe
