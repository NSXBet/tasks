---
phase: 09-task-view-parity
plan: 05
subsystem: tui, docs
tags: [artifact-view, code-doc-evidence, guarded-read, block-comments, tmux-probe, d-05]
status: complete
requires: [09-04, 09-03, 04-02, 04-04, 04-05, 08-02]
provides:
  - "TUI artifact view (`6`, `tk://artifact`): a distinct file view with CODE / DOC / EVIDENCE modes, header `<id> / <path>` + `N OPEN · K ✓` + mode tag, `COMMENTS · …` right panel"
  - "readGuardedFile(root, relPath) in packages/tui/src/review/edit.ts on the 04-02 guardWorktreePath (escape | missing | too-large > 2 MB)"
  - "ArtifactTarget, AppState.artifact, AppActions.openArtifact; ReviewComposerContext.endLine; openReviewComposer(kind, placement?)"
  - "packages/tui/src/app/markdown.ts (MdLine, EVIDENCE_CHUNK_RE, mdLines) + markdown-view.tsx (MdLineView), shared by detail.tsx and DOC mode"
  - "Task view: ARTIFACTS cursor (`J`/`K`), `o` opens the artifact (or the CHANGES file row after rail j/k); diff view `o open as file`"
  - "taskview-smoke.ts: 11 checks (4 new for 09-05)"
affects: [09-08 (final docs pass)]
key-files:
  created:
    - packages/tui/src/app/markdown.ts
    - packages/tui/src/app/markdown-view.tsx
  modified:
    - packages/tui/src/app/artifact.tsx
    - packages/tui/src/app/context.ts
    - packages/tui/src/app/App.tsx
    - packages/tui/src/app/task.tsx
    - packages/tui/src/app/diff.tsx
    - packages/tui/src/app/detail.tsx
    - packages/tui/src/app/composer.tsx
    - packages/tui/src/app/help.tsx
    - packages/tui/src/review/edit.ts
    - packages/tui/test/taskview.test.tsx
    - packages/tui/test/taskview-smoke.ts
    - packages/tui/test/app.test.tsx
    - docs/src/content/docs/overview.md
    - docs/src/content/docs/testing.md
    - docs/src/content/docs/architecture.md
requirements-completed: [VIEW-04, VIEW-01]
metrics:
  tasks: 3
  completed: 2026-11-10
actuals:
  tasks: 3
  commits: 0
---

# Phase 9 Plan 05: TUI artifact view (D-05) Summary

**What changed for the user:** in the TUI, any artifact on a task opens as a file, separately from the diff. Code shows as numbered lines, markdown docs are rendered as docs, and evidence shows as an image. A reviewer can comment on a line, on a doc block (a line range) or on the whole file, and every comment lands on the task record.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (tracer) | ARTIFACTS `o` → CODE view (guarded read) → `c` line comment → record | withheld | artifact.tsx, context.ts, App.tsx, task.tsx, edit.ts, composer.tsx, taskview.test.tsx, app.test.tsx |
| 2 | DOC mode (block-range comments), EVIDENCE mode, diff view `o` | withheld | artifact.tsx, markdown.ts, markdown-view.tsx, detail.tsx, diff.tsx, taskview.test.tsx |
| 3 | Help overlay, docs, tmux probe artifact checks | withheld | help.tsx, taskview-smoke.ts, overview.md, testing.md, architecture.md |

Commits were withheld per AGENTS.md (conservative profile, orchestrator override). All changes are uncommitted in the main tree. STATE.md and ROADMAP.md were not touched, and nothing under packages/web was touched. The doc edits stay in TUI sections: the overview TUI table, the Task view paragraph, a new "Artifact view" paragraph, and the hunk-keys note; the testing.md task-view probe paragraph; and the architecture.md terminal-image row plus item 6 of the review flow.

## What was built

**Opening an artifact.** `actions.openArtifact(target)` sets `AppState.artifact`, closes the diff modal and switches to `view "artifact"`. It is reached in three ways:
- **Task view, ARTIFACTS:** `J`/`K` move a `▸` cursor over the flattened group rows, with the hint `J/K select · o open`. `o` opens the selected row: an evidence row opens as `{kind:"evidence"}`, a path row as `{kind:"file"}`.
- **Task view, rail:** `o` follows the list the user last moved in. `J`/`K` select the artifacts; rail `j`/`k`/`tab` select the rail. So after `j` in CHANGES, `o` opens that file row. Before any move, `o` uses the artifacts when there are any.
- **Full diff view:** `o` opens the selected file, or the selected evidence entry. On a deleted file it toasts `deleted file — nothing to open`. The keybar gains `o open as file`.

