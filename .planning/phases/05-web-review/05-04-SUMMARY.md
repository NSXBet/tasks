---
phase: 05-web-review
plan: 04
subsystem: web
tags: [web, review, editor, git-adapter, sc3]
requires:
  - phase: 05-01
    provides: "event: review SSE frames, island refresh(issueId), working-tree live patch"
  - phase: 05-03
    provides: "artifact view, HttpError status in getJson, file GET/threads endpoints"
provides:
  - "`gitShowFile(cwd, rev, path, runner)` in @tasks/git — untrimmed blob at a rev, or null"
  - "`ProcessRunner.run(..., options?: { raw?: boolean })` — opt-in untrimmed stdout on bunRunner/nodeRunner"
  - "`GET /api/review/:id/file?path=&side=base` (byte-exact base blob; 404 missing)"
  - "`PUT /api/review/:id/file` refuses worktree-less tasks with 400 `no_worktree`"
  - "Diff-view edit mode (save / ⌘S / done→discard?), refresh deferral while dirty, `＋ comment on file` in the diff view"
affects: [packages/git, packages/web, docs/architecture.md]
key-files:
  created:
    - packages/web/test/edit-loop.test.ts
  modified:
    - packages/git/src/runner.ts
    - packages/git/src/commands.ts
    - packages/git/test/adapter.test.ts
    - packages/web/src/review.ts
    - packages/web/src/server.ts
    - packages/web/src/client/review-island.tsx
    - packages/web/src/app.html
    - docs/src/content/docs/architecture.md
decisions:
  - "File-level threads in the diff view render in a `.dfthreads` block above the FileDiff (under a `.dfbar` with the file name + `＋ comment on file`), not as a line-0 annotation — line 0 is not a diff row, so placement was unreliable; line annotations now carry only line > 0."
  - "Edit sessions are keyed by a generation counter: each rebuild remounts FileDiff (`edit:<path>:<gen>`) with a fresh `editorOptions` object, so EditProvider (which caches editors by options identity) creates a fresh Editor; onChange tracks the draft through refs."
  - "A rebuild is skipped when base + worktree contents equal the current session's, so the watcher frame that follows our own save is a no-op (no double remount)."
  - "Save/load failures toast via `onError` and an inline menu chip instead of `fail` — `fail` swaps the whole view for an error state and would drop the draft."
  - "FileDiff `options` memoized (theme only; onLineClick reads the selected path through a ref) so typing-induced re-renders never force a repaint under the live editor."
requirements: [WEB-01, WEB-02]
metrics:
  tasks: 3
  completed: 2026-11-10
---

# Phase 05 Plan 04: Editable web diff + SC3 loop — Summary

The web diff now edits in place. `edit` on a changed file loads the full base blob (`GET …/file?side=base`, served byte-exact through the new `@tasks/git` `gitShowFile`) and the worktree file, and builds a non-partial diff with `parseDiffFromFile`. That diff renders in `FileDiff edit` inside the existing `EditProvider`. `save` (or ⌘S/Ctrl+S) PUTs the draft and the diff re-renders around the edit. Writes are refused for tasks without a `tk work` worktree (`no_worktree`), so a web edit never touches the main checkout. An e2e test pins ROADMAP SC3: a web edit shows up in the TUI's `gitDiffPatch(worktree, base, null, {})` and in `GET /api/review/:id`, and a web comment shows in `tk show` and in `taskStoreCommentStore(store).listThreads`.

**Commits withheld per AGENTS.md.** No git commit or push was made. All changes are in the main working tree, and STATE.md and ROADMAP.md are untouched.

## Tasks

| Task | Name | Status | Files |
|------|------|--------|-------|
| 1 (tracer) | base blob through @tasks/git → `GET …/file?side=base` → SC3 edit + comment loop test | done | runner.ts, commands.ts, adapter.test.ts, review.ts, server.ts, edit-loop.test.ts |
| 2 | island edit mode + `＋ comment on file` in the diff view | done | review-island.tsx, app.html (CSS only) |
| 3 | docs: edit endpoint, base side, worktree-only writes | done | architecture.md |

### What changed
- **runner.ts:**
  - New `RunOptions { raw?: boolean }` as an optional 4th parameter of `ProcessRunner.run`.
  - `bunRunner` and `nodeRunner` skip the stdout trim only when `raw === true`. stderr is always trimmed, and the default is unchanged.
  - Other implementers (beads export, test fakes) take fewer params, which TypeScript still accepts.
- **commands.ts:**
  - New `gitShowFile` runs `git cat-file blob <rev>:<path>` with `{ raw: true }`.
  - It returns null before spawning anything for a non-hex rev, or for a path that is empty, starts with `-` or `/`, or contains NUL.
  - A non-zero exit also returns null.
- **review.ts:**
  - New `readBaseFile`: it runs the `guardWorktreePath` guard, then reads the pinned base with `readChangesetBase` and requires a SHA. A null blob from `gitShowFile` becomes `missing`.
  - `writeWorktreeFile` returns `no_worktree` when the task has none. Reads keep the root fallback.
- **server.ts:** the file GET honors `side=base` and returns 400 for any other `side` value. `no_worktree` maps to 400 through the existing non-missing branch.
- **review-island.tsx:**
  - `EditSession` state and `loadEdit(path, force)` added.
  - Menu controls: `edit`, then `editing <path> ●` with `save`, `done` / `discard?`, and a status chip. `discard?` is a 4s armed second click, not a native confirm.
  - ⌘S/Ctrl+S is handled on `.dbody` keydown.
  - A refresh while dirty sets `pendingRefresh`, which replays on discard. Save does its own reload and rebuild.
  - Switching files while dirty is blocked with a toast.
  - The `.dfbar` file name row has `＋ comment on file`, and `.dfthreads` lists file-level threads plus the line-0 draft.
  - `renderList` and `.lrow` are untouched (07-03).
