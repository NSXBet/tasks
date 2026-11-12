---
phase: 04-terminal-review
plan: 04
subsystem: tui, docs
tags: [gap-closure, keybindings, hunk-keymap, tmux-probe, docs]
requires: [04-01, 04-02, 04-03]
provides:
  - "useReviewKeys on hunk's default map: `]`/`[` hunk, `.`/`,` file, `1`/`2` layout, `g`/`G` first/last hunk, `c`/`E`/`R` notes, `q` quit"
  - "HUNK_SHELL_KEYS (diff.tsx): the shell view-switch keys (`1`, `2`, `g`) that the diff and artifact views take over"
  - "ReviewKeybar({ lines }): a multi-line dim key bar, each line truncated to the terminal"
  - "review-smoke.ts: `,` file nav, a `2`/`1` in-place layout check, and a plain `q` quit (7 checks)"
affects: [04-05 (s/l/z/search/select/copy/notes/theme keys extend this map and keybar), 08-02 (keys-line text anchors changed)]
key-files:
  modified:
    - packages/tui/src/app/diff.tsx
    - packages/tui/src/app/App.tsx
    - packages/tui/src/app/artifact.tsx
    - packages/tui/src/app/help.tsx
    - packages/tui/test/review.test.tsx
    - packages/tui/test/app.test.tsx
    - packages/tui/test/review-smoke.ts
    - docs/src/content/docs/overview.md
    - docs/src/content/docs/testing.md
decisions:
  - "`q` and the note/edit/resolve/thread keys stay full-page only (compact modal unchanged, per the prohibition). Navigation, jump and layout keys work in the modal too."
  - "The full-page file nav sits in a fixed 34-column box. The diff body width is now terminal − shell nav (18) − file nav (34) − padding (1) − rail (36). The old formula overestimated it by about 22 columns."
  - "The probe's edit step selects the hunk with `]` (hunk's key) rather than the `j` alias."
requirements-completed: [REV-03]
metrics:
  tasks: 2
  completed: 2026-11-10
---

# Phase 04 Plan 04: Hunk's own review keys (gap 1, part A) — Summary

The diff, artifact and modal views now use hunk's key map:

- `]` / `[` step hunks within the selected file, and `.` / `,` step changed files, clamped at both ends.
- `1` / `2` switch unified / split in place.
- `g` / `G` jump to the first / last hunk.
- `c` / `E` / `R` are note, edit note and reply.
- `q` quits.

The app shell now lets the diff and artifact views handle `1`, `2` and `g`, so those keys no longer jump to the list, board or graph. `r` and `u` are unbound. `D` and `S` are still free for 08-02, and `x` still resolves. The keybars, modal footer, help screen, docs and the tmux probe all show the new map.

## What was built

- **diff.tsx**
  - Exported `HUNK_SHELL_KEYS = {"1","2","g"}`, documented as the shell keys the review views take over.
  - Rewrote `useReviewKeys`:
    - The 04-03 guard line is unchanged.
    - New `nextHunk` / `prevHunk` helpers serve `]`/`j` and `[`/`k`.
    - `.`/`,` move between files (clamped), `g`/`G` jump to the first/last hunk, `1` sets unified, and `2`/`p` set split.
    - Full page only: `c`, `R`, `E`, `e`, `x`, `J`/`K`, `q` (→ `actions.quit()`).
    - A comment block above the hook maps each key to its hunk command id or marks it as a tk alias. It also says why `r`, `u`, `D` and `S` are unbound.
  - `ReviewKeybar` takes `lines` and draws one truncated height-1 dim line per entry. The diff bar is:
    - `q quit  c note  ]/[ hunk  ./, file  1/2 layout  ? help`
    - `R reply  E edit note  e edit hunk  x resolve  J/K note  esc back`
  - The modal footer is now `]/[ hunk  1/2 layout  ? help  esc close  full review: tk://diff`.
- **App.tsx `ShellKeys`:** just before the view-key map, it returns early when the view is `diff` or `artifact` and the key is in `HUNK_SHELL_KEYS`. `HUNK_SHELL_KEYS` is imported from `./diff.js`.
- **artifact.tsx:** a two-line bar:
  - `]/[ hunk  ./, file  1/2 layout  ? help`
  - `c note  R reply  E edit note  e edit hunk  x resolve  esc back to task`
- **help.tsx:** the review section now has the five lines the plan specifies: the hunk map, the notes, the inline edit, the aliases, and live with no refresh key.
- **review.test.tsx:** six new cases in `tui review keys are hunk's own`:
  1. `]`/`[`/`g`/`G` on a 40-line file with two hunks. Each hunk's range is read from the `✎ edit` buffer title. The selected file stays `a.ts`, and the graph view never appears.
  2. `.`/`,` with clamping.
  3. `2`/`1`: split shows `OLD_A` and `NEW_A` on one row and unified doesn't. The `tk/<id> ←` stats line is visible in both.
  4. `R` opens `reply…`, and `r` opens nothing within 500 ms.
  5. `q` calls the `onQuit` spy once.
  6. The keybar contains `./, file` and `R reply`, and doesn't contain `u unified` or `r reply ·`.

  Other changes in the file:
  - `repoWithIssue` and `repoWithWork` take an optional base `src/a.ts`.
  - `renderDiff` takes an optional `onQuit`.
  - The live selection-by-path test and the clamp test press `.` instead of `]`. The clamp test is renamed `. clamps at the last changed file`.
