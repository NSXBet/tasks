---
phase: 02
review: 02-REVIEW.md
titles: json
findings:
  - id: WR-1
    severity: warning
    disposition: open
    title: "Close-shaped saves bypass the exactly-once freeze — `markDuplicate`, `markSuperseded` (CLI + surface), `todoDone`"
  - id: WR-2
    severity: warning
    disposition: open
    title: "A failed derivation at close silently skips the freeze with no signal, permanently unfreezing the record"
  - id: IN-1
    severity: info
    disposition: open
    title: "FILES coloring misses score-suffixed rename/copy codes"
  - id: IN-2
    severity: info
    disposition: open
    title: "Finish dispatch re-derives the changeset live purely for the confirmation line"
  - id: IN-3
    severity: info
    disposition: open
    title: "Unused `ctx` parameter in `finishIssueUow`"
  - id: IN-4
    severity: info
    disposition: open
    title: "Porcelain parsers don't handle git's C-quoted paths"
  - id: WR-01
    severity: warning
    disposition: fixed
    title: "Close-shaped saves bypass the exactly-once freeze"
  - id: WR-02
    severity: warning
    disposition: fixed
    title: "Frozen-snapshot absence invisible on close dispatch"
open: 6
total: 8
recorded: 2026-10-18T21:46:13.558Z
---

# Phase 02: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| WR-1 | warning | open | - |
| WR-2 | warning | open | - |
| IN-1 | info | open | - |
| IN-2 | info | open | - |
| IN-3 | info | open | - |
| IN-4 | info | open | - |
| WR-01 | warning | fixed | 02-REVIEW-FIX.md (not in the current review) |
| WR-02 | warning | fixed | 02-REVIEW-FIX.md (not in the current review) |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