With no explicit target (a plain `6` or `tk://artifact`), the view shows the review session's selected file or evidence entry. If no review session exists yet, it starts one for the task the task view would show.

**Layout.**
- Header: `<id> / <path>`, the artifact's count in upper case (`1 OPEN · 0 ✓`, `NO COMMENTS`, `ALL RESOLVED`, via 08-02 `reviewHeaderLabel`), and the mode tag.
- Body: on the left.
- Right panel (32%): `COMMENTS · …` with every thread at the artifact. Whole-file threads come first, then threads by line. Each row shows `commentStatusBadge` + `reviewLocationLabel` (`path:3-4`), then the thread's comments.
- Keybar: one line per mode, always ending in `esc back to task`.

**CODE.**
- The whole file as `N │ text` rows. The cursor row uses the selection background.
- Each line thread renders inline under its line as `▸ author: body · open`.
- `j`/`k`/arrows move the cursor; `g`/`G` jump to the first and last line.
- `c` opens the composer with `{filePath, line: cursor+1}`, so the placeholder reads `comment on src/a.ts:2`. `C` opens it with `{filePath, line: null}`.

**DOC** (`isDocPath`).
- The file is split with `docBlocks(text)`. Each block's lines are shaped with `mdLines` and rendered through `MdLineView`, the same rendering as the detail pane: headings without `#`, bullets as `· `, code, quotes, and evidence images.
- The cursor block has an accent `▌ ` gutter.
- A thread renders under the first block its `line..endLine` overlaps.
- `j`/`k` move by block.
- `c` opens the composer with `{line: block.line, endLine: block.endLine | null}`; the placeholder reads `comment on docs/task.md:3-4`. `C` comments on the whole file.
- The keybar shows `whole file (C) · selection → lines a–b (c)` with the real numbers.

**EVIDENCE.**
- Renders `EvidenceImage` with its caption row (`▣ evidence:<id> · <name> · 💬 N`), followed by the inline threads.
- `c` and `C` both open the composer with `{filePath: "evidence:<id>", evidenceId}`.

**Reads.**
- `readGuardedFile(root, path)` first runs the existing `guardWorktreePath`. No new path logic was added.
- Results by case:

| Case | Result | Message shown |
|---|---|---|
| Path escapes the root (`..`, absolute, NUL, symlink out) | `escape` | `refused: outside the worktree` |
| Missing file or root | `missing` | `not in the worktree: <path>` |
| File over 2 MB | `too-large` (file is never read) | `file too large to render (N MB)` |
| Binary file (contains NUL) | read | `binary file — not rendered` |

- Root: `source.cwd` when the review source located a worktree, else `store.surface.store.root`. Path attachments are stored relative to the workspace root, so that fallback is correct.
- The read effect depends on `[path, root, source]`, so every live re-derive re-reads the file and worktree edits re-render.

**Placement plumbing.**
- `ReviewComposerContext.endLine` is null wherever it was built before, and set from `thread.endLine` for reply and edit.
- `openReviewComposer(kind, placement?)`: a `placement` overrides the selection for `comment`/`file`.
- `submitReview` passes `endLine` (only together with `line`) and `evidenceId` through to `createThread`.
- The composer placeholder shows `:line-endLine`.

**ShellKeys.** The artifact view no longer swallows `1`/`2`; only `g` is reserved, as its jump-to-top. The diff view keeps `1`/`2`/`g` exactly as before.

**Help.**
- Task-view section: rail rows / `↵` diff modal (CHANGES / MINIMAP), `V`/`v`, and the `J/K artifacts · o open artifact · c comment` line.
- New artifact-view section: modes, `j/k line (code) or block (doc) · g/G`, `c` line or block, `C` whole file, `esc`.
- Review section: `o open … as a file`.
- The diff-modal section from 09-04 was already in place.

## Verification (all run, final state)

