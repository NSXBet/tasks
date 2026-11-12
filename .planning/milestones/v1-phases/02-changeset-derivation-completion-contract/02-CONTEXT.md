# Phase 2: Changeset Derivation & Completion Contract - Context

**Gathered:** 2026-10-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 makes the PR record real. Three deliverables:

1. **CHG-01 — Lazy changeset derivation.** Commits and changed files derive live from the task's worktree branch vs the pinned base on every read — the agent supplies nothing, nothing is cached per-read. `tk show` lists both.
2. **CHG-02 — Terminal snapshot.** The changeset snapshot freezes into the record exactly once at close, and a closed task keeps rendering from the frozen snapshot with no worktree present.
3. **FIN-01 — Completion contract.** `tk finish <id> --session <sid>` records the session id and moves the task to `ready-to-review` — and only that status, enforced in code.

Out of scope: review component and comment storage (Phase 3), TUI review views (Phase 3–4), web surface (Phase 5), prune machinery (`tk close` auto-prune, `tk worktree clean`, merged-check, lifecycle hooks — Phase 6). Full patch text/hunks belong to Phase 3's review component.

</domain>

<decisions>
## Implementation Decisions

*Note: the area-selection prompt was skipped; the defaults below adopt the plan-literal / conservative option for every gray area. Each is recorded with its rationale — edit this file to override before planning.*

### Changeset derivation (CHG-01)
- **D-01:** Derivation uses the plan's two commands through `@tasks/git`: `git log --oneline <base>..<branch>` for commits, `git diff <base>...<branch>` (numstat) for changed files + line counts — live on every read, no caching. Base = `metadata["changeset"].base` pinned at `tk work` (Phase 1).
- **D-02:** Phase 2 derives a structured payload — `commits[{sha, subject}]`, `files[{path, status}]`, `counts{additions, deletions}`. Full patch text/hunks are deferred to Phase 3: the adapter gains a `gitDiffPatch` command then, keeping one derivation surface rather than two.
- **D-03:** Derivation reads are scoped by the plan ("whenever a read needs it, `tk show`, review, and web fetch it live"): `tk show` and `tk finish` derive; list/kanban/watch paths do not shell git per row.

### Terminal snapshot (CHG-02)
- **D-04:** The frozen snapshot is stored in `metadata["changeset"]` — plan step 7 literal ("frozen into `metadata[\"changeset\"]`"), zero storage migrations, same JsonValue pattern as the Phase 1 `changeset.base`. — **Reversibility:** costly — promoting to a typed Issue field later requires sqlite + postgres migrations and wire codec changes on every storage backend.
- **D-05:** The freeze fires inside the close path (idempotent exactly-once guard: skip when a snapshot is already frozen) rather than waiting for Phase 6's prune — this is the only way Phase 2's criterion 4 ("closed task renders from the frozen snapshot with no worktree present") is verifiable end-to-end before the prune exists. Phase 6's LC-02 then only removes directories.
- **D-06:** Frozen tuple is a self-sufficient superset of the plan's `{base, head, files}`: `{base, head, commits, files, counts}`. Rationale: criterion 4 demands commit + diff rendering from the snapshot alone; if the branch is ever deleted, a files-only snapshot would blank the record. Counts ride numstat already derived at freeze time. Metadata is additive — reversible.
- **D-07:** Until close, nothing is cached: finish prints live-derived counts and stores nothing beyond the existing pinned base.

### Completion contract (FIN-01)
- **D-08:** `tk finish <id> --session <sid>`; `TK_SESSION` env is accepted when the flag is omitted (plan step 6); neither present → refuse with a clear error.
- **D-09:** Finish transitions to exactly `ready-to-review` via the existing StatusTransitionPolicy; closed/done are unreachable from finish — policy denies, enforced in code.
- **D-10:** Finish with no branch/worktree record refuses (lifecycle error: no evidence to derive counts from — the branch is the evidence).
- **D-11:** Re-finish while already `ready-to-review` is an idempotent update: re-record session id, re-derive + re-print counts, no status change, never close/done.
- **D-12:** Readonly gate: `finish` joins the writers set in `tk.ts`, and the Phase 1 CR-01 advisory (`work` missing from the same set) is repaid here per the STATE.md debt note.

### Derivation surface
- **D-13:** New `@tasks/git` enumerated commands for log and numstat diff, porcelain 1:1 (one record per entry, no merging/dedup), empty/whitespace output → `[]` — the locked adapter invariants.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Contract & requirements
- `.agents/plans/2026-10-08-task-to-review.md` — the authoritative product contract; §product (show/finish shapes), §3 (derivation commands), §5 (finish contract), §6, §7 (freeze-into-metadata semantics)
- `.planning/REQUIREMENTS.md` — CHG-01, CHG-02, FIN-01 requirement texts
- `.planning/ROADMAP.md` — Phase 2 goal, success criteria (1–4), cross-cutting constraints (porcelain 1:1, empty → `[]`, resolver determinism)

### Project decisions
- `.planning/PROJECT.md` — validated scope, key decisions (branch-as-evidence, pinned base), known debt (CR-01 rides this phase)
- `.planning/PROJECT.md` §Key Decisions — "changeset base pinned at `tk work` creation" (Phase 1 ✓)

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md` — hexagonal layering, where derivation operations live
- `.planning/codebase/CONVENTIONS.md` — naming, test placement, build/check commands
- `.planning/codebase/STACK.md` — Bun workspace, test stack

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/git/src/runner.ts` + `commands.ts` — abortable runner and enumerated-command pattern; add log/numstat commands following the same shape
- `packages/git/src/porcelain.ts` — porcelain 1:1 parsing utilities with empty → `[]` invariant
- `metadata["changeset"].base` — pinned at `tk work` (Phase 1, on the wire already); the freeze writes siblings into the same object
- `StatusTransitionPolicy` (packages/domain) — finish's transition; closed/done denial likely a policy addition
- Surface operations layer (packages/application → surface) — new derivation/finish operations follow the existing operation-file pattern
- `packages/cli/src/presentation.ts` — `tk show` rendering gains commits/files/counts lines

### Established Patterns
- Domain purity: no I/O in `packages/domain`; surface owns git calls; CLI parses/serializes only
- Branded zod IDs; `fail()` coalescing for null narrowing; `exactOptionalPropertyTypes` strictness
- Tests colocated per package (`packages/*/test/*.test.ts`), `bun test` + `bun run check`

### Integration Points
- `packages/cli/src/tk.ts` — command registry, `--readonly` writers set (D-12)
- `packages/workspace/src/storage.ts` — metadata passthrough (JsonValue) — unchanged for this phase
- Watch daemon signature (counts + updatedAt) — deliberately untouched (D-03)

</code_context>

<specifics>
## Specific Ideas

- Finish output prints derived counts (`commits · +add −del · files`) per the plan's product mock.

</specifics>

<deferred>
## Deferred Ideas

- Hunks / full patch text derivation — Phase 3 (review component input; adapter gains `gitDiffPatch`)
- Auto-prune on close, `tk worktree clean`, `gitIsMergedToBase`, lifecycle hooks, pm install — Phase 6
- Live diff over `/events` SSE — Phase 5

</deferred>

---

*Phase: 2-Changeset Derivation & Completion Contract*
*Context gathered: 2026-10-18*
