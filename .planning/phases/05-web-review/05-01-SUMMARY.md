---
phase: 05-web-review
plan: 01
subsystem: web
tags: [web, review, sse, live-diff, watcher]
requires: []
provides:
  - "Named SSE frame `event: review` {id, reason: worktree|branch} on GET /events"
  - "ReviewIsland.refresh(issueId) on the island mount API"
  - "Working-tree-vs-base live patch for tasks with a worktree"
affects: [packages/web, docs/architecture.md]
key-files:
  created:
    - packages/web/test/live.test.ts
  modified:
    - packages/web/src/server.ts
    - packages/web/src/review.ts
    - packages/web/src/client/review-island.tsx
    - packages/web/src/app.html
    - docs/src/content/docs/architecture.md
decisions:
  - "Debounce 250ms (worktree) / 150ms (refs); event name `review`; payload JSON {id, reason}"
  - "gitCommonDir resolved once per active root (cached), not every 5s sync pass; branch heads seeded only for newly tracked issues"
  - "Sync passes serialized through a promise chain so the 5s ticker and a repoint cannot open duplicate watchers"
requirements: [WEB-02]
metrics:
  tasks: 2
  completed: 2026-11-10
---

# Phase 05 Plan 01: Live web review over /events Summary

The web diff now updates live: a native watcher on each task's worktree and one on the repo's branch refs push `event: review` `{id, reason}` frames through the existing `GET /events` SSE stream, and the mounted review island re-fetches `/api/review/:id` + threads in place (no page reload, no client polling). The live patch is the worktree's working tree vs the pinned base, so uncommitted edits show.

**Commits withheld per AGENTS.md** (no git commit/push in this run; all changes are in the main working tree).

## Tasks

| Task | Name | Status | Files |
|------|------|--------|-------|
| 1 (tracer) | worktree edit → SSE `review` frame → island refetch of a working-tree patch | done | review.ts, server.ts, app.html, review-island.tsx, test/live.test.ts |
| 2 | branch-ref watch → `reason: "branch"`; docs | done | server.ts, test/live.test.ts, architecture.md |

### What changed
- `review.ts` `diffPatch`: live worktree uses `gitDiffPatch(worktree, base, null, {fullIndex})` (TUI review-source contract); branch-ref and frozen-snapshot fallbacks unchanged; doc comments updated.
- `server.ts`:
  - `/api/review/*` payload / file GET / file PUT use `active.root` (follow `POST /api/open` repoints).
  - `watchedWorktrees: Map<path, {watcher, ids}>`; ids refreshed every sync pass; debounced callback calls `broadcastReview(id, "worktree")`.
  - `broadcastReview(id, reason)` writes `event: review\ndata: <JSON.stringify({id, reason})>\n\n` (T-05-01).
  - Branch-ref watch: recursive `fs.watch` on `<commonDir>/refs/heads` + non-recursive on `<commonDir>` filtered to `packed-refs*`; on event (150ms debounce) re-reads `gitBranchHead` per tracked issue and emits `reason: "branch"` for changed heads. Torn down in `stopWatches` and rebuilt when the active root changes. git is never spawned on a timer for heads.
  - `broadcastReload()` kept for `open()` repoints and the dev shell ticker.
- `review-island.tsx`: module-level `activeRefresh` registered by `Island` in a `useEffect`; mount API is now `{ mount, unmount, refresh }`.
- `app.html`: `events.addEventListener("review", …)` parses JSON in try/catch and calls `window.ReviewIsland?.refresh?.(id)` only for a string id. `onmessage` reload handler untouched; `renderList` untouched.
- `architecture.md` Web Path: one "Live diff" paragraph documenting the frame, the island refetch, and the working-tree patch contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SSE waiter leak crashed the server on broadcast**
- **Found during:** Task 1 browser probe (server process died).
- **Issue:** The `/events` abort handler did `reloadWaiters.filter(w => w !== null)` — a no-op, so waiters were never removed. When a stream closed without the abort signal (Bun's default 10s idle timeout cut the SSE request), the next broadcast threw `TypeError: Invalid state: Controller is already closed` and took the process down. Latent before (broadcasts were rare); every worktree edit broadcasts now.
- **Fix:** each stream's waiter self-removes on abort, on stream `cancel`, and on any enqueue failure; `/events` calls `server.timeout(request, 0)` to disable the idle timeout for the long-lived stream.
- **Test:** `live.test.ts` "a closed /events client does not break later broadcasts" — fails against the pre-fix server with the exact TypeError, passes after.
- **Files:** packages/web/src/server.ts

**2. [Rule 1 - Bug] Refreshed diff rendered stale hunks**
- **Found during:** Task 1 browser probe (second edit refetched the payload but the diff body did not change).
- **Issue:** `parsePatchFiles(patch)` without a prefix leaves `cacheKey` unset; `FileDiff.render` then sets `cacheKey = file name`, so its highlight cache served the previous render for the same file.
- **Fix:** `parsePatchFiles(patch, "p" + fnv1a(patch))` — content-derived cache keys per patch.
- **Files:** packages/web/src/client/review-island.tsx

**3. [Rule 3 - Blocking] Grep gate shape**
- `broadcastReview` written as a function declaration (not an arrow const) so the plan's `grep -c 'broadcastReview('` gate counts definition + 2 call sites (= 3).

### Probe adjustments (not code deviations)
- The plan's Task 1 probe waits on `.dfl`, but a fresh worktree has an empty diff (no file rows until the first edit). Probe waited on `.dmenu`, then on `.dfl` after the edit.
- `@pierre/diffs` renders into a shadow root, so `.dbody.innerText` is empty; the probe reads `shadowRoot.textContent` of `.dbody` descendants instead.

## Verification

| Check | Result |
|-------|--------|
| `bun test --timeout 20000 packages/web/test/live.test.ts packages/web/test/server.test.ts packages/web/test/review.test.ts` | 19 pass, 0 fail |
| `cd packages/web && bunx tsc --noEmit -p tsconfig.json` | clean |
| `cd docs && bun run build` | Complete |
| Grep gate `broadcastReview(` (non-comment) | 3 |
| No `setInterval` around `/api/review` in the island | 0 matches |
| Mutation checks | reverting `active.root` → `options.root` fails the repoint test; reverting the patch to `"HEAD"` fails the uncommitted-edit test; pre-fix SSE code fails the closed-client test |
| Task 1 browser probe (session `gsd0501`) | edit 1 → `[marker=1, line rendered=true]`; edit 2 without clicking → `[1, true]` (no reload, in-place re-render) |
| Task 2 browser probe | after `git commit` in the worktree, `.dmenu` shows `1 commits`, `+2 −0`; marker still 1 |
| Probe server | stopped afterwards; browser session closed |

## Threat Model

- T-05-01 mitigated: frame data is `JSON.stringify({id, reason})`; client parses in try/catch and passes only a string id to `refresh` (never into HTML).
- T-05-02 mitigated: 250ms/150ms debounce; `node_modules`/`.git` filtered; heads re-read only on refs events or for newly tracked issues during a sync pass.

## Notes / Follow-ups

- `/api/rpc` still injects `root: options.root` (boot root) rather than `active.root` (server.ts, RPC block). Out of this plan's scope (plan only named the review block); worth a follow-up task.
- The live patch excludes untracked new files (`git diff` vs base does not list them) — same as the TUI contract.
- `counts`/`files` in the payload still come from `deriveChangeset` (committed `base...branch`), while `patch` is the working tree; the island's file list is driven by the patch.

## Self-Check: PASSED
- packages/web/test/live.test.ts exists; all modified files present; verification commands re-run green after the last edit.