| Command | Result |
|---|---|
| `bun test --timeout 20000 packages/tui/test/taskview.test.tsx -t 09-05` (2×) | 5 pass / 0 fail each |
| `cd packages/tui && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `cd packages/tui && bun run check` | exit 0 |
| `bun test --timeout 20000 packages/tui/test` (twice, after Task 2 and at the end) | 109 pass / 0 fail across 8 files (09-04 baseline: 104 / 0) |
| `bun packages/tui/test/taskview-smoke.ts` (4 runs) | `taskview-smoke: 11 passed, 0 failed` every run |
| `bun packages/tui/test/review-smoke.ts` (2 runs) | `review-smoke: all green (9 checks)` |
| `bun packages/tui/test/smoke.ts` (2 runs) | `smoke: all green (13 checks)` |
| `cd docs && bun run build` | Complete |

After the probes there were no `tk-*-smoke-*` scratch dirs, no `tktv-*`/`tkrev-*` tmux sessions and no stray `main.tsx` processes.

### New tests (taskview.test.tsx, describe "tui artifact view (09-05)")

1. **CODE.** Setup: `tk attach <id> src/a.ts`, plus a two-line worktree edit.
   - `J`, `o` → the frame shows `<id> / src/a.ts`, `CODE`, `1 │ export const a`, `2 │ export const second` and `COMMENTS · NO COMMENTS`, and no diff keybar.
   - `j`, `c` → the composer reads `comment on src/a.ts:2`. Typing `line note` makes `▸ tester: line note` appear on the row right after line 2, along with `1 OPEN · 0 ✓` and the panel's `open src/a.ts:2`.
   - Plain `tk show` contains both `src/a.ts:2` and `line note`.
   - `C` → a placeholder with no `:line`. `esc` → `esc` returns to the task view.
2. **Guard.** Setup: an attachment `../<scratch>/secret.txt`.
   - `o` → `refused: outside the worktree`, and `TOP_SECRET` never appears.
3. **DOC.** Setup: `docs/task.md` = `# Plan\n\nstep one\nstep two\n\n- a\n- b\n`.
   - `o` → `DOC`, `Plan` with no `# Plan`, `· a` and `· b`, and `selection → lines 1–1 (c)`.
   - `j` → `lines 3–4`. `c` → `comment on docs/task.md:3-4`. The note renders between `step two` and `· a`.
   - `tk comments --json` contains `docs/task.md:3-4`.
4. **EVIDENCE.**
   - `o` on a PNG evidence row → `EVIDENCE` and `▣ evidence:ev-…`.
   - `c` → `comment on evidence:<id>`. The note appears inline and the caption count becomes `💬 1`.
   - `tk comments --json` contains `"evidence:<id>"`.
5. **Diff `o` and CHANGES `o`.**
   - The diff view shows `o open as file`. `o` → `CODE` with `1 │ export const a = 2; // EDIT_A`.
   - `esc` → task view. `j`, `o` on the CHANGES `a.ts` row → `CODE` again.

### taskview-smoke.ts `// 09-05 checks`

- **Check 8:** `5`, then `J` + `o` on the evidence artifact → `EVIDENCE` and `▣ evidence:`. In the real TTY this goes through the blocks image path.
- **Check 9:** `Escape` → task view.
- **Check 10:** `j` + `o` on the CHANGES a.ts row → `CODE` with `1 │ export const a = 2` and `/ src/a.ts`.
- **Check 11:** `c`, then `probe artifact note` typed with `send-keys -l`, then `Enter` → a spawned `tk show <id>` contains `probe artifact note` and `src/a.ts:1`.

## Deviations from Plan

1. **[Adaptation] `MdLineView` is in `markdown-view.tsx`, not `markdown.ts`.** A `.ts` file cannot contain JSX. `markdown.ts` holds `MdLine`, `EVIDENCE_CHUNK_RE` and `mdLines`, moved unchanged. `MdLineView` takes an optional `width` that truncates; detail.tsx passes none, so its output is unchanged.
2. **[Adaptation] Rows are windowed, not a `<scrollbox>`.** The body builds a flat row list: lines or block lines, inline threads, block gaps. It renders only a terminal-height window that scrolls just enough to keep the cursor line or block visible, with the previous start kept in a ref. A scrollbox does not follow a keyboard cursor. Windowing also bounds the render cost of large files, on top of the 2 MB read cap (T-09-11).
3. **[Rule 2] `readGuardedFile` returns a third outcome, `too-large`.** The plan's signature has only `escape | missing`, but its threat model T-09-11 asks for the 2 MB cap and the `file too large to render (N MB)` message. Binary files (NUL bytes) show a note instead of garbage.
4. **[Adaptation] `o` in the task view follows the last-moved list.** The plan gives `o` both to the ARTIFACTS rows and to the CHANGES rows. `J`/`K` give focus to the artifacts; `j`/`k`/`tab` give it to the rail. The ARTIFACTS cursor is shown only while the artifacts have focus.
5. **[Adaptation] Artifact view with no explicit target.** It falls back to the review session's selected file or evidence entry instead of rendering nothing. This keeps `tk://artifact` and the review.test.tsx "artifact view never shows the watching indicator" case meaningful: it still finds `<id> / src/a.ts` and `EDIT_A`, unchanged. With no file at all it shows `no artifact open — in the task view, J/K select an artifact and o opens it`.
6. **[Rule 3] Files outside `files_modified`:**
   - composer.tsx: the placeholder shows `:line-endLine`.
   - app.test.tsx: its artifact-boot test asserted the old Workbench keybar (`c note  R reply`). It now asserts `esc back to task` plus `no artifact open`, and that the workbench keybar is absent.
