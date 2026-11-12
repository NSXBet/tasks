---
phase: 04-terminal-review
plan: 05
subsystem: tui, git, docs
tags: [gap-closure, watching-indicator, hunk-keymap, osc52, tmux-probe, docs]
requires: [04-04]
provides:
  - "ReviewWatchHandle { stop, watching } from startReviewWatch; ReviewState.watching drives the `watching worktree — re-derives as commits land ●` line (DiffView only)"
  - "gitDiffPatch option contextLines → --unified=<n> (integer 0..10000, else ignored; additive)"
  - "resolveReviewSource(issue, cwd, runner, { contextLines }) + EXPANDED_CONTEXT_LINES = 25"
  - "review/selection.ts: hunkPatchTexts(file), reviewSelectionText(file, from, to)"
  - "diff view keys s/l/a/t/z, `/` file search, v/y hunk select + OSC 52 copy, esc clears selection"
  - "wrapKeyLine + ReviewKeybar wrapping at key separators (no clipping beside the shell nav rail)"
affects: [08-02 (keybar line 1 text changed; line 2 untouched — D/S still unbound)]
key-files:
  created:
    - packages/tui/src/review/selection.ts
    - packages/tui/test/review-selection.test.ts
  modified:
    - packages/git/src/commands.ts
    - packages/git/test/adapter.test.ts
    - packages/tui/src/review/live.ts
    - packages/tui/src/review/source.ts
    - packages/tui/src/app/context.ts
    - packages/tui/src/app/App.tsx
    - packages/tui/src/app/diff.tsx
    - packages/tui/src/app/artifact.tsx
    - packages/tui/src/app/composer.tsx
    - packages/tui/src/app/help.tsx
    - packages/tui/test/review.test.tsx
    - packages/tui/test/review-smoke.ts
    - docs/src/content/docs/overview.md
    - docs/src/content/docs/testing.md
    - docs/src/content/docs/architecture.md
decisions:
  - "Keybar width: the plan's 139-usable-columns figure ignored the shell's 18-column nav rail (the same miss 04-04 found for the body width). At 140 columns only ~121 are free, so the 136-column line 1 would be clipped before `t theme  ? help`. ReviewKeybar now wraps each line at its two-space key separators: one row at ≥156 columns (the line text is exactly the spec bar), two rows at 140, no key ever clipped."
  - "`t` with no theme chosen starts at HUNK_DIFF_THEME_NAMES[0], as planned (not after the component default `github-dark-default`)."
  - "`/` prefills the last query, as planned, so `/ ↵` repeats the search to the next match; a new query needs the old text cleared first."
  - "Artifact view: its own esc handler now also yields to an active `v` selection (the artifact view shares useReviewKeys, so it gets the new keys too; its key bar is unchanged)."
requirements-completed: [REV-03]
metrics:
  tasks: 3
  completed: 2026-11-10
---

# Phase 04 Plan 05: Watching indicator + the rest of the spec key bar (gaps 2 and 1B) — Summary

The full-page diff now shows `watching worktree — re-derives as commits land ●` (dim text, green dot) only while a live watch controller actually runs. Every key on the spec §3 DIFF · FULL PAGE bar except `r refresh` is bound: `s` files pane, `l` line numbers, `z` context, `/` search, `v` select, `y` copy, `a` notes, `t` theme. The keybar, help, docs and the tmux probe all agree.

## What was built

- **Task 1 — watching indicator (gap 2)**
  - `live.ts`: `startReviewWatch` resolves to `ReviewWatchHandle { stop, watching }`. Every no-op path (errored, branchless, branch-null, base-null, no common dir) returns `{ stop: noop, watching: false }`. After `createWatchController` it returns `{ stop: controller.close, watching: true }`.
  - `ReviewState.watching` starts false on each (re)resolve. The live effect sets it from the handle and resets it to false in cleanup, guarded by issue id. `onError` leaves it alone, because the controller keeps polling.
  - `diff.tsx`: exports `WATCHING_LINE`. A `WatchingIndicator` row sits between the workbench and the keybar in `DiffView` only. It renders when `watching && source && !error && !empty`. `ArtifactView` and `DiffModal` don't render it.
