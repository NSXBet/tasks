---
phase: 2
reviewed_at: 2026-10-18
diff_base: 7b02463419d761822141438436a0c3a10cde65b1
status: issues_found
files_reviewed: 19
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
---

# Phase 2 Code Review — Changeset Derivation & Completion Contract

Reviewed the phase diff (`7b02463..HEAD`) across `@tasks/git` (commands, porcelain parsers), `@tasks/surface` (changeset derivation + freeze, finish operation, mutate close paths), and `@tasks/cli` (finish command, show rendering, freeze wiring, writers gate). `bun.lock` and `packages/surface/package.json` checked: only the expected `@tasks/git` workspace dependency and build-chain ordering — no findings there.

The core contract work is solid: the freeze is correctly exactly-once (`readChangesetSnapshot` guard), never saves on its own (callers merge into the single save), refuses non-closed targets, and the head is always git's own `rev-parse` output (D-05/D-13). `finishPolicy` makes closed/done unreachable from finish by construction (D-09), and the D-11 idempotent re-finish path correctly leaves status/timestamps untouched. Parsers are pure, 1:1, and empty→`[]`. Git args are passed as arrays (no shell interpolation) — no injection surface.

## Warnings

### WR-1: Close-shaped saves bypass the exactly-once freeze — `markDuplicate`, `markSuperseded` (CLI + surface), `todoDone`

- **File:** `packages/cli/src/tk.ts:490-491,495`; `packages/surface/src/operations/mutate.ts:224-231`
- **Evidence:** Four additional write paths set `status: "closed"` directly and save without calling `freezeChangesetUow`:
  - `CommandService.markDuplicate` / `markSuperseded` (`tk.ts:490-491`) — close any issue, including branched feature issues.
  - `CommandService.todoDone` (`tk.ts:495`) — despite the comment "branch-less todo items derive null — nothing to freeze", it closes **any** `type === "task"` issue; `tk work` is not restricted to non-task types, so a task with a work record would close unfrozen.
  - Surface `markSuperseded` (`mutate.ts:224-231`) — same shape.
- **Impact:** The 02-02 summary claims "every close path (CLI mutate, `changeStatus`, `closeMany`) freezes … exactly once", but these paths produce closed records with no snapshot. A closed-but-unfrozen branched issue then falls back to **live** derivation on `tk show` (`tk.ts:1114-1115`: `frozen` is null, so `deriveChangeset` runs) — and once the branch/worktree decays, the closed record renders with no COMMITS/FILES, which is precisely the decay CHG-02 exists to prevent. Note the planner's decision-point resolution only enumerated CLI `mutate`/`changeStatus`/`closeMany`, so this is a scope-resolution gap, not a plan deviation — but the summary overclaims.
- **Fix:** Route these paths through `changeStatus` (surface) / the same freeze guard, or add the identical `freezeChangesetUow` + metadata-merge call to each. Cheapest consistent option: extract a small `closeWithFreeze(uow, issue, extraPatch)` helper in `mutate.ts` and use it from `changeStatus`, `closeMany`, `markSuperseded`; mirror in the CLI service methods.

### WR-2: A failed derivation at close silently skips the freeze with no signal, permanently unfreezing the record

- **File:** `packages/surface/src/operations/changeset.ts:120-137`; `packages/cli/src/tk.ts:1112-1116`
- **Evidence:** `freezeChangesetUow` returns `null` both for legitimate no-ops (not closed, already frozen, branch-less) and for derivation failure (`deriveChangeset → null`, `gitBranchHead → null` — e.g. a transient git error or an unresolvable ref at close time). Callers cannot distinguish these, so a branched feature issue can close **without a snapshot and without any warning**, and per D-05 the exactly-once guard then doesn't apply (nothing was frozen), yet the record is permanently past the freeze point. `tk show` on that closed record silently performs git calls (contradicting the `tk.ts:1112-1113` comment "closed tasks render the frozen snapshot with NO git calls") and, after branch deletion, renders blank COMMITS/FILES.
- **Impact:** The decay-protection guarantee has a silent failure mode at the only moment it can be applied.
- **Fix:** Either (a) differentiate the failure return (e.g. a `frozen | null | "derive_failed"` result) and surface a non-fatal warning at close, or (b) at minimum, in the CLI close dispatch, detect "closed + branch present + base pinned + snapshot still absent" after the save and emit a dim warning (`snapshot not frozen — derivation failed`). Also correct the stale `tk.ts:1112-1113` comment to "when a frozen snapshot exists".

## Info

### IN-1: FILES coloring misses score-suffixed rename/copy codes

- **File:** `packages/cli/src/presentation.ts:245`
- **Evidence:** `file.status === "R" ? magenta("R") : yellow(file.status)` — `--name-status` emits `R100`, `C75`, etc. (the score is part of the token, and `parseNameStatus` deliberately keeps it verbatim), so renames/copies render as yellow `R100` instead of the intended magenta `R`.
- **Fix:** `file.status.startsWith("R")` (or check the leading letter: `file.status[0]`).

### IN-2: Finish dispatch re-derives the changeset live purely for the confirmation line

- **File:** `packages/cli/src/tk.ts:1167`
- **Evidence:** After `finishIssueUow` saves, the human path runs a second full `deriveChangeset` (3 git processes) only to print counts via `formatFinish`. The operation deliberately stores nothing (D-07), so this is by design, but it doubles the git work per finish and re-derives after the status change.
- **Fix (optional):** Acceptable as-is; if touched again, derive once and pass the payload through the service return instead of re-deriving in dispatch.

### IN-3: Unused `ctx` parameter in `finishIssueUow`

- **File:** `packages/surface/src/operations/finish.ts:41,44`
- **Evidence:** `ctx: { readonly cwd: string }` is accepted only to be discarded (`void ctx;`). `freezeChangesetUow` genuinely needs `cwd`; finish doesn't call git. Keeping the parameter preserves the uow-operation signature convention, but the `void ctx;` discard is a smell a future reader will puzzle over.
- **Fix:** Either drop the parameter (callers pass `{ cwd: store.root }` in two places) or add a one-line comment that the signature is kept for operation-family symmetry.

### IN-4: Porcelain parsers don't handle git's C-quoted paths

- **File:** `packages/git/src/porcelain.ts:39-64`
- **Evidence:** Without `-z`, `--numstat`/`--name-status` quote paths containing non-ASCII or special characters (`"\303\244.txt"` style), including the surrounding double quotes. The parsers keep tokens verbatim (documented), which is correct for the plan's display-only scope and the explicit "never join on path" constraint — but any Phase 3 consumer that joins or opens these paths will hit quoted spellings.
- **Fix:** No change required now; record the constraint (already implicit in the plan's "nothing joins on it") for Phase 3, or switch to `-z` there.
