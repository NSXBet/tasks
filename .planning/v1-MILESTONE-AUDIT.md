---
milestone: v1
milestone_name: "task → review"
audited: 2026-11-12T18:33:21Z
status: tech_debt
scores:
  requirements: 32/32
  phases: 11/11
  integration: 14/14
  flows: 7/7
gaps:
  requirements: []
  integration: []
  flows: []
resolved_gaps:
  - id: "CHG-02 / spec verify 8 (TUI door)"
    resolved: 2026-11-12
    fix: "packages/tui/src/review/source.ts resolveReviewSource falls back to readChangesetSnapshot (sha-validated base...head via gitDiffPatch) when no worktree has the branch, mirroring web review.ts; tests packages/tui/test/frozen-source.test.ts (2 pass), full tui suite 127/0, tsc clean; live tmux on the audit e2e closed+pruned task tk-djv rendered `tk/tk-djv ← b2a51501ff75 · +3 −0` with files and comments."
tech_debt:
  - phase: milestone
    items:
      - "None of the milestone is committed. HEAD is `496745b pre claude`. The working tree has 105 modified files (+8321/−1912) and many untracked source, test and phase dirs (domain review-record/pr-record/changes-card, cli tests, .planning/phases/03..11)."
      - "Nyquist is active (validate-phase hook) but no phase has a VALIDATION.md. All 11 phases are MISSING. Run /gsd:validate-phase N."
      - "SUMMARY frontmatter hygiene: summary-extract returns no requirements_completed for GIT-01 (01-04 has only a tag), CHG-01 (02-01 has only a title), CHG-02/FIN-01 (02-02 frontmatter unparseable) and WEB-01/02 (05-* use a `requirements:` key). Each was verified by hand against VERIFICATION and the audit E2E."
      - "tk bookkeeping: delivered step and epic tasks are still open (tasks-jyhl, -qrbi, -obpr, -e0kg, -srqb, -1zjy, -0v4m, -5fu5, -dor3, -n5xi). tasks-osxi, -lxok and -3jxf are still in progress. Mock steps tasks-foo, -tnc and -xskm sit in ready-to-review. Probe and junk tasks: tasks-1, -9f6, -9vx, -5aj, -5e0, -8ib, -b2g, -caf, -cpi, -cth, -gqx, -ihn, -jhu, -p5l, -qhz, -ryc, -tx3, tk-dbg8, tk-dbg9."
  - phase: 01-git-adapter-worktree-entry
    items:
      - "Contract drift (INJ-01 text vs GIT-03 code): the injected contract says `tk work <id>` claims (→ in-progress), but the status stays `open` (audit E2E; tasks-jlhs). R18 status flow is partial."
      - "Contract drift: the injected contract says 'the title seeds the branch name', but the branch is `tk/<id>` (GIT-03 locked this). Fix the text in tk-section.md, SKILL.md and AGENTS.md."
      - "tui taskview-smoke check 12 flake (tasks-syjq); web live.test.ts branch-frame timing (tasks-p8og)."
  - phase: 02-changeset-derivation-completion-contract
    items:
      - "Info: `tk finish` on a closed task moves it back to ready-to-review. Unknown flags such as `--status closed` are silently ignored."
  - phase: 03-review-component-review-storage
    items:
      - "Info: TUI and web comment rows skip the in-memory legacy hunk import until the first adapter read."
  - phase: 05-web-review
    items:
      - "Stored '[review <loc>] ' prefixes are shown in web bodies (tasks-lsna); door contrast, 'just now ago', diff header counts exclude uncommitted work (tasks-xo2y)."
      - "Web edit is last-write-wins over outside changes (tasks-lgjk); full diff page scrolls the whole page (tasks-yjx4)."
      - "/api/rpc routes to the boot workspace after POST /api/open (tasks-qliz); react/react-dom lockfile mismatch (tasks-lx90); top bar overflows at 760px (tasks-0elp)."
  - phase: 06-worktree-lifecycle-injection
    items:
      - "A mistyped worktree.* key silently drops all hooks (tasks-iqlr); hooks get no TK_TASK/TK_WORKTREE_PATH env (tasks-iqkh)."
      - "Info: prune skips the merge check for a detached worktree whose branch was deleted out-of-band. `tk show` still prints the pruned WORKTREE path. A second `tk onboard install` says 'Updated' (tasks-0mzr)."
      - "UAT (tracked tasks-llrt): live-harness primed session shows the contract (spec verify 9b). The TUI half of verify 8 is now known broken (see gaps)."
  - phase: 07-review-record-harness-registry
    items:
      - "leaseHolder reads OMP_SESSION_ID instead of PI_SESSION_ID (tasks-2fux); TUI list-pane doors line truncates the URL (tasks-4xxz)."
      - "Info: the harness falls back to `omp` when no harness env is set (audit E2E: 'agent omp' with PI_SESSION_ID blank)."
  - phase: 08-comment-lifecycle-agent-delivery
    items:
      - "Count mismatch: after `tk comments send`, `tk comments --json` gives counts.open 0 / sent 3, but the human footer, the `tk show` REVIEW header and the comments row say '3 open'. The D-09 rule folds sent into open; no tk task tracks this."
      - "Error paths print the raw JSON envelope (tasks-vmx6); TUI artifact view lacks x/D/R/E actions (tasks-dz0x)."
  - phase: 09-task-view-parity
    items:
      - "TUI wip counter: in_progress vs in-progress spelling (tasks-rxpq); web WORKSPC commit is enabled with only untracked files (tasks-gezj)."
  - phase: 10-event-wire-watch-broker
    items:
      - "pi tasks_wait and the inbox share a cursor (tasks-kdpe); own writes echo when TK_SESSION is unset (tasks-uvvr); double toast on page-own actions (tasks-mzsn); overview.md still says the TUI polls (tasks-1jc7)."
      - "Info: recorder swallows append errors; `tk watch` human line doesn't distinguish open from sent; spec 'CLI sole editor' not adopted (in-process writes are decorated by withEventLog)."
      - "UAT (tracked tasks-aucj): live omp inbox delivery, away brief, no self-echo."
  - phase: 11-pr-sidecar-chat-stat-card
    items:
      - "WARNING (PR-01 → LC-02): after `tk pr merge` (gh merges remotely), `tk close` refuses the prune ('not fully merged') until the main checkout fetches origin. `pr merge` prints 'next: tk close' with no fetch step. Recovery is `git fetch` + `tk worktree clean --yes` (audit E2E). Overlaps UAT tasks-omwa."
      - "Stat card link uses the default port when no web runtime is registered (tasks-sixa); metadata.pr narrowed to {number,url,state} (D-01)."
      - "UAT (tracked tasks-omwa, tasks-llrt): real GitHub gh run; live pi stat/PR cards."
  - phase: cross-cutting
    items:
      - "tk update --status accepts invalid values (tasks-vzws); tk dep add allows self-dependency (tasks-rq1i); pi-extention tsc fails (tasks-sssi); daemon tests share a socket (tasks-uhry); tk web accepts start/stop as workspace names (tasks-lyhe)."
