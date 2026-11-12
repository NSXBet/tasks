# Roadmap: Tasks (tk)

## Overview

v1 delivers the **task → review** loop from `.agents/plans/2026-10-08-task-to-review.md` (plan steps 4–12): one PR-shaped record from `tk work` to reviewed, with the branch as the only evidence. The mock shells (plan steps 1–3) are validated baseline. The real layer is filled in behind those approved shells: first the PR container (typed git adapter + worktree entry), then the PR record (lazy changeset + completion contract), then the tk-owned review component and its storage swap, then the two review surfaces (terminal, web) wired over the derived diff, and finally worktree lifecycle safety plus workflow injection. Phase order honors the plan's build order — git adapter before changeset derivation; vendoring independent of the adapter chain but before the surfaces; lifecycle after the adapter; injection last because it documents finished commands.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Git Adapter & Worktree Entry** - Typed `packages/git` (hunk's way) + `resolveWorktreePath` (gw port) + `tk work <id>` with pinned base SHA (completed 2026-10-18)
- [x] **Phase 2: Changeset Derivation & Completion Contract** - Lazy commits/diff from the branch per read, terminal snapshot at close+prune, `tk finish --session` (completed 2026-11-10)
- [x] **Phase 3: Review Component & Review Storage** - Vendored hunk slice as `packages/review`; comments/edits persist to the task record with resolve state (completed 2026-11-10)
- [x] **Phase 4: Terminal Review** - Real TUI review: three views wired to the live component via `tk review <id>` (completed 2026-11-10)
- [x] **Phase 5: Web Review** - Same three views in `packages/web` on @pierre/diffs, live via SSE, editable via write endpoint (completed 2026-11-10)
- [x] **Phase 6: Worktree Lifecycle & Injection** - gw's safety/clean/hooks ported; ONBOARD/prime/SKILL/AGENTS.md teach the workflow contract (completed 2026-11-12)

## Phase Details

### Phase 1: Git Adapter & Worktree Entry

**Goal**: The PR container exists — every task can get a worktree on its own branch, and all git access flows through one typed adapter
**Mode**: mvp
**Depends on**: Nothing (first phase)
**Requirements**: GIT-01, GIT-02, GIT-03
**Success Criteria** (what must be TRUE):
  1. `tk work <id>` in a scratch repo creates a worktree on branch `tk/<id>` — visible in `git worktree list` — and records the pinned base SHA, worktree path, and branch on the task record (`tk show` renders the WORKTREE/branch lines)
  2. Worktree location follows the one resolver: default in-repo dir `<repoRoot>/.worktrees/<repoName>-<id>` (auto-ignored), `worktree.dir` workspace config, or per-task metadata override — and the same resolver serves `tk worktree create`
  3. Every git call goes through the typed adapter (one abortable runner, enumerated commands, porcelain parsing) — no scattered `git` subprocess calls; the inline `runWorktree` path logic is deleted, not wrapped

**Plans**: 4/4 plans complete (01-03, 01-04 gap closure, wave 1 parallel)

Plans:
- [x] 01-01: [Typed git adapter in packages/git]
- [x] 01-02: [resolveWorktreePath resolver + tk work command]
- [x] 01-03: [gap closure — worktree create uses main root, hook arg order, .worktrees/ auto-exclude, WR-01/02/04]
- [x] 01-04: [gap closure — one git runner: fold surface/git.ts + hooks.ts spawnSync into @tasks/git]

**Cross-cutting constraints:**
- Porcelain parsing maps 1:1 from porcelain output — exactly one typed record per porcelain entry; equal or adjacent entries are never merged, deduplicated, or dropped by the parser.
- Every porcelain parser returns an empty array for empty/whitespace-only porcelain output — never undefined, never null, never throws.
- Parsed collections preserve porcelain output order verbatim; the adapter adds no sorting — ordering is the caller's concern.
- The resolver performs no writes and holds no state — interrupted or concurrent calls always recompute the same deterministic path; worktree-creation races surface as git's own 'already exists' error at the caller, not in the resolver.

