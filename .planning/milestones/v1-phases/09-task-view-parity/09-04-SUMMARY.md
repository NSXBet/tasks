---
phase: 09-task-view-parity
plan: 04
subsystem: tui, docs
tags: [diff-modal, evidence, terminal-image, task-view, tmux-probe, d-03]
status: complete
requires: [09-03, 09-02, 04-04, 04-05, 08-02]
provides:
  - "File-scoped DiffModal over the current view: header `<id> / <path> [S] +a −d` + `f ⤢ full view · esc close`, the file's diff, its threads, footer key line"
  - "AppActions.openDiffModalAt(path | null, hunkIndex | null); openReviewComposer kind `file` (whole-file thread, line null)"
  - "ReviewComposerContext.evidenceId; submitReview passes evidenceId to createThread"
  - "EvidenceImage (packages/tui/src/app/evidence-image.tsx): extracted BlobImage, gated by @tasks/terminal-image inlineImageMode, optional caption row `▣ evidence:<id> · <name> · 💬 N`"
  - "Full diff view: `EVIDENCE · N` under the file nav; `]` / `.` walk past the files into evidence entries; `c` on an entry comments at `evidence:<id>`"
  - "diff.tsx exports reviewEvidence, reviewTarget, locationThreads, MODAL_EXPAND_HINT"
  - "test/fixtures.ts tkPlain (plain `tk` output, ANSI stripped)"
  - "Board task modal + command palette: D-03 on ready-to-review (open diff, never start)"
affects: [09-05 (extends taskview-smoke.ts at `// 09-05 checks`)]
key-files:
  created:
    - packages/tui/src/app/evidence-image.tsx
  modified:
    - packages/tui/src/app/diff.tsx
    - packages/tui/src/app/App.tsx
    - packages/tui/src/app/context.ts
    - packages/tui/src/app/task.tsx
    - packages/tui/src/app/detail.tsx
    - packages/tui/src/app/modal.tsx
    - packages/tui/src/app/palette.tsx
    - packages/tui/src/app/help.tsx
    - packages/tui/package.json
    - bun.lock
    - packages/tui/test/taskview.test.tsx
    - packages/tui/test/taskview-smoke.ts
    - packages/tui/test/fixtures.ts
    - packages/tui/test/review.test.tsx
    - docs/src/content/docs/overview.md
    - docs/src/content/docs/testing.md
    - docs/src/content/docs/architecture.md
requirements-completed: [VIEW-04]
metrics:
  tasks: 3
  completed: 2026-11-10
actuals:
  tasks: 3
  commits: 0
---

# Phase 9 Plan 04: TUI diff modal and evidence in the diff flow (D-04, D-06) Summary

**What changed for the user:**
- In the task view, a changed file opens a commentable diff modal over the task. From there, `f` expands it to the full diff on the same file and hunk.
- The full diff view lists the task's evidence after the files. Each evidence entry renders inline, when the terminal can paint images, with an `evidence:<id>` caption row, and takes comments like a line does.
- The board task modal and the command palette no longer offer start-work on a ready-to-review task.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (tracer) | CHANGES `↵` → diff modal → `C` file comment → record; `f` ⤢ full view | withheld | context.ts, App.tsx, diff.tsx, task.tsx, taskview.test.tsx |
| 2 | EvidenceImage extracted, gated by `inlineImageMode`, caption row | withheld | evidence-image.tsx, detail.tsx, package.json, bun.lock, taskview.test.tsx |
| 3 | EVIDENCE entries in the full diff view, comments at `evidence:<id>`; tmux probe | withheld | diff.tsx, App.tsx, context.ts, taskview.test.tsx, taskview-smoke.ts |
| extra | D-03 in the board task modal and the command palette | withheld | modal.tsx, palette.tsx, taskview.test.tsx |

Commits are withheld per AGENTS.md (conservative profile; orchestrator override). All changes are uncommitted in the main tree. STATE.md and ROADMAP.md were not touched. Nothing under packages/web was touched; that package belongs to the concurrent 09-07 executor.

## What was built

**Diff modal (D-04).**
- The modal is a centred absolute frame: `left 8%`, `width 84%`, `top 2`, `bottom 4`, panel background, rounded focus border.
- It opens over whatever view is current, and the task view stays drawn behind it. The Composer row and the status bar stay visible below the frame.
- Header: `<id> / <path>` with the path in bold, then `[M] +a −d` from `source.stats`, then `f ⤢ full view · esc close` on the right.
- Body: the selected file's `HunkDiffView` (no file nav), then that file's `ThreadList`, which now takes a width, then the footer `c comment on a line · C comment on the file · j/k hunk · esc close · f ⤢ full view — file · line · evidence`.