nyquist:
  compliant_phases: []
  partial_phases: []
  not_validated_phases: []
  missing_phases: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  overall: missing
---

# Milestone v1 ("task → review") Audit

**Status: gaps_found.** There is one narrow integration blocker: the TUI `tk review` for closed, pruned tasks. Everything else is tech debt or tracked UAT.

Sources:
- ROADMAP.md (11 phases, all complete)
- REQUIREMENTS.md (32 REQ-IDs)
- 11 VERIFICATION.md files (all `status: passed`, with a regression sweep on 2026-11-12: full suite 1897 pass / 0 fail, `bun run check` rc 0, luau 6/6, docs build ok)
- 52 SUMMARY.md files
- the spec `docs/html/task-to-review.html` + `docs/html/data/task-to-review-data.js`
- a live E2E run by this audit in a scratch repo (fake gh first on PATH, blank GH_TOKEN/GITHUB_TOKEN/TK_GH, local bare origin)

## Phases

| # | Phase | VERIFICATION | Score | Human items → disposition |
|---|-------|--------------|-------|---------------------------|
| 1 | Git Adapter & Worktree Entry | passed | 9/9 | none |
| 2 | Changeset Derivation & Completion Contract | passed | 7/7 | none |
| 3 | Review Component & Storage | passed | 9/9 | none |
| 4 | Terminal Review | passed | 15/15 | visual parity, accepted 2026-11-10 |
| 5 | Web Review | passed | 22/22 | visual, accepted 2026-11-10 |
| 6 | Worktree Lifecycle & Injection | passed | 14/14 | verify 8b/9b → tk UAT tasks-llrt |
| 7 | Review Record & Harness Registry | passed | 3/3 | doors, human-verified 2026-11-10 |
| 8 | Comment Lifecycle & Agent Delivery | passed | 4/4 | none |
| 9 | Task View Parity | passed | 8/8 | none (smoke flake advisory) |
| 10 | Event Wire & Watch Broker | passed | 3/3 | live omp → tk UAT tasks-aucj |
| 11 | PR Sidecar & Chat Stat Card | passed | 3/3 | real gh / live pi → tk UAT tasks-omwa, tasks-llrt |

