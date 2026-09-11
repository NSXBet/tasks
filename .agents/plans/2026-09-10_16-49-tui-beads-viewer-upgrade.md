# tk-tui → beads_viewer-class upgrade

Evolve `packages/tui` from the current functional split-view into a polished, multi-view tracker TUI modeled on [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) (main split, kanban `b`, graph `g`, insights `i`), prettier than the original, with full issue **editing** and a first-class **kanban** view. Plan only — no code in this pass.

## Context

**What exists today** (`packages/tui/`):
- `src/store.ts` — `loadBoard()` over `@tasks/surface`, `watch()` polling, `applyFilter`, `isBlocked`, counts. Board = issues + currentId + counts + fetchedAt.
- `src/format.ts` — Tokyo-Night palette (`colors`), `statusColor`, `priorityLabel/Color`, `toListRow`, truncate/pad helpers.
- `src/app/App.tsx` — state + actions (`setStatus`, `claim`, `create`, `comment`), context, AppProvider.
- `src/app/components.tsx` — `IssueList` (tab-select + select), `IssueDetail` (scrollbox, s/r/d/c keys), `Composer` (single-line input, create/comment), `StatusBar` (counts + toast).
- `src/main.tsx` — entry, alternate screen, mouse on, Ctrl+Q quit.
- Tests: `test/app.test.tsx` (OpenTUI test-utils, 2 passing), `test/smoke.ts` (tmux-driven E2E, 5 checks green).

**Backend capabilities already available (no new storage work needed):**
- `surface.update(id, UpdatePatch)` — title, description, priority, type, assignee, owner, notes, status, labels-adjacent fields, attachments.
- `depAdd/depRemove` (blocks/related/parent-child), `comments.add`, `create`, `claim`, status transitions.
- `Issue` carries `dependencies[]` (typed edges), `dependencyCount/dependentCount`, `comments`, `labels`, `assignee`, `priority`, `estimate`, `dueAt`, `parentId`.

**What beads_viewer gets right (from screenshot + README analysis) — our design targets:**
1. Semantic color discipline: green/cyan/dim = lifecycle; pink/khaki = interactive highlights; everything else in one family.
2. Depth via dimming, not chrome: closed/done rows whole-row dimmed; no heavy boxes around panes.
3. Strict column alignment with right-aligned relative ages; truncation with `…` that never breaks columns.
4. Selection ↔ detail always in sync.
5. Lightweight rules: one thin vertical divider, header underline, blockquote bar on comments, outlined chips only for interactive/filter elements.
6. Emoji + count column headers; rounded borders on cards; empty states are clean bordered voids, never placeholder text.
7. Statusbar = left chips/counters, right key hints with `│` separators.
8. Blocked/actionable conveyed by glyph (⚡ ready, ⛔/🔷 blocked) on both list rows and kanban cards.

## Design language (applies to every view)