- **app.html:** CSS only, for `.dedit`, `.dfbar` and `.dfthreads`.
- **architecture.md:** an "Editing" paragraph in the Web Path review section. It covers in-place edit, `side=base` via `gitShowFile`, PUT path-guarded and `no_worktree`, the watcher → `event: review` path, refresh deferral, and the file-level comment control.

## Deviations from Plan

1. **[Rule 1 - Bug] File-level comments not via a line-0 annotation.** The plan assumed `lineNumber: 0` renders above the first hunk, but line 0 is not a diff row. File-level threads and drafts render in a block above the diff instead, and line annotations are now line > 0 only. Before this change, threads without a line were grouped at `additions:0` and probably never rendered.
2. **[Rule 2] Save errors don't use `fail`.** `fail` replaces the view with an error screen, which would lose the draft and break the plan's "keep the draft". Save errors go to `onError` plus an inline chip instead.
3. **[Rule 2] Memoized diff options.** The previous inline `options={{…onLineClick}}` object changed on every render. Under a live editor, every keystroke re-render could force a repaint.
4. **app.html touched (CSS only).** It is not in `files_modified`, but the new controls needed styling. `renderList`, `.lrow` and markup were not changed.
5. **Edit controls placement.** `edit`/`save`/`done` sit in `.dmenu` as planned. `＋ comment on file` sits in a new `.dfbar` above the diff, next to the file name, rather than in `renderHeaderMetadata`.

## Verification

| Check | Result |
|-------|--------|
| `bun test --timeout 20000 packages/git/test/adapter.test.ts packages/web/test/edit-loop.test.ts` | 17 pass, 0 fail |
| `bun run --filter @tasks/git build` + git tsc + web tsc | exit 0 / clean / clean |
| `bun test --timeout 20000 packages/git/test packages/web/test` (final) | 88 pass, 0 fail |
| `bun test packages/git` (back-compat check) | 66 pass, 0 fail |
| `cd docs && bun run build` | Complete |
| Grep gate `grep -rn '\["git"' packages/web/src \| wc -l` | 0 |
| `dangerouslySetInnerHTML` in island | 0 |
| Browser probe (session `gsd0504`, port 59872, server started after all code edits) | see below |

Browser probe steps:
1. The worktree got `export const b = 2;` appended. I opened `/tasks/tk-ptt/diff` and clicked `#diffEdit`. The menu showed `editing src/a.ts`, and the FileDiff shadow root had one `contenteditable` (the editor attached).
2. I focused the editor, pressed End, and typed ` // web-edit`. The menu showed `●` (dirty). `Meta+s` then gave a `saved` chip.
   - `$WT/src/a.ts` line 1 is `export const a = 1; // web-edit` (grep ok).
   - `git -C $WT diff <base>` contains `+export const a = 1; // web-edit`.
   - The diff's shadow-root text contains `web-edit`, and the marker survived, so there was no page reload.
   - `agent-browser get text '#reviewView'` / `innerText` does **not** contain it, because @pierre renders into a shadow root (same note as 05-01). The check was done through `shadowRoot.textContent`.
3. Deferral: I typed ` UNSAVEDX` (dirty), then appended `export const c = 3;` to the worktree from the shell and waited 1.5s. The result was `[dirty=true, UNSAVEDX kept=true, c=3 shown=false]`. Clicking `done` changed it to `discard?`, and a second click discarded. The result was then `[edit button back=true, UNSAVEDX=false, c=3 shown=true]`, so the pending refresh replayed.
4. I clicked `＋ comment on file`, filled `probe file-level` and clicked Comment. `tk show tk-ptt` printed `REVIEW (1) · 1 open · 0 ✓` / `○ src/a.ts  yuri  probe file-level`, and the `.dfthreads` block rendered it as a `file-level` thread.
5. Evidence: `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/p0504/edit.png`. It was taken after the comment, outside edit mode.
6. Teardown: browser closed. The bun server (pid 23224, the real bun process) was killed and the port now answers 000.

## Threat Model
- **T-05-08** mitigated: `writeWorktreeFile` requires a recorded worktree, and `guardWorktreePath` keeps writes under it. The tests pin `../x` → 400 `escape` (nothing written outside the worktree) and a worktree-less task → 400 `no_worktree`, with the main checkout file unchanged.
- **T-05-09** mitigated: `gitShowFile` validates rev (hex 7–64) and path (no leading `-` or `/`, no NUL) before spawning. `<rev>:<path>` is a single argv element. The tests pin `--output=x`, `-x`, `/etc/passwd` and the empty path to null with the fake runner recording no command.
- **T-05-10** mitigated: the path is guarded before the blob read, and only the task's own pinned base is used.
- **T-05-11 / T-05-SC** accepted: no new packages.

## Notes / Follow-ups
- Saving overwrites the worktree file with the editor's draft (last write wins). An external change made while the editor is dirty is not merged; it is replaced on save. Discard keeps the external change. A conflict check (for example, sending the base contents with the PUT) would be a follow-up.
- The thread body prefix `[review src/a.ts] …` still shows in the island (05-03 follow-up still open).
- `nodeRunner` raw mode is covered only by the type and the shared code path. The new test exercises `bunRunner`.

## Self-Check: PASSED
- `packages/web/test/edit-loop.test.ts` exists, and every modified file is present.
- All automated verify commands were re-run green after the last code edit. The docs build ran after the docs edit.