- **review-smoke.ts:**
  - Step 4 loops `,` to get back to `a.ts`.
  - New check `layout keys stay in the diff view`. After `2`, some row must show `const v3` twice (split). After `1`, no row does (unified). Both frames must keep `tk/<id>` and must not show the list's ` all  ready  open ` tabs.
  - New check `q quits` uses a `quitWith(key)` helper on the final branchless session. `quit()` is now `quitWith("C-q")`.
  - The header checklist is updated. The run reports 7 checks.
- **Docs:**
  - `overview.md` `### Review` has a `Keys (hunk's own)` table, a paragraph on the aliases, the missing `r` refresh and which shell keys the review views take over, and the Commentable bullet now says `R` replies.
  - `testing.md`'s review-probe paragraph now covers `,` navigation, the `2`/`1` layout check and the `q` quit.

## Verification (all run)

| Command | Result |
|---|---|
| `bun test --timeout 30000 packages/tui/test/review.test.tsx` | 17 pass / 0 fail after Task 1; 18 pass / 0 fail after Task 2, which added the keybar case |
| `bun test --timeout 30000 packages/tui/test` | 76 pass / 0 fail (Task 1); 77 pass / 0 fail (Task 2) |
| `cd packages/tui && bun run check` | exit 0 (both tasks) |
| `grep -n 'case "u"\|case "r"' packages/tui/src/app/diff.tsx` | 0 lines |
| `bun packages/tui/test/review-smoke.ts` | `review-smoke: all green (7 checks)`, run twice |
| `cd docs && bun run build` | Complete |
| `grep -rn "u unified\|r reply\|\] \[ file" packages/tui/src docs/src/content/docs/overview.md` | 0 lines |
| `bun packages/tui/test/smoke.ts` (regression, not in the plan) | 13/13 ok |

After the runs, no `tk-review-smoke-*` scratch dirs or `tkrev-*` tmux processes were left behind.

## Deviations from Plan

- **[Rule 1] Split layout's new side was blank. This was a pre-existing bug, and the `2`/`1` test exposed it.**
  - **Bug:** `HunkDiffView` was passed `termWidth - 40 - RAIL_WIDTH`. That ignored the shell's 18-column nav rail. Hunk's file nav is also `width: 100%`, so it grew past 34 columns. The body ended up about 22 columns wider than the space it had. In unified, that only clipped line ends. In split, the right cell's text word-wrapped onto a second visual line, and the height-1 row hid it. So only the `▌ 3 +` gutter showed, at 140 and at 220 columns.
  - **Fix (diff.tsx):** the file nav sits in a fixed-width `flexShrink: 0` box (34 on the full page, the same `min(28, w/4)` in the compact modal). The full-page body width is `termWidth − 18 − 34 − 1 − 36`. The compact-modal width formula is unchanged.
  - **Result:** split now shows both sides (`▌ 3 - OLD_A; │ ▌ 3 + NEW_A;`).
- **[Rule 3] `packages/tui/test/app.test.tsx` changed but isn't in `files_modified`.** Its artifact-view case asserted the old bar substring `c comment · r reply`. It now asserts `c note  R reply`. Two existing review.test.tsx assertions also changed, from `E edit comment` to `E edit note`.
- **TDD order:** in this run, Task 1's implementation was written before its tests. RED was not shown separately against the old map. The new cases test `.`, `G`, `R`, `q` and the split row, and none of those keys was bound to that behaviour before.
- **Probe edit step:** it selects the hunk with `]` instead of `j`. Both work, and `]` exercises hunk's key.

## Notes

- **Commits withheld per AGENTS.md** (conservative profile). The work was done in the main tree. STATE.md and ROADMAP.md were not touched. Nothing under packages/web or packages/git was touched; those belong to the concurrent 05-04 executor.
- **Flag for 08-02:** `08-02-PLAN.md:161-163` quotes the pre-04-04 keys line. It says to keep the `c comment · r reply · E edit comment · e edit hunk` and `esc back` substrings and to replace `x resolve`. The keybar now has two lines, `q quit  c note  ]/[ hunk  ./, file  1/2 layout  ? help` and `R reply  E edit note  e edit hunk  x resolve  J/K note  esc back`, with two-space separators. 08-02 needs to anchor on the second line (`x resolve` → `x ✓ done  D ✕ remove  S send to agent`) before it executes. `D` and `S` are still unbound.
- **Prohibitions held:**
  - No `D`/`S` binding, and no refresh key anywhere.
  - None of `s`/`l`/`z`/`/`/`v`/`y`/`a`/`t` is bound or listed; those belong to 04-05.
  - Comment gating in the compact modal is unchanged.
- **Gap 2 is open:** the `watching worktree` indicator isn't in this plan and is still open.

## Self-Check: PASSED
