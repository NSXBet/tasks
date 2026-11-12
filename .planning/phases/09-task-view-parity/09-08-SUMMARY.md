---
phase: 09-task-view-parity
plan: 08
subsystem: web, docs
tags: [web, artifact-view, doc-render, evidence, e2e-probe, d-05]
status: complete
requires: [09-07, 09-05, 05-03, 08-03]
provides:
  - "`renderDocBlocks(contents)` + `scrubDocHtml` (packages/web/src/review.ts): `docBlocks` ranges → `Bun.markdown.html` (noHtmlBlocks/noHtmlSpans) → href/src allowlist scrub after entity decoding"
  - "`GET /api/review/:id/file?path=<doc>&render=doc` → `{ contents, blocks: [{ line, endLine, html }] }` (docs only, after the guarded read)"
  - "Island artifact view modes: `CODE` (05-03 `File`), `DOC` (blocks + `＋` gutter range comments), `EVIDENCE` (`?evidence=`, image/chip + composer at `evidence:<id>`), header mode tag + `N open · K ✓`"
  - "app.html: `?evidence=` route parsing; ARTIFACTS row names link to `?path=` / `?evidence=` via `navigate` (thumbnail still opens the viewer)"
key-files:
  modified:
    - packages/web/src/review.ts
    - packages/web/src/server.ts
    - packages/web/src/client/review-island.tsx
    - packages/web/src/app.html
    - packages/web/test/taskview.test.ts
    - docs/src/content/docs/architecture.md
    - docs/src/content/docs/overview.md
    - docs/src/content/docs/testing.md
requirements-completed: [VIEW-04, VIEW-01]
metrics:
  tasks: 3
  completed: 2026-11-11
actuals:
  tasks: 3
  commits: 0
plan_head_before: 496745b6ad49570362ec3fc5d672b7da784b292f
plan_head_after: 496745b6ad49570362ec3fc5d672b7da784b292f
---

# Phase 9 Plan 08: Web artifact view — docs as docs, evidence view, e2e probe — Summary

`/tasks/:id/file` now has three modes. Each has a mode tag and a `N open · K ✓` chip in the header and uses the same comment panel.

- **`CODE`** (`?path=src/a.ts`) keeps the 05-03 `File` render with line comments.
- **`DOC`** (`?path=docs/task.md`) renders the markdown server-side as one sanitized HTML block per `docBlocks` range. Each block has a `＋` gutter button that posts a `path:line-endLine` range comment.
- **`EVIDENCE`** (`?evidence=ev-…`) shows the image, or a name·mime chip for non-images, with its comment cards and a composer that stores comments at `evidence:<id>`.

Names in the task view's ARTIFACTS rows open these views in place, and the thumbnail still opens the image viewer. architecture.md and overview.md describe the whole web task-view loop. The end-to-end browser probe put comments from three surfaces (modal line, full-view evidence, doc block) on one record.

**Commits withheld per AGENTS.md** (no git commit/push). All changes are uncommitted in the main tree, and STATE.md and ROADMAP.md are untouched.

## Continuation note: what was already done vs completed here

A previous executor ran most of this plan and was cut off before writing the summary. I inspected the working tree against each task:

| Task | Found on arrival | Completed in this run |
|------|------------------|-----------------------|
| 1 (tracer): doc blocks → DOC mode → block ＋ range comment | **Done.** `renderDocBlocks`/`scrubDocHtml` in review.ts, the `render=doc` branch in server.ts, `FileArtifact` DOC mode in the island, `.rvi-doc*`/`.rvi-gut` CSS, and 3 unit/integration tests | Verified only (automated + browser probe) |
| 2: `?evidence=` view + ARTIFACTS links | **Done.** `EvidenceArtifact`, `routeFromLocation` `evidence`, a remount key that includes it, `evidenceUrl`, ARTIFACTS `a.aname` links, and a shell test | Verified only (automated + browser probe) |
| 3: docs + e2e probe | **Docs done.** The architecture.md Web Path paragraph and the overview.md "Web task view" section with the diff modal / evidence / artifact-view bullets. The **e2e probe had not been run.** | Ran the full e2e probe. Small doc fix: added `web/test/taskview.test.ts` to the testing.md inventory |

## What was built (as found and verified)

- **review.ts:**
  - `SAFE_URL = /^(https?:|mailto:|#|\.{0,2}\/|[^:]*$)/i`.
  - `scrubDocHtml` drops any `href`/`src` whose value falls outside the allowlist. The check runs after entity decoding and after stripping ASCII whitespace and control characters.
  - `renderDocBlocks` maps each `docBlocks` range through `Bun.markdown.html(text, { noHtmlBlocks: true, noHtmlSpans: true })`, then the scrub, then trims the result.
