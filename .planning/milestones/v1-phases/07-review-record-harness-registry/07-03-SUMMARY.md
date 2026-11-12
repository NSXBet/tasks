---
phase: 07-review-record-harness-registry
plan: 03
subsystem: cli, web, docs
status: complete
tags: [review-doors, cli, web, runtime-registry]
requires:
  - phase: 07-02
    provides: "@tasks/surface resolveWebBase(tasksDir)"
provides:
  - "Doors footer on tk query/children/agent issues/search/blocked/stale human output (list/ready already had it)"
  - "CLI webBase delegates to resolveWebBase (one rule for CLI + TUI)"
  - "Web list-view rows carry the doors"
affects: [07-04 (verification)]
actuals:
  tokens: 3500
  tasks: 2
  commits: 0
key-files:
  created:
    - packages/cli/test/doors.test.ts
  modified:
    - packages/cli/src/tk.ts
    - packages/cli/src/presentation.ts
    - packages/cli/test/presentation.test.ts
    - packages/web/src/app.html
    - packages/web/test/server.test.ts
    - docs/src/content/docs/overview.md
key-decisions:
  - "A private `doorsFooter(webBase)` helper in presentation.ts gives search/blocked/stale the same `review tk review <id> · <base>/tasks/<id>` footer as formatIssueList; undefined base → byte-identical old output."
  - "`readRuntimeRegistry` and `WEB_DEFAULT_PORT` stay imported in tk.ts (still used by `tk web`/`runtime list`)."
  - "`tk stale --days 0` works (cutoff = now), so stale stays in the e2e."
requirements-completed: [REC-02]
completed: 2026-11-10
---

# Phase 07 Plan 03: Review doors on every CLI listing and web list rows — Summary

**Every CLI command that lists tasks now ends with the doors footer, and its web base comes from the shared `resolveWebBase` rule. Rows in the web list view show `tk review <id>`, with the full `<origin>/tasks/<id>` URL in the row's title.**

Commits withheld per AGENTS.md (conservative profile). All work is in the main tree; STATE.md and ROADMAP.md were not touched.

## What changed

- `packages/cli/src/tk.ts`: the body of `webBase(root)` is now `resolveWebBase(join(root, ".tasks"))`, and `resolveWebBase` was added to the `@tasks/surface` import. `blocked`, `query`, `search`, `children`, `stale` and `agent issues` each compute `const base = await webBase(root!)` before `human` and pass it to their formatter. I edited only these dispatch lines and the `webBase` definition. `--json` paths are unchanged.
- `packages/cli/src/presentation.ts`: `formatSearch`, `formatBlocked` and `formatStale` take an optional trailing `webBase?` and append `""` plus `formatDoors(reviewDoors("<id>", webBase))` through a new `doorsFooter` helper. Empty-result messages return before the footer is added, so they never show doors.
- `packages/cli/test/presentation.test.ts`: 4 unit cases. Each formatter ends with the doors when given a base, its output without a base is exactly the prefix of the output with one, and empty results get no footer.
- `packages/cli/test/doors.test.ts` (new e2e): the test sets up a parent, a child blocked by a separate blocker, and an agent-assigned issue, and registers a web runtime at `http://127.0.0.1:5999`. Then `list`, `ready`, `query status=open`, `children`, `search`, `blocked`, `stale --days 0` and `agent issues` all print `http://127.0.0.1:5999/tasks/<id>` and `tk review <id>`. With no runtime registered, `list` prints `http://localhost:21579/tasks/<id>`, and `search --json` has no footer.
- `packages/web/src/app.html`: in `renderList`, each `.lrow` gets a trailing `<span class="ldoors mono" title="${esc(doorsFor(i).web)}">${esc(doorsFor(i).tui)}</span>`, plus a `.lrow .ldoors` CSS rule. There is no narrow-width media query for `.lrow`, so the span is always visible. Both values are interpolated through `esc()` (T-07-05). I touched only the `.lrow` CSS block and `renderList`.
- `packages/web/test/server.test.ts`: the shell test now asserts `class="ldoors mono"` and `doorsFor(i).tui` are present.
- `docs/src/content/docs/overview.md` (~line 538): I updated the doors paragraph that 07-02 already changed instead of adding a second one. It now lists every door surface (the CLI footer on all 8 list-family commands, the TUI, and the web modal, board cards and list rows). It also says the rule is shared by CLI and TUI, that the web UI uses its own origin, and that `--json` lists have no footer while `tk show --json` carries `review_doors`. The `:21579` default was already in place.

## Verification (all run)

| Command | Result |
|---|---|
| `bun test packages/cli/test/presentation.test.ts packages/cli/test/doors.test.ts packages/cli/test/finish.test.ts` | 28 pass / 0 fail |
| `cd packages/cli && bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `bun test --timeout 15000 packages/web/test/server.test.ts` | 13 pass / 0 fail |
| `grep -n 21579 docs/src/content/docs/overview.md` | hit (line 538) |
| `cd docs && bun run build` | Complete |
| `grep -rn 4747 packages/*/src docs/src` | no matches |
| Extra: `bun test --timeout 30000 packages/cli/test` | first run 20+ transient failures in tk.test.ts; `tk.test.ts` alone 57/0; full rerun 171 pass / 0 fail |

## Deviations from Plan

- **TDD order:** I wrote the implementation before the unit and e2e tests. I did not capture a RED run, so there is no recorded failing run. The tests pin behavior that did not exist before: no doors footer was printed by any of these formatters or commands.
- **Fixture:** the `formatBlocked` unit fixture needs a full `DependencyEdge` (issueId, createdAt, createdBy, metadata, wireUnknown) and `dependencyCount: 1` to pass `IssueSchema`.
- **Scope addition:** `agent issues` was added to the e2e even though the plan's behavior list leaves it out. The must-have truth includes it.
- **Transient full-suite failures:** the first full `packages/cli/test` run had many tk.test.ts failures. They did not reproduce in isolation or on a full rerun, which came back 171/0. The likely cause is concurrent executors (06-01) editing `tk.ts` during the run. I did not investigate further.

## Self-Check: PASSED
