# Requirements — Task → Review (v1)

v1 scope = the review loop from `.agents/plans/2026-10-08-task-to-review.md` (steps 4–12). Mock shells (steps 1–3) and the pre-existing tracker are validated baseline (PROJECT.md §Validated). One requirement per phase-mappable capability; traceability table filled by roadmap.

## GIT — Git adapter & worktrees

- [ ] **GIT-01**: Typed git adapter in `packages/git` the hunk way — one abortable runner, enumerated commands, porcelain parsing — so every later git call goes through it
- [ ] **GIT-02**: `resolveWorktreePath()` (gw port) — default sibling dir `<repoRoot>/../<repoName>-<id>`, `worktree.dir` workspace config, per-task metadata override; one resolver used by both `tk work` and `tk worktree create`, inline `runWorktree` path logic deleted
- [ ] **GIT-03**: `tk work <id>` creates/enters the worktree on branch `tk/<id>` and records the pinned base SHA, worktree path, and branch in the task record

## CHG — Changeset derivation

- [ ] **CHG-01**: Commits + diff derive live from the worktree branch vs the pinned base on every read — no agent-supplied lists, no per-read caching
- [ ] **CHG-02**: Terminal changeset snapshot (`{base, head, files}` frozen) written only at close+prune; closed tasks keep rendering from the frozen snapshot with no worktree present

## FIN — Completion contract

- [ ] **FIN-01**: `tk finish <id> --session <sid>` records the session id and moves the task to `ready-to-review` — and only that status; the command cannot set closed/done

## REV — Review component & storage

- [ ] **REV-01**: `packages/review` vendored from hunk — changeset, review types, watch controller, @pierre/diffs dep — with session broker and comment store stripped; `hunk-vcs`/`hunk-git` fold into `packages/git` (one adapter, no second one); the `tk hunk` spawn path deleted
- [ ] **REV-02**: Reviewer comments and in-diff edits persist straight to the task record (TUI and web write the same store) with per-comment resolve state and "All resolved" thread header
- [ ] **REV-03**: `tk review <id>` opens the vendored TUI over the tk-derived diff — comment, live re-render on new commits, in-view edit that writes the worktree file

## WEB — Web review surface

- [ ] **WEB-01**: `packages/web` gains the same three views on @pierre/diffs `./react` + `./edit` — task view (description, sessions, artifacts rail), artifact view (file/doc + comments), diff view with per-hunk/per-file comments
- [ ] **WEB-02**: Web diff is live through `/events` SSE and editable through a write endpoint over the same worktree files — web comment → task store → TUI; web edit → TUI diff

## LC — Worktree lifecycle

- [ ] **LC-01**: `gitIsMergedToBase()` safety (gw port) — `tk worktree remove` and every prune path refuse while the branch is unmerged (dirty/unpushed/stashes already checked)
- [ ] **LC-02**: `tk close <id>` auto-prunes the task's worktree when the record closes — safety checks first, removal second, prune failures non-fatal to the close
- [ ] **LC-03**: `tk worktree clean` lists every closed-task, merged, clean worktree (gw clean semantics); dry-run by default, `--yes` removes
- [ ] **LC-04**: Lifecycle hooks `worktree.post_start` / `post_checkout` / `pre_end` on workspace config run at those points; `tk work`/`worktree create` post-start detects the package manager and installs deps (configurable off)

## INJ — Injection

- [ ] **INJ-01**: `tk onboard` snippet, `tk prime` context, `skills/tasks/SKILL.md`, and root AGENTS.md all state the contract — work in `tk work <id>`, finish with `tk finish <id> --session <id>`, never mark done, review with `tk review <id>`

## v2 (deferred)

- Tier-b product epics (tracked on tk: tasks-34rm, -k5kp, -lx7a, -d0rq, -zshv, -nzg0, -xcov, -6zif, -gt6y)
- Post-review accept/merge/close automation and rejection flow
- Event fabric ("the wire") + `tk next` oracle

## Out of Scope

- Interactive keybindings inside `tk show` — show renders records; interactivity belongs to `tk review`
- Rewriting hunk's rendering stack — @opentui/react is already the shared stack
- Everything the reference app does that is not the review experience

## Traceability

<!-- Filled by roadmap: requirement → phase. -->

| Requirement | Phase |
|-------------|-------|
| (pending) | |