7. **[Adaptation] ShellKeys in the artifact view.** `1`/`2` switch views again, because the artifact view has no layouts. Only `g` stays reserved.
8. **[Test harness] Settle after the composer opens.** The new frame tests wait 150 ms after the composer placeholder appears before typing. Without it, the EVIDENCE test once lost `i` from `evidence note` to the shell's insights switch: key handlers re-bind in a passive effect after the frame draws. This is the same class of race 09-04 noted. The probe sleeps 200 ms at that point too.
9. **TDD order.** Implementation came before each task's frame tests, so there was no separate RED run. None of the asserted strings existed before this plan: `J/K select · o open`, `CODE`, `N │ `, `COMMENTS · NO COMMENTS`, `refused: outside the worktree`, `selection → lines`, `o open as file` and `comment on …:3-4`.

## Keymap regressions checked (04-04 / 04-05 / 08-02 / 09-03 / 09-04)

- **Diff view:**
  - `useReviewKeys` gains only `o`, on the full page. The compact modal is unchanged.
  - The full-page keybar line 2 gains `o open as file`.
  - `]`/`[`, `.`/`,`, `1`/`2`/`g`/`G`, `c`/`R`/`E`/`e`, `x`/`D`/`S`, `J`/`K`, `s`/`l`/`a`/`t`/`z`, `/`, `v`/`y` and `q` are untouched. review-smoke passes 9/9.
- **Task view:**
  - `tab`/`shift+tab`, `j`/`k`, `↵`, `v`, `V`, `c` and `q` are unchanged.
  - `J`/`K`/`o` are new. `J`/`K` are matched by sequence before the `j`/`k` key-name branch.
  - The refs pattern from 09-04 is kept for the new artifact cursor and focus, so key bursts land.
  - taskview-smoke checks 1–7 pass.
- **List, board, modal and palette:** untouched. smoke passes 13/13.

## Threat Model

- **T-09-10:** every artifact read goes through `readGuardedFile` → `guardWorktreePath` (realpath under the root, no `..`, no absolute paths, no NUL, no symlink escape). A refusal renders `refused: outside the worktree` and reads nothing. This is covered by the guard test.
- **T-09-11:** reads over 2 MB are refused after a `stat`, without reading the file. Rendering is windowed to the terminal height.
- **T-09-SC:** no package installs.

## Known Stubs / Follow-ups

- In the artifact view, the comments panel does not take `x`/`D`/`R`/`E` (resolve, dismiss, reply, edit); those lifecycle keys stay in the diff view. Worth a follow-up if reviewers want to settle comments from the file view.
- In DOC mode an `img` line (an `evidence:` ref inside a doc) counts as one row in the window, so a doc with many inline images can push the cursor block below the fold.
- From 09-04 and still open: `rm -rf /tmp/tkdbg-8n2L /tmp/tkdbg-8n2L.sock`. This plan created nothing under /tmp outside the test fixtures and probes, and they clean up after themselves.

## Self-Check: PASSED

- FOUND: packages/tui/src/app/markdown.ts (`mdLines`, `EVIDENCE_CHUNK_RE`), packages/tui/src/app/markdown-view.tsx (`MdLineView`)
- FOUND: `readGuardedFile`, `ARTIFACT_READ_CAP` (edit.ts); `ArtifactTarget`, `ReviewPlacement`, `artifact`, `openArtifact` and `endLine` (context.ts); `openArtifact` (App.tsx, task.tsx, diff.tsx)
- FOUND: the `// 09-05 checks` block in taskview-smoke.ts (4 checks); the artifact-view section in help.tsx
- Commits: none; withheld per AGENTS.md
