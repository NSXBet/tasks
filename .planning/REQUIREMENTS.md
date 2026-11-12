# Requirements — Task → Review (v1)

v1 scope = the review loop from `.agents/plans/2026-10-08-task-to-review.md` (steps 4–12). Mock shells (steps 1–3) and the pre-existing tracker are validated baseline (PROJECT.md §Validated). One requirement per phase-mappable capability; traceability table filled by roadmap.

## GIT — Git adapter & worktrees

- [x] **GIT-01**: Typed git adapter in `packages/git` the hunk way — one abortable runner, enumerated commands, porcelain parsing — so every later git call goes through it
- [x] **GIT-02**: `resolveWorktreePath()` (gw port) — default in-repo dir `<repoRoot>/.worktrees/<repoName>-<id>` (auto-ignored; decided in Phase 2 UAT), `worktree.dir` workspace config, per-task metadata override; one resolver used by both `tk work` and `tk worktree create`, inline `runWorktree` path logic deleted
- [x] **GIT-03**: `tk work <id>` creates/enters the worktree on branch `tk/<id>` and records the pinned base SHA, worktree path, and branch in the task record

## CHG — Changeset derivation

- [x] **CHG-01**: Commits + diff derive live from the worktree branch vs the pinned base on every read — no agent-supplied lists, no per-read caching
- [x] **CHG-02**: Terminal changeset snapshot (`{base, head, files}` frozen) written only at close+prune; closed tasks keep rendering from the frozen snapshot with no worktree present

## FIN — Completion contract

- [x] **FIN-01**: `tk finish <id> --session <sid>` records the session id and moves the task to `ready-to-review` — and only that status; the command cannot set closed/done

## REV — Review component & storage

- [x] **REV-01**: `packages/review` vendored from hunk — changeset, review types, watch controller, @pierre/diffs dep — with session broker and comment store stripped; `hunk-vcs`/`hunk-git` fold into `packages/git` (one adapter, no second one); the `tk hunk` spawn path deleted
- [x] **REV-02**: Reviewer comments and in-diff edits persist straight to the task record (TUI and web write the same store) with per-comment resolve state and "All resolved" thread header
- [x] **REV-03**: `tk review <id>` opens the vendored TUI over the tk-derived diff — comment, live re-render on new commits, in-view edit that writes the worktree file

## WEB — Web review surface

- [x] **WEB-01**: `packages/web` gains the same three views on @pierre/diffs `./react` + `./edit` — task view (description, sessions, artifacts rail), artifact view (file/doc + comments), diff view with per-hunk/per-file comments
- [x] **WEB-02**: Web diff is live through `/events` SSE and editable through a write endpoint over the same worktree files — web comment → task store → TUI; web edit → TUI diff

## LC — Worktree lifecycle

- [x] **LC-01**: `gitIsMergedToBase()` safety (gw port) — `tk worktree remove` and every prune path refuse while the branch is unmerged (dirty/unpushed/stashes already checked)
- [x] **LC-02**: `tk close <id>` auto-prunes the task's worktree when the record closes — safety checks first, removal second, prune failures non-fatal to the close
- [x] **LC-03**: `tk worktree clean` lists every closed-task, merged, clean worktree (gw clean semantics); dry-run by default, `--yes` removes
- [x] **LC-04**: Lifecycle hooks `worktree.post_start` / `post_checkout` / `pre_end` on workspace config run at those points; `tk work`/`worktree create` post-start detects the package manager and installs deps (configurable off)

## INJ — Injection

- [x] **INJ-01**: `tk onboard` snippet, `tk prime` context, `skills/tasks/SKILL.md`, and root AGENTS.md all state the contract — work in `tk work <id>`, finish with `tk finish <id> --session <id>`, never mark done, review with `tk review <id>`

### Spec extension (task-to-review.html R17–R74 not covered above)

- [x] **REC-01**: Harness registry — omp first, codex and cursor entries; the agent line in `tk show` renders from it (R50)
- [x] **REC-02**: Review doors — `tk review <id>` and the web `/tasks/<id>` URL — on every task surface (R51)
- [x] **REC-03**: Session id and finish time recorded on the task and shown in the record's agent line, with a comments row (R17)
- [x] **CMT-01**: One comment store per task; each comment carries its location — file, line(s), or evidence id (R73, R74)
- [x] **CMT-02**: Comment status open | sent | resolved | dismissed with done/remove controls; each transition is a `task.comment` event (R63)
- [x] **CMT-03**: Explicit batched send of review comments to the agent as cards — never a firehose (R62)
- [x] **VIEW-01**: Task view — description front and center, evidence-backed artifacts main column, comments; sessions never lead (R33–R36, R64, R68)
- [x] **VIEW-02**: Tabbed task rail — sessions / changes / workspace / minimap (R67)
- [x] **VIEW-03**: No start-work on ready-to-review; open diff primary; worktree visible on narrow views (R69, R70)
- [x] **VIEW-04**: Changes opens the diff modal; modal expands to full diff; evidence images commentable in the diff flow; distinct artifact view (R37–R39, R71, R72, R74)
- [x] **WIRE-01**: Watch becomes a broker — subscribe to one or many tasks, many agents at once (R56)
- [x] **WIRE-02**: One event stream drives TUI and web live views and notifications (R57)
- [x] **WIRE-03**: User messages (comments, approvals) ride the stream and agents pick them up automatically (R58)
- [x] **PR-01**: One PR per task with create / sync / close (merge) via gh — sync is a verb, never a poller (R28, R65)
- [x] **PR-02**: Chat carries a stat card linking to the changes view — never a raw diff (R60)
- [x] **PR-03**: Changes fall back to task.commit / task.report stats when the worktree is out of reach (R61)

## v2 (deferred)

- Tier-b product epics (tracked on tk: tasks-34rm, -k5kp, -lx7a, -d0rq, -zshv, -nzg0, -xcov, -6zif, -gt6y)
- Post-review accept/merge/close automation and rejection flow
- `tk next` oracle (event fabric moved into v1 as Phase 10)

## Out of Scope

- Interactive keybindings inside `tk show` — show renders records; interactivity belongs to `tk review`
- Rewriting hunk's rendering stack — @opentui/react is already the shared stack
- Everything the reference app does that is not the review experience

## Traceability

<!-- Filled by roadmap: requirement → phase. -->

| Requirement | Phase |
|-------------|-------|
| GIT-01 | Phase 1 |
| GIT-02 | Phase 1 |
| GIT-03 | Phase 1 |
| CHG-01 | Phase 2 |
| CHG-02 | Phase 2 |
| FIN-01 | Phase 2 |
| REV-01 | Phase 3 |
| REV-02 | Phase 3 |
| REV-03 | Phase 4 |
| WEB-01 | Phase 5 |
| WEB-02 | Phase 5 |
| LC-01 | Phase 6 |
| LC-02 | Phase 6 |
| LC-03 | Phase 6 |
| LC-04 | Phase 6 |
| INJ-01 | Phase 6 |
| REC-01 | Phase 7 |
| REC-02 | Phase 7 |
| REC-03 | Phase 7 |
| CMT-01 | Phase 8 |
| CMT-02 | Phase 8 |
| CMT-03 | Phase 8 |
| VIEW-01 | Phase 9 |
| VIEW-02 | Phase 9 |
| VIEW-03 | Phase 9 |
| VIEW-04 | Phase 9 |
| WIRE-01 | Phase 10 |
| WIRE-02 | Phase 10 |
| WIRE-03 | Phase 10 |
| PR-01 | Phase 11 |
| PR-02 | Phase 11 |
| PR-03 | Phase 11 |