- **Task 2 — view toggles**
  - `gitDiffPatch` options gain `contextLines`. `--unified=<n>` goes before `--end-of-options`, only for an integer from 0 to 10000. Existing callers are unchanged (web `review.ts`, tui `source.ts`/`live.ts`).
  - `resolveReviewSource` takes a 4th `{ contextLines }` argument. `EXPANDED_CONTEXT_LINES = 25`.
  - `ReviewState` gains `showFiles`, `showLineNumbers`, `showNotes`, `theme`, `context`. The new actions are `setReviewView` and `toggleReviewContext`:
    - `toggleReviewContext` toasts `context expanded` / `context default`, re-derives, and drops a stale result if the context was toggled again in the meantime.
    - A `reviewContextRef` feeds `resolveOptions()` into the live onChange and `saveHunkEdit` re-derives, so expanded context survives both.
    - The initial resolve always uses the default context.
  - `Workbench` handles the hidden panes:
    - It hides the nav (`showFiles`) and the rail (`showNotes`) on the full page.
    - The body width is `term − 18 − (nav ? 34 : 0) − 1 − (rail ? 36 : 0)`, so the body uses the freed columns.
    - It passes `showLineNumbers`/`theme` to `HunkDiffView` and `theme` to `HunkFileNav`.
  - Keys on the full page only: `s`, `l`, `a`, `t` (toasts `theme <name>`), `z`.
- **Task 3 — search, select, copy, keybar, help, docs, probe**
  - `selection.ts` (pure):
    - `hunkPatchTexts` splits `file.patch` per `@@` hunk; file headers are excluded and a patchless or binary file gives `[]`.
    - `reviewSelectionText` joins a range of hunks, swaps reversed bounds, and falls back to the whole patch for `null`/`null`.
  - `ComposerMode` adds `"review-search"`: the title is `/ search files` and the placeholder `search files…`. Submit calls `searchReviewFiles`, which wraps from `fileIndex + 1` and compares case-insensitively; on no match it toasts `no file matches <q>`.
  - `v` toggles a selection anchored at the selected hunk (selecting hunk 0 when none is selected). `]`/`[`/`j`/`k` extend it. The stats line appends `· selecting hunks a–b`.
  - `y` → `copyReviewSelection((text) => renderer.copyToClipboardOSC52(text))`. It copies the range, else the selected hunk, else the whole file patch. It toasts `copied N lines` or `clipboard unavailable` and clears the selection. `setReviewFile` also clears the selection.
  - `esc` with an active selection: `useReviewKeys` clears it. `ShellKeys` (diff) and `ArtifactView` don't navigate on that first esc.
  - Keybar line 1 is `q quit  c note  ]/[ hunk  ./, file  1/2 layout  s files  l line numbers  z context  / search  v select  y copy  a notes  t theme  ? help`. Line 2 is unchanged from 04-04.
  - The help screen gains 4 lines: the toggles, `z` (whole diff, ±25), search/select/copy/esc, and the `watching worktree ●` legend.
  - `overview.md` adds 8 key rows and a paragraph on how tk differs from hunk. The Live bullet now mentions the indicator.
  - `architecture.md` "TUI Review Path" step 3 describes the handle, the indicator and `z`. Step 5 had a stale `r`, corrected to `R`.
  - `testing.md`: the probe paragraph covers the indicator and `/` search with 9 checks, and the inventory lists `review-selection`.
  - `review-smoke.ts`: adds `watching indicator` after open and `search selects file` (`/ live ↵` → `live.ts`) after the live commit. Step 4's `,` loop walks back to `a.ts`. The probe has 9 checks.

## Verification (all run, final state)

| Command | Result |
|---|---|
| `bun test packages/git/test/adapter.test.ts` | 17 pass / 0 fail (includes new `contextLines` case: LINE_10 only with 25, invalid −1/2.5/NaN/10001 identical to default, argv has no `--unified` for −3, `--unified=25` before `--end-of-options`) |
| `bun test packages/git packages/web/test` (05-04 compat) | 89 pass / 0 fail across 13 files |
| `cd packages/git && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `bun test --timeout 30000 packages/tui/test` | 92 pass / 0 fail across 7 files (incl. review-selection.test.ts, 3 tests) |
| `cd packages/tui && bun run check` | exit 0 |
| `bun packages/tui/test/review-smoke.ts` | `review-smoke: all green (9 checks)`: once after the probe edits, again at the final state (after the keybar wrap) |
| `bun packages/tui/test/smoke.ts` (regression, not in plan) | 13/13 ok |
| `cd docs && bun run build` | Complete |
| `grep -rn "@tasks/web" packages/tui/src` | 0 lines |
| `grep -n 'case "D"\|case "S"' packages/tui/src/app/diff.tsx` | 0 lines |
| `grep -rn "watching worktree" packages/tui/src` | `diff.tsx:53` `WATCHING_LINE` constant (+ doc comments, help legend) |

After the runs, no `tk-review-smoke-*` scratch dirs and no `tkrev-*` tmux processes were left behind.

New review.test.tsx cases:
- Indicator:
  - The worked task shows the indicator within 12 s, and it is still there after a live commit.
  - A branchless task shows no indicator after 1.5 s.
  - An errored `startReviewWatch` returns `watching: false`, and its `stop()` can be called.
  - The modal and the artifact view never show the indicator.
- View toggles:
  - `s`/`a` hide and restore the nav and the rail, and the stats line stays.
  - `l` removes and restores the `29` gutter number on the `// LINE_29` row.
  - `t` names `HUNK_DIFF_THEME_NAMES[0]`, then `[1]`.
  - `z` shows `// LINE_10`, hides it again, and keeps it through a live commit.
