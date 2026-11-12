---
phase: 09-task-view-parity
plan: 07
subsystem: web
tags: [web, task-view, diff-modal, evidence, review-island]
status: complete
requires: [09-06, 05-02, 05-03, 05-04, 08-03]
provides:
  - "Island `mode: \"modal\"` with `initialHunk`, `onExpand`, `onClose`: one file of the diff, `⤢ full view` and `esc close`, line and file comments"
  - "`#diffModal` over the web task view, opened by CHANGES file rows, a click on the already-selected CHANGES tab, `◧ open diff`, and MINIMAP bars (at their hunk)"
  - "`ReviewPayload.evidence: [{ id, name, mime }]` on `GET /api/review/:id`"
  - "Diff view: an `EVIDENCE` list under FILES, and evidence `<img>` blocks after the file diff with 08-03 comment cards and a `comment on the evidence…` composer that posts `{ evidenceId, body }`"
key-files:
  modified:
    - packages/web/src/review.ts
    - packages/web/src/client/review-island.tsx
    - packages/web/src/app.html
    - packages/web/test/taskview.test.ts
    - docs/src/content/docs/architecture.md
requirements-completed: [VIEW-04]
metrics:
  tasks: 2
  completed: 2026-11-11
actuals:
  tasks: 2
  commits: 0
---

# Phase 9 Plan 07: Diff modal over the task view and evidence in the diff flow (web) — Summary

On `/tasks/:id`, these open a diff modal over the dimmed task view, and the URL does not change:

- a CHANGES file row
- a click on the CHANGES tab when it is already selected
- `◧ open diff`
- a MINIMAP bar, which also scrolls to that bar's hunk

The modal shows one file: `<id> / <path>`, its status pill and `+a −d`. The header holds `⤢ full view` and `esc close`, and a footer lists the key hints. You can comment on a line or on the whole file (`＋ comment on this file`); both go to the same thread store. `⤢ full view` goes to `/tasks/:id/diff?file=<path>`. Esc, `esc close`, or a click on the backdrop closes the modal and leaves the task view as it was, including the selected rail tab.

The full diff view now lists `EVIDENCE` under FILES (`name · 💬 N`). After the file diff it renders each evidence item: an `<img>` for image mimes, otherwise a name·mime chip. Each item has its comment cards (the 08-03 `ThreadCard`, so status pill, ✓ done / ✕ remove / ↺ reopen) and an always-open `comment on the evidence…` composer. These comments are stored at `evidence:<id>`.

**Commits withheld per AGENTS.md.** All changes are uncommitted in the main tree, and STATE.md and ROADMAP.md are untouched.

## Tasks

| Task | Name | Status | Files |
|------|------|--------|-------|
| 1 (tracer) | CHANGES row → diff modal → line comment → record; ⤢ full view; esc close | done | review-island.tsx, app.html, taskview.test.ts |
| 2 | evidence images in the full diff flow, commentable at `evidence:<id>` | done | review.ts, review-island.tsx, app.html, taskview.test.ts |

### What changed

**review.ts**
- New `ReviewEvidence` type and `evidenceOf(issue)`. It keeps only blob attachments whose id matches `^ev-[a-z0-9]{6}$` and that have a non-empty mime.
- `reviewPayloadFor` now wraps `changesetPayloadFor` and adds `evidence` on every return path.

