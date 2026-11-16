---
title: "Overview"
order: 1
---
# Tasks

Local-first issue tracker with dependency chains. Inspired by [beads](https://github.com/steveyegge/beads), redesigned as a TypeScript library with pluggable storage adapters (SQLite, PostgreSQL, file-based).

## What's different from the original

- **Library-first**: clean hexagonal architecture — domain, application ports, and swappable adapters
- **Multiple backends**: file-based (default, git-committable JSON per issue), SQLite, and PostgreSQL
- **Bun-native**: runs directly from TypeScript source via `bun`, no build step required for CLI
- **Beads migration**: `tk migrate` imports a `.beads/` workspace issue-by-issue, non-destructively

## Install

Prebuilt self-contained binaries (no Bun required) for linux/darwin on arm64/x64:

```bash
# Homebrew (macOS and Linux)
brew install nsxbet/tap/tasks

# One-line script — latest stable release, checksum-verified
curl -fsSL https://raw.githubusercontent.com/NSXBet/tasks/main/install.sh | sh

# Nightly pre-release from every push to main
curl -fsSL https://raw.githubusercontent.com/NSXBet/tasks/main/install.sh | sh -s -- --latest

# Pinned version
curl -fsSL https://raw.githubusercontent.com/NSXBet/tasks/main/install.sh | sh -s -- v0.3.0
```

The script installs to `~/.local/bin/tk` (override with `TK_BIN_DIR`). Later,
`tk update` self-updates in place — or `brew upgrade nsxbet/tap/tasks` for
Homebrew installs — and `tk update --latest` moves to the newest nightly.

## Requirements

- [Bun](https://bun.sh) 1.3+ (only for running from source; the installed binary is self-contained)

## Quick start

```bash
bun install

# Run CLI directly from source
tk init
tk create "Fix login bug"
tk ready --claim --json
```

## Task → review loop

Every task is a PR-shaped record: it gets its own worktree on branch `tk/<id>`, its commits and diff are derived from that branch (the agent never supplies a file list), and it reaches review only through `tk finish`. The loop, end to end:

```bash
ID=$(tk q "Change bg to blue")                    # 1. create — the title seeds the branch name
tk work $ID                                       # 2. claim + worktree .worktrees/<repo>-<id> on tk/<id>, base pinned
cd .worktrees/<repo>-$ID && git commit -am "…"    # 3. commit in the worktree — commits are the evidence
tk finish $ID --session $TK_SESSION               # 4. hand over → ready-to-review; prints the stat card
tk watch $ID --until "status=approved|rejected"   # 5. agent waits for the verdict (exit 124 on --timeout)
tk review $ID                                     # 6. reviewer: TUI diff review (web: <web base>/tasks/<id>)
tk comments send $ID                              #    send open review comments to the agent as one batch
tk pr create $ID                                  # 7. optional: push tk/<id> and open its one PR via gh
tk close $ID --reason "…"                         # 8. close — prunes the worktree and branch once merged + clean
```

| status | who moves it | how |
|---|---|---|
| `open` | creator | `tk create` / `tk q` |
| `in_progress` | agent | `tk work <id>` |
| `ready-to-review` | agent | `tk finish <id> --session <sid>` — the only path into review; it can never set `closed` |
| `approved` / `rejected` | reviewer | `tk update <id> --status approved` (or `rejected`), after `tk review` / `tk comments` |
| `closed` | reviewer | `tk close <id>`; a rejected task restarts at `tk work <id>` |

Deeper: [Task worktrees](#task-worktrees) · [Finishing a task](#finishing-a-task) · [The review record](#the-review-record) · [Changes and the stat card](#changes-and-the-stat-card) · [Review](#review) · [Waiting for review](#waiting-for-review) · [Pull requests](#pull-requests) · [Terminal UI](#terminal-ui) · the agent-side contract in [Agent injection — the workflow contract](#agent-injection--the-workflow-contract).

## Packages

| Package | Description |
|---------|-------------|
| `@tasks/domain` | Pure issue model: branded types, Zod schemas, invariant validation; review-record, stat-card and PR-record helpers |
| `@tasks/application` | Use-case contracts, inbound/outbound ports |
| `@tasks/sqlite` | SQLite adapter (Bun built-in `bun:sqlite`) |
| `@tasks/postgres` | PostgreSQL adapter with migrations |
| `@tasks/file` | File-based adapter — one JSON per issue, git-friendly |
| `@tasks/s3` | S3-compatible blob store for attachments |
| `@tasks/workspace` | `.tasks/config.json` schema, backend resolution/inference, adapter lifecycle |
| `@tasks/beads` | Beads migration: record decoding, parent ordering, transactional import |
| `@tasks/git` | Typed git adapter — the only place tk spawns git: worktrees, changeset/diff derivation, merge predicate, hooks |
| `@tasks/surface` | Host-agnostic typed command surface shared by every frontend; event log (`events.jsonl`), watch, changes, PR (`gh`) |
| `@tasks/rpc` | RPC wire protocol and the single verb table (see [RPC API](#rpc)) |
| `@tasks/daemon` | `tkd` per-workspace unix-socket daemon; hosts `tk web` |
| `@tasks/review` | tk's review component (vendored from Hunk): diff model, comment lifecycle, task-view model, OpenTUI view |
| `@tasks/cli` | `tk` CLI executable |
| `@tasks/tui` | OpenTUI-based terminal UI: list, kanban board, dependency graph, insights, task / artifact / diff review views |
| `@tasks/web` | `tk web` local web UI: Bun HTTP server, JSON API, SPA shell and the review island on `@pierre/diffs` |
| `@tasks/terminal-image` | Inline terminal image painting (kitty graphics / half blocks) for evidence |
| `@tasks/lua` | Hand-written Luau tk RPC client |
| `pi-extention` | pi / omp agent extension (tools, inbox, `tasks_wait`) |

The layering (domain → application ports → adapters → surface → frontends) and every data path are described in [Architecture](#architecture); the repo layout in [Structure](#structure).

## CLI usage

```bash
tk init [--prefix <p>] [--backend ...]  # Initialize .tasks/ workspace (default prefix: tk, backend: file)
tk create <title> [opts]      # Create issue
tk list [--status <s>]        # List issues; shorthands: --open --closed --all --ready-to-review --approved --rejected
tk ready [--claim]            # List unblocked issues
tk show <id>                  # PR-shaped record: agent line, review doors (tk review <id> + web /tasks/<id>), comments row
tk work <id>                  # Claim + create/re-enter the task worktree on tk/<id> (base pinned)
tk finish <id> --session <sid> [--harness omp|codex|cursor]  # Hand over for review; records agent session + harness
tk close <id>                 # Close issue (prunes a merged, clean task worktree)
tk update <id> [--branch <name>]  # Update fields; link the issue branch
tk dep <id> add <target>      # Add dependency
tk attach <id> <path>        # Attach a file path (--attach-metadata k=v,k2=v2)
tk detach <id> <path>        # Remove an attachment
tk tui [workspace] ['tk://route']  # Launch the terminal UI; deep-link boots into a state, e.g. 'tk://task/<id>'
tk watch <id> --until "status=approved|rejected"  # Block until the review lands (also --drain, --follow, --as, --timeout)
tk daemon [start|status|stop|restart]  # Manage the tkd daemon (one per user; tk web bootstraps it; status --quiet exits 1 when down)
tk mcp [--root <path>]        # MCP stdio server for Claude Code / Cursor / Codex (bridges to the daemon); e.g. claude mcp add tasks -- tk mcp
tk tree [--all] [--depth N]  # Tree view: epics, subtasks, dependency fan-out
tk search <text>              # Full-text search
tk review <id>                # Open the task's review (diff + comments) in the TUI
tk changes <id>               # Stat card: N commits · +A −D · F files + changes-view links (never a diff)
tk pr create|sync|close|merge <id>  # The task's one PR via gh (see Pull requests); tk pr <id> reads the record
tk comments <id>              # Review comments: location, status, author, body (send|resolve|dismiss|reopen)
tk worktree create|list|info|remove|clean  # Worktrees sharing this .tasks/ workspace (see Task worktrees)
tk onboard [install|check|remove]  # Managed workflow block in AGENTS.md; tk prime prints the agent context
tk export                     # Export all as JSONL
tk update                     # Self-update the binary (--latest for nightlies, --check to inspect)
tk agent create <name> [opts]  # Register an agent (see Agents and runs below)
tk runs [--issue <id>] [--state <s>]  # List runs; tk run show|cancel|rerun|message <id>
tk --help                     # Full command list
```

`tk` discovers `.tasks/` by walking upward from cwd. Use `-C DIR` to override. `--json` for structured output, `--markdown` (or `--md`) for markdown — issue lists render as `## id — title` sections separated by `---`. `--readonly` rejects mutations.

### Task worktrees

```bash
tk work tk-abc                 # claim + create/enter <repoRoot>/.worktrees/<repoName>-tk-abc on branch tk/tk-abc
tk worktree create spike       # ad-hoc worktree at <repoRoot>/.worktrees/spike (--branch <existing> to check one out)
tk worktree list               # every worktree and its tasks-workspace state
tk worktree info               # tasks-workspace state for the current worktree
tk worktree remove spike       # merge-aware removal (--force overrides)
tk worktree clean [--yes]      # prune merged, clean worktrees of closed tasks (dry-run by default)
```

`tk work <id>` records the worktree path, the branch `tk/<id>` and the pinned base SHA on the task
(`tk show` renders them); commits and diff are then re-derived from that branch on every read.

- `tk work <id>` and `tk worktree create <name>` share one resolver and always resolve against the
  **main** repo root — running either from inside a task worktree never nests a new worktree under it.
- Placement precedence: per-task `worktree_dir` metadata > `worktree.dir` in `.tasks/config.json`
  (`{name}` expands, otherwise the name is appended) > the default in-repo pool `<repoRoot>/.worktrees/`.
- When the default pool is used, tk appends `/.worktrees/` once to the repo-local `.git/info/exclude`
  (never the tracked `.gitignore`, and skipped if the path is already ignored), so the pool never shows
  up as untracked in `git status`.
- If `tk work` created `tk/<id>` and `git worktree add` then fails, the branch is removed again; a
  pre-existing branch is never deleted. `tk worktree create <name> --branch <existing>` checks the
  existing branch out instead of failing.
- **Merge-aware removal.** One predicate decides whether a branch is merged: it is an ancestor of
  the base, or the pinned base sits on the default branch's tip and the branch is an ancestor of
  that tip, or every commit landed patch-equivalent (rebase / cherry-pick merge — `git cherry`
  reports no `+` line). It guards `tk worktree remove <name>` (an unmerged branch is refused with
  the branch and base named; `--force` overrides) and every prune path below.
- **Auto-prune on close.** `tk close` (and `duplicate`, `supersede`, `todo done`) removes a merged,
  clean worktree and its `tk/<id>` branch and records the outcome in `metadata.worktreePruned`. A
  refusal (unmerged, dirty, stashed) never fails the close; the human line ends in
  `— worktree pruned` or `— worktree kept: <reason>`. The frozen changeset keeps `tk show` and
  review working after the worktree and branch are gone.
- **`tk worktree clean [--dry-run | --yes]`.** Dry-run by default: lists every closed task whose
  worktree is merged and clean as eligible, and the rest with the reason they are kept; tasks
  already pruned are not listed. `--yes` removes each eligible worktree once and records
  `metadata.worktreePruned` on its task; `--dry-run --yes` is rejected.

#### Lifecycle hooks and dependency setup

```json
{
  "worktree": {
    "post_start": "cp ../.env .env",
    "post_checkout": "direnv allow",
    "pre_end": "docker compose down",
    "install": false
  }
}
```

- Hooks are shell strings in `.tasks/config.json`, run with `sh -c` from inside the worktree. The
  camelCase spellings (`postStart`, `postCheckout`, `preEnd`) are accepted too; setting both
  spellings of one hook to different values is a config error. `pmSetup` is a legacy alias of
  `install`. Unknown `worktree` keys are rejected.
- `post_start` fires when tk creates a worktree on a **new** branch (`tk work` creating `tk/<id>`,
  `tk worktree create` with a branch that does not exist yet).
- `post_checkout` fires when tk creates a worktree for a branch that **already exists** (`tk work`
  re-provisioning a task whose `tk/<id>` survived, `tk worktree create --branch <existing>`).
- Re-entering an existing worktree (`tk work` on a task whose worktree is present) fires neither.
- `pre_end` fires just before every removal (`tk worktree remove`, close auto-prune, `tk worktree
  clean --yes`). On a prune a failing `pre_end` vetoes the removal (the worktree is kept with the
  hook's error as the reason); on `tk worktree remove` it is only a note.
- **Dependency install** runs after creation, inside the new worktree, by default. The package
  manager is detected from the main worktree's lockfile with precedence bun (`bun.lock` /
  `bun.lockb`) → pnpm (`pnpm-lock.yaml`) → yarn (`yarn.lock`) → npm (`package-lock.json`);
  no lockfile, no install. `"install": false` disables it.
- Hook and install failures never fail the tk command: they are reported in the JSON `hooks`
  field and the human line's suffix (e.g. `post_start hook failed`, `package install failed (bun)`).

### Finishing a task

```bash
tk finish tk-abc --session <sid>          # or TK_SESSION=<sid> tk finish tk-abc
tk finish tk-abc --session <sid> --harness codex   # override the detected harness
```

`tk finish` is the single completion path: it moves the task to exactly `ready-to-review` and can
never set `closed` (the transition is refused in code). It requires a session id (`--session` or
`TK_SESSION`) and a `tk work` record (branch + pinned base) — otherwise it fails with
`run tk work <id> first`. It records `agent_session`, `finished_at` and `agent_harness`, stamps the
counts-only `metadata.report`, prints the [stat card](#changes-and-the-stat-card) plus the PR line
(or `next: tk pr create <id>`), and seeds the session's `tk watch` cursor so no verdict is missed.
Finishing an already `ready-to-review` task only re-records the metadata. The changeset is frozen
only at close, never at finish.

### The review record

`tk show` (and every surface that shows a task: the human-output footer of `tk list`/`ready`/`query`/`children`/`search`/`blocked`/`stale`/`agent issues` when at least one task is listed, the TUI task view plus a footer line for the focused row/card/issue in the TUI list, kanban and detail pane, and the web task modal, board cards and list-view rows) carries the **review doors**: the TUI command `tk review <id>` and the web URL `<web base>/tasks/<id>` (web base = the registered web runtime, else `http://localhost:21579`, the web server's default port; resolved by `resolveWebBase` in `@tasks/surface` from `<tasksDir>/runtime.json` without probing — one rule for the CLI and TUI; the TUI re-reads it on every board refresh; the web UI uses its own origin). `--json` list output carries no doors footer; `tk show --json` carries `review_doors`. `tk show` also renders:

- `agent <harness> · session <id> finished <time>`, from `tk finish --session <sid> [--harness <id>]` (or `TK_SESSION` / `TK_HARNESS`). The harness is looked up in the harness registry (`HARNESS_REGISTRY` in `packages/domain/src/review-record.ts`: omp is the first entry and the default; codex and cursor are registry entries too) — adding a harness type is a registry entry. The harness is always recorded as `metadata.agent_harness`, chosen by precedence: `--harness` > `TK_HARNESS` > detected from the harness session env > `omp` (the registry default). Detection reads each registry entry's `env` list (omp `PI_SESSION_ID`, codex `CODEX_THREAD_ID`, cursor `CURSOR_CONVERSATION_ID` / `CURSOR_AGENT`), so adding a harness and its detection is one entry; a non-default match wins over omp in nested shells. Older records finished with no harness still render as `omp`.
- `comments N · M open K ✓`: total comments, open and resolved review comments (read from `metadata.reviewThreads`, written by the TUI and web review alike; zero when absent). Each comment's stored status decides: `open` and `sent` count as open, `resolved` as ✓, `dismissed` settles without counting either way (legacy records with only `resolved: true` read as resolved). Once at least one comment exists and none is open or sent, the row reads `comments N · All resolved · K ✓`. The TUI task view and the web task modal use the same rule.
- `REVIEW (N) · M open · K ✓` (or `REVIEW (N) · All resolved`): one row per review comment, `○` open, `→` sent, `✓` resolved, `–` dismissed, followed by its location (`file:line`, `file:line-endLine`, `file`, or `evidence:<id>`), the author and the first line of the body (control characters stripped). Legacy Hunk comments appear here too, imported on read. The section is omitted when the task has no review comments.

`tk show --json` adds a `review_doors` object and a `review` object: `{ comments: [cards], counts }`, where each card carries `id`, `location`, `file`, `line`, `endLine`, `evidence`, `author`, `body`, `status` and `replies`, and `counts` carries `total`, `open`, `sent`, `resolved`, `dismissed`, `unresolved`, `label` and `allResolved`. It is the same shape the `comments.list` RPC verb returns.

### Changes and the stat card

Chat-facing output never carries a diff. `tk finish` (human and `--json`), `tk changes <id>` and `tk show` (when the branch is out of reach) report a task's changes as one **stat card**:

```
Changes · <id>  N commits · +A −D · F files  → <web base>/tasks/<id>/diff · tk review <id>
```

The counts are commits, added and deleted lines, and files changed; the links open the changes view in the web (`/tasks/<id>/diff`) and the TUI (`tk review <id>`). `--json` carries `changes: { source, stale, at, stat: { commits, files, additions, deletions }, links: { tui, web } }` (`tk changes --json` returns `{ id, changes }`, `changes: null` when nothing is recorded; human output then reads `no changes recorded`).

The counts come from the first rung that answers (`resolveChanges` in `@tasks/surface`):

1. a **closed** task with a frozen snapshot → `snapshot` (no git calls);
2. a live derivation from the recorded branch and pinned base → `live`;
3. the **finish report** cache `metadata.report` → `report`, stale — the card adds `· stale — from finish report <at>`;
4. a frozen snapshot on a reopened task → `snapshot`, stale (`· frozen at close`);
5. nothing → `no changes recorded`.

`tk finish` stamps `metadata.report = { changes: { commits, files, additions, deletions }, head, at }` (counts only, never a patch or file list) so a host that cannot reach the branch — deleted, pruned, or on another machine — still shows the numbers. Finish still never freezes the changeset; only close does. `tk show` keeps its commit and file listing while the branch or snapshot answers; when neither does and a report exists, its `CHANGES` section shows the stale stat card and `--json` `changeset` is the counts-only `{ source: "report", stale: true, counts, commits, files }`.

### Review

```bash
tk work tk-abc     # worktree + branch tk/tk-abc, base pinned
tk review tk-abc   # open the task's diff review in the TUI

tk comments tk-abc                 # list review comments: REVIEW (n) · N open · K ✓
tk comments send tk-abc            # hand every open comment to the agent as one batch
tk comments resolve tk-abc <cid>   # ✓ done
tk comments dismiss tk-abc <cid>   # ✕ remove
tk comments reopen tk-abc <cid>    # back to open
```

`tk comments` works the review comments from a shell. Every review comment carries its location as data (a
file, `file:line`, a line range `file:line-end`, or `evidence:<id>`) and a status: open → sent → resolved /
dismissed (resolved and dismissed may reopen). `send` is explicit and batched: every open comment — or only the
comment ids named after the task id — becomes `sent` in one transaction and is printed as cards
`location · author · body`, with one `[review sent] N comments` summary comment added to the task; nothing is
sent per comment, and a send with nothing open writes nothing. The verb may also follow the task id
(`tk comments tk-abc send`, `tk comments tk-abc resolve <cid>`). An unknown comment id fails with
`comment not found: <cid>` before anything is written; `resolve`/`dismiss`/`reopen` take exactly one comment id.
Each move is logged in `metadata.reviewCommentLog` (actor and time) and surfaces as a `task.comment` event on
`tk watch`; an agent picks sent cards up with `tk watch <id> --until "type=task.comment"` (see
[Waiting for review](#waiting-for-review)). `--json` returns
`{ comments, counts }` for the list and the status moves and `{ sent, counts }` for `send`, matching the
`comments.list` / `comments.send` RPC verbs. Plain task comments (`tk comment <id> <body>`) are not review
comments: they stay on `tk show <id>` (`--json` `.comments`).

The review views drive the same loop on the same record. In the TUI diff view `x` marks the selected comment
✓ done, `D` ✕ removes (dismisses) it, the same key on a done/removed comment reopens it, and `S` sends every
open comment to the agent in one batch; the rail header reads `COMMENTS · N open · K ✓` or `All resolved`. The
web diff and artifact views (`tk web`) give every comment card its status pill (`open`, `→ sent`, `✓ resolved`,
`✕ dismissed`) and the same `✓ done` / `✕ remove` / `↺ reopen` buttons, show the same header, and carry one
`send to agent (N)` button (disabled when nothing is open) that sends the batch and lists the sent cards as
`location · author · body`. Displayed comment bodies drop the stored `[review <loc>]` / `[review reply]`
prefix. Sent comments still count as open until resolved or dismissed. The agent picks the batch up from the
event log with `tk watch` (below).

**Web task view (`tk web`, `/tasks/<id>`).** The web page mirrors the TUI task view with the same names. The
center column leads with the work: the title and status, the `worktree <path>` and `<branch> → <base>` chips
(the worktree chip and the WORKSPC `worktree` row show the short label, e.g. `.worktrees/<repo>-<id>`, with the
full absolute path on hover),
`◧ open diff`, the description, then `ARTIFACTS — evidence on the task` (typed `src · edit · new · other` counts,
`IN CHANGES` / `UNREFERENCED` groups, a `● N` or `—` comment pill per row) before `COMMENTS · N`
(`author first line → location`) and the review doors. The right rail is tabbed `SESSIONS · CHANGES · WORKSPC ·
MINIMAP` (CHANGES by default) and refreshes live from the worktree. WORKSPC adds a `pr` row when the task has a PR
(`PR #<n> · <state>`, a link opening in a new tab) and two buttons: `commit` and `open pr`. `commit`
reveals an inline message field (Enter commits, Esc cancels; no browser dialog) and runs `git commit --all
--message=<msg>` in the task's recorded worktree: staged and tracked changes only, untracked files are never added,
hooks run, nothing is amended and nothing is pushed. It is refused with a clear message, and no commit, for an empty
message, a missing worktree (`no worktree for <id> — run tk work <id>`), a worktree that is the main checkout, a
worktree on a branch other than the task's, or nothing tracked to commit; a successful commit restamps the task's
`metadata.report` and toasts `✓ committed <sha7> on <id>`. `commit` is disabled with no worktree or a clean one.
`open pr` is `tk pr create <id>` (push, then create / adopt / refresh; `refresh pr` once a PR is open) and toasts
`✓ PR #<n> <state> — <url>`. A `ready-to-review` task shows `open diff`
and no start control (the palette lists `open diff <id>` instead of `start <id>`). At 860px and narrower the
rail stacks under the main column, and the worktree chip stays while the branch chip hides. A left `TASKS`
column sits between the app sidebar (List/Board/Graph/Insights/Review) and the work: the same working
tasks as the TUI (not `closed`, `archived` or `deferred`, board order, plus the shown task), a status dot and
title per row, the shown task highlighted. A click on a row, or `[` / `]` outside a text field (previous / next,
wrapping), switches the task view to that task in place, with no page load; switching closes an open diff
modal. The column is hidden at 1100px and narrower.

**Web navigation.** Every screen has a URL: `/list`, `/board`, `/graph`, `/insights` (keys `1`–`4`; `/` is the
board), `/review` (`5`) lands on the selected — else first — reviewable task's `/tasks/<id>/diff`, and the task
modal opened from a list row, board card or insights row is `?task=<id>` on top of the current view (closing it
steps back in history), so reload, back and forward always show what was on screen. Each list row and the task
modal carry two real links — `❐ task` (`/tasks/<id>`) and `± review` (`/tasks/<id>/diff`, dimmed until the task
has a branch and a base); board cards link the same two; the task view adds `± review page` beside `◧ open diff`;
and the review, file and evidence pages head with a breadcrumb `tasks › <id> › review` whose first two crumbs
link back to the list and the task view (the sidebar is never the only way back). The sidebar hides and shows
with the `☰` button, `\` or `⌘B` (`hide sidebar` in the palette); the choice is remembered. At 900px and
narrower it is a drawer over the content, closed by default (a nav click or a click on the content closes it),
and the top bar drops the workspace path and the button labels so a half-screen window stays usable.

- **Diff modal:** `◧ open diff`, a CHANGES file row, a click on the already-selected CHANGES tab, or a MINIMAP
  bar (at its hunk) opens that file's diff in a modal over the task view, with the URL unchanged. Click a line
  to comment on it, or use `＋ comment on this file`. `⤢ full view` opens `/tasks/<id>/diff?file=<path>`, and
  `esc close` (or Esc) returns to the task view as it was.
- **Evidence in the diff:** the full diff view lists `EVIDENCE` under the files and renders each image after
  the file diff, with its comment cards and a `comment on the evidence…` box; those comments are stored at
  `evidence:<id>`.
- **Artifact view** (`/tasks/<id>/file`): every ARTIFACTS row opens its artifact as its own commentable view
  (the thumbnail still opens the image viewer). The header reads `<id> / <path>` with a mode tag and
  `N open · K ✓`; the right panel lists the artifact's comments with `＋ comment on file` for a whole-file
  comment. Three modes, as in the TUI:
  - `CODE` (`?path=<file>`): the file as highlighted code; click a line to comment at `path:line`.
  - `DOC` (`?path=<doc>.md`): the markdown rendered as a document, one block per paragraph, list, heading or
    fence, each with a `＋` gutter that comments on the block's line range (`path:3-4`). Raw HTML in the doc is
    shown as text and only `http(s)`, `mailto`, `#` and relative links are kept.
  - `EVIDENCE` (`?evidence=<ev id>`): the image (or a name · mime chip), its comments, and a composer that
    stores comments at `evidence:<id>`.

Every web comment lands on the same task record as the TUI's: `tk comments <id>` and `tk show <id>` REVIEW.

**Live web board.** The web page does not poll: it listens on the server's `GET /events` stream, which carries
one `task` frame per line appended to the served workspace's event log, whoever wrote it (a terminal `tk`,
the TUI, an agent, or the page itself). Each burst of frames refreshes the board, the list, an open task
modal and the task view on screen once (100ms debounce), and a reconnect after a dropped stream refreshes
once to catch up; the sidebar dot turns red while the stream is down. Review moments show a toast:
`<id> ready for review`, `<id> approved`, `<id> rejected`, `<id> · <author>: <comment>` for a note,
`<id> · review comment at <location>` for a new review comment, and `<id> · N review comments sent` for a sent
batch. Repointing the page at another workspace switches the stream to that workspace's log.

`tk review <id>` opens tk's own diff component (`packages/review`, vendored from Hunk and rendered with
OpenTUI) over the task's tk-derived diff — the task worktree's working tree against the pinned base, resolved
through `@tasks/git`. The session is live, editable and commentable:

- **Live:** the diff re-derives as commits and edits land in the worktree (vendored watch controller, debounced);
  there is no refresh key, and the selected file is kept by path. While the watcher runs, the page shows
  `watching worktree — re-derives as commits land ●`; a branchless or errored review shows no such line.
- **Editable:** `]` selects a hunk and `e` edits it inline (`ctrl+s` save, `esc` cancel); the save writes the
  worktree file, path-guarded to stay inside the worktree.
- **Commentable:** `c` comments on the selected file/hunk, `R` replies, `E` edits the last comment, `x` marks
  the selected comment ✓ done and `D` ✕ removes it (dismissed; either key on a resolved/dismissed comment
  reopens it), and `S` sends every open comment to the agent in one batch (rows flip to `→ sent`) — all on the
  task record, which `tk show <id>` prints in its `REVIEW` section. The notes rail is headed
  `COMMENTS · N open · K ✓` over all of the task's comments (`All resolved` once none is open or sent), with
  `S send N to agent` while open comments wait; each row shows its status (`open`, `→ sent`, `✓ resolved`,
  `✕ dismissed`).
- **Branch-scoped:** a task with no branch shows `no branch yet — run tk work <id>`; the workspace is never diffed.

Keys (hunk's own):

| key | action |
|---|---|
| `]` / `[` | next / previous hunk in the selected file |
| `.` / `,` | next / previous changed file (clamped) |
| `1` / `2` | unified / split layout |
| `g` / `G` | first / last hunk |
| `c` | note (comment) on the selected file/hunk |
| `R` | reply to the selected thread |
| `E` | edit the selected thread's last note |
| `e` | edit the selected hunk inline |
| `x` | ✓ done (resolve) / reopen the selected comment |
| `D` | ✕ remove (dismiss) / reopen the selected comment |
| `S` | send every open comment to the agent (one batch) |
| `J` / `K` | next / previous thread |
| `s` | hide / show the files pane |
| `l` | hide / show line numbers |
| `z` | expand / restore context for the whole diff (re-derived with `--unified=25`) |
| `/` | search files: select the next changed file whose path contains the query |
| `v` | start / end a hunk-range selection at the selected hunk (`]`/`[` extend it; `esc` clears it) |
| `y` | copy the selected hunks (else the selected hunk, else the file patch) through OSC 52 |
| `a` | hide / show the notes (thread) rail |
| `t` | cycle the diff theme |
| `q` | quit |
| `?` | help |

Where tk's TUI differs from hunk: `z` expands context for the whole diff, not one hunk (the vendored view has no
per-hunk gap expansion). `v`/`y` select whole hunks, because the view has no line cursor. `a` toggles the notes
rail, because tk has no separate agent-rationale notes. `t` cycles the bundled themes and has no selector popup.
`/` is file search, which hunk leaves unbound in the review view. Live refreshes and inline edit saves keep the
expanded context. `y` needs a terminal that accepts OSC 52 clipboard writes; otherwise it toasts
`clipboard unavailable`.

`j` / `k` (step the hunk selection) and `p` (split) stay as tk aliases. There is no `r` refresh key: hunk binds
`r` to refresh, but the review re-renders live, so `r` is unbound. In the diff view `1`, `2` and
`g` belong to the review, not the shell's view switches; `3`, `4`, `b` and `i` still switch views. In the
artifact view only `g` (first line or block) is taken; every other view key switches as usual. `o` in the full
diff view opens the selected file (or evidence entry) in the artifact view.

Reviewer line/file comments and their resolve state are written straight to the task record
(`metadata.reviewThreads`) by the TUI and the web UI alike; there is no separate `hunk` binary to install and no
sync step. Comments imported earlier by the removed Hunk sync command are carried into review threads
automatically the first time the task's review is read.

### Waiting for review

Every committed `tk` write (CLI, TUI, web, daemon, agent extension) appends one line per change to
`.tasks/events.jsonl`: `{ seq, host, ts, task, type, actor, session?, data }`, with a gap-free `seq`. The types
are `task.created`, `task.status` (approvals are `to: approved|rejected`; `tk finish` adds `session`),
`task.owner`, `task.comment` (plain notes and every review-comment move, one line per sent card),
`task.evidence`, `task.worktree`, `task.pr` (the recorded PR changed), `task.report` (the stat-card counts
changed), `task.update`, `task.deleted` and `run.changed` — the full `data` table is in
[RPC API](#rpc) under `events.subscribe`. There is no daemon in the loop: `tk watch` reads the file and
sleeps on it until it grows.

```bash
tk watch tk-abc --until "status=approved|rejected"     # block until the verdict; prints it, exit 0
tk watch tk-abc --until "type=task.comment" --timeout 2h
tk watch --drain                                       # everything since my cursor (session start)
tk watch --follow "owner=me,type=task.comment" --json  # stream NDJSON until Ctrl-C / SIGTERM / stdin closes
```

- **Query:** comma = AND, `|` = alternatives. Keys: `task=`, `status=` (a `task.status` line's `to`),
  `type=` (legacy `issue.*` names are accepted), `actor=`, `owner=` (`me` = you), and the bare word `mine`
  (owned by or assigned to you). Positional ids add `task=<id>|<id>`.
- **Modes:** `--until` prints the first match and exits 0, or exits **124** after `--timeout` (default
  `30m`; `90s`, `2h` and plain ms work too) with `no matching event within <t>`. `--drain` prints every match
  past the cursor and exits. `--follow` streams matches as they append. Pick one; with none, `tk watch` keeps
  the NDJSON frame protocol (`ready`/`event`/`error` frames, `--kinds/--ids/--label/--interval/--after`) that
  the pi/omp extension uses.
- **Cursors:** each subscriber keeps its own read position in `.tasks/cursors.json`, so any number of
  watchers run at once and an offline one drains the whole gap later. The name is `--as <name>`, else
  `session:$TK_SESSION`, else `cli:<actor>`. A fresh subscriber starts at seq 0 for `--until`/`--drain` and
  at the log end for `--follow`; `--from <seq>` overrides, `--peek` reads without moving the cursor.
- **No missed verdicts:** `tk finish <id> --session <sid>` seeds cursor `session:<sid>` at its own finish
  line, so a comment or approval made before the agent's first `tk watch` is still delivered. An `--until`
  with `status=` and task ids first checks the tasks themselves: a task already in a listed status returns
  at once (a `task.status` line with `data.current: true`), and an approval from an earlier round does not
  match once the task has moved on.
- Output is one line per event (`#<seq> <hh:mm:ss> <task> <type> <summary>`); `--json` prints the raw log
  line. An unknown task id exits 1 with `issue not found: <id>`, a bad query with `invalid watch query: …`.

### Pull requests

A task has at most one PR, recorded as `metadata.pr = { number, url, state }`. It is managed by explicit verbs that call the GitHub CLI (`gh`); tk never polls GitHub.

```bash
tk pr create <id>   # push tk/<id> to origin, open the PR (base = default branch) and record it
tk pr sync <id>     # one `gh pr view`; updates the recorded state (open → merged/closed)
tk pr merge <id>    # gh pr merge <n> --merge (or --squash / --rebase); branch kept, then tk close <id>
tk pr close <id>    # gh pr close <n>; branch and worktree kept
tk pr <id>          # the recorded PR from the local mirror (also `tk pr show <id>`); no gh call
```

- `tk pr create` needs a worked task (`tk work <id>`). It pushes first; a failed push stops before any gh call. It is idempotent: a recorded open PR is refreshed (`(already open)`), an open PR already on GitHub for the branch is adopted, and only otherwise is `gh pr create --head <branch> --base <default>` run. The title is the task title (`--title` overrides) and the body is `tk: <id>`, the first paragraph of the description and the stat card (`--body` overrides) — never a diff. A record whose PR is `closed` or `merged` refuses: one PR per task.
- `tk pr merge <id> [--merge|--squash|--rebase]` (default `--merge`; more than one fails with `pick one of --merge, --squash, --rebase`) and `tk pr close <id>` first run `gh pr view` (gh is the remote truth), then the mutating gh call only when the remote state differs from the target, then one more `gh pr view`, and record the result. Merging an already merged PR or closing an already closed one is a no-op that still syncs once and reports the state. Closing a merged PR or merging a closed one refuses. Neither passes `--delete-branch` or `--admin`, and neither touches the branch, the worktree or the task status: merge does not close the task (human output ends `next: tk close <id>`), and `tk close` prunes the worktree and `tk/<id>` once the branch is merged. Without a recorded PR both fail with `no PR on <id> — run tk pr create <id>`.
- The handoff card: `tk finish` prints, under the stat card, the recorded PR (`PR #7 · open · <url>`) or, when there is none, `next: tk pr create <id>`; `tk finish --json` carries `pr` (the record or `null`) next to `changes`. `tk changes <id>` also prints the PR line when one is recorded (no hint). Both read the local mirror only and never run gh — run `tk pr sync <id>` for a fresh state.
- `--json`: create/sync/close/merge return `{ id, op, pr }` (`op` is `create`, `adopt`, `refresh`, `sync`, `close` or `merge`); `tk pr <id> --json` returns `{ id, pr }` (`pr: null` when none, human output `no PR — run tk pr create <id>`).
- Both writing verbs restamp `metadata.report` (the stat-card cache) when the branch is reachable.
- Errors: a missing gh prints `gh not found — install GitHub CLI (https://cli.github.com) or set TK_GH`; a failing gh prints `gh <subcommand> failed: <first stderr line>`. Nothing is written on failure. `TK_GH` points tk at another gh binary (tests use a fake).

### Terminal UI

`tk tui` launches a full terminal UI (OpenTUI + React, alternate screen, mouse-aware):

```bash
tk tui                  # discover workspace from cwd like the CLI
tk tui /path/to/ws      # or point it at a workspace
```

Four views (`1`–`4`; `b`, `g`, `i` also jump to Board, Graph, Insights) on a persistent nav rail with live counts (`\` hides and shows the rail — every view gets the
columns back; `⇤ hide rail` on the rail and `hide nav rail` in the palette do the same), and a statusbar. A task's
own pages — the task view, the artifact view and the diff — are not rail entries: they open from the highlighted
task (`t` task view, `v` diff, `o` artifact; the `❐ task` / `± diff` doors under the list, board and detail are
clickable) and `esc` returns to the list:

| View | Key | What it shows |
|------|-----|---------------|
| List | `1` | filter chips (`all/ready/open/wip/review/closed/mine`), glyph+priority rows, right-aligned ages, detail pane |
| Board | `2` | kanban columns (Open / In Progress / Review / Closed, Parked when non-empty), `h/l/j/k` movement, in-place status moves (`s/r/o/d`) |
| Graph | `3` | dependency tree centered on selection, `▲ BLOCKED BY` / `▼ BLOCKS` sections, `(cycle)` markers |
| Insights | `4` | ready picks, blocked panel with unblock-gain, critical chain, cycles / DAG health |
| Task | `t` | the task view (`tk://task`): a `TASKS` column of working tasks on the left, the work in the center, a tabbed rail on the right — see below |
| Artifact | `o` | one artifact of the task opened as a file (`tk://artifact`): code, doc or evidence, with line, block and whole-file comments — see below |
| Diff | `v` | the full diff review of the selected task (`tk://diff/<id>`, what `tk review <id>` opens) — see [Review](#review) |

**Task view (`t`).** The center column leads with the work: the title, a meta line (`<id> · <status> · @<assignee> · <priority>`), a chips row `[ worktree <path> ]  [ <branch> → <base> ]` (the path relative to the workspace root when under it; `[ no worktree — tk work <id> ]` before `tk work`), the primary action `◧ v open diff` (`V` diff modal, `c` comment), the description, `ARTIFACTS — evidence on the task` with typed counts (`N src · N edit · N new · N other`) and the `IN CHANGES` / `UNREFERENCED` groups (each row ends in `● N` open comments or `—`; `J`/`K` select a row, `o` opens it in the artifact view), then `COMMENTS · N` with up to five `author: first line → location` rows, and the review doors. The right rail is tabbed `SESSIONS │ CHANGES │ WORKSPC │ MINIMAP` (`tab` / `shift+tab`, `j`/`k` row, `↵` opens the diff modal on the CHANGES file or MINIMAP hunk): SESSIONS lists the task's agent runs and `tk finish` session (`STATUS  SESSION  UPD`); CHANGES is the worktree's live change tree, a row ending in `●` while it still needs review (no thread, or an open/sent one), and it re-renders when the worktree changes (the panel shows `live from the worktree ●` while the watch runs); WORKSPC shows `branch`, `worktree`, `host`, `state N dirty | clean` and `pr  PR #<n> · <state>` (`—` before a PR), with the hint `[C] commit  [P] open pr`: on the WORKSPC tab `C` opens a `commit <id>` composer and commits the worktree's tracked + staged changes with that message (the same commit as the web `commit` button, below), and `P` runs `tk pr create <id>` in-process (`✓ PR #<n> <state> — <url>` in the status line; gh / git errors shown verbatim); on the other tabs `C` and `P` do nothing; MINIMAP draws one `█` bar per hunk, sized against the largest hunk, green when it mostly adds and red when it mostly deletes. A left `TASKS` column sits between the VIEWS nav and the center column: it lists the working tasks (every board task that is not `closed`, `archived` or `deferred`, in board order, plus the shown task), one `●` status dot and title per row, the shown task highlighted with the `▎` band. `[` / `]` step to the previous / next working task (wrapping) and a click on a row opens that task; the whole view follows it (header, chips, ARTIFACTS, COMMENTS, rail, review session) and the rail tab and cursors reset. When the worktree and branch chips do not fit side by side, the branch chip wraps to its own line. Below 130 columns the TASKS column is hidden; below 100 columns the rail is hidden and the chips row keeps only the worktree chip. The task view has no start-work key. In the list, `t` opens the highlighted task's task view and `v` its diff (the doors line under the list is clickable: `❐ task` / `± diff`); on a `ready-to-review` task the detail footer offers `v:open diff` instead of `s:start`, and `s` only toasts `ready-to-review — v opens the diff`. The board task modal and the `:` command palette follow the same rule: on a `ready-to-review` task the modal footer reads `v open diff · r/o status` (`v` opens the diff, `s` only toasts) and the palette lists `open diff [v]` instead of `start (in progress)`.

Task view keys at a glance:

| key | action |
|---|---|
| `v` / `V` | open the full diff / the diff modal at the first file that needs review |
| `c` | comment on the task |
| `J` / `K`, `o` | select an ARTIFACTS row, open it in the artifact view |
| `tab` / `shift+tab` | switch the rail tab (SESSIONS · CHANGES · WORKSPC · MINIMAP) |
| `j` / `k`, `↵` | move in the rail, open the diff modal on that file / hunk (`o` opens a CHANGES file as an artifact) |
| `C` / `P` (WORKSPC tab) | commit the worktree's tracked changes / `tk pr create <id>` |
| `[` / `]` | previous / next working task in the TASKS column |
| `e` | edit the task title (any view with a selected task) |

**Diff modal and evidence.** `↵` on a CHANGES file row (or a MINIMAP bar) opens the diff in a modal over the task view at that file (and hunk); `↵` on a directory row, or `V`, opens it at the first file that still needs review. The task view stays drawn behind it. The header reads `<id> / <path> [M] +a −d` with `f ⤢ full view · esc close`; the body is that file's diff with its comment threads below. `j`/`k` move hunks, `c` comments on the selected hunk's line, `C` on the whole file (no line); both land on the task record (`tk show <id>` REVIEW). `f` closes the modal and opens the full diff view on the same file and hunk; `esc` returns to the task view with the rail tab and cursor unchanged. Hunk editing (`e`) and `x`/`D`/`S` stay full-page only. The full diff view lists `EVIDENCE · N` under the files (`▣ <name> · 💬 N`, the selected entry marked `▌`); `]` past the last file's last hunk (or `.`) walks into the evidence entries and `[` walks back. An entry renders in the diff flow as an inline image when the terminal can paint one (`inlineImageMode` from `@tasks/terminal-image`: kitty graphics when the renderer advertises them, half blocks on any other TTY), always followed by the caption row `▣ evidence:<id> · <name> · 💬 N`; off a TTY only the caption row renders. `c` on an entry comments at `evidence:<id>`, which lists in that entry's thread rail, in `tk comments <id>` and in `tk show <id>` REVIEW.

**Artifact view (`o`).** Any artifact of the task opens as a file, separate from the diff: `o` on an ARTIFACTS row in the task view, `o` on a CHANGES file row after moving the rail cursor with `j`/`k`, or `o` on the selected file (or evidence entry) in the full diff view. The header reads `<id> / <path>` with the artifact's `N OPEN · K ✓` count and a mode tag; the right panel, `COMMENTS · …`, lists every comment on the artifact (whole-file first, then by line). Three modes:

- `CODE`: the whole file as numbered lines (`12 │ …`) with a cursor (`j`/`k`, `g`/`G`). `c` comments on the cursor line (`path:line`), `C` on the whole file (`path`). Line comments render inline under their line (`▸ author: body · open`).
- `DOC` (`.md` / `.markdown`): headings, bullets, quotes and code fences shaped like the detail pane. The cursor (`▌`) moves by block (a paragraph, a list, a fence); `c` comments on the block's line range (`path:3-4`), `C` on the whole file.
- `EVIDENCE`: the image (when the terminal can paint one) and its `▣ evidence:<id> · <name> · 💬 N` row; `c` / `C` comment at `evidence:<id>`.

Every comment lands on the task record (`tk show <id>` REVIEW, `tk comments <id>`). Files are read from the task worktree (the workspace root when the task has none) through the same path guard as hunk edits: a path that escapes the root, absolute or through a symlink, shows `refused: outside the worktree` and nothing is read; a missing file shows `not in the worktree: <path>`, and files over 2 MB are not rendered. `esc` returns to the task view. With no artifact chosen (`tk://artifact`), it shows the review's selected file.

Global surfaces: `:` command palette (fuzzy-filtered commands with keycaps), `/` search,
`n` new issue, `?` key reference, `ctrl+c`/`ctrl+q` quit. Confirmation prompts take
`↵`/`y` to accept, `n`/esc to cancel. Selection ↔ detail stays in sync, edits
go through the same surface as the CLI, and the board tails `.tasks/events.jsonl`, so a change from any process (CLI, web, agent) re-renders it within about a second and review moments (`<id> ready for review`, `approved`, `rejected`, new or sent review comments) show as status-bar toasts — see [TUI Board Path](#tui-board-path).

### File attachments

Issues can carry file-path attachments — references, not copies. Paths resolve
against the current directory and are stored workspace-relative, so
`tk create "x" --attach foo.yaml` attaches the repo-root `foo.yaml`. Attachments
can carry metadata: inline `--attach 'docs/plan.md={"kind":"plan"}'` (repeatable)
or a trailing `--attach-metadata kind=input,k2=v2` applying to the last path.
`tk update <id> --attach <path>` and `--detach <path>` work ad hoc; attaching an
existing path replaces its metadata.
`--plan <path>` (on `create`/`update`) sets the issue's plan through the same
system — it attaches the file with `kind: "plan"` metadata and replaces any
prior plan attachment, leaving other attachments untouched.

### Agent skill

tk ships an LLM-facing skill — the authoritative machine docs for every op and
flag (ops table, attachment/plan semantics, JSON contracts). The skill ships
with the binary and is printed or installed from the CLI, so guidance never
drifts from the binary. It is one of the surfaces that carry the workflow
contract; see [Agent injection — the workflow contract](#agent-injection--the-workflow-contract):

```bash
tk skill                     # print the full SKILL.md
tk skill --json              # { path, skill } for programmatic loading
tk skill path                # installed skill file location only
tk skill --install ~/.pi/agent/skills   # copy the skill into an agent skills dir
tk skill install --tool claude          # copy into .claude/skills (--global: ~/.claude/skills)
```

### Storage backend

The backend is a `.tasks/config.json` property, resolved once per workspace — no command reads a runtime `--backend` flag; the only place `--backend` exists is `tk init`, as a convenience for writing the config instead of hand-editing it:

```bash
tk init                                          # storage.backend: "file" (default)
tk init --backend sqlite [--filename <name>]     # storage.backend: "sqlite"
tk init --backend postgres [--url-env <VAR>]     # storage.backend: "postgres"
tk init --help                                   # full flag reference and examples
```

Each of those writes into `.tasks/config.json`:

```json
{ "prefix": "tk", "storage": { "backend": "file" } }
```

`storage.backend` is one of:

| Backend | Config | Notes |
|---|---|---|
| `file` | `{ "backend": "file" }` | Default. One JSON file per issue under `.tasks/issues/`, see below. |
| `sqlite` | `{ "backend": "sqlite", "filename"?: string }` | `filename` is relative to `.tasks/`, defaults to `tasks.db`. |
| `postgres` | `{ "backend": "postgres", "urlEnv"?: string, "url"?: string }` | Connects via env var indirection by default (`urlEnv`, default name `TASKS_DATABASE_URL`) so connection strings never need to live in committed config. `url` is a literal fallback, discouraged for anything with credentials — `tk init` has no `--url` flag on purpose, to avoid connection strings landing in shell history. |

Switching backends on an existing workspace: use `tk switch-backend <file|sqlite|postgres>` (see `tk switch-backend --help`). It reads every issue from the current backend, writes them all into the target, and only then flips `storage.backend` in `.tasks/config.json` — the old backend's data is never deleted automatically, so verify with `tk doctor`/`tk list` before cleaning it up by hand. `--dry-run` reports what would move without writing anything. A workspace with an existing `.tasks/tasks.db` but no `storage` key is treated as `sqlite` (inferred from disk, not silently defaulted to `file`), so upgrading `tk` never orphans pre-existing data; every workspace `tk init` creates from here on writes an explicit `storage.backend`.

`tk export`/`tk import` also move data between backends manually (and between two entirely separate workspaces) using the same beads-compatible JSONL format: `tk -C <source> export | tk -C <target> import`. `switch-backend` is exactly that sequence, wrapped into one step that also updates the target workspace's own config.

`tk where` reports the resolved backend and location without opening a connection; `tk doctor` opens it and reports health.

#### File backend layout

The file adapter (the default backend) stores each issue as an individual JSON file:

```
.tasks/
├── meta.json                 # { "backend": "file", "version": null, "prefix": "tk" }
├── issues/
│   ├── tk-a3f2dd.json        # one file per issue (wire format)
│   └── tk-c7e1ab.json
└── history/
    ├── tk-a3f2dd.jsonl       # append-only audit log
    └── tk-c7e1ab.jsonl
```

Git-friendly: per-issue diffs, no binary DB files, merge conflicts scoped to individual issues.

### Migration from beads

`tk migrate` imports a beads workspace into `.tasks/`:

```bash
tk migrate                       # import via `bd export --all` (default)
tk migrate --dry-run --json      # report what would be imported, write nothing
tk migrate --source jsonl        # read .beads/issues.jsonl instead of invoking bd
tk migrate --on-conflict skip    # skip (default) | overwrite | fail
tk migrate --bd /path/to/bd      # pin the beads executable
```

The source workspace is never renamed, moved, or modified, so `bd` keeps
working against `.beads/` after migration. Beads stores issues in an embedded
database that only `bd` can read — `.beads/issues.jsonl` is a passive
export that is usually empty — so `bd export` is the default source and an
empty JSONL is reported as an error rather than a successful empty migration.

Migration runs in a single transaction: either every issue lands or none does.
Issues are ordered parent-first so parent links resolve regardless of export
order, and non-issue beads records (memories, infra beads, templates, gates)
are *carried* — reported rather than rejected, so one memory cannot abort the
run. `tk migrate` is idempotent; re-running skips issues already present.

The JSON report accounts for every record read:

| Field | Meaning |
| `imported` / `skipped` / `overwritten` | issue outcomes |
| `carried` | non-issue records, by line and type |
| `rejected` | undecodable records, with line and field |
| `detached_parents` | parent links dropped because the parent is absent |
| `cycles` | parent cycles broken to stay persistable |

If an older `tk` already renamed `.beads/` to `.tasks/`, `tk` detects the
moved beads database and tells you how to restore it before migrating.

### Sprints

A sprint is a focus bucket: at most one sprint is `active` per workspace, and
`tk list` can be scoped to it. Sprints are first-class records (`.tasks/sprints/`
on the file backend, a `sprints` table elsewhere) and survive export/import.

```bash
tk sprint start "Week 34"     # Create + activate; completes any active sprint
tk sprint start "Week 35" --carry   # ...moving its unfinished issues into the new sprint
tk sprint add <id>            # Move an issue into the active sprint
tk sprint remove <id>         # Move an issue back to the backlog
tk sprint move <id> <slug>    # Move an issue into a named sprint (any status)
tk sprint close               # Complete the active sprint; issues return to the backlog
tk sprint list                # Active focus first, then completed sprints
tk list --sprint active       # Scope: active | current | backlog | none | <slug>
```

Restarting a sprint enforces the single-active invariant in one transaction:
the previous focus is marked `completed` (stamping `completed_at`) and its
issues drop to the backlog unless `--carry` moves them forward.

### Archive (icebox)

Archiving hides work from default views without deleting it — "start from
zero" while keeping everything for reference:

```bash
tk archive <id>               # Hide: status → archived, prior status kept in metadata.archivedFrom
tk unarchive <id>             # Restore to the status it had when archived
tk list --archived            # Show only the icebox
tk list --all                 # Everything, archived included
```

Default `tk list`, `tk ready`, and the TUI/Web boards all exclude archived
issues; `tk ready` never surfaces them regardless. The TUI has an `icebox`
tab (`!` toggles sprint membership on a card); the extension exposes
`archive`/`unarchive` and `sprint-*` ops on the `tasks` tool.

### Agents and runs

Agents are a registry — who can be dispatched on issues — with runs as the
execution record of that dispatch. Agents are first-class records like sprints
(`.tasks/agents/` on the file backend, an `agents` table elsewhere); runs
persist alongside them. Agents are never deleted, only archived:

```bash
tk agent create <name> --description ... --owner ... --runtime ... \
    --access ... --mode ... --instructions ... \
    --skill <s> --env k=v          # repeatable; status starts offline
tk agent list [--archived] [--status online|idle|offline]
tk agent get <id>                # alias: tk agent show
tk agent update <id> [--description ... --instructions ...]  # ≥1 flag required
tk agent archive <id>            # stamps archivedAt (status → offline); idempotent
tk agent unarchive <id>          # clears archivedAt; idempotent
tk agent copy <id> --name <new-name>   # duplicate with a fresh slug
tk agent issues <id>             # issues assigned to the agent
```

Every dispatched execution is a run: `<issueId>-run-<n>`, queued before it
starts, carrying its message log and token/cost usage. Runs are driven by
issue status moves — claiming an issue (`in_progress`) queues a run,
`ready-to-review` moves it `in_review`, rejection marks it `failed`, archiving
cancels it, closing marks it `done` — so the ledger stays true even for runs
driven by outside tools:

```bash
tk runs                          # newest first; --issue <id> or --state <s> to filter
tk run show <id>                 # full record incl. messages and usage
tk run cancel <id>               # only queued|running runs; stamps closedAt
tk run rerun <id>                # fresh queued run for the same issue (manual trigger)
tk run message <id> <text>       # append a log message (--stdin to pipe; terminal runs reject)
```

A run is "active" only while `queued|running` — the states that may still
change on their own. The extension receives a `run.changed` watch event
(`kinds: run.changed`) so sessions can react to run lifecycle transitions.

Watch children (`tk watch`) self-register as runtimes in `.tasks/runtime.json`
and heartbeat on every poll tick, so `tk runtime list` shows what is actually
alive. A deferred issue whose `--defer-until` has passed is undefered by the
watch tick and — when it has an assigned agent — gets a queued run with
trigger `wakeup` (once per expiry):

```bash
tk runtime list                  # live watch children + their heartbeat ages
tk runtime activity [n]          # recent runtime events (starts, wakeups)
tk daemon status                 # daemon ping + hosted web URL (start|stop|restart to manage)
tk inbox                         # runs awaiting attention, unread first
tk inbox read <runId>            # mark a run's inbox entry read (also: archive; --all to include)
```

Parallel sessions also share physical things the worktree can't isolate — a
simulator, a dev port, a seeded database. Resource leases coordinate those:

```bash
tk lease acquire ios-sim --purpose "verify accounts screen" --ttl 900
tk lease list                    # who holds what, time remaining
tk lease renew ios-sim           # extend your hold by another TTL
tk lease release ios-sim         # drop your hold early
tk lease acquire port:19006 --task tk-wszk   # tie a hold to an issue
```

Holds are advisory: a second `acquire` on the same name fails with the
holder's identity and time left (`--wait <ms>` queues instead), and an expired
hold vanishes on its own — a crashed session can never deadlock a resource.

#### Walkthrough: the agent-dispatch loop

The registry above is the setup; this is the daily loop. In a scratch
workspace (or your own):

```bash
# 1. Register the agents that can be dispatched
tk agent create scout --runtime claude --access project \
    --instructions "Investigate, then report findings via run messages"
tk agent create builder --runtime claude --access project

# 2. Put an agent on an issue — the assignment is what runs record
#    (`tk q` creates and prints just the new id)
ID=$(tk q "Fix flaky sqlite test"); tk assign $ID scout

# 3. Work the issue by moving its status; runs follow automatically
tk update $ID --status in_progress          # → run $ID-run-1 queued
tk runs --issue $ID                         # watch the ledger fill in
tk run message $ID-run-1 "repro confirmed, poking storage adapter"
tk update $ID --status ready-to-review      # → run in_review
tk run message $ID-run-1 --stdin < driver-progress.log  # pipe a driver's log in
tk update $ID --status closed               # → run done

# 4. Audit the ledger — it outlives the work and stays tool-agnostic
tk run show $ID-run-1                       # full record: trigger, messages, usage
tk runs --state in_review                   # everything awaiting review
```

Each run records who (agent), why (trigger: `status-move`, `manual`,
`wakeup`), and what happened (message log + token/cost usage) — no matter
whether you flipped the status or an external tool did. Keep `tk watch`
running in a pane: it registers itself as a live runtime (`tk runtime list`),
fires wakeups for expired `--defer-until` deadlines on assigned issues, and
feeds `run.changed` events to the extension. Anything an agent leaves in
`in_review` surfaces in `tk inbox` until you `tk inbox read <runId>` — that
is your review queue.

## Agent extension (pi / omp)

The repo ships as an installable extension for [pi](https://github.com/earendil-works/pi-coding-agent) and omp, exposing the full tk surface as LLM tools plus live change notifications.

### Install

```bash
omp install github:NSXBet/tasks
```

omp (and pi) resolve the repo, read the `pi`/`omp` manifest keys in the root
`package.json` — pointing at `packages/pi-extention/src/index.ts` and the
`packages/pi-extention/skills/*/SKILL.md` skill — and copy the plugin into
`~/.omp/plugins/`. `#ref` pins a branch, tag, or commit
(`github:NSXBet/tasks#v1.2.0`).

To install from a local checkout instead (symlinked, live for edits):

```bash
omp install /path/to/tasks/packages/pi-extention
```

Both hosts run TypeScript directly (omp is a Bun binary; pi loads `.ts`
extensions via jiti under node), so there is no build step and no committed
bundles. The extension sources `@tasks/surface` as a workspace dep.

### Tools

| Tool | Purpose |
|---|---|
| `tasks` | Full tk surface through one `op`-parameterized tool: `create`, `quick`, `show`, `list`, `ready`, `blocked`, `update`, `close`, `reopen`, `defer`, `undefer`, `claim`, `assign`, `priority`, `label-add`, `label-rm`, `note`, `comment`, `comments`, `dep-add`, `dep-rm`, `dep-list`, `link`, `rename`, `delete`, `duplicate`, `supersede`, `todo`, `todo-done`, `search`, `query`, `history`, `counts`, `stats`, `tree`, `graph`, `duplicates`, `lint`, `children`, `epic`, `attach`, `detach`, `sprint-list`, `sprint-start`, `sprint-close`, `sprint-add`, `sprint-remove`, `sprint-move`, `archive`, `unarchive`, `runtime-list`, `runtime-activity`, `inbox`, `inbox-read`, `inbox-archive`, `changes` (the counts-only stat card, never a diff). Returns JSON. |
| `tasks_ready` | The unblocked backlog — call when about to run out of work. |
| `tasks_wait` | Block until a matching event lands on the event log — the in-session `tk watch --until` (`query`, optional `ids`, `timeoutMs`). |
| `tasks_watch_start` | Start a watcher that notifies the session on each matching log line. Filter with `kinds` (`task.created`, `task.status`, `task.comment`, `task.owner`, `task.update`, `task.evidence`, `task.worktree`, `task.pr`, `task.report`, `task.deleted`, `run.changed`; legacy `issue.*` names accepted), `ids`, `label`, `intervalMs`. |
| `tasks_watch_status` | Active watchers with seq watermark and last event. |
| `tasks_watch_stop` | Stop one watcher (by id) or all. |

### Inbox and watching for changes

Review comments and verdicts on the session's own tasks arrive **without any tool call**: on
`session_start` the extension opens an inbox that tails `.tasks/events.jsonl` and steers one
follow-up message per task into the session (a sent review batch, a comment from someone else,
`approved` / `rejected`, a PR change), each ending in the next command to run. The followed tasks,
message formats, the `📬 while you were away` brief and `TK_INBOX=off` are described in
[Integrations](#agent-hosts-pi--omp).

For anything else, `tasks_watch_start` subscribes to arbitrary kinds:

```
tasks_watch_start { "kinds": ["task.created", "task.status"], "ids": ["tk-abc"] }
```

- Watchers tail the event log in-process (no board polling); `TK_EVENTS=daemon` routes them through the `tkd` socket instead.
- Notifications arrive via `sendUserMessage(text, { deliverAs: "followUp" })` — identical primitive on pi and omp.
- Keep subscriptions narrow (`kinds` + optional `ids`/`label`); a watcher on every update is noise.
- Watchers die with the session; stop them explicitly with `tasks_watch_stop` when done.
- The same stream is available in a terminal: `tk watch --kinds task.created`.

A widget bubble above the editor lists active watchers, their uptime, and the
last event per watcher (hidden while no watchers run).

### Commands

| Command | Purpose |
|---|---|
| `/tasks` | Print current tasks — open issues in this workspace (id, title, assignee). |
| `/tasks watch` | Show active task watchers — count, name, last event, seq watermark. |

Agents drive everything through the tools; the commands are human-facing
health checks in the composer.

### Skill

Installing the extension injects the `tasks` skill, which teaches agents the
task → review workflow (work in `tk work`, finish with `tk finish`, wait with
`tasks_wait` / the inbox) plus tools-over-shell and watcher etiquette. It loads
through the same manifest mechanism as the extension bundle; no separate
configuration. See [Agent injection — the workflow contract](#agent-injection--the-workflow-contract).

## Credits

Inspired by [beads](https://github.com/steveyegge/beads) by Steve Yegge. Restructured as a multi-adapter TypeScript library with pluggable storage.