- Search, select and copy:
  - `/` with `Z.TS` selects `z.ts` (case-insensitive); `nomatch` toasts and keeps the selection.
  - `] v ] y` (spied OSC 52) copies once, containing `+NEW_A;` and `NEW_B`, toasts `copied N lines`, and clears the selection.
  - With the spy returning false, `y` toasts `clipboard unavailable`.
  - `v` then `esc` stays in the diff view; a second `esc` leaves it.
- Keybar:
  - At 160 columns it shows the exact spec line.
  - At 140 columns every key is present, with no `…`.

## Deviations from Plan

- **[Rule 1] The keybar didn't fit at 140 columns.**
  - The plan said line 1 (136 chars) fits the 139 usable columns. The shell's nav rail takes 18 of them, so ~121 are free and the line was clipped after `a notes`.
  - **Fix:** a `wrapKeyLine` helper. `ReviewKeybar` breaks only at two-space separators and wraps to a second row when the line doesn't fit. The line-1 text is still exactly the spec bar.
  - **Tests:** the exact-line keybar test renders at 160 columns. A second test at 140 checks that every key is present and nothing is truncated.
- **Selection stats line at 140 columns.** Beside the nav and rail, the body is ~51 columns, so `tk/<id> ← <base> · +N −M · selecting hunks a–b` word-wraps onto a second row. It is still visible. The two selection tests render at 180 columns so they can match the substring on one row. I left the behaviour unchanged rather than drop the base rev from the stats line.
- **[Rule 2] The artifact view's esc also yields to an active selection.** The artifact view shares `useReviewKeys`, so `v` works there too. Without this change, esc would have cleared the selection and left the view in the same keypress.
- **Search test:** the second `/` prefills the previous query, as planned, so the test sends 4 backspaces before typing `nomatch`.
- **Not in `files_modified`:** `packages/tui/src/app/artifact.tsx` (the esc guard above).
- **TDD order:** I wrote the implementation before the tests in each task, so RED wasn't shown separately. None of the new keys or the indicator existed before, so the new cases couldn't have passed against the old code.

## Deviations from hunk (recorded per the plan)

- `z`: whole-diff context toggle (re-derived at `--unified=25`), not hunk's per-hunk `review.toggleHunkGap`. The vendored `HunkDiffView` has no gap-expansion prop.
- `v`/`y`: hunk-granular selection and copy, because the view has no line cursor. The copy goes through OpenTUI's OSC 52.
- `a`: toggles the notes (thread) rail. tk has no separate agent-rationale source.
- `t`: cycles `HUNK_DIFF_THEME_NAMES` and shows a toast. There's no selector popup.
- `/`: changed-file search. Hunk's review filter has no default key.

## Notes

- **Commits withheld per AGENTS.md** (conservative profile). The work was done in the main tree. STATE.md and ROADMAP.md were not touched.
- **05-04 coexistence:** the `contextLines` option is additive on the options object. The `ProcessRunner.run` 4th `{raw}` argument and `gitShowFile` are untouched, and the git and web suites are green.
- **Prohibitions held:**
  - `D`/`S` are unbound, and lowercase `s` is the files pane only.
  - There's no refresh key.
  - The indicator comes only from a created controller and isn't shown in the modal or the artifact view.
  - `packages/tui` doesn't import `@tasks/web`.
- **Flag for 08-02:** keybar line 2 (`R reply  E edit note  e edit hunk  x resolve  J/K note  esc back`) is unchanged and is still the anchor. Line 1 changed. Lines now wrap at key separators on narrow terminals.

## Self-Check: PASSED