**Modal keys** (`useReviewKeys(true)`):
- `j`/`k` move between hunks.
- `c` comments on the selected hunk's line. This was the compact-modal `c note` that 04-04 deferred to this plan.
- `C` comments on the whole file (`openReviewComposer("file")`, no line).
- `f` runs `closeDiffModal()` and then `setView("diff")`. The file and hunk are already in the review state.
- `esc` closes the modal. ShellKeys handles this, as before.
- `e`, `E`, `R`, `x`, `D`, `S`, `J`/`K`, `q` and the view toggles stay full-page only.

**`openDiffModalAt(path, hunk)`** matches `path` against `review.source.files[].path`. With a null path it opens the first file that still `needsReview`, or file 0 if none does. An unknown path leaves the selection alone. The hunk index is clamped.

**Task view wiring:**
- `↵` on a CHANGES file row opens the modal at that file.
- `↵` on a directory row, and `V`, open it at the first file needing review.
- `↵` on a MINIMAP bar opens it at that file and hunk.

**EvidenceImage (D-06).**
- `BlobImage` moved verbatim (fetch, decode, area resize, dispose) into `evidence-image.tsx`.
- Before painting, it computes `inlineImageMode({ mime, isTTY: process.stdout.isTTY, kittyGraphics })`:
  - `kitty` → the existing `protocol="auto"` branch.
  - `blocks` → the existing half-block branch.
  - `null` → no `<image>`, and the decoder is never touched.
- With `caption`, the row `▣ evidence:<id> · <name> · 💬 N` always follows the image, or replaces it when nothing paints. `N` is shown in accent when it is above 0.
- Without a caption and with no mode, it prints `▣ evidence:<id> · <name>`. That case only happens off a TTY.
- detail.tsx uses it in the same three places with no caption. In a real terminal the pane renders exactly as before.

**EVIDENCE in the full diff view (D-06).**
- `reviewEvidence(issue)` is the task's blob attachments.
- `reviewTarget(review, evidence)` resolves `fileIndex` to a file, or, past the last file, to an evidence entry (`fileIndex - files.length`).
- Under the file nav: `EVIDENCE · N` and one `▣ <name> · 💬 N` row per entry. `N` counts open and sent threads at `evidence:<id>`, and the selected entry is marked `▌`.
- The body shows `evidence · <name>` and an `EvidenceImage` with its caption. The right rail lists the threads at `evidence:<id>`.

**Evidence navigation:**
- `]` past the last hunk of the last file (or a file with no hunks) moves to the next entry, clamped at the last one.
- `[` on an entry moves to the previous entry, then onto the last file's last hunk.
- `.` also walks into the entries.
- `j`/`k` only step hunks within a file, so they do nothing on an entry.
- The evidence walk is full-page only, because the modal is file-scoped.

**Evidence comments:**
- `c` on an entry opens the composer with `{ filePath: "evidence:<id>", line: null, evidenceId }`.
- `submitReview` calls `createThread(id, { filePath, evidenceId, body, author })`.
- `x`/`D`, reply and edit resolve the selected thread by location too, so they work on evidence threads.
- `mergeLiveSource` keeps an evidence selection across live re-derives, by its offset past the files.

**D-03 extra (09-03 follow-up).**
- Board task modal on a ready-to-review task:
  - The footer reads `↵ title · v open diff · r/o status · …`.
  - `s` toasts `ready-to-review — v opens the diff` and leaves the status unchanged.
  - `v` closes the modal and opens the diff.
- Command palette: a ready-to-review target lists `◧ open diff [v]` (group `review`) instead of `⚡ start (in progress) [s]`.

**Help and docs:**
- help.tsx gains:
  - a `diff modal` section
  - the modal's ready-to-review line
  - the EVIDENCE walk line
- overview.md gains:
  - a "Diff modal and evidence" paragraph
  - the modal and palette D-03 sentence
- testing.md: the probe now has 7 checks.
- architecture.md: the terminal-image row names `EvidenceImage` as the consumer.

## Verification (all run, final state)