- **Palette:** keep Tokyo Night base (already cohesive with the repo's other tooling) but add bv-style accents: violet `#bb9af7` for header bands/selection borders, pink `#f7768e` reserved for destructive/labels chips, khaki `#e0af68` for version/filter chips. Closed/dimmed rows use a single `dim` treatment across all cells.
- **Chrome:** no pane borders on the main split (thin vertical rule only); rounded borders only on kanban cards/columns and graph nodes; chips = 1-cell padding + thin border + no fill.
- **Type discipline:** fixed-width columns for id/status/priority; relative ages (`2h ago`) right-aligned; bold reserved for issue IDs and section headers; italics for timestamps inside cards.
- **Glyphs:** `⚡` ready (unblocked open), `⛔` blocked (open with unclosed blockers), `▶` wip, `👀` ready-to-review, `✓` closed, `🅟` P0/P1 marker colored red/yellow. One legend row on first launch of each view (dismissable, `?` toggles help overlay).
- **Statusbar:** left = view chips with active highlight (`1 list │ 2 board │ 3 graph │ 4 insights`), counts; right = contextual key hints for the focused pane + toast slot.

## Steps

### Phase 1 — Shell, design system, polish of existing views

1. **`src/theme.ts` (new, replaces raw `colors` in `format.ts`):** extended token set — `band` (violet header), `chip`, `rule`, `selection`, per-status fg, glyph map, `age()` relative-time formatter, `chip()`/`row()` text builders shared by all views so snapshots stay deterministic.
2. **App shell (`App.tsx`, `main.tsx`):** view state (`list | board | graph | insights`), global keymap (`1/2/3/4` + bv-style `l/b/g/i`), `?` help overlay listing all keys per view; statusbar rebuilt to the chip layout above.
3. **List polish (`components.tsx` → split into `app/list.tsx`):** row format `⚡ P2 OPEN tk-abc12 Fix store race ······ 2h ago` — glyph column, padded priority chip, status color, bold id, dim title truncation, right-aligned age; closed rows fully dimmed; `mine` filter shows assignee column.
4. **Detail polish (`app/detail.tsx`):** metadata table with thin column separators + header underline (ID │ status │ priority │ assignee │ age); markdown-lite renderer for description/comments/notes (bold, `##`/`###` headers, `-` lists, inline code, blockquote bar for comments) — verify whether `@opentui/core` ships a markdown element before hand-rolling; dependency tree in-pane (down to depth 3, `(cycle)` markers, colored status dots) using `depList` semantics computed from the already-loaded board.
5. **Watch → refresh correctness:** kanban/graph views derive everything from `Board`; keep the existing watch/poll refresh as the single data path.

**Verify:** renderer tests for row/detail rendering (extend `test/app.test.tsx`); typecheck; tmux smoke still green.

### Phase 2 — Kanban view (`app/kanban.tsx`) ⭐ centerpiece

6. **Columns:** one per lifecycle stage — `📋 Open · 🚀 In Progress · 👀 Review · ✅ Closed` (deferred/rejected folded into a `🅿 Parked` column only when non-empty). Column header = full-width band, emoji + name + count, active-column band in violet. Columns separated by background gutters; each column is a scrollbox with rounded border and hidden-until-needed scrollbar; empty column renders as a clean bordered void.
7. **Cards (3 lines, rounded border):**
   - L1: type emoji + status glyph (⚡/⛔/▶/👀/✓) + bold id.
   - L2: title, hard-truncated with `…`.
   - L3 (italic, dim): relative age + up to 2 label chips (`+N` overflow) + `⛔ n` blocked counter.
   - Selected card: bright violet border + full-line pill on L1.
8. **Navigation & movement:** `h/l` or arrows switch columns, `j/k` move within column, `Enter` opens detail, `Tab` cycles focus (list pane ↔ kanban). Status moves reuse existing action keys in-place: `s` → In Progress, `r` → Review, `d` → Done (closed), `o` → Open (reopen), each with toast + optimistic board update through the existing refresh path.
9. **Blocked visualization:** ⛔ glyph + red left-edge accent bar on blocked cards; column header shows `n ⛔` badge; `x` on a blocked card jumps to its top blocker.
10. **Mouse:** click card = select, double-click/Enter = open, wheel scrolls column, click header focuses column.
11. **WIP guard (optional flag):`--wip N` highlights the In-Progress header when count > N.

**Verify:** renderer tests — seeded board renders 4 columns, counts, card anatomy, selection movement, `s/r/d` moves statuses (assert via `waitForFrame`); tmux smoke extended: launch → `2` → columns visible → move a card → assert status change persists via real `tk list` in the throwaway workspace.

### Phase 3 — Editing (make it a manager, not just a viewer)

12. **Composer v2 (`app/composer.tsx`):** one component, modes: `create` (existing), `comment` (existing), `title` (`e`), `description` (`E`, multi-line textarea), `assignee` (`@`), `labels` (`,` — add/remove, rendered as chips), `dep-add` (`D` — fuzzy pick target, type blocks/related), `dep-remove` (`X` — pick from existing edges), `priority` (`+`/`-` direct, no dialog). All submit through `surface.update` / `depAdd` / `depRemove`; failures land in the existing toast/error path; every successful edit triggers the standard refresh (watch picks up CLI-side changes too).
13. **Confirm-before-write:** destructive edits (dep-remove, close) ask `y/n` inline in the composer line; everything else applies immediately.
14. **Edit affordances visible:** detail pane footer gains mode hints (`e edit · E desc · @ assignee · , labels · D dep+ · X dep−`); kanban cards accept `e` on selection too.

**Verify:** renderer test driving an edit end-to-end (change title → frame shows new title); tmux smoke: `e` → type → Enter → assert new title via real `tk show` in the throwaway workspace; dep add/remove asserted via `tk list`/file state.

### Phase 4 — Graph view (`app/graph.tsx`)

15. **Dependency tree centered on selection:** up section (`▲ BLOCKED BY`) above, down section (`▼ BLOCKS`) below, box-drawing connectors (`├─`/`└─` with `│` stems), depth 3 (matching bv), each node = rounded box with status dot + id + truncated title; selected node enlarged with violet border; `(cycle)` marker on back-edges; dedupe repeated subtrees with `(reference: shown elsewhere)` like bv.
16. **Navigation:** `j/k` walk visible nodes (tree order), `Enter` re-centers graph on that node, `Escape` back to previous view; metrics footer strip for the centered node: `deps n · dependents n · chain n` (chain = longest downstream path, computed in TS on the board — no new deps).

**Verify:** renderer test with a seeded A→B→C chain asserts connector glyphs + banner text; unit test the chain/cycle helpers in `store.ts` (pure functions, no renderer needed).

### Phase 5 — Insights view (`app/insights.tsx`)

17. **Pragmatic metric subset (computed in `store.ts` from `Board`, pure TS):** ready count, blocked count, **critical chain** (longest dependency path via DFS — bv's keystones), **bottlenecks** (top-N by dependentCount among non-closed), **cycles** (Tarjan SCC), density. PageRank/betweenness/HITS are explicitly out of scope (no WASM port) unless later wanted.
18. **Layout:** 2×2 panel grid mirroring bv — `⚡ Ready now` (top picks by priority then age), `⛔ Blocked` (with unblock-gain: how many tasks each blocker frees), `🔗 Critical chain`, `🚨 Cycles / health` (cycles list or `✓ DAG` empty state, density, counts). Rows: score/glyph + bold id + dim truncated title; `Enter` opens detail. All panels keyboard-walkable.

**Verify:** unit tests for chain/cycle/bottleneck helpers on fixture graphs (blocker diamond, cycle, linear chain); renderer test asserts panels render counts from a seeded board.

### Phase 6 — Verification sweep & screenshots

19. **Smoke suite (`test/smoke.ts`) extended to a per-view pass:** list → kanban (move) → detail (edit roundtrip) → graph → insights → quit; each view asserted on `tmux capture-pane` text.
20. **Screenshot harness:** script driving tmux captures of each view against a seeded demo workspace (10–15 issues with deps) → PNG via `tmux` + terminal capture for README/docs parity with beads_viewer's screenshots dir.
21. **Full gate:** `bun run check` (tsc), renderer tests, smoke, plus a fat-workspace sanity run (import real repo `.tasks` read-only) to confirm watch/refresh on a real board.

## Verification

- Every phase: `bun x tsc --noEmit -p packages/tui` + renderer tests green before moving on.
- Behavior proof is the tmux smoke (real binary, real pty, real storage) — new checks per view, no test doubles.
- Visual proof: per-view captures reviewed after Phase 2, 4, 5 (the three new/changed surfaces).
- Regression guard: existing 2 renderer tests + 5 smoke checks keep passing (row format changes update the assertions deliberately, not silently).

## Out of scope

- Robot/agent JSON mode (`--robot-*`), TOON output, hooks system, markdown export, git-history correlation view (`h`), time-travel diff (`t`), WASM graph algorithms (PageRank/betweenness/HITS), WASM anything.
- Postgres-backend workspaces (TUI targets the file/sqlite local flow it already opens).
- Any change to `@tasks/*` packages — TUI consumes the existing surface API only; if an op is missing, the plan notes it, it doesn't add it (none appear to be missing).
