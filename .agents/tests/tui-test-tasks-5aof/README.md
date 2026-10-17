# tui-test-tasks-5aof — image render proof

Goal: prove `tasks-5aof`'s attachment `tk-tui-poc-list.png` (ev-080a21, 447.8 kB) renders inside the TUI detail view.

## Result: PASS with `blocks` protocol (default). Kitty fails everywhere tested.

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
- `task-detail-image.png`, `print.gif` — headless VHS print, blocks protocol (image painted)
- `herdr-blocks-live.png`, `herdr-blocks-live-crop.png` — live herdr client pixels, image painted
- `herdr-attach.png`, `herdr-detail-crop.png` — kitty attempt in live surface (negative evidence)
- `crop-3x.png`, `crop-image-area.png` — kitty-attempt crops (6 unique colors = placeholder)
- `crop-src.png` — blocks crop source
- `run.tape` — reproducible VHS recipe