**review-island.tsx**
- `IslandProps.mode` gains `"modal"`, plus the new props `initialHunk`, `onExpand` and `onClose`.
- Modal frame: `.dmodal-frame` with a sticky `.dmenu` (`[data-act="expand"]`, `[data-act="close"]`). Below it: a `.dfbar` with the hunk spec and `＋ comment on this file`, file threads, the `FileDiff`, and the key hints. There is no file list and no edit mode.
- The status letter comes from the changeset, falling back to the @pierre change type (`CHANGE_LETTER`).
- While the modal is mounted, a document `keydown` handler runs. Escape closes the modal, except when focus is in a field: the page blurs the field first. `C` opens the file composer.
- `scrollToHunk` finds the row whose `data-line-index` begins with `hunk.unifiedLineStart`, searching inside shadow roots (`queryDeep`). It re-scrolls every 100 ms until that row exists and the body height holds steady across a tick.
- Empty and error states get the close button too.
- `Draft.evidenceId`: `DraftCard` posts `{ evidenceId, body }` for it. `DraftCard` also gains `persistent` (no cancel button) and `inputId`.
- `ThreadCard` labels evidence threads `evidence:<id>`.
- Diff mode: the EVIDENCE list and the `section#ev-<id>.rvi-ev` blocks. Clicking the image focuses that item's composer.
- The file-threads block is factored into `fileThreadsBlock`, shared by diff and modal.

**app.html**
- New `state.diffModal`, `openDiffModal(id, path, hunk)`, `closeDiffModal()` and `firstDiffPath(id)`. `firstDiffPath` returns the first file that needs review, else the first file.
- `#diffModal` is rendered inside `#taskView` but positioned against `.main`, so it stays in place while the task scrolls.
- `renderTask` returns early while the modal is open (T-09-17). The review SSE frame already calls `ReviewIsland.refresh(id)`.
- `render()` closes the modal on a view, route or task change.
- The global key handler yields to the modal, so 1–4, n and Enter do nothing while it is open.
- `[data-open-diff]` clicks open the modal. Modifier-clicks still follow the `/diff?file=` href.
- `openDiffModal` resets `state.reviewKey`. There is one island root at a time, so after the modal the full diff view remounts instead of showing blank.
- New CSS: `.dmodal`, `.dmodal-card`, `.dmodal-frame …`, `.rvi-ev`, `.rvi-evimg`, `.evhead`, `.evrow`, and the evidence composer textarea.

**taskview.test.ts**
- Two new cases:
  - The bundle contains `⤢ full view`, `esc close` and `comment on the evidence…`, and the shell contains `id="diffModal"` and `mode: "modal"`.
  - `GET /api/review/:id` has `evidence` equal to `[{id, name:"shot.png", mime:"image/png"}]`; a branchless task gets `[]`.
  - An evidence thread has `evidenceId` set and `filePath` = `evidence:<id>`. It appears in the taskview comment rows and in `tk comments --json`.

**architecture.md**
- I extended the Web Path review sentence to cover the modal, the evidence blocks and `evidence` on the payload. Only the web paragraph changed, by exact-string replacement against the current file, so 09-05's TUI edits are untouched.

## Verification

| Command | Result |
|---|---|
| `bun test --timeout 20000 packages/web/test/taskview.test.ts` | 5 pass, 0 fail |
| `bun test --timeout 20000 packages/web/test` | 28 pass, 0 fail (5 files) |
| `cd packages/web && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `cd docs && bun run build` | Complete |
| `grep -c dangerouslySetInnerHTML review-island.tsx` | 0 |

The final `bun test` and `tsc` runs came after the last code edit.

**Browser probe.** Session `AGENT_BROWSER_SESSION=gsd0907`, port 62171. The scratch repo is under the scratchpad (`p0907/`). It holds `src/a.ts` with 61 lines and two edits, which gives two hunks, plus an attached 40×30 `shot.png`. The server was restarted after each code edit.

- **Task 1:**
  - The CHANGES `a.ts` click opened the modal. The url stayed `/tasks/tk-pwc`, `#taskView h2` was visible, and the header read `tk-pwc / src/a.ts M +2 −2 ⤢ full view esc close`.
  - `＋ comment on this file`, filled with `modal file note`, showed in `tk show` (`○ src/a.ts  yuri  modal file note`).
  - A line click opened the line composer. `modal line note` was stored at `src/a.ts:1`.
  - Escape hid the modal, the url was unchanged, and COMMENTS showed 2.
  - Re-clicking the CHANGES tab opened the modal, and `esc close` closed it.
  - `#openDiff` opened the modal.
  - MINIMAP bar `data-hunk="1"` opened the modal scrolled to hunk 2 (card `scrollTop` 96, the maximum). Bar 0 gave `scrollTop` 0. After Escape, MINIMAP was still the selected tab.
  - `[data-act="expand"]` led to `/tasks/tk-pwc/diff?file=src%2Fa.ts`, and the full diff mounted.
  - Shift+C in the modal opened the file draft.
  - Pressing `2` while the modal was open did nothing.