- **server.ts:** in the `file` GET, `render=doc` combined with `isDocPath(relativePath)` spreads `blocks` into the guarded-read JSON. Non-doc paths return `{ contents }` only. Escape paths still return 400 and missing paths 404.
- **review-island.tsx:**
  - `ArtifactView` dispatches to `EvidenceArtifact` when `evidenceId` is set, else to `FileArtifact`.
  - `FileArtifact` in DOC mode:
    - renders `.rvi-docblock[data-line][data-end-line]` with a `.rvi-gut` button (aria-label `comment on lines a–b`) and the server HTML.
    - Each thread renders under the first block its range overlaps.
    - The panel shows the hint `whole file (＋ comment on file) · selection → lines a–b (gutter ＋)` and the note `docs render as docs · code renders as code · same comment surface on both`.
  - `dangerouslySetInnerHTML` appears once in the island, on the server-sanitized doc block.
- **app.html:**
  - `routeFromLocation` reads `?evidence=` on the file route, and the remount key is `file\0<id>\0<path>\0<evidence>`.
  - ARTIFACTS rows: file rows link to `?path=`, evidence rows link to `?evidence=`, routed in place by `inPlace`.
  - CSS for `.rvi-doc` / `.rvi-dochtml` typography, `.rvi-docblock`, and `.rvi-gut` (faint until hover or focus).
- **taskview.test.ts:** covers 09-08 with these cases:
  - the `renderDocBlocks` shape
  - scrub cases: entity-encoded, mixed-case, `data:`, and safe targets kept
  - `render=doc` for doc versus code paths, plus 400/404, and a block-range comment that lands at `docs/task.md:3-4`
  - the `?evidence=` shell and bundle strings
- **Docs:** architecture.md Web Path covers `/taskview`, the diff modal, `⤢`, evidence in the diff flow, and the `CODE`/`DOC`/`EVIDENCE` modes, including `render=doc`, the sanitizer and `?evidence=`. overview.md has a "Web task view" section with diff modal / evidence / artifact view bullets that use the same mode names as the 09-05 TUI "Artifact view" paragraph. 09-05's TUI sections are untouched.

## Verification (all run in this session, after the last edit)

| Command | Result |
|---|---|
| `bun test --timeout 20000 packages/web/test` | 32 pass, 0 fail (5 files) |
| `cd packages/web && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `cd docs && bun run build` | Complete (re-run after the testing.md edit) |
| `grep -c dangerouslySetInnerHTML packages/web/src/client/review-island.tsx` | 1 (the sanitized doc block, by design) |

### End-to-end browser probe transcript

Setup:
- Session: `AGENT_BROWSER_SESSION=gsd0908b`, port 49908, viewport 1280×900.
- Scratch dir: `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0908/`.
- Scratch repo: 09-06 probe_recipe repo with task `tk-9ie` from `tk work`, and `src/a.ts` edited in the worktree.
- `docs/task.md` contains `# Plan\n\nstep one\nstep two\n\n[x](javascript:alert(1)) <b>raw</b>\n` and was attached with `tk attach tk-9ie docs/task.md`.
- A 40×30 PNG was attached as evidence `ev-0aa912`.
- Ran `tk finish tk-9ie --session s1`, so status is `ready-to-review`.

1. **Task view `/tasks/tk-9ie`:**
   - `ARTIFACTS` appears at text index 256 and `COMMENTS` at 499, so artifacts come first.
   - There is exactly 1 `.btn.primary` and no start button.
   - ARTIFACTS reads `1 SRC · 0 EDIT · 0 NEW · 1 OTHER`, `UNREFERENCED (2)`, `shot.png`, `docs/task.md`.
   - The SESSIONS tab shows `DONE  omp · session s1`.
2. **CHANGES `src/a.ts` → diff modal:**
   - The URL stayed `/tasks/tk-9ie` and the header read `tk-9ie / src/a.ts M +1 −1 ⤢ full view esc close`.
   - Clicking the addition line opened the composer; I submitted `e2e line`.
   - `tk comments` showed `src/a.ts:1`.
3. **`⤢ full view`:**
   - The URL became `/tasks/tk-9ie/diff?file=src%2Fa.ts` and `.rvi-evimg` loaded with naturalWidth 40.
   - In the `ev-compose-ev-0aa912` composer I submitted `e2e evidence`, stored at `evidence:ev-0aa912`.
