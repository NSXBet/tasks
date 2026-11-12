---
phase: 08-comment-lifecycle-agent-delivery
plan: 03
subsystem: web, docs
tags: [comment-lifecycle, web, review-island, send-to-agent]
requires: [08-01, 08-02, 05-04, 07-03]
provides:
  - "Web comment cards (diff + artifact views): stored status pill + ✓ done / ✕ remove / ↺ reopen from commentControls, POSTing /threads/:tid/status"
  - "ReviewHeader: `COMMENTS · N open · K ✓` or `All resolved` banner from the /threads list response, plus `send to agent (N)`"
  - "SentPanel: `sent to agent · n` cards `location · author · body`, clearable"
  - "displayBody(): stored `[review <loc>]` / `[review reply]` prefixes stripped from displayed bodies (tasks-lsna)"
key-files:
  modified:
    - packages/web/src/client/review-island.tsx
    - packages/web/src/app.html
    - packages/web/test/server.test.ts
    - docs/src/content/docs/overview.md
    - docs/src/content/docs/architecture.md
requirements-completed: [CMT-02, CMT-03]
metrics:
  tasks: 3
  completed: 2026-11-10
---

# Phase 08 Plan 03: Web comment lifecycle and send to agent — Summary

The web review island now runs the same comment loop as the TUI and CLI, on the same task record:

- Every card in the diff view and the artifact view shows a status pill: `open`, `→ sent`, `✓ resolved` or `✕ dismissed`.
- Every card has the lifecycle buttons: `✓ done` and `✕ remove` on open or sent comments, `↺ reopen` on resolved or dismissed ones.
- Both views have a `COMMENTS · N open · K ✓` / `All resolved` header and one `send to agent (N)` batch button that shows the cards it sent.

All rules come from `@tasks/review/lifecycle`. The old `/resolve` toggle is gone from the island.

## What was built

- **review-island.tsx**
  - Runtime import of `commentControls`, `commentStatusBadge`, `reviewHeaderLabel` and `sendableCount` from `@tasks/review/lifecycle`. The import from `@tasks/review` stays `import type`.
  - New helpers:
    - `threadStatus`: stored status, falling back to `resolved` for older records.
    - `pillClass`: open→`open`, sent→`sent`, resolved→`res`, dismissed→`dis`.
    - `controlTitle`: `mark done` / `remove (dismiss)` / `reopen`.
    - `displayBody`: the tasks-lsna fix, below.
  - `ThreadCard`:
    - The pill comes from `commentStatusBadge`.
    - There is one `.rvi-ctrl` button per `commentControls(status)` entry. Each posts `/threads/:tid/status { status: control.to }` through the existing `run` wrapper, then calls `reload()`. Errors go to `fail`.
    - The card gets class `res` when resolved or dismissed, plus `dis` when dismissed.
  - `Island` and `ArtifactView` now keep the whole `ReviewThreadList` in state (`list`); `threads` is derived from it with `useMemo`.
  - `useSendToAgent` hook:
    - POSTs `/comments/send {}` and keeps the returned `sent` cards. A ref guard plus the `sending` state allow only one request in flight.
    - An empty batch reports `onError?.("nothing open to send")`, which app.html routes to its toast. A failure reports `send failed: …`.
    - It always reloads afterwards.
  - `ReviewHeader` shows `#reviewHeader`: either `COMMENTS · {reviewHeaderLabel(list)}` or the `All resolved` banner. It also shows `#reviewSend` = `send to agent ({sendableCount})`, disabled when the count is 0 or a send is in flight, with the title from the plan.
    - Diff view: rendered in `.dmenu`.
    - Artifact view: rendered in the comments panel under its `Comments · n` heading.
  - `SentPanel` (`#reviewSent`): `sent to agent · n`, one row per card, and an `×` that clears the panel. Everything renders as React text nodes, with no `dangerouslySetInnerHTML` (grep count 0).
    - Diff view: between `.dmenu` and `.dmain`.
    - Artifact view: in the panel.
- **app.html** (island CSS block):
  - `.pill.sent`, `.pill.dis` (line-through).
  - `.rvi-head.cmt`, `.rvi-banner` (green, bordered, rounded).
  - `.rvi-hwrap`, `.rvi-ctrls`, `.rvi-ctrl`, `.rvi-thread.dis`.
  - `.rvi-send` (matches `.vbtn` sizing on panel colours).
  - `.rvi-sent*`, `.apanel-head`, and a flush `.dwrap > .rvi-sent`.
- **server.test.ts**
  - Bundle test:
    - The bundle contains `✕ remove`, `✓ done`, `↺ reopen`, `/status`, `All resolved`, `send to agent` and `/comments/send`.
    - It does not contain `/resolve`, `openStorage` or `withinTransaction`.
  - Lifecycle test, extended with the island's own calls:
    - sent → `dismissed` gives `counts.dismissed 1`, `allResolved true` and label `0 open · 1 ✓`.
    - Then → `open` gives `allResolved false`.
  - New test for the batched send:
    - Two threads; the first send returns 2 cards.
    - The list then shows both `sent`, with label `2 open · 0 ✓`.
    - A second send returns 0 cards.
    - `POST /api/rpc issue.show` shows exactly one comment starting `[review sent] 2 comments`.
