# Phase 2: Changeset Derivation & Completion Contract - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-18
**Phase:** 2-Changeset Derivation & Completion Contract
**Areas discussed:** Snapshot storage; Freeze trigger; Derivation payload; Finish contract edges

---

## Snapshot storage

| Option | Description | Selected |
|--------|-------------|----------|
| metadata["changeset"] | Plan-literal, JsonValue-typed, zero storage migrations | ✓ |
| typed Issue.changeset field | Type-safe, needs sqlite/postgres migrations + wire codecs | |

**User's choice:** *(selection prompt skipped — default adopted)* metadata["changeset"]
**Notes:** Plan step 7 is explicit ("frozen into `metadata[\"changeset\"]`"); zero migrations keeps file/sqlite/postgres untouched.

---

## Freeze trigger

| Option | Description | Selected |
|--------|-------------|----------|
| freeze inside close path now (idempotent) | close on task with branch → snapshot written once; Phase 6 prune just removes directories | ✓ |
| freeze at actual prune only (Phase 6) | Phase 2 verifies via manual worktree removal; close leaves record unfrozen | |

**User's choice:** *(selection prompt skipped — default adopted)* freeze inside close path now
**Notes:** Only way Phase 2's success criterion 4 is verifiable end-to-end before the prune exists.

---

## Derivation payload

| Option | Description | Selected |
|--------|-------------|----------|
| structured payload now | commits[{sha,subject}], files[{path,status}], counts; hunks/patch text Phase 3 | ✓ |
| full unified diff text now | everything review needs early; larger wire payloads; hunk parsing still Phase 3 | |

**User's choice:** *(selection prompt skipped — default adopted)* structured payload now
**Notes:** Success criteria require commits + files + counts only; one derivation surface (adapter gains `gitDiffPatch` in Phase 3).

---

## Finish contract edges

| Option | Description | Selected |
|--------|-------------|----------|
| refuse without evidence + idempotent re-finish | no branch/worktree → lifecycle error; re-finish re-records session + re-prints counts | ✓ |
| allowed without worktree + error on re-finish | counts omitted; second finish errors | |
| refuse + error | strict both ways | |

**User's choice:** *(selection prompt skipped — default adopted)* refuse without evidence + idempotent re-finish
**Notes:** Branch is the evidence (locked decision); tolerant re-finish avoids agent retry dead-ends.

---

## Claude's Discretion

- Frozen tuple extended to self-sufficient superset `{base, head, commits, files, counts}` (plan literal is `{base, head, files}`) so criterion 4 rendering survives branch deletion.

## Deferred Ideas

- Hunks / patch text — Phase 3
- Prune machinery, clean, merged-check, hooks — Phase 6
- Live SSE diff — Phase 5