4. **`← task` → ARTIFACTS `docs/task.md` link:**
   - The link `href` was `/tasks/tk-9ie/file?path=docs%2Ftask.md`.
   - `.rvi-doc h1` read `Plan` and the mode tag read `DOC`.
   - `#reviewView` text does not contain `# Plan`.
   - The doc HTML has no `javascript:` and no `<b>` element; `<b>raw</b>` shows as text.
   - The blocks are `1-1`, `3-4` and `6-6`, with gutter labels `comment on line 1`, `comment on lines 3–4`, `comment on line 6`.
   - Clicking the second `.rvi-gut` set the hint to `selection → lines 3–4`. I submitted `e2e block`, stored at `docs/task.md:3-4`, and the chip read `1 open · 0 ✓`.
   - `＋ comment on file` with `e2e doc file note` was stored at `docs/task.md`, and the chip read `2 open · 0 ✓`.
5. **Task 2 probe:**
   - Clicking the ARTIFACTS evidence name went to `/tasks/tk-9ie/file?evidence=ev-0aa912` with no reload (a window marker survived).
   - The header read `← task file tk-9ie / shot.png EVIDENCE 1 open · 0 ✓`, the image naturalWidth was 40, and the earlier `e2e evidence` card showed.
   - I submitted `probe evidence artifact note`, stored at `evidence:ev-0aa912`, and the chip read `2 open · 0 ✓`.
   - `agent-browser back` returned to `/tasks/tk-9ie` with `#taskView` visible.
   - The ARTIFACTS `.athumb` still opens the image viewer, and the path stays `/tasks/tk-9ie`.
   - `?evidence=ev-zzzzzz` shows `evidence not found: ev-zzzzzz`.
   - `?path=src%2Fa.ts` shows mode `CODE`, `1 open · 0 ✓`.
6. **Final `tk comments tk-9ie --json` locations:**
   - `src/a.ts:1` (e2e line)
   - `evidence:ev-0aa912` (e2e evidence)
   - `docs/task.md:3-4` (e2e block)
   - `docs/task.md` (e2e doc file note)
   - `evidence:ev-0aa912` (probe evidence artifact note)
   - Three surfaces landed on one record.
7. **Regressions:**
   - The 08-03 comment controls (`✓ done` / `✕ remove`) show on the CODE artifact. `✓ done` moved the chip to `0 open · 1 ✓`.
   - `/diff`: `#diffEdit` → `#diffSave` + `#diffDone` → `#diffDone` → `#diffEdit` restored.
   - `.dflview` (`view file`) → `/file?path=src%2Fa.ts`.
   - The List view renders `.lrow`, 1 row.
8. **Teardown:**
   - The browser is closed.
   - The real bun pids (17669, then the restart for the regression re-check) were killed. `pgrep -f web/src/main.ts` finds nothing, and the port answers 000.

Screenshots are in `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0908/`: `e2e-1-taskview.png`, `e2e-2-modal.png`, `e2e-3-fullview-evidence.png`, `e2e-4-doc-artifact.png`, `e2e-5-evidence-artifact.png`. They were not attached as tk evidence because no tk task tracks phase 9 / 09-08. tasks-0v4m is the TUI-side task.

## Deviations from Plan

1. **[Rule 2, docs] testing.md inventory:** `web/test/server.test.ts` became `web/test/{server,taskview}.test.ts`. 09-06 added taskview.test.ts without listing it. This is not in the plan's `files_modified`, but AGENTS.md requires docs to land with code.
2. **Scrub is stricter than the plan text:** besides entity decoding, it strips ASCII whitespace and control characters before the check (`java\tscript:`). The previous executor did this, and it is covered by the second renderDocBlocks test.
3. **Doc thread placement:** a thread whose range overlaps no block falls back to the last block starting at or before its line. Such ranges come from older or edited docs.
4. **E2E probe order:** the probe ran once against a `ready-to-review` task (`tk finish` sets the status). A separate `tk update --status ready-to-review` was not needed.

## Threat Model

- **T-09-18 (mitigated):**
  - The server renders with `noHtmlBlocks`/`noHtmlSpans`, and the scrub enforces the href/src allowlist after entity decoding.
  - The unit tests cover `javascript:`, entity-encoded and mixed-case schemes, `data:` and raw tags.
  - The browser probe confirmed no `javascript:` in the DOM and raw `<b>` rendered as text.
  - The island has one raw-HTML sink.
- **T-09-19 (mitigated):** `render=doc` transforms only after `readWorktreeFile`. `../escape.md` returns 400 (test).
- **T-09-20 (mitigated):** the size limit is the guarded read's existing behaviour, and only `isDocPath` paths are rendered.
- **T-09-SC:** no package installs; `Bun.markdown` is built in.

## Self-Check: PASSED

- All listed files exist with the described changes, and every verify command plus the e2e probe was run in this session.
- Commits: none (withheld per AGENTS.md).
