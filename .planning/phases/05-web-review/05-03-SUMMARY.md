---
phase: 05-web-review
plan: 03
subsystem: web
tags: [web, review, artifact-view, comments, router]
requires:
  - phase: 05-02
    provides: "task view landing, /tasks/:id/diff router, island onBack/initialFile/theme"
provides:
  - "`/tasks/:id/file?path=<repo-relative path>` artifact view: full worktree file through `@pierre/diffs/react` `File`, line + whole-file comments, comments panel with `N open · K ✓`"
  - "Island mount props `mode: \"diff\" | \"file\"`, `path`, `onOpenFile`"
  - "Diff view `view file` per file row (hidden for deleted files); task-view comment rows that point at a file link to the artifact view"
affects: [packages/web, docs/architecture.md]
key-files:
  modified:
    - packages/web/src/client/review-island.tsx
    - packages/web/src/app.html
    - packages/web/test/server.test.ts
    - docs/src/content/docs/architecture.md
decisions:
  - "The artifact view shares `#reviewView` with the diff: `state.view = \"file\"` displays that container and `renderReview` branches on it. Remount key is `file\\0<id>\\0<path>`; the diff key is now `diff\\0<id>\\0<initialFile>`."
  - "`File` cacheKey is `<id>:<path>:<fnv1a(contents)>`, not the plan's `<id>:<path>`, so a live `review` refresh never repaints a stale highlight (the 05-01 lesson)."
  - "Write failures in the artifact view (comment, reply, resolve) toast through `onError` and keep the view. Only load failures replace it with the empty state."
  - "`/tasks/:id/file` without `?path=` lands on the task view."
requirements: [WEB-01]
metrics:
  tasks: 2
  completed: 2026-11-10
---

# Phase 05 Plan 03: Artifact view (file + comments) — Summary

`/tasks/:id/file?path=src/a.ts` now shows that worktree file in full. Clicking a line opens a composer, and `＋ comment on file` opens a file-level one. Both post to `POST /api/review/:id/threads`, land in `metadata.reviewThreads`, and show in `tk show`'s REVIEW section. A right-hand panel (320px) lists every thread on the file, file-level first, with a `N open · K ✓` chip in the header. You reach the view from the diff view's `view file` and from file-located comment rows in the task view, and `← task` goes back. It follows `<html data-theme>`, and a `review` SSE frame for the task re-reads the file and threads in place.

**Commits withheld per AGENTS.md** (no git commit/push; all changes are in the main working tree; STATE.md/ROADMAP.md untouched).

## Tasks

| Task | Name | Status | Files |
|------|------|--------|-------|
| 1 (tracer) | `/tasks/:id/file?path=` → File render → line comment → thread on the record | done | review-island.tsx, app.html, test/server.test.ts |
| 2 | docs: artifact view route | done | architecture.md |

### What changed
- **review-island.tsx:**
  - `IslandProps` gains `mode`, `path` and `onOpenFile`. `mount` renders `ArtifactView` when `mode === "file"` and `Island` otherwise. `refresh(issueId)` reaches whichever one is mounted, because both register `activeRefresh`.
  - The theme follower is pulled out into `useAppTheme`, which both views share.
  - New `threadCounts` (03-05 rule: open + sent are open, resolved is ✓, dismissed settles).
  - `getJson` now throws an `HttpError` that carries the status, so a 404 shows `file not in the worktree: <path>` with a retry button.
  - `ArtifactView`:
    - Loads `GET …/file?path=` and `GET …/threads` together and keeps the threads whose `filePath === path`.
    - Groups line threads plus the open draft per line as `LineAnnotation`s, rendered as `ThreadCard`/`DraftCard`.
    - `onLineClick` opens a `{line, side: "new"}` draft. `＋ comment on file` (`#fileComment`) opens a line-0 draft in the panel.
  - Diff file rows are now `.dflrow`: the existing `.dfl` button plus a `view file` button (`.dflview`). That button shows only when `onOpenFile` is passed and the file's `type !== "deleted"`.
  - The `DraftCard` placeholder now reads "Comment on this file…" for file-level drafts.
  - No `dangerouslySetInnerHTML` (grep gate = 0).
