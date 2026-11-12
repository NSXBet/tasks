---
phase: 06-worktree-lifecycle-injection
plan: 03
subsystem: agent injection (onboard / prime / skill / AGENTS.md)
tags: [onboard, prime, skill, agents-md, contract, docs]

requires: [06-01, 06-02]
provides:
  - "packages/cli/test/contract.test.ts: one drift guard over every injection surface"
  - "Workflow contract text matches the commands as they exist now: tk work → commit → tk finish --session → never mark done → tk watch <id> --until \"status=approved|rejected\" → tk review / tk comments"
  - "Lifecycle line (tk close prune, tk worktree clean [--yes]) on template, PRIME and both shipped skills"
  - "Root AGENTS.md managed block regenerated via tk onboard install (check = current)"
  - "docs: integrations.md `## Agent injection — the workflow contract`"
affects: [tk onboard, tk prime, tk skill, pi extension skill, AGENTS.md]

actuals:
  tasks: 2
  commits: 0

key-files:
  created:
    - packages/cli/test/contract.test.ts
  modified:
    - packages/cli/templates/agents/tk-section.md
    - packages/cli/src/presentation.ts
    - packages/cli/skills/tasks/SKILL.md
    - packages/pi-extention/skills/tasks/SKILL.md
    - .agents/skills/tasks/SKILL.md
    - AGENTS.md
    - docs/src/content/docs/integrations.md
    - docs/src/content/docs/overview.md

key-decisions:
  - "The contract asserts six clauses, not four. The plan's four (`tk work <id>`, `tk finish <id> --session`, /never mark done/i, `tk review <id>`) plus the commands added since the plan was written: `tk watch <id> --until` (10-03) and `tk comments` (08-01). This follows the orchestrator brief."
  - "One bold contract line is shared verbatim by the template, all three SKILL.md copies and the root AGENTS.md, and the test enforces it. It also fixes the old `--session <id>` typo to `--session <sid>`."
  - "The pi skill copy differs from the CLI copy on purpose, in step 5's indented wait paragraph only (10-06: `tasks_wait` tool + inbox). Everything else was synced: the Leases section and the onboard rule line were missing, and step 6 is now the same as the CLI copy. The paragraph now also names `tk watch <id> --until \"status=approved|rejected\"` as the shell form, so the clause holds. The test compares the two copies with that paragraph stripped."
  - "The project-local `.agents/skills/tasks/SKILL.md` is byte-identical to the CLI copy, refreshed with `tk skill install --force`."
  - "`ONBOARD` export deleted. A repo-wide grep (excluding dist/node_modules) found only its definition."

requirements-completed: [INJ-01]

coverage:
  - id: D1
    description: "Fresh git init → tk onboard install: one BEGIN/END, all clauses + lifecycle + contract line; second install byte-identical"
    requirement: INJ-01
    verification:
      - kind: e2e
        ref: "packages/cli/test/contract.test.ts#fresh clone → tk onboard install"
        status: pass
  - id: D2
    description: "tk prime (ANSI-stripped) carries all clauses and the lifecycle line"
    requirement: INJ-01
    verification:
      - kind: e2e
        ref: "packages/cli/test/contract.test.ts#tk prime states the contract"
        status: pass
  - id: D3
    description: "Template, CLI/pi/project SKILL.md, root AGENTS.md carry the clauses and the same bold contract line; project copy byte-identical; pi copy identical except its wait paragraph"
    requirement: INJ-01
    verification:
      - kind: unit
        ref: "packages/cli/test/contract.test.ts (surfaces + skill copies cases)"
        status: pass
  - id: D4
    description: "tk onboard check at repo root exits 0, no stale"
    requirement: INJ-01
    verification:
      - kind: e2e
        ref: "packages/cli/test/contract.test.ts#root AGENTS.md managed block is current"
        status: pass
  - id: D5
    description: "No `tk hunk` on any surface; no `WIP mock` in HUMAN_HELP or tk help"
    requirement: INJ-01
    verification:
      - kind: unit
        ref: "packages/cli/test/contract.test.ts#no surface mentions the removed tk hunk command"
        status: pass
  - id: D6
    description: "Scratch-repo fresh-clone onboard probe"
    requirement: INJ-01
    verification:
      - kind: manual_procedural
        ref: "scratchpad probe0603 (see Verification)"
        status: pass

completed: 2026-11-12
---

# Phase 6 Plan 03: Workflow contract on every injection surface (INJ-01) Summary

**A fresh clone that runs `tk onboard install` now gets the current workflow contract in AGENTS.md: `tk work <id>`, commit, `tk finish <id> --session <sid>`, never mark done, `tk watch <id> --until "status=approved|rejected"`, then `tk review <id>` / `tk comments <id>`. The same contract and the close-prune / `tk worktree clean` lifecycle line appear in `tk prime`, every SKILL.md copy and this repo's AGENTS.md. One test fails if any of them drifts.**

**Commits withheld per AGENTS.md** (conservative profile: no git commit or push). All changes are uncommitted in the main tree. STATE.md and ROADMAP.md were not updated, per the orchestrator override.

## What changed

### Task 1: `packages/cli/test/contract.test.ts` (new)
The test has six cases:
- Fresh `git init` → `tk onboard install`:
  - exactly one BEGIN and one END marker
  - the block has every clause, the lifecycle line and the bold contract line
  - a second install leaves the file byte-identical
- `tk prime` output, ANSI-stripped, has every clause and the lifecycle line.
- The template, all three SKILL.md copies and the root AGENTS.md have every clause and the same bold `**The contract: …**` line. The template and both shipped skills have `tk worktree clean`.
- Skill copies: the `.agents` copy is byte-identical to the CLI copy. The pi copy is equal to it once step 5's indented wait paragraph is stripped, and it must mention `tasks_wait`.
- `tk onboard check -C <repo>` exits 0 and prints nothing containing `stale`.
- No surface or prime matches `\btk hunk\b`. `HUMAN_HELP` and `tk help` contain no `WIP mock`.