### Phase 2: Changeset Derivation & Completion Contract

**Goal**: The PR record exists — commits and diff derive live from the branch (the agent supplies nothing), and completion is `tk finish` into `ready-to-review` and nothing else
**Mode**: mvp
**Depends on**: Phase 1
**Requirements**: CHG-01, CHG-02, FIN-01
**Success Criteria** (what must be TRUE):
  1. Two commits inside the worktree → `tk show` lists both commits and the changed files, re-derived from the branch on every read — no agent-supplied lists, no per-read caching
  2. `tk finish <id> --session <sid>` records the session id, moves status to `ready-to-review`, and prints derived counts (commits · +− · files)
  3. `tk finish` cannot set closed or done — the completion contract is enforced in code, not docs
  4. At close+prune the changeset snapshot (`{base, head, files}`) freezes into the record exactly once, and a closed task keeps rendering commits and diff from the frozen snapshot with no worktree present

**Plans**: 2/2 plans complete

Plans:
**Wave 1**
- [x] 02-01: [Lazy changeset derivation vs pinned base]

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 02-02: [tk finish command + terminal snapshot freeze]

### Phase 3: Review Component & Review Storage

**Goal**: tk owns its diff component — the vendored hunk slice takes tk-derived input and writes review state straight to the task record
**Mode**: mvp
**Depends on**: Nothing (independent of Phases 1–2 — touches only a new package, per plan step 7; must land before Phase 4)
**Requirements**: REV-01, REV-02
**Success Criteria** (what must be TRUE):
  1. `packages/review` (changeset, review types, watch controller, @pierre/diffs dep, broker + comment store stripped) passes a headless smoke — opens a diff of any repo from node
  2. `hunk-vcs`/`hunk-git` fold into `packages/git` — one adapter, no second one — and the old `tk hunk` spawn path is deleted; the `pi-extention` workspace-dep fix rides this phase
  3. A reviewer comment on a line or file persists straight to the task record and shows in `tk show` with resolve counts
  4. Resolving a comment flips it to ✓ and an all-resolved thread shows "All resolved" in the header — stored on the record, not gestured

**Plans**: 5/5 plans complete (wave 1: 03-01..03-04 parallel; wave 2: 03-05). Vendored slice, comment store, statuses/counts already in the tree (2026-11-10); plans cover the remaining deltas. pi-extention workspace-dep fix already landed 2026-11-10 (recorded in 03-01).

Plans:
- [x] 03-01-PLAN.md — tracer: `gitDiffPatch` in @tasks/git → `@tasks/review/headless` → node smoke (no TTY); web/TUI diffs routed through @tasks/git; review git-free gate
- [x] 03-02-PLAN.md — delete `tk hunk` + packages/cli/src/hunk.ts, tests, and doc mentions (needs 01-04 landed for structure.md)
- [x] 03-03-PLAN.md — trim vendored VCS layer to provider-neutral types (drop jj/sl fixtures, parked bundled-adapter tests, prose)
- [x] 03-04-PLAN.md — one-time import of legacy hunk-synced comments into `metadata.reviewThreads` on first read (surface + review adapter)
- [x] 03-05-PLAN.md — `tk show` REVIEW section with per-comment ✓, resolve counts, "All resolved"; one D-09 counting rule across domain/CLI/TUI/web

### Phase 4: Terminal Review

**Goal**: The full review loop works in the terminal — the mock-proved three views go live over the tk-derived diff
**Mode**: mvp
**Depends on**: Phase 2 + Phase 3
**Requirements**: REV-03
**Success Criteria** (what must be TRUE):
  1. `tk review <id>` opens the vendored review TUI over the tk-derived diff without a manual branch link
  2. A commit from a second terminal re-renders the diff live — no restart, no refresh key
  3. An in-view edit persists to the worktree file and the diff re-renders around it
  4. Comments composed in the TUI land on the task record (same store `tk show` reads) and the mock shell's plumbing is deleted at this step