| Command | Result |
|---|---|
| `bun test --timeout 20000 packages/tui/test/taskview.test.tsx packages/tui/test/review.test.tsx` | 42 pass / 0 fail |
| `cd packages/tui && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `cd packages/tui && bun run check` | exit 0 |
| `bun install` | relinked; `packages/tui/node_modules/@tasks/terminal-image` present, no registry installs |
| `bun test --timeout 20000 packages/tui/test` | 104 pass / 0 fail across 8 files (09-03 baseline: 99 / 0) |
| `bun packages/tui/test/taskview-smoke.ts` | `taskview-smoke: 7 passed, 0 failed` (run 3× in a row after the ref fix, plus once more at the end) |
| `bun packages/tui/test/review-smoke.ts` | `review-smoke: all green (9 checks)` |
| `bun packages/tui/test/smoke.ts` | `smoke: all green (13 checks)` |
| `cd docs && bun run build` | Complete |

### New tests in taskview.test.tsx (describe "tui diff modal and evidence (09-04)")

1. **CHANGES `↵` → modal → `C` → `f` → `esc`.**
   - `j` and `↵` on the `a.ts` row open the modal. The frame has `<id> / src/a.ts`, `[M] +1 −1`, `EDIT_A`, `C comment on the file`, and the task title behind the modal.
   - `C` opens the composer as `comment on src/a.ts`, with no `:line`. The test types `whole file note` and checks that the modal shows the thread.
   - Plain `tk show` contains `src/a.ts` and `whole file note`.
   - `f` removes the modal. The full view shows `· +1 −1`, `q quit`, and `▌ M a.ts` selected in the nav.
   - `esc` goes to the list, which is the ShellKeys diff → list behaviour today.
2. **`esc` keeps the CHANGES cursor.**
   - With a.ts and z.ts edited, two `j` presses and `↵` open `/ src/z.ts`.
   - `esc` returns to the task view: the rail tab row, the CHANGES hint and `◧ v open diff` are all present.
   - `↵` again opens z.ts, so the cursor was kept.
   - `V` opens a.ts, the first file needing review.
3. **EvidenceImage.**
   - `inlineImageMode({ mime: "image/png", isTTY: false, kittyGraphics: false })` is null.
   - The detail pane of a task with an attached PNG still shows `attachments`, `shot.png` and `ev-xxxxxx · evidence`.
4. **EVIDENCE walk and evidence comment.**
   - The diff view shows `EVIDENCE · 1` and `▣ shot.png · 💬 0`.
   - Pressing `]` reaches `evidence · shot.png` and `▣ evidence:ev-… · shot.png · 💬 0`. `EDIT_A` is gone at that point.
   - `j` and `]` are no-ops on the last entry.
   - `c` opens the composer as `comment on evidence:<id>`. After `this is the 500`, the rail shows `tester: this is the 500` and the count shows `💬 1`.
   - `tk comments <id> --json` contains `"evidence:<id>"`, and so does plain `tk show`.
   - `[` walks back to the a.ts hunk.
5. **D-03 everywhere.**
   - Board task modal on a ready-to-review task: the footer shows `v open diff · r/o status`. `s` toasts and the status is unchanged; `v` opens the diff.
   - Palette filter `sta`: no `start (in progress)`.
   - Palette filter `dif`: `open diff` and `[v]`.

### taskview-smoke.ts `// 09-04 checks`

Setup attaches a 1×1 PNG with `tk attach --evidence`. The new checks:

- **Check 5:** back at 140 columns, `BTab` returns to CHANGES. `j` and `Enter` then open the modal, showing `f ⤢ full view` and `/ src/a.ts`, with `probe task` still visible behind it.
- **Check 6:** `f` opens the full view, with the stats line `· +1 −1` and `q quit`.
- **Check 7:** pressing `]` reaches `▣ evidence:` and `EVIDENCE · 1`. The probe then sends `Escape`.

## Deviations from Plan

1. **[Rule 1 — Bug] Task-view keys raced the handler re-bind.**
   - In the probe, `BTab` followed by `j` and `Enter` did nothing. The `useKeyboard` closure still held the old `tab` until React re-rendered. Run by hand at human speed, the same sequence worked.
   - Fix: task.tsx reads the active tab and the per-tab cursors from refs. The handlers update those refs synchronously (`tabRef`, `cursorsRef`), so a burst of keys lands correctly.
   - This replaces 09-03's functional `setChosenTab` workaround and covers `j` and `↵` too.
   - The probe sends `j` and `Enter` right after the CHANGES frame, with no settle sleeps, and passes 3 runs out of 3.
2. **[Rule 1 — Bug] TaskModal hook order.**
   - Booting with a task modal open (`modalId` set before the board loads) triggered React's "change in the order of Hooks" error. `useKeyboard` sat after the `issue === null` early return.
   - Fix: the hook now runs first and its handler guards `issue === null`. The handler reads `issue.status` instead of the derived `done`.
   - This was a pre-existing bug. The new D-03 modal test exposed it.
3. **[Rule 3] review.test.tsx (not in `files_modified`).**
   - The "compact diff modal … never shows the watching indicator" case waited on the old modal's file nav (`▌ M a.ts`), which the file-scoped modal no longer has.
   - Its predicate now also accepts the modal header `<id> / src/a.ts`. The assertion itself (no `watching worktree`) is unchanged.
4. **[Rule 3] Files outside `files_modified`:**
   - fixtures.ts: `tkPlain`.
   - help.tsx: key reference.
   - modal.tsx and palette.tsx: the requested D-03 extra.
   - bun.lock: the workspace link from `bun install`.
   - Docs: overview.md, testing.md and architecture.md, per AGENTS.md.
5. **[Adaptation] `]` versus `j` in the evidence walk.**
   - The plan says "`]` clamps to files + evidence − 1", but `]` is also hunk's next-hunk key. It still steps hunks inside a file, and only past the last hunk of the last file does it enter the evidence entries.
   - `.` walks files and then evidence. `j`/`k` stay pure hunk steps, so they do nothing on evidence as the plan requires.
   - `[` walks back out of evidence onto the last file's last hunk.
6. **[Adaptation] The modal on an evidence selection.** If the review selection is already on an evidence entry when the modal opens (for example through `tk://diff-modal`), the modal renders that entry's `EvidenceImage` with its caption instead of a blank body. The modal itself never walks into evidence.
7. **[Adaptation] Uncaptioned EvidenceImage off a TTY.** The detail pane gets a dim `▣ evidence:<id> · <name>` mark instead of nothing. In a real terminal it paints exactly as before. Only non-TTY runs, such as tests or pipes, see the mark.
8. **TDD order.** I wrote the implementation before each task's frame tests, so there was no separate RED run. None of the asserted strings existed before this plan: `f ⤢ full view`, `EVIDENCE · 1`, `▣ evidence:`, `comment on evidence:`, `v open diff · r/o status` and `open diff [v]`.

## Keymap regressions checked (04-04 / 04-05 / 08-02 / 09-03)

- Full page:
  - `]`/`[` step hunks exactly as before whenever no evidence exists or the selection is not past the last file.
  - `.`/`,`, `1`/`2`, `g`/`G`, `c`/`R`/`E`, `e`, `x`/`D`/`S`, `J`/`K`, `s`/`l`/`a`/`t`/`z`, `/`, `v`/`y` and `q` are unchanged.
  - The keybars are unchanged: no `C` or `f` on the full page.
- Compact modal:
  - Gains `c`, `C` and `f`.
  - `e`, `E`, `R`, `x`, `D`, `S`, `J`/`K`, `q`, the toggles and `v`/`y` stay disabled. Hunk editing is still refused there: `openHunkEdit` returns while `diffOpen`.
  - It still never shows the watching indicator (review.test.tsx).
- ShellKeys is untouched. With the modal open only `esc`, `:` and `?` reach it, and the task view returns early while the modal is open.
- review-smoke: 9/9. smoke: 13/13. taskview-smoke 1–4 (09-03): still green.

## Threat Model

- **T-09-07 (DoS decode):** a null mode never decodes. The decode still sits in the try/catch, and failure falls back to the raw-bytes `blocks` render or the caption row. Decoding is limited to the task's own blob attachments, resized to the fitted cell box.
- **T-09-08 (raw escapes):** the TUI has no `terminalImageEscape` or `process.stdout.write`. Painting stays in OpenTUI `<image>`, and `@tasks/terminal-image` only supplies the mode decision.
- **T-09-09:** the comment author is the TUI actor, as for other review comments.
- **T-09-SC:** the only dependency added is the workspace dependency `@tasks/terminal-image`. No registry package was installed.

## Known Stubs / Follow-ups

- The thread rail's empty hint still reads `no threads — press c on a hunk to start one` on an evidence entry. It is accurate enough, but wording that fits evidence would be better.
- I could not remove a debug scratch repo from a hand-run tmux session, `/tmp/tkdbg-8n2L` and `/tmp/tkdbg-8n2L.sock`, because the sandbox denied `rm -rf` on /tmp. Its tmux server was killed. Remove it with `rm -rf /tmp/tkdbg-8n2L /tmp/tkdbg-8n2L.sock`. The probes left no `tk-taskview-smoke-*` or `tk-review-smoke-*` dirs and no `tktv-*` or `tkrev-*` tmux sessions.

## Self-Check: PASSED

- FOUND: packages/tui/src/app/evidence-image.tsx (`EvidenceImage`, `inlineImageMode` import)
- FOUND: `openDiffModalAt` (context.ts, App.tsx, task.tsx); `MODAL_EXPAND_HINT`, `reviewEvidence`, `reviewTarget` and `EvidenceNav` (diff.tsx); `evidenceId` in ReviewComposerContext and in submitReview
- FOUND: `"@tasks/terminal-image": "workspace:*"` in packages/tui/package.json
- FOUND: the `// 09-04 checks` block in taskview-smoke.ts (3 checks); the `// 09-05 checks` marker is kept
- Commits: none, withheld per AGENTS.md
