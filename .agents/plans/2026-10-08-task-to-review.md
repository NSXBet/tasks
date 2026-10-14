# Task → review — implementation plan

The product section is the
contract; every step names the code it touches. Nothing beyond the spec.

## Architecture rules

- Package-oriented, locality of behavior: every piece of this work ships as a
  package module — code lives where it's used, and packages never reach up a
  directory. Cross-package imports go through workspace dependencies
  (`@tasks/<pkg>`), never `../../<pkg>/src/...`.
- Known violation to fix as part of this work: `packages/pi-extention/src/*`
  imports `../../surface/src/index.ts` — it must declare `@tasks/surface` in
  its `package.json` and import by name.
- One git adapter: all git access flows through a typed `packages/git` module
  — the port of hunk's `hunk-vcs` runner + `hunk-git` commands (abortable
  spawn, enumerated commands, porcelain parsing). Command code never spawns
  `git` ad hoc. No pure-JS git lib qualifies: isomorphic-git has no worktree
  support, nodegit is a stalled native module — the typed adapter over the git
  binary is the lib, exactly hunk's way.
- DRY / Open-Closed: extend existing components in place (`runWorktree`,
  `WorkspaceConfigSchema`, `closeMany`); no parallel second implementations.
- Code quality over completeness: a smaller, well-built surface beats a
  feature-complete mess.

## The product

```
$ tk show TK-142

  TK-142  Fix flaky retry logic in uploader            ● ready-to-review
  ─────────────────────────────────────────────────────────────
  branch     tk/TK-142 → main          worktree ~/worktrees/TK-142
  commits    3                         (vs main)
  diff       +38 −12   3 files         computed from the branch
  agent      omp · session a1b2c3d4    finished 14:32
  harness    omp (first) · codex · cursor
  review  ▸ TUI  tk review TK-142
          ▸ web  https://…/tasks/TK-142
  ─────────────────────────────────────────────────────────────
```

Every surface that renders a task — `tk show`, the list, kanban, web task
views — carries the same two doors into review: the TUI command and the web
URL. Nothing is ever more than one hop from the review.

The `agent` field is a list of harness types — a registry we will define; omp
is the first of them (codex and cursor next). Adding a harness is an entry in
the registry, not a patch. The name of this work is **task → review**: it
delivers the pull-request experience, but the PR experience is not what
defines it — the task→review flow is.

Around the record, three views — reverse-engineered from HumanLayer, built in
both the TUI and the web:

### 1. Task view — description front and center

```
  ┌ tasks ──────────┬───────────────────────────────────┬ artifacts ──────┐
  │ auth refactor   │  Fix flaky retry logic in uploader│ research.md   2 │
  │ api limiting    │  repo ~/workdir/platform-api      │ retry.ts      5 │
  │ dashboard       │  [ start work ]  [ open diff ]    │ bench.txt     1 │
  │ …               │                                   │                 │
  │                 │  status   session           upd   │                 │
  │                 │  done     research patterns 10m   │                 │
  │                 │  running  design discussion  2m   │                 │
  └─────────────────┴───────────────────────────────────┴─────────────────┘
```

Left: the task list tk already has (kanban). Center: the description, the
actions, and the session table — agent sessions recorded on the task with
lifecycle status. Right rail: artifacts — attached files (`tk attach`) plus
the changed files derived from the branch — each with its comment count.

### 2. Artifact view — every file, commentable

```
  ┌ TK-142 / retry.ts ───────────────────────┬ comments · 5 open ─────┐
  │ (doc rendered, or changed file content)  │ ● kyle  will the mutex │
  │                                          │         deadlock?      │
  └──────────────────────────────────────────┴────────────────────────┘
```

The artifact sits front and center; comments sit beside it. Humans and agents
comment on the same object, and the thread lands on the task record.

### 3. Diff view — copied from hunk

```
  ┌ src/middleware/auth.ts ────────────────────────────────────┐
  │ - const res = await fetch(REFRESH_URL, {                   │
  │ + const res = await refreshMutex.run(token, async () => {  │
  └─────────────────────────────────────────────[ comment ]────┘
  message: Send a message…
```

