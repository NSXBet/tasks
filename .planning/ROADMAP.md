# Roadmap: Tasks (tk)

## Overview

v1 delivers the **task → review** loop from `.agents/plans/2026-10-08-task-to-review.md` (plan steps 4–12): one PR-shaped record from `tk work` to reviewed, with the branch as the only evidence. The mock shells (plan steps 1–3) are validated baseline. The real layer is filled in behind those approved shells: first the PR container (typed git adapter + worktree entry), then the PR record (lazy changeset + completion contract), then the tk-owned review component and its storage swap, then the two review surfaces (terminal, web) wired over the derived diff, and finally worktree lifecycle safety plus workflow injection. Phase order honors the plan's build order — git adapter before changeset derivation; vendoring independent of the adapter chain but before the surfaces; lifecycle after the adapter; injection last because it documents finished commands.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Git Adapter & Worktree Entry** - Typed `packages/git` (hunk's way) + `resolveWorktreePath` (gw port) + `tk work <id>` with pinned base SHA (completed 2026-10-18)
- [ ] **Phase 2: Changeset Derivation & Completion Contract** - Lazy commits/diff from the branch per read, terminal snapshot at close+prune, `tk finish --session`
- [ ] **Phase 3: Review Component & Review Storage** - Vendored hunk slice as `packages/review`; comments/edits persist to the task record with resolve state
- [ ] **Phase 4: Terminal Review** - Real TUI review: three views wired to the live component via `tk review <id>`
- [ ] **Phase 5: Web Review** - Same three views in `packages/web` on @pierre/diffs, live via SSE, editable via write endpoint
- [ ] **Phase 6: Worktree Lifecycle & Injection** - gw's safety/clean/hooks ported; ONBOARD/prime/SKILL/AGENTS.md teach the workflow contract

## Phase Details

### Phase 1: Git Adapter & Worktree Entry

**Goal**: The PR container exists — every task can get a worktree on its own branch, and all git access flows through one typed adapter
**Mode**: mvp
**Depends on**: Nothing (first phase)
**Requirements**: GIT-01, GIT-02, GIT-03
**Success Criteria** (what must be TRUE):
  1. `tk work <id>` in a scratch repo creates a worktree on branch `tk/<id>` — visible in `git worktree list` — and records the pinned base SHA, worktree path, and branch on the task record (`tk show` renders the WORKTREE/branch lines)
  2. Worktree location follows the one resolver: default sibling dir `<repoRoot>/../<repoName>-<id>`, `worktree.dir` workspace config, or per-task metadata override — and the same resolver serves `tk worktree create`
  3. Every git call goes through the typed adapter (one abortable runner, enumerated commands, porcelain parsing) — no scattered `git` subprocess calls; the inline `runWorktree` path logic is deleted, not wrapped

**Plans**: TBD

Plans:
- [x] 01-01: [Typed git adapter in packages/git]
- [x] 01-02: [resolveWorktreePath resolver + tk work command]

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

**Plans**: 2 plans

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

**Plans**: TBD

Plans:
- [ ] 03-01: [Vendor hunk slice into packages/review; fold vcs/git into packages/git]
- [ ] 03-02: [Review storage swap onto the task record with resolve state]

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
**Plans**: TBD

Plans:
- [ ] 04-01: [Wire three TUI views to the live review component; tk review entry point]

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
**Plans**: TBD

Plans:
- [ ] 05-01: [Web routes + @pierre/diffs ./react ./edit views]
- [ ] 05-02: [SSE live diff + edit write-endpoint]

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

**Plans**: TBD

Plans:
- [ ] 06-01: [gitIsMergedToBase safety + auto-prune in tk close + tk worktree clean]
- [ ] 06-02: [Lifecycle hooks + pm setup on start]
- [ ] 06-03: [Injection: ONBOARD, prime, SKILL.md, root AGENTS.md]

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6
(Plan-parallelizable: Phase 3 with Phases 1–2; Phase 6's lifecycle work after Phase 1 — but INJ-01 stays last.)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Git Adapter & Worktree Entry | 2/2 | Complete    | 2026-10-18 |
| 2. Changeset Derivation & Completion Contract | 1/2 | In Progress|  |
| 3. Review Component & Review Storage | 0/TBD | Not started | - |
| 4. Terminal Review | 0/TBD | Not started | - |
| 5. Web Review | 0/TBD | Not started | - |
| 6. Worktree Lifecycle & Injection | 0/TBD | Not started | - |