**UI hint**: yes
**Plans**: 5/5 plans complete (sequential: wave 1 → 04-01, wave 2 → 04-02, wave 3 → 04-03; they share App.tsx/diff.tsx). The UI contract is spec §3 (DIFF · FULL PAGE). `tk review` → `tk://diff/<id>` is already wired; the plans cover the remaining deltas. Gap closure (04-VERIFICATION gaps; user decision 2026-11-10 "Match the spec"): wave 1 → 04-04, wave 2 → 04-05.

Plans:
- [x] 04-01-PLAN.md — tracer: `@tasks/review/watch` entry → TUI `review/live.ts` watch on worktree + branch ref (debounced) → live, selection-preserving re-render; branchless empty state `no branch yet — run tk work <id>` (D-01, D-02)
- [x] 04-02-PLAN.md — `e` inline hunk edit buffer in the diff view → realpath-guarded, stale-checked worktree write → diff re-derives; comment edit moves to `E` (D-03)
- [x] 04-03-PLAN.md — TUI comment/resolve → task record → `tk show` round trip (thread-rail path filter fix); delete mock-shell plumbing; tmux probe `review-smoke.ts` (SC-1..SC-4); help + docs (D-04)
- [x] 04-04-PLAN.md — gap closure (gap 1a): hunk's own keys in the diff view — `]`/`[` hunk, `.`/`,` file, `1`/`2` layout, `g`/`G`, `R` reply, `q` quit; no `r` refresh; non-colliding tk aliases (`j`/`k`, `p`, `e`, `x`, `J`/`K`); ShellKeys yields `1`/`2`/`g`; keybar/help/docs/probe
- [x] 04-05-PLAN.md — gap closure (gap 2 + 1b): `watching worktree — re-derives as commits land ●` from the live watcher; `s`/`l`/`a`/`t`/`z` view toggles (`z` via `gitDiffPatch` contextLines); `/` file search; `v`/`y` hunk select + OSC 52 copy; full spec keybar, help, docs, probe

### Phase 5: Web Review

**Goal**: The same review surface in the browser — TUI and web are one review surface in two shapes, over the same task record
**Mode**: mvp
**Depends on**: Phase 2 + Phase 3 (shell from mock web — independent of Phase 4)
**Requirements**: WEB-01, WEB-02
**Success Criteria** (what must be TRUE):
  1. `/tasks/:id` renders the three views — task view (description, sessions, artifacts rail), artifact view (file/doc + comments), diff view with per-hunk/per-file comments — from the task record
  2. The web diff updates through the existing `/events` SSE stream when the worktree changes
  3. A web edit writes the worktree file and appears in the TUI's diff; a web comment lands in the task store and shows in the TUI

**UI hint**: yes
**Plans:** 4/4 plans complete

Plans:
- [x] 05-01-PLAN.md — tracer: worktree + branch-ref watchers push `event: review {id, reason}` over `/events`; island `refresh(id)`; live patch = worktree vs pinned base; review routes use active root (wave 1)
- [x] 05-02-PLAN.md — `/tasks/:id` lands on the task view (record, comments preview, SESSIONS + ARTIFACTS rail, `◧ open diff` primary); `/tasks/:id/diff` deep link + back; diff follows app theme (wave 2)
- [x] 05-03-PLAN.md — artifact view `/tasks/:id/file?path=`: full file via @pierre/diffs `File`, line + whole-file comments over the thread store (wave 3)
- [x] 05-04-PLAN.md — inline edit via @pierre/diffs `./edit` → `PUT /api/review/:id/file` (worktree-only), base blob via `@tasks/git` `gitShowFile`, file-level diff comments, SC3 e2e (wave 4)