- **Task 2:**
  - On `/tasks/tk-pwc/diff`, `.rvi-evimg` had `naturalWidth > 0`, and FILES listed `EVIDENCE · 1 shot.png —`.
  - Clicking the image focused `ev-compose-ev-39cfc8`. I submitted `probe evidence note`.
  - `tk comments --json` locations included `evidence:ev-39cfc8`, and the list row became `💬 1`.
  - `✓ done` on the evidence card changed it to `✓ RESOLVED` with `↺ reopen`, and the list went back to `—`.
  - The task view showed `→ evidence:ev-39cfc8`.
- **Regressions:** `#diffEdit` (edit, then done), `#diffBack`, `view file` (`/file?path=`, `2 open · 0 ✓`) and `#fileBack` all behave as before. The modal still opens after a file round-trip, and the List view renders `.lrow`.
- **Screenshots:**
  - `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0907/09-07-modal.png`
  - `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0907/09-07-hunk.png`
  - `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0907/09-07-evidence.png`
- **Teardown:** the browser is closed. The real bun pid 67616 was killed, `pgrep` finds no `web/src/main.ts`, and the port answers 000.

## Deviations from Plan

1. **[Rule 1] Hunk scroll target.** I target the rendered row whose `data-line-index` begins with `hunk.unifiedLineStart` rather than the "hunk separator". Separators exist only where context is collapsed. A one-shot scroll also ran before FileDiff's later layout passes, and the probe showed `scrollTop` 0. The retry stops only once the body height holds steady.
2. **[Rule 2] Status letter fallback.** For a working-tree-only change, `payload.files` (committed changeset) is empty, so the modal had no status pill. It now falls back to the @pierre change type.
3. **[Rule 2] `state.reviewKey` reset on modal open.** Without it, `⤢ full view` after the modal would leave `#reviewView` blank, because there is a single island root.
4. **[Rule 2] Extras:**
   - Clicking the backdrop closes the modal.
   - The page's global keys are suppressed while the modal is open.
   - Leaving the task closes the modal.
   - The first Escape in a focused field only blurs it, so a draft is not lost.
   - Evidence `ThreadCard`s show `evidence:<id>` instead of `file-level`.
   - The evidence composer gets a full-width textarea style.
5. **Footer hint `c comment on a line`:** clicking a line opens its composer. There is no keyboard line cursor, so `c` itself is not bound; only `C` (file) is.
6. **TDD order:** the Task 2 tests were written after the review.ts change and passed on their first run, so no RED run was captured.
7. **Evidence filter:** like `artifactGroups`, it keeps all blob attachments (evidence and inline), not only `kind: "evidence"`.

## Threat Model

- **T-09-15** (mitigated): evidence renders only through `<img>`; there is no `object`, `iframe` or innerHTML, and the grep count is 0. The blob route is unchanged.
- **T-09-16** (mitigated): ids are filtered to `^ev-[a-z0-9]{6}$` server-side, and URLs use `encodeURIComponent`.
- **T-09-17** (mitigated): `renderTask` is skipped while the modal is open, and SSE goes through `ReviewIsland.refresh`.
- **T-09-SC:** no package installs.

## Notes / Follow-ups

- The diff view (pre-existing) scrolls the document body rather than `.dbody`. With evidence blocks the page grows taller, and the `EVIDENCE` row's `scrollIntoView` scrolls the body. It works, but a layout pass could pin the diff pane's height.
- The evidence image renders at its natural size, capped at 420px; tiny images stay tiny.

## Self-Check: PASSED

- All modified files exist with the described changes. The verify commands were re-run green after the last edit, and the docs build passed after the docs edit.
- Commits: none (withheld per AGENTS.md).