## Requirements (3-source cross-reference)

Every REQUIREMENTS.md checkbox was already `[x]`, so no checkbox needed updating. The traceability table only had rows for GIT..INJ. This audit **added rows for REC-01..PR-03 (Phases 7–11)**.

"SUMMARY fm" is the `requirements-completed` value that `summary-extract` reads from SUMMARY frontmatter. "manual" means the frontmatter read returned nothing and the claim was confirmed by hand from the SUMMARY body, VERIFICATION and the audit E2E.

| REQ | Phase | VERIFICATION | SUMMARY fm | Checkbox | Final |
|-----|-------|--------------|-----------|----------|-------|
| GIT-01 | 1 | SATISFIED | missing (01-04 has a tag only) → manual | [x] | satisfied (manual) |
| GIT-02 | 1 | SATISFIED | 01-03 | [x] | satisfied |
| GIT-03 | 1 | SATISFIED | 01-03 | [x] | satisfied (E2E: tk/<id>, base, path recorded) |
| CHG-01 | 2 | SATISFIED | missing (02-01 has a title only) → manual | [x] | satisfied (E2E: COMMITS (2)/FILES (2) derived) |
| CHG-02 | 2 | SATISFIED | 02-02 body (fm unparseable) | [x] | **partial**: show/changes/web ✓, TUI review ✗ |
| FIN-01 | 2 | SATISFIED | 02-02 body (fm unparseable) | [x] | satisfied (E2E: `--status closed` still lands in ready-to-review) |
| REV-01 | 3 | SATISFIED | 03-02 | [x] | satisfied |
| REV-02 | 3 | SATISFIED | 03-04, 03-05 | [x] | satisfied |
| REV-03 | 4 | SATISFIED | 04-01..05 | [x] | satisfied for live tasks (see CHG-02 gap) |
| WEB-01 | 5 | SATISFIED | `requirements:` key → manual | [x] | satisfied (E2E: /tasks/<id> 200, payload) |
| WEB-02 | 5 | SATISFIED | `requirements:` key → manual | [x] | satisfied (E2E: SSE frames for CLI writes) |
| LC-01 | 6 | SATISFIED | 06-01 | [x] | satisfied (E2E: refuses unmerged) |
| LC-02 | 6 | SATISFIED | 06-01 | [x] | satisfied (close succeeds, prune non-fatal) |
| LC-03 | 6 | SATISFIED | 06-01 | [x] | satisfied (E2E: clean dry-run, then --yes) |
| LC-04 | 6 | SATISFIED | 06-02 | [x] | satisfied |
| INJ-01 | 6 | SATISFIED | 06-03 | [x] | satisfied (contract-text drift = tech debt) |
| REC-01..03 | 7 | SATISFIED | 07-02..04 | [x] | satisfied (E2E: agent line, doors, comments row) |
| CMT-01..03 | 8 | SATISFIED | 08-01..03 | [x] | satisfied (E2E: location tags, send batch → sent) |
| VIEW-01..04 | 9 | SATISFIED | 09-02..11 | [x] | satisfied |
| WIRE-01..03 | 10 | SATISFIED | 10-01..06 | [x] | satisfied (E2E: watch --until exit 0 on approve) |
| PR-01..03 | 11 | SATISFIED | 11-01..05 | [x] | satisfied (fake gh; real gh = UAT) |