- **app.html:**
  - `applyRoute` sets `state.view = route.view` (task, review or file).
  - `render()` shows `#reviewView` for review and for file, and calls `renderReview` for both. `renderReview` mounts file mode with `{mode:"file", path, issueId, actor, theme, onBack, onError}`.
  - Diff mode passes `onOpenFile → navigate(fileUrl(id, p))`. The new `fileUrl` helper uses `encodeURIComponent`.
  - `commentsPreview` turns file-located rows (no `evidenceId`, no `evidence:` prefix) into `<a class="tcrow tclink" href=…>`. These rows route in place, but modifier-clicks still open a new tab. Every value goes through `esc()`.
  - Popping back to `/` from the file view falls back to board.
  - CSS added: `.dflrow`, `.dflview`, `.apanel` (stacks under 860px), and `a.tcrow`.
  - `renderList`, `cardHtml` and `.lrow` are untouched.
- **server.test.ts:** new `artifact view endpoints (05-03)` case on a scratch git repo with `tk work`. The file GET returns the worktree contents, `../escape` returns 400 and `nope.ts` returns 404. It then creates a line thread and a file thread, and both are listed. `tk show` prints `REVIEW (2)`, `src/a.ts:1`, and both bodies.
- **architecture.md:** one sentence in the Web Path review paragraph documents the artifact-view route.

## Deviations from Plan

**1. [Rule 1 - Bug] cacheKey includes a content hash.** The plan's key, `id + ":" + path`, would serve a stale highlight after a live refresh. This is the same failure as 05-01 deviation #2. The key is now `${id}:${path}:${patchHash(contents)}`.

**2. [Test adjustment] Thread bodies carry the store's location prefix.** `formatReviewThreadComment` (packages/review) stores bodies as `[review src/a.ts:1] artifact note`. The test therefore matches with `stringContaining` rather than equality. This is existing behavior and was not changed.

## Verification

| Check | Result |
|-------|--------|
| `bun test --timeout 20000 packages/web/test` | 21 pass, 0 fail |
| `cd packages/web && bunx tsc --noEmit -p tsconfig.json` | clean |
| `cd docs && bun run build` | Complete |
| `grep -c 'dangerouslySetInnerHTML' packages/web/src/client/review-island.tsx` | 0 |
| Browser probe (session `gsd0503`, server started after all edits): open `/tasks/tk-ww2/file?path=src%2Fa.ts` | `#reviewView` text has `tk-ww2/src/a.ts`. The File shadow root contains `export const a = 1` |
| Click line 1 (dispatched on shadow `[data-column-number="1"]`), fill and submit `probe line note` | `tk show` shows `REVIEW (1)` and `○ src/a.ts:1  yuri  probe line note`. The thread renders inline and in the panel |
| `＋ comment on file`, submit `probe file note` | `tk show` shows `REVIEW (2)` and `○ src/a.ts  yuri  probe file note`. Panel order is `file-level`, then `new · line 1` |
| Resolve + reply from the panel | Header reads `1 open · 1 ✓`, `tk show` reads `1 open · 1 ✓`, and the reply is visible |
| Navigation | `← task` goes to `/tasks/tk-ww2`. Both comment rows link to the file route, and clicking one routes in place (marker survived). `◧ open diff` shows one `view file`, which opens the file route (marker survived). Browser back returns to `/diff` |
| Extra | `path=nope.ts` shows "file not in the worktree: nope.ts" with retry. A worktree edit shows the new line live (no reload). Light theme gives `pre` bg `rgb(255,255,255)` and dark gives `rgb(21,26,35)` |
| Evidence | `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0503/artifact-view.png`, `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0503/diff-viewfile.png`, `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0503/artifact-light.png` |
| Teardown | Browser closed, server killed (port answers 000). Note that `$!` was the mise shim, so the bun child had to be killed separately |

No "loading review…" stall was seen in this run.

## Threat Model
- **T-05-06** mitigated: the existing `guardWorktreePath` covers this, and the test pins `../escape` → 400 and `nope.ts` → 404.
- **T-05-07** mitigated: file text is rendered only by `@pierre/diffs` `File` and React text children. There is no `dangerouslySetInnerHTML`, and the app.html preview rows use `esc()`.
- **T-05-SC**: no new packages.

## Notes / Follow-ups
- Thread comment bodies show the stored `[review <loc>] ` / `[review reply] ` prefix in the island, in both the diff view and the artifact view. This comes from `formatReviewThreadComment`, which writes it for `tk show`. Stripping it in the web view needs a follow-up.
- Docs render as text here; markdown document rendering is Phase 9 (VIEW-04).

## Self-Check: PASSED
- All modified files are present. Every verify command was run green after the last code edit, and the docs build ran after the docs edit.