RED run before Task 2: 0 pass / 6 fail. The failures were:
- the `tk watch` clause missing from the template, prime and the fresh block
- skill-copy mismatch
- stale root block
- `WIP mock`

### Task 2: the surfaces
- **`templates/agents/tk-section.md`** (the only source of the block):
  - The intro sentence now includes the `Run \`tk prime\` for full workflow context.` pointer, which had been hand-edited into the root block and made it stale.
  - New contract line.
  - Step 2 says to commit on the task branch.
  - New step 5, "Wait for the verdict, don't poll", covers `tk watch <id> --until "status=approved|rejected"`, `type=task.comment`, exit 124 and `--drain`.
  - Step 6 is review/close, with `tk review <id>`, `tk comments <id>` and `tk comments resolve`.
  - A lifecycle line follows the loop.
- **`presentation.ts`:**
  - `PRIME`: the typical loop now reads commit → finish → `tk watch … --until` (and `--drain`) → close. The review bullet names `tk comments` and `tk comments resolve`. A new lifecycle bullet was added.
  - `HUMAN_HELP` rows now read `tk work <id> — Claim + open the task's worktree and branch` and `tk review <id> — Review the task's recorded diff`.
  - The unused `ONBOARD` export is deleted.
- **`packages/cli/skills/tasks/SKILL.md`:** new contract line, and a lifecycle line after step 7. The 10-03 wait paragraph and the 08-01 comments text are unchanged.
- **`packages/pi-extention/skills/tasks/SKILL.md`:** synced from the CLI copy (gains Leases, the onboard rule and the CLI step 6). The 10-06 `tasks_wait`/inbox paragraph is kept and now names its shell equivalent. `packages/pi-extention/src/**` was not touched.
- **`.agents/skills/tasks/SKILL.md`:** refreshed with `bun packages/cli/src/tk.ts skill install --force`. It no longer teaches `tk update --claim` and the manual `--status ready-to-review` hand-over.
- **Root `AGENTS.md`:** regenerated only through `tk onboard install`. A diff against a pre-edit snapshot shows changes only inside the markers: hash `40af0fb6` → `a7b6436b`, the contract line, steps 2/5/6, and the lifecycle line. The hand-written sections are unchanged.
- **Docs:**
  - `integrations.md` has a new section, `## Agent injection — the workflow contract`. It covers the contract, the surface table, `tk onboard` print/install/check/remove with `--file`/`--tool`, the marker and hash format, and idempotence. It also covers `tk prime` at SessionStart and its re-injection after compaction through `tk setup codex|cursor` hooks, `tk skill` / `tk skill install` and the pi copy, and the contract test as the drift guard.
  - In `overview.md`, `### Agent skill` drops the Hunk comparison and links to `#agent-injection--the-workflow-contract`. The docs site is one page, so links are in-page anchors. The link was checked in the built `dist/index.html`.

## Deviations
1. **[Orchestrator brief] Contract widened from 4 to 6 clauses.** Added `tk watch <id> --until` and `tk comments`, plus a shared bold contract line, so the text matches the commands from 08-01 and 10-03.
2. **[Plan fallback, step 3] pi copy not byte-equal.** The 10-06 inbox/`tasks_wait` paragraph is a deliberate difference. The test compares the copies with that paragraph stripped. Leases and the onboard line had no history of being dropped on purpose, so they were synced.
3. **[Rule 1] `tk prime` needs a workspace.** In a bare temp dir it fails with "No .tasks workspace found". The test runs `prime` with `-C <repo>` (read-only). The scratch probe ran `tk init` first.
4. **Observation (not fixed, out of scope):** `HUMAN_HELP` is imported in tk.ts but never printed; `tk help` prints `HELP`. The test checks both. Also, a second `tk onboard install` prints "✓ Updated existing tk section" even though the file is byte-identical (shasum confirmed). Only the message is wrong.

## Verification (all run)
- RED: `bun test packages/cli/test/contract.test.ts` → 0 pass, 6 fail. These were the expected deltas.
- `bun test packages/cli/test/contract.test.ts packages/cli/test/onboard.test.ts packages/cli/test/tk.test.ts packages/cli/test/hooks.test.ts` → **87 pass, 0 fail**. The onboard tests compute the hash from the body; none pins a literal.
- `bun test packages/cli/test/presentation.test.ts` → 15 pass.
- `bun packages/cli/src/tk.ts onboard check` (repo root) → `✓ … AGENTS.md (current)`, exit 0.
- `cd packages/cli && bunx tsc --noEmit -p tsconfig.json` → exit 0.
- `cd docs && bun run build` → `[build] Complete!`.
- Fresh-clone probe in the session scratchpad (`probe0603`): `git init` → `tk onboard install` → AGENTS.md hit counts:

  | Grep | Hits |
  |---|---|
  | `tk work <id>` | 5 |
  | `tk finish <id> --session` | 3 |
  | `never mark done` (-i) | 2 |
  | `tk review <id>` | 2 |
  | `tk worktree clean` | 1 |
  | `tk watch <id> --until` | 2 |
  | `tk comments` | 2 |

  A second install left the shasum unchanged (`80b0d9bd…`). `tk onboard check` → current, exit 0. After `tk init`, `tk prime | grep -c "tk review <id>"` → 1.

## Follow-ups
- Phase 11 (`tk pr` / `tk changes`) must update the contract line in the template, `PRIME` and both SKILL.md copies together. Then run `tk skill install --force` and `tk onboard install` at the root; contract.test.ts will flag any copy that is missed.