No requirement is orphaned. All 32 appear in a phase VERIFICATION requirements table.

## Integration (cross-phase wiring)

| # | Connection | Status | Evidence |
|---|-----------|--------|----------|
| 1 | @tasks/git adapter → changeset, review gitDiffPatch, web, prune, push | WIRED | Phase 1/3 sweeps; no second adapter, planHunk gone |
| 2 | tk work record (branch/base/worktree) → lazy derivation | WIRED | E2E `tk show` after 2 commits |
| 3 | tk finish → harness registry agent line | WIRED | E2E `agent omp · session … finished` |
| 4 | tk finish → stat card + metadata.report → task.report event | WIRED | E2E events #4–#5, card with diff link |
| 5a | close snapshot → tk show / tk changes | WIRED | E2E after prune |
| 5b | close snapshot → web /api/review | WIRED | E2E patch from frozen base..head |
| 5c | close snapshot → TUI `tk review` | **BROKEN** | E2E tmux: "branch tk/tk-djv is not checked out" |
| 6 | comment store ← web threads API → CLI `tk comments` | WIRED | E2E 3 web comments listed with locations |
| 7 | send batch → task.comment cards {location, author, body} → watch/pi | WIRED | events.jsonl seq 10–12 |
| 8 | events.jsonl → web SSE / TUI tail / tk watch --until | WIRED | 7 SSE `event: task` frames from CLI writes; watch exited 0 on approve |
| 9 | tk pr create/sync/merge → metadata.pr + task.pr | WIRED | gh.log: list→create→view; idempotent adopt |
| 10 | tk pr merge → tk close prune | WARNING | refuses until `git fetch`; `worktree clean --yes` then prunes |
| 11 | doors web base ← registered web runtime | WIRED | links switched to :21677 once the server ran |
| 12 | INJ contract ↔ tk work behavior | WARNING | "claims" and "title seeds branch" are not what the code does |
| 13 | task view WORKSPC → commit/pr routes | WIRED | Phase 11-05 verified |
| 14 | RPC VERBS 6: TS ↔ Luau ↔ rpc.md | WIRED | protocol.ts:23, wire.luau:18, rpc.md:149 |

Score: 13/14 wired (2 with warnings), 1 broken.

## E2E flows (run by this audit)

Scratch dir: `/private/tmp/claude-501/-Users-yuri-Workdir-Nsx-tasks/8da80871-88ce-4515-b90a-6adc2fe64896/scratchpad/e2e`

| Flow | Result |
|------|--------|
| tk create → tk work → 2 commits → tk show derives commits/files | ✓ (status stays `open`, see tasks-jlhs) |
| tk finish --session → stat card `2 commits · +3 −0 · 2 files → …/diff · tk review` → events | ✓ |
| reviewer comments via web API → store → `tk comments` → `tk comments send` (batch) → sent cards on the wire and SSE | ✓ |
| tk update --status approved → blocked `tk watch --until "status=approved\|rejected"` exits 0 | ✓ |
| tk pr create (twice, adopt) → pr sync → pr merge (fake gh, bare origin push) | ✓ |
| tk close → snapshot frozen → prune (after fetch) → tk show / tk changes / web review render | ✓ (warning: fetch needed) |
| closed + pruned → `tk review <id>` TUI | ✗ broken |
| live omp agent pickup of sent cards / approval | not run, tracked UAT tasks-aucj |

## Spec verify items (docs/html/data/task-to-review-data.js `verify`)