The diff component is copied from hunk (step 4): red/green code changes per
changed file, the agent's rationale above the change, and a message box below
— comments feed back onto the task record the agent reads.

One record, like a GitHub PR: the branch with its commits, the diff computed
from that branch, the session that produced it, two doors into review. Nothing
is handed over file by file — tk derives commits and diff from the branch
itself; the agent supplies no file lists.

The review diff is live and workable: it watches the worktree and re-derives
as commits land, and it is a working surface — the reviewer edits the changed
files in place and comments on lines and files, all of it landing on the task
record.

## How it gets there

### 1. The agent works in a worktree — `tk work <id>`

New command in `packages/cli/src/tk.ts`, running on `packages/git` — the typed
adapter (hunk's way: one runner, enumerated commands — no scattered
`git` subprocess calls): `gitWorktreeAdd` and every other git call flow
through it. Worktree path and branch derived from the
issue (`tk-<id>/`, branch `tk/<id>`). It records the branch on the issue via
the existing update path (`issue.branch`) and the path in issue metadata
(`worktree` key — metadata already rides the wire, `presentation.ts:88`).

`tk show` grows a WORKTREE line next to the existing BRANCH line
(`presentation.ts:167`). `tk worktree list/info/remove` stay as they are.

```
$ tk work TK-142
  → worktree ready at ~/worktrees/TK-142 (branch tk/TK-142)
```

### 2. When the agent is done, the session id lands on the task

Agents run inside harness sessions and the agent hooks already receive the
session id (`packages/cli/src/agent-hooks.ts:83` codex, `:154` cursor). The
finish path (step 3) records it: `--session <id>` flag, or `TK_SESSION` env.
It is written to metadata (`agent_session` + timestamp) at completion —
when the agent finishes (`tk finish`) — never at start. Step 6 makes agents
pass it.

### 3. Completion is automatic — the branch is the evidence

Like a GitHub PR: commits and diff are derived from the task's branch, never
passed file by file. Worktree state is **lazy, not cached**: whenever a read
needs it, `tk show`, review, and web fetch it live from git through the
adapter — `git log --oneline <base>..<branch>` for the commits and
`git diff <base>...<branch>` for files + hunks. The task record holds only
identity: worktree path, branch, and the base SHA pinned once at `tk work`
creation (merge-base vs `gitDefaultBranch`) into
`metadata["changeset"].base`. The changeset snapshot is written exactly once —
when the lifecycle is done (`tk close` + worktree purged, step 7) — freezing
the final `{base, head, files}` into the record so it renders after the
branch and worktree are gone. The agent supplies nothing; there is no file
list to hand over.

The agent's only completion action is `tk finish <id>`: records the session
id (step 2) and moves status to `ready-to-review` — the existing status whose
transition already finalizes the active run
(`packages/surface/test/status-runs.test.ts:67`). It can set exactly one
status: `ready-to-review`. It cannot close or mark done — harness behavior
enforced in code, not just in docs.

Produced artifacts (test output, benchmarks) stay optional and attach through
the existing `tk attach <id> --evidence <file>` blob path when the agent has
something extra to hand in — they supplement the computed diff, never
replace it.

```
$ tk finish TK-142 --session a1b2c3d4
  session a1b2c3d4 recorded
  status → ready-to-review
  3 commits · +38 −12 · 3 files (computed from tk/TK-142)
```

### 4. Review is ours — hunk copied and reimplemented, `tk review <id>`

The PR plumbing — base detection, commit list, changed files, hunks — is not
provided by hunk. We include the batteries: tk derives them from the task's
branch (step 3) and feeds them to the review component.

Three behaviors define the component — the reason we copy rather than spawn:

- **Live** — the diff is a view over the worktree, not a snapshot. The
  component watches the worktree and re-runs the step 3 derivation as commits
  and edits land; no restart, no refresh key.
- **Editable** — the reviewer edits a changed file from inside the review
  surface; the edit writes back to the worktree file and the diff re-renders
  around it.