### Phase 6: Worktree Lifecycle & Injection

**Goal**: tk replaces gw — worktree removal is merge-aware and cleanable with hooks — and the harness learns the workflow contract
**Mode**: mvp
**Depends on**: Phase 1 (lifecycle work is plan-parallel with Phases 2–5); executes last — INJ-01 documents finished commands
**Requirements**: LC-01, LC-02, LC-03, LC-04, INJ-01
**Success Criteria** (what must be TRUE):
  1. Closing a task whose branch is merged and clean prunes its worktree (close succeeds); an unmerged branch refuses the prune while the close still succeeds — `gitIsMergedToBase()` guards `tk worktree remove` and every prune path
  2. `tk worktree clean` (dry-run by default) lists every closed-task, merged, clean worktree; `--yes` removes them
  3. Configured `worktree.post_start`/`post_checkout`/`pre_end` hooks run at their lifecycle points, and `tk work`/`worktree create` post-start detects the package manager and installs deps (configurable off)
  4. Fresh clone → `tk onboard` → the workflow contract (work in `tk work`, finish with `tk finish --session`, never mark done, review with `tk review`) is present in AGENTS.md, `tk prime` context, and `skills/tasks/SKILL.md`

**Plans**: 3/3 plans complete

Plans:
- [x] 06-01-PLAN.md — (wave 1) gitIsMergedToBase as the single merge predicate (rebase-merged aware) guarding `tk worktree remove` + every prune path; close prints prune outcome; `tk worktree clean` single-pass, `--dry-run`/`--yes`, skips already-pruned, persists records
- [x] 06-02-PLAN.md — (wave 2) spec-named hook keys (`post_start`/`post_checkout`/`pre_end`) + `worktree.install`; lockfile precedence bun→pnpm→yarn→npm; post_start on new branch vs post_checkout on existing branch; `tk worktree create --branch <existing>`
- [x] 06-03-PLAN.md — (wave 3) injection contract test + template/PRIME/help/SKILL copies/root AGENTS.md block regenerated; `tk onboard` docs home

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6
(Plan-parallelizable: Phase 3 with Phases 1–2; Phase 6's lifecycle work after Phase 1 — but INJ-01 stays last.)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Git Adapter & Worktree Entry | 4/4 | Complete    | 2026-10-18 |
| 2. Changeset Derivation & Completion Contract | 2/2 | Complete    | 2026-11-10 |
| 3. Review Component & Review Storage | 5/5 | Complete    | 2026-11-10 |
| 4. Terminal Review | 5/5 | Complete    | 2026-11-10 |
| 5. Web Review | 4/4 | Complete    | 2026-11-10 |
| 6. Worktree Lifecycle & Injection | 3/3 | Complete    | 2026-11-12 |

### Phase 7: Review Record & Harness Registry

**Goal**: The record carries its own provenance and both review doors on every task surface — the agent line renders from a harness registry (data, not code)
**Mode**: mvp
**Depends on**: Phase 2
**Requirements**: REC-01, REC-02, REC-03
**Success Criteria** (what must be TRUE):
  1. `tk show` renders `agent <harness> · session <id> finished <time>` from a harness registry where omp is first and codex/cursor are entries; adding a harness is a data entry, not a patch
  2. Every task surface — `tk show`, `tk list`, TUI task view, web task modal and board cards — shows both doors: `tk review <id>` and `<web base>/tasks/<id>`
  3. `tk show` carries a comments row `comments N · M open K ✓` read from the task's review threads

**Plans:** 4/4 plans complete

Plans:
- [x] 07-01-PLAN.md — Harness auto-detect at `tk finish` from registry `env` (omp PI_SESSION_ID, codex CODEX_THREAD_ID, cursor CURSOR_CONVERSATION_ID/CURSOR_AGENT); fix stale DEFAULT_WEB_BASE (wave 1)
- [x] 07-02-PLAN.md — Surface `resolveWebBase` from the registered web runtime; TUI task view, list, kanban, detail pane carry doors (wave 1)
- [x] 07-03-PLAN.md — CLI list-family doors footer (query/children/search/blocked/stale/agent issues) via `resolveWebBase`; web list rows; docs (wave 2)
- [x] 07-04-PLAN.md — Verification e2e for spec verify items 1, 6, 7 + SC1-3 and full phase gate (wave 3)

### Phase 8: Comment Lifecycle & Agent Delivery

**Goal**: Review comments have a lifecycle and reach the agent only when sent — one store per task, each comment tagged with where it was made
**Mode**: mvp
**Depends on**: Phase 3
**Requirements**: CMT-01, CMT-02, CMT-03
**Success Criteria** (what must be TRUE):
  1. Every comment carries its location as data — file, line range, or `evidence:<id>` — in the task's single comment store
  2. Comment status is open | sent | resolved | dismissed with ✓ done / ✕ remove controls in TUI and web; each transition emits a `task.comment` event
  3. An explicit send batches open comments to the agent as cards `{file:line, author, body}` — never per-comment — from CLI (`tk comments send`), TUI and web
  4. Views render `N open · K ✓` and an `All resolved` header from stored state

**Plans:** 3/3 plans complete

Plans:
- [x] 08-01-PLAN.md — `tk comments <id>` list + send/resolve/dismiss/reopen (`--json`) over uow-level surface ops; docs + skill (wave 1, after 07-03)
- [x] 08-02-PLAN.md — `@tasks/review/lifecycle` shared rules; TUI diff view ✓ done (`x`) / ✕ remove (`D`) / send to agent (`S`), status badges, `COMMENTS · N open · K ✓` / All resolved header (wave 1, after 04-03 + 07-02)
- [x] 08-03-PLAN.md — web island ✓/✕/↺ controls, header + All resolved banner, `send to agent (N)` batch button with sent cards; view docs (wave 2, after 08-01 + 08-02 + 05-04 + 07-03)

### Phase 9: Task View Parity

**Goal**: The task view matches the spec in both shapes — work front and center, sessions in a tabbed rail, review starting where the work is
**Mode**: mvp
**Depends on**: Phase 4 + Phase 5 + Phase 8
**Requirements**: VIEW-01, VIEW-02, VIEW-03, VIEW-04
**Success Criteria** (what must be TRUE):
  1. Task view (TUI + web): description front and center, artifacts mapped to `tk evidence` as the main column, comments preview; never leads with a sessions table
  2. The side rail is tabbed sessions / changes / workspace / minimap — sessions lists agent runs, changes reads the worktree live, workspace shows the worktree contract, minimap previews the diff
  3. No start-work button on a ready-to-review task; open diff is the primary action; worktree chips stay visible on narrow views (path only)
  4. Clicking changes or a changed file opens the diff modal over the task view; the modal expands to the full diff view; evidence images render inside the diff flow and are commentable like lines
  5. Artifact view is a distinct commentable file view (docs render as docs, code as code, line or whole-file comments) — not the diff view

**Plans:** 11/11 plans complete (8 + 3 gap closure: 09-09, 09-10 wave 1 parallel, then 09-11) (wave 1: 09-01, 09-02 parallel; then two chains — TUI 09-03 → 09-04 → 09-05 and web 09-06 → 09-07 → 09-08 (09-08 also after 09-05 for shared docs)). Applies after 04-03, 05-04, 07-04, 08-03. UI contract: spec §2 VIEW 1–3 + §3 diff modal / full web view.

Plans:
- [x] 09-01-PLAN.md — `@tasks/review/taskview` shared pure model: patchFileStats, changesTree (review dots), minimapBars, artifactGroups (typed counts), docBlocks; decision IDs D-01..D-06 (wave 1, TDD)
- [x] 09-02-PLAN.md — data seams: `surface.taskSessions` (runs + finish record), `gitDirtyCount`, `@tasks/terminal-image` `inlineImageMode` (wave 1)
- [x] 09-03-PLAN.md — TUI task view: work-first center column (chips, ◧ open diff, ARTIFACTS, COMMENTS), tab-cycled SESSIONS/CHANGES/WORKSPC/MINIMAP rail, no start-work on ready-to-review, narrow worktree chip, tmux probe (wave 2)
- [x] 09-04-PLAN.md — TUI diff modal over the task view (c/C comments, f ⤢ full view), EvidenceImage via terminal-image with `evidence:<id>` row fallback, evidence entries in the diff flow (wave 3)
- [x] 09-05-PLAN.md — TUI artifact view: CODE / DOC / EVIDENCE modes with line, block-range and whole-file comments; help + docs + probe (wave 4)
- [x] 09-06-PLAN.md — web `/api/review/:id/taskview`, task view center column + tabbed rail (live CHANGES via SSE), palette without start on ready-to-review, narrow worktree chip (wave 2)
- [x] 09-07-PLAN.md — web diff modal over the task view (island `mode: "modal"`, ⤢ → `/tasks/:id/diff?file=`, esc), evidence `<img>` blocks in the diff flow commentable at `evidence:<id>` (wave 3)
- [x] 09-08-PLAN.md — web artifact view: DOC mode (sanitized `Bun.markdown.html` blocks, range comments), `?evidence=` view, ARTIFACTS entry points, docs + e2e agent-browser probe (wave 5)
- [x] 09-09-PLAN.md — gap closure: untracked (never git-added) files in the live changeset via `gitDiffPatch` working-tree form (`ls-files --others --exclude-standard` + `/dev/null` diffs, index untouched); TUI + web live tests; closes tasks-n5xi (wave 1)
- [x] 09-10-PLAN.md — gap closure: TUI task view left TASKS column (R34, working tasks, status dots, current highlighted) beside the VIEWS nav; click / `[` `]` switch the task view (wave 1)
- [x] 09-11-PLAN.md — gap closure: web TASKS column in `/tasks/:id` (click / `[` `]`), worktree chip + WORKSPC show `.worktrees/<repo>-<id>` with full path tooltip (`workspace.worktreeLabel`) (wave 2, after 09-09, 09-10)

### Phase 10: Event Wire & Watch Broker

**Goal**: One event stream drives TUI, web and agents — agents subscribe to tasks and pick up user messages automatically
**Mode**: mvp
**Depends on**: Phase 3 + Phase 8
**Requirements**: WIRE-01, WIRE-02, WIRE-03
**Success Criteria** (what must be TRUE):
  1. One append-only `events.jsonl` log is the wire (no daemon); `tk watch <id…>` reads it with per-subscriber cursors and `--until/--drain/--follow`, so many agents watch simultaneously via tool calling and CLI
  2. The same event stream drives live visualization and notifications in TUI and web
  3. Comments, approvals and sent review batches ride the stream and are picked up by the agent automatically

**Plans:** 6/6 plans complete

Plans:
- [x] 10-01-PLAN.md — (wave 1, after 05-04 + 08-03) write side: `.tasks/events.jsonl` with spec envelope `{seq, host, ts, task, type, actor, data}`; `withEventLog` adapter decorator on every opened store (surface + CLI) derives `task.created/status/owner/comment/update/evidence/worktree/deleted` + `run.changed` from before/after on commit; review cards carry location/author/body; lock-serialized gap-free seq
- [x] 10-02-PLAN.md — (wave 2) read side: `tailEvents` (fs.watch + poll), query grammar (`task= status= owner= type= actor= mine`), per-host cursors in `.tasks/cursors.json`; `runWatchLoop` rebuilt over the log (diffOnce removed, legacy kind aliases); daemon subscriptions ride it (no broker); VERBS_VERSION 5 (TS + Luau); rpc.md + architecture.md
- [x] 10-03-PLAN.md — (wave 3) `tk watch <id…> --until "<query>" [--timeout] | --drain | --follow` with `--as`/`--from`/`--peek`, status precheck, finish seeds `session:<sid>` cursor, NDJSON frame mode kept; HELP, overview.md, skills
- [x] 10-04-PLAN.md — (wave 3, after 09-08) web: `/events` SSE `event: task` frames tailed from the active workspace's log, `/api/events` reads the log (ring removed), repoint follows the new workspace; page refresh is event-driven (2s poll removed) with review toasts
- [x] 10-05-PLAN.md — (wave 3, after 09-05) TUI: `TuiStore.watch` tails the log (1s board poll removed), debounced repaint, `eventToast` notifications for ready-to-review / verdicts / comments
- [x] 10-06-PLAN.md — (wave 4) pi/omp: automatic inbox tailing the log for followed tasks (sent cards, approvals, comments → one followUp each, own-session filtered), session-start drain brief, `tasks_wait` tool over `waitUntil`, new kinds in `formatEvent`; integrations.md, testing.md, pi skill

### Phase 11: PR Sidecar & Chat Stat Card

**Goal**: A task has at most one PR, managed as a verb not a poller, and chat never carries a raw diff
**Mode**: mvp
**Depends on**: Phase 2 + Phase 10
**Requirements**: PR-01, PR-02, PR-03
**Success Criteria** (what must be TRUE):
  1. One PR per task — a 1-to-1 relation on the record with `tk pr create`, `tk pr sync`, `tk pr close` (and merge) through `gh`; gh is the remote truth, sync is explicit
  2. Chat/agent output carries a stat card (commits · +− · files) that links to the task's changes view; a diff is never printed into chat
  3. When the worktree is out of reach, changes fall back to task.commit / task.report stats as the cache

**Plans:** 5/5 plans complete

Plans:
- [x] 11-01-PLAN.md — (wave 1, after 06-03/07-03/08-01 + 10-01..10-06) stat card `N commits · +A −D · F files → <web>/tasks/<id>/diff · tk review <id>` on `tk finish`; finish stamps counts-only `metadata.report` (covered/silent in events derive.ts); `resolveChanges` ladder live → report (stale) → snapshot; `tk changes <id>`; `tk show` fallback
- [x] 11-02-PLAN.md — (wave 2) `gitPushBranch` in @tasks/git; gh wrapper `packages/surface/src/gh.ts` (`TK_GH`); `tk pr create` (push + idempotent refresh/adopt/create → `metadata.pr = {number, url, state}`), `tk pr sync` (single explicit gh call), `tk pr <id>` local mirror; fake gh on PATH in tests
- [x] 11-03-PLAN.md — (wave 3) `tk pr close` / `tk pr merge [--merge|--squash|--rebase]` (branch + worktree kept); handoff card shows the PR line or `next: tk pr create <id>`; docs (overview, integrations, architecture, testing)
- [x] 11-04-PLAN.md — (wave 4) `task.pr` + `task.report` derived in `packages/surface/src/events/derive.ts` (`pr`/`report` covered metadata) on the events.jsonl wire; pi `formatEvent` stat/PR cards, inbox delivers `task.pr` + card on PR/verdict messages; `TasksSurface.changes` + `tasks` op `changes`; rpc.md + VERBS 5 → 6 (TS + Luau)
- [x] 11-05-PLAN.md — (wave 4) WORKSPC rail `commit` / `open pr` buttons (deferred from Phase 9) in web app.html and TUI task.tsx: `commit` = guarded `git commit --all` in the task worktree via `gitCommitTracked` (message prompt, never push, report restamp); `open pr` = `prCreate` (tk pr create); `POST /api/review/:id/commit|pr`; `workspace.pr` row