| # | Item | Disposition | Evidence |
|---|------|-------------|----------|
| 1 | Product: tk show renders the derived PR-shaped record | satisfied | CHG-01; E2E |
| 2 | Review: tk review live, editable, commentable, resolve state, persisted | satisfied | REV-03; review-smoke 9/9 |
| 3 | Web: /tasks/:id same record + review, same store | satisfied | WEB-01/02; E2E web → CLI |
| 4 | Cutover: planHunk deleted, gw has no role, no second git adapter | satisfied | Phase 1/3; `tk hunk` → unknown command |
| 5 | Mocks navigable with WIP before real code | satisfied (baseline, historical) | PROJECT.md §Validated; mock plumbing deleted in 04-03; tasks-foo/-tnc/-xskm still in ready-to-review |
| 6 | Registry: agent line from harness registry, omp first | satisfied | REC-01 |
| 7 | Doors on every task surface | satisfied | REC-02; human-verified |
| 8 | post_start runs on tk work; closed task renders commits+diff from snapshot with no worktree/branch | **partial**: post_start ✓, show/changes/web ✓, **TUI review ✗** | gap above; tracked UAT tasks-llrt would fail |
| 9 | fresh clone → tk onboard → AGENTS.md rules; primed agent session shows them | satisfied / tracked UAT | INJ-01; live harness = tasks-llrt |

## Spec requests R01–R74

| Requests | Disposition | Evidence |
|----------|-------------|----------|
| R01, R02 | satisfied; live harness = tracked UAT | INJ-01, tk setup codex/cursor, tasks-llrt |
| R03, R16, R17 | satisfied | FIN-01, REC-03 |
| R04, R05, R07, R08, R10, R21, R29 | satisfied | GIT-03, CHG-01 |
| R06 | deviated by decision | branch is `tk/<id>` (GIT-03), not the title; doc text still claims title |
| R09, R64 | satisfied | evidence-backed artifacts (VIEW-01) |
| R11, R12, R19, R26, R48 | satisfied | REV-01/03, shared @tasks/review + gitDiffPatch |
| R13, R14, R15, R27, R40–R47 | satisfied | REV-03, WEB-01, VIEW-*; R27 via doors URL + `tk web --open` |
| R18 | partial | tk work does not move to in-progress (tasks-jlhs) |
| R20 | satisfied by rename | `tk diff` → `tk review <id>` / `tk changes <id>` |
| R22, R67, R68 | satisfied | sessions rail (09-02/03/06) |
| R23–R25, R30, R37–R39, R73 | satisfied | REV-02, CMT-01 |
| R28, R65 | satisfied (fake gh); real gh = tracked UAT | PR-01, tasks-omwa |
| R31–R36, R69–R72, R74 | satisfied | VIEW-01..04 |
| R49 | satisfied | naming in docs |
| R50, R51 | satisfied | REC-01/02 |
| R52, R53 | satisfied (baseline) | build order; mock shells |
| R54 | partial → deferred v2 | script, evidence, pickup and merge exist; `tk next` oracle deferred |
| R55 | partial → deferred v2 | nudges (`next: …`) exist; oracle deferred; `tk update --status` over-permissive (tasks-vzws) |
| R56–R58 | satisfied; live omp = tracked UAT | WIRE-01..03, tasks-aucj |
| R59 | satisfied | GIT-02 config/override, LC-04 |
| R60, R61 | satisfied | PR-02/03 (base = pinned base) |
| R62, R63 | satisfied | CMT-02/03 (count display debt noted) |
| R66 | satisfied | task-to-review-references.html documents 2026-10-16 |

Tier-b epics (tasks-34rm, -k5kp, -lx7a, -d0rq, -zshv, -nzg0, -xcov, -6zif, -gt6y) are v2 by REQUIREMENTS.md.

## Nyquist coverage

| Phase | VALIDATION.md | Compliant | Action |
|-------|---------------|-----------|--------|
| 1–11 | missing | — | `/gsd:validate-phase N` for each |

## Next

1. Close the gap: add the frozen-snapshot fallback to `packages/tui/src/review/source.ts`, mirroring `packages/web/src/review.ts:157-166`. Then re-run verify item 8 (tk close → prune → `tk review <id>`).
2. Commit the milestone. It is all uncommitted.
3. Fix the contract text (claims / title-seeds-branch) or the `tk work` behavior (tasks-jlhs), and add a fetch hint (or fetch) between `tk pr merge` and `tk close`.


## Gap closure (2026-11-12)

The single blocker (CHG-02 partial — TUI `tk review` on a closed+pruned task) is fixed: the TUI review source now falls back to the frozen changeset snapshot like the web does. Status moves gaps_found → tech_debt (no blockers; remaining items are tracked tk follow-ups and UAT tasks).
