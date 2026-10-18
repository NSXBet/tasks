---
name: tui-testing
description: "Use this skill whenever doing anything TUI-related — testing, verifying, debugging, or demoing a terminal user interface. It covers the real-interface loop: drive the actual binary in a Herdr pane with herdr CLI, capture text frames and pixel prints, and save all prints and evidence in .agents/tests/tui-test-<identifier>."
---

# TUI Testing

Test the TUI through its real interface: launch the actual binary in a Herdr pane, drive it with keys, read the rendered frames, and save pixel prints as evidence. No tmux, no mocks for verification — the renderer is the product.

Division of labor: **Herdr panes are only for the interactive loop** (send key → read frame → assert → adjust). **Prints never need Herdr** — VHS runs fully headless (own virtual terminal, rendered offscreen); run the tape as a plain command from anywhere.

(Headless frame tests — e.g. `bun run --filter <package> test` — do not see layout. They never replace the loop below.)

## Evidence directory

All prints and evidence go to `.agents/tests/tui-test-<identifier>/`. The identifier is something that represents the work, in order of preference:

1. **Branch name**, sanitized: `git branch --show-current` → lowercase, `/` and spaces → `-` (e.g. `feat/review parity` → `tui-test-feat-review-parity`).
2. **Issue id** when the work is tracked: `tui-test-<issue-id>`.
3. **Short feature slug** as fallback: `tui-test-diff-composer`.

Create the directory on first print. Keep one tape + prints per run; name files by what they show (`detail.png`, `list-view.png`). Attach prints to the tracked issue when one exists.

## The loop

### 1. Ensure a Herdr server

```bash
herdr pane list    # works? server is up
```

If it errors with "no herdr server is running": start `herdr server` as a persistent background job (harness job, no deadline — it is shared infrastructure, do not kill it when done). Then re-check `herdr pane list`.

### 2. Get a pane

```bash
herdr pane split <existing-pane-id> --direction right --cwd <repo-root> --no-focus
```

Pick any existing pane id from `herdr pane list`; use the new pane id everywhere below. The pane must start at the repo root (`--cwd`).

### 3. Launch the real binary

```bash
herdr pane run <pane> bun <path-to-tui-entry>    # e.g. bun packages/tui/src/main.tsx
herdr pane wait-output <pane> --match "<boot-complete-signature>"   # statusbar/footer = boot complete
```

### 4. Drive it — one key per call, paced

```bash
herdr pane send-keys <pane> j       # down (k = up, in lists)
herdr pane send-keys <pane> enter   # open detail on selection
herdr pane send-keys <pane> esc     # close detail/modal
herdr pane send-keys <pane> q       # quit the TUI when done
```

**Never burst keys in one call** — the renderer coalesces them and selection lags (a burst of `j`+enter has opened the wrong item). One `send-keys` per call, ~200ms apart. Discover app-specific keys (views, shortcuts) by reading a rendered frame, not by guessing.

### 5. Read and assert

```bash
herdr pane read <pane> --source visible --format text
```

Selection state is easiest to verify by acting: open the detail and read its title. Expect wrong content? Adjust with one paced `j`/`k` and re-enter.

### 6. Pixel print (the deliverable)

VHS records its own terminal running the real binary — fully headless, no Herdr pane or server required. Write a tape **with relative paths only** — this VHS rejects absolute paths for `Output`/`Screenshot` — then run it from the tape's own directory:

```
# run.tape
Output print.gif
Set Shell bash
Set Width 1600
Set Height 880
Set FontSize 16
Set Padding 0
Set TypingSpeed 40ms
Type "cd <repo-root-absolute> && bun <path-to-tui-entry>"   # shell starts in the tape's dir
Enter
Sleep 3500ms
Type "j"
Sleep 200ms
Enter                 # Enter/Escape directives for special keys; Type for characters
Sleep 800ms
Screenshot detail.png
Sleep 800ms
```

```bash
cd .agents/tests/tui-test-<id> && vhs run.tape
```

Boot needs ~4s before the first frame is worth capturing. Commit the tape alongside the prints — it is a reproducible recipe.

## Pitfalls

- Burst `send-keys` coalesces → paced single calls only.
- VHS absolute paths → parser errors ("Invalid command: tmp"); relative paths only.
- `herdr pane read` shows the shell prompt `$` when the TUI has quit — relaunch with step 3.
- Do not kill the Herdr server or close panes you didn't create; leave the workspace as you found it.