- **Docs**
  - overview.md `### Review` gets a paragraph after the `tk comments` paragraph. It covers the TUI `x`/`D`/`S` keys, the web pills and buttons, the header, `send to agent (N)` with its sent cards, and the prefix stripping, and notes that sent comments still count as open and that pickup comes with the watch broker.
  - architecture.md: the review-comments paragraph names `@tasks/surface` `review-comments.ts` (transitions, batched send, log → `task.comment`) and `@tasks/review/lifecycle` (type-only, shared by the TUI and the web bundle), and lists the island's routes.

## tasks-lsna (orchestrator add-on, display only)

`displayBody` uses the same regex as the TUI's `diff.tsx` (`/^\[review [^\]]*\]\s*/`). It strips the stored `[review <loc>] ` / `[review reply] ` prefix in three places:

- comment bodies on every card, in both views;
- the text loaded into the edit box;
- the sent-panel rows.

Stored text is unchanged. Loading the stripped text into the edit box also fixes a latent bug: `editThreadComment` re-applies the prefix on save, so editing used to store it twice. A note is on tasks-lsna. The task is left open for review and has not been closed.

## Verification

| command | result |
|---|---|
| `bun test --timeout 20000 packages/web/test/server.test.ts` | 16 pass / 0 fail |
| `bun test --timeout 20000 packages/web/test` | 23 pass / 0 fail (4 files) |
| `cd packages/web && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `test "$(grep -c dangerouslySetInnerHTML …/review-island.tsx)" = 0` | ok |
| `grep -n "send to agent" overview.md` / `grep -n "@tasks/review/lifecycle" architecture.md` | hits |
| `cd docs && bun run build` | Complete |
| Minified bundle probe (`Bun.build … minify`) | `/resolve` count 0; `/status` present; no `openStorage` |

**Browser probe** (`AGENT_BROWSER_SESSION=gsd0803`): a scratch repo with a `tk work` worktree, an edited `a.txt`, and `tk web --port 59165` (free port), seeded with one line comment and one file comment.

- **Diff view, on load:** header `COMMENTS · 2 open · 0 ✓`, button `send to agent (2)`, pills `open, open`, and controls `✓ done ✕ remove` ×2. Bodies show `rename this`, not `[review a.txt:2] rename this`.
- **send:** the panel reads `SENT TO AGENT · 2` with `a.txt:2 · yuri · rename this` and `a.txt · yuri · whole file note`. Both pills are `→ sent`, the button is `send to agent (0)` and disabled, and the header still reads `2 open · 0 ✓`.
- **✕ remove + ✓ done:** pills `✕ dismissed`, `✓ resolved`; header switches to the `All resolved` banner (`.rvi-banner`); controls are `↺ reopen` ×2. `tk comments tk-yw8` prints `REVIEW (2) · All resolved` with `✓` and `–` rows.
- **↺ reopen:** header `1 open · 1 ✓`, button `send to agent (1)`.
- **Artifact view `/tasks/tk-yw8/file?path=a.txt`:** same header and controls in the comments panel. Send → `SENT TO AGENT · 1` and the button is disabled.
- **Record:** two `[review sent]` summaries (`2 comments`, `1 comment`), one per send.
- **Cleanup:** I killed the real bun daemon (pid 22034); the server is down, the pid is gone, and the browser is closed. Screenshots: `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/sent.png`, `…/artifact-sent.png`. The scratch repo `…/scratchpad/probe0803` is still there because its removal was denied by the permission prompt; it is in the session scratchpad only.

## Deviations from Plan

- **`.rvi-head` collision.** `.rvi-head` already exists as a flex container in the island's empty states. The header label therefore uses `className="rvi-head cmt"`, styled by `.rvi-head.cmt`, so the old rule is not restyled. The plan's `.rvi-head` selector is still the base class.
- **Extra elements.** The header, button and panel got ids (`#reviewHeader`, `#reviewSend`, `#reviewSent`) for probes, plus a `.rvi-hwrap` wrapper. The bundle test also asserts `↺ reopen` and the absence of `/resolve`.
- **Artifact view keeps its file-scoped chip.** The `#fileCounts` chip in its menu is unchanged. The task-wide `ReviewHeader` sits in the comments panel as the plan says, so the panel shows both `COMMENTS · n` (this file) and `COMMENTS · N open · K ✓` (whole task). This is a cosmetic duplication you may want to fold later.
- **Line-comment cards are narrow.** With the controls on the row, the `new · line N` location text gets ellipsized in the narrow artifact panel and on the right side of the split diff. The text is still there; a later polish could wrap the row.
- **tasks-lsna** was folded in as the orchestrator directed. It is display only.

## Notes

- **Commits withheld per AGENTS.md** (conservative profile). The work was done in the main tree; STATE.md and ROADMAP.md were not touched.
- **Threats:**
  - T-08-08: the island sends only `commentControls().to` values.
  - T-08-09: one send at a time (ref plus disabled button), and nothing is sent when no comment is open.
  - T-08-10: text nodes only.
  - T-08-11: the bundle test proves no storage code reaches the browser.

## Self-Check: PASSED