- **Commentable** — line and file comments persist straight to the task store
  (replacing hunk's own comment storage, as below).

Hunk (https://github.com/modem-dev/hunk/) is copied into the repo as the
starting point and reimplemented as tk's own diff component,
`packages/review/`:

- copied: the diff-rendering TUI core and its git plumbing (`hunk`,
  `hunk-git`) plus the `@pierre/diffs` renderer it is built on;
- replaced: hunk's diff input and comment storage — the component takes the
  tk-derived base...branch diff as input and writes reviewer comments
  straight into the task store (no `hunk session comment` sidecar, no
  `tk hunk <id> sync`);
- cutover: the existing spawn path (`packages/cli/src/hunk.ts` planHunk,
  `tk.ts:972`) is deleted when this lands — upstream hunk stays a code origin
  and reference, never a runtime dependency.

The rendering stack stays hunk's (OpenTUI); reimplemented means swapped
inputs, outputs, and storage, not a rewrite onto tk's Ink stack.

Entry points: `tk review <id>` from anywhere, and the review line printed by
`tk show`. Interactive keybindings inside `tk show` are out of scope (§ below).

```
$ tk review TK-142
┌ diff ─ src/uploader/retry.ts ──────────────────────────┐
│  - if (err) return retry(attempt)                      │
│  + if (err && attempt < MAX) return retry(attempt + 1) │
└─────────────────────────────── [c] comment  [q] quit ──┘
```

### 5. The same review on the web — `packages/web`

`packages/web/src/server.ts` (routes at `:74-160`) gains the same three views
as the TUI: the task view (`GET /tasks/:id` — description front and center,
sessions, artifacts rail), the artifact view (file or doc with its comment
thread), and the diff view over the base...branch
diff, comments rendered per hunk and per file from the task record. Comments
composed on the web persist straight to the task store — the same store the
TUI writes — so TUI and web are one review surface in two shapes. The web
diff is live through the existing `/events` SSE stream (`server.ts:79`) and
editable through a small write endpoint over the same worktree files — the
component's three behaviors, not a read-only PR page.

Renderer: `@pierre/diffs` is a public Apache-2.0 npm package (not part of
hunk's source), so `packages/web` imports it directly — `./react` for the
diff components and `./edit` for its edit-mode editor, which is the web half
of the editable-diff behavior. The session-broker embed is the fallback only
if the spike shows a reason for it.

### 6. Injection — how the harness learns this workflow

Resolved with tk's existing injection surface, the same mechanism beads uses:

1. `tk onboard` snippet (`ONBOARD`, `packages/cli/src/presentation.ts:624`)
   → pasted into AGENTS.md/CLAUDE.md, teaching the workflow rules.
2. `tk prime` context, delivered by the agent hooks at SessionStart
   (`agent-hooks.ts`) → agents get the rules on every session start.
3. `skills/tasks/SKILL.md` (`packages/cli/skills/tasks/` and
   `packages/extension/skills/tasks/`) → the workflow reference.

All three state the contract: work in `tk work <id>`; finish with
`tk finish <id> --session <id>`; never mark done — the recorded worktree,
branch, and derived diff are the evidence; review with `tk review <id>`.
This repo's root AGENTS.md Tasks block is updated to match, since that is
what agents here actually read.

No runtime enforcement beyond the commands: the injected rules are the
contract, and `tk finish`'s can't-close shape is the backstop.

### 7. Worktree lifecycle — gw's functionality copied; tk replaces gw

tk's `tk worktree create <name>` resolves its path inline
(`packages/cli/src/tk.ts:190` — `resolve(start, name)`, inside the repo, then
hand-gitignored) and knows nothing about tasks. nsxbet/gw (yurifrl fork, Go)
solves the same problem with one source of truth. Same treatment as hunk: the
functionality is copied from gw and reimplemented in TypeScript inside tk —
after this phase tk is the worktree manager and gw has no role in tk-using
repos:

- **One resolver, one naming rule.** `resolveWorktreePath()` in
  `packages/git` — the port of gw's `ResolveWorktreePath`
  (`gw/internal/git/worktree.go`): default `<repoRoot>/../<repoName>-<id>`,
  or `<dir>/<repoName>-<id>` when a worktree dir is configured (relative
  resolved against the repo root). Branch `tk/<id>`. Both `tk work <id>`
  (step 1) and `tk worktree create` call it — the inline logic in
  `runWorktree` is deleted, not wrapped.
- **Config, two levels.** `WorkspaceConfigSchema`
  (`packages/workspace/src/config.ts`) gains `worktree: { dir }` as the
  workspace default; the task's metadata carries its own override
  (`worktree_dir` plus the recorded path/branch/base), so a task pins its
  worktree where it was created and survives later config changes.
- **Merge-aware safety.** `packages/git` gains `gitIsMergedToBase(path,
  branch, base)` — gw's third check (`gw/cmd/safety.go`); `tk worktree
  remove` and every prune path refuse while the branch is unmerged.
  dirty/unpushed/stashes are already checked today.
- **Auto-prune on done.** `tk close <id>` (closeMany,
  `packages/surface/src/operations/mutate.ts:229`) prunes the task's worktree
  when the record closes — safety checks first, removal second, failures
  reported and non-fatal to the close itself. At prune time the lazy changeset
  is fetched one last time and frozen into `metadata["changeset"]` as the
  terminal snapshot; until that moment nothing is cached.
- **Bulk prune.** `tk worktree clean` lists every worktree whose task is
  closed and whose branch is merged and clean (gw's `clean` semantics,
  `gw/cmd/command_clean.go`); dry-run by default, `--yes` removes.

- **Lifecycle hooks.** gw's project-level hook keys copied onto the
  workspace config: `worktree.post_start`, `worktree.post_checkout`,
  `worktree.pre_end` (gw's post_start_hook, post_checkout_hook,
  pre_end_hook) — shell commands run at those lifecycle points.
- **Environment setup on start.** gw detects the package manager and
  prepares the fresh worktree (install deps); the same detection is ported
  into `tk work` / `tk worktree create` post-start, configurable off.

## Build order

Interfaces first. The order values visibility over what reads as core: the
user gets a mock implementation of every UI up front — navigation and click
actions only, every action displays `WIP` — so the interaction can be
evaluated and nudged before any real code lands. Then the real layer is
filled in behind the shells.

**Phase 0 — mock interfaces (no functionality beyond navigation; actions say `WIP`)**

| # | Build | Delivers | Verified by |
|---|---|---|---|
| 1 | mock TUI — the three views (task, artifact, diff) + the diff view as full page and modal, hard-coded data, navigation and clicks only | the interaction, testable on day one | walk every view; every action displays `WIP` |
| 2 | mock web — same three views on `@pierre/diffs` shells, hard-coded data | the same interaction in the browser | walk every view; every action displays `WIP` |
| 3 | mock CLI — `tk show`, `tk work`, `tk review` output shapes against fake records | the record's exact shape, reviewable as text | `tk show TK-142` renders the PR-shaped record from fixture data |

**Phase 1 — make it real (real code behind the approved shells)**

| # | Build | Delivers | Verified by |
|---|---|---|---|
| 4 | `packages/git` — typed git adapter, hunk's way (one abortable runner, enumerated commands, porcelain parsing) — plus `resolveWorktreePath` (gw port) and `tk work <id>`: default sibling dir, `worktree.dir` config, per-task metadata override; branch `tk/<id>`; **pinned base SHA** | the PR container; ad-hoc path logic in `runWorktree` deleted | `tk work` in scratch repo → `git worktree list`, `tk show` branch/worktree |
| 5 | changeset derivation — **lazy**: every read derives live via the adapter (`git log`/`git diff` vs pinned base), nothing cached per read; terminal snapshot written only at close+prune | the PR record: commits + diff, no file lists | two commits → `tk show` lists them fresh after every change; close+prune → frozen snapshot still renders |
| 6 | `tk finish <id> --session` — session id, → `ready-to-review` only, cannot close | the completion contract | finish → status + counts; `close`/`done` refused |
| 7 | vendor hunk slice → `packages/review` (changeset, review types, watch controller; @pierre/diffs dep; strip broker + comment store); `hunk-vcs` + `hunk-git` fold into `packages/git` — one adapter, no second one | the diff component, tk-owned | headless smoke: opens a diff of any repo from node |
| 8 | storage swap — component comments/edits persist to the task store | review state lives on the task | line comment in component → task record, `tk show` |
| 9 | real TUI — the three views wired to the live component; `tk review <id>` | HumanLayer layout in the terminal | full loop: comment, live re-render, in-view edit |
| 10 | real web — same layouts wired to `@pierre/diffs` `./react` + `./edit`; `/tasks/:id`, SSE live, write endpoint | HumanLayer layout on the web | web comment → task store → TUI; web edit → TUI diff |
| 11 | worktree lifecycle — gw copied (TS port): `gitIsMergedToBase` safety, auto-prune in `tk close` with terminal changeset snapshot, `tk worktree clean`, lifecycle hooks, pm setup on start | gw's full worktree functionality in tk, task-aware — tk replaces gw | close a merged+clean task → worktree gone, snapshot frozen; unmerged → prune refused, close still succeeds; `worktree.post_start` ran on create |
| 12 | injection — `ONBOARD` snippet, `prime`, `SKILL.md`, root AGENTS.md | the harness learns the workflow | fresh clone → onboard → rules present |

Dependencies: mocks 1–3 are parallel — no prerequisites, hard-coded data
only. Real layer: 4 → 5 → 6. 7 is independent — start it parallel with 4–6;
it touches only a new package. 8 needs 7. 9 needs 5 + 8 (shell from mock 1).
10 needs 5 + 8 (shell from mock 2, not 9). 11 needs 4 and runs parallel with
5–8. 12 is last — it documents finished commands. The `pi-extention`
workspace-dep fix rides phase 7 (package hygiene, trivially independent).

The mocks are not throwaway scaffolding to keep around: each mock shell is
replaced by its real implementation (9 and 10 keep the layout the mocks
proved, 3 becomes the real command path), and the mock-only plumbing is
deleted at that step.

## Verification

End-to-end smoke, per step, in a scratch repo:

0. Mocks first: walk the mock TUI and mock web — every view reachable, every
   action displays `WIP`; `tk show` against fixture data renders the
   PR-shaped record — before any real code merges.
1. `tk create` → `tk work <id>` → commit inside the worktree → assert show
   renders WORKTREE/branch and `tk worktree list` sees it.
2. Two commits inside the worktree → `tk show` lists both commits and the
   changed files with no agent-supplied lists; `tk finish <id> --session s1`
   → session in metadata, status `ready-to-review`, command cannot set
   closed/done; an optional `tk attach --evidence` artifact renders alongside.
3. `tk review <id>` opens the vendored review TUI over the tk-derived diff
   without a manual branch link; a line comment lands directly in the task
   store and shows in `tk show`; a commit from a second terminal re-renders
   the diff live; an in-TUI edit persists to the worktree file and re-renders.
4. Web: record, derived diff, and the TUI's comment all render; the web view
   updates through `/events` when the worktree changes; a web edit writes the
   worktree file and appears in the TUI's diff.
5. Lifecycle: close a task whose branch is merged and clean → its worktree is
   pruned; an unmerged branch → prune refused, close still succeeds;
   `tk worktree clean --dry-run` lists every closed-task worktree; a
   configured `worktree.post_start` command runs when `tk work` creates the
   worktree; after the prune, the closed task still renders its commits and
   diff from the frozen snapshot with no worktree or branch present.
6. Injection: fresh clone → `tk onboard` → AGENTS.md contains the workflow
   rules; agent session with hooks primed shows the same rules.

## Out of scope

- What happens after review: accept/merge/close automation, rejection flow.
- Interactive keybindings inside `tk show`.
- Rewriting hunk's rendering stack — none needed: tk's TUI (`packages/tui`)
  already runs @opentui/react, the same stack hunk uses; the copied component
  drops in with only inputs, outputs, and storage changing.
