# Changelog

All notable changes to `tk` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/). Each release on GitHub embeds the
matching section as its release notes — add a section for every new version
(see `.agents/skills/release/SKILL.md` for the full release procedure).

## [Unreleased]

### Added

- `tk web` now exposes the full RPC verb table at `POST /api/rpc` (server-injected
  workspace root, 1 MiB body cap) and a watch-event feed at
  `GET /api/events?after=<seq>&kinds=a,b` — a bounded event ring (512 events,
  5-minute TTL) re-sequenced server-side with a cumulative `dropped` counter for
  reconciliation. HTTP clients (including the upcoming Luau bridge) get full RPC
  parity without a unix socket.
- A workspace-agnostic `tkd` daemon (`packages/daemon`): one unix-socket process
  hosting the RPC verb table over ndjson frames for every `.tasks` workspace it
  is asked about. Clients share the daemon's single surface store instead of
  each opening their own; the daemon self-heals (stale socket cleanup,
  spawn-on-connect), refuses roots that are not tasks workspaces
  (`root_invalid`), and idles out when nothing is connected or subscribed.
  `tk daemon status` reports its state without spawning one.
- `tk web` now bootstraps the daemon and hosts the web UI inside it
  (`web.start`/`web.stop`/`web.status` over the socket) — the server outlives
  the invoking terminal without the previous detached-child dance; `--dev`
  keeps the foreground live-reload child. `tk web stop` shuts the hosted
  server down over HTTP as before.
- `events.subscribe` / `events.unsubscribe` over the tkd socket, reusing the
  in-process watch loop: subscribers get ndjson event frames per connection,
  loops restart on their own transient failures, and active subscriptions pin
  the daemon against idle exit. The pi/omp extension opts in via
  `TK_EVENTS=daemon`, falling back to its in-process watcher when the daemon
  is unavailable.

### Fixed

- The daemon's web host no longer turns into a phantom after `tk web stop`:
  the hosted server's HTTP `/api/stop` route tore the listening socket down
  without telling the daemon, so `web.status` kept reporting `hosting: true`
  and the next `tk web start` echoed the dead URL — which by then served
  whatever process had grabbed the freed port. The server now notifies its
  host on every self-teardown path (`onStopped` callback covering both the
  route and a failed ownership probe), so the daemon drops its reference and
  `web.start` boots a genuinely fresh server.
- Changeset bases no longer anchor to a stale `origin/HEAD`: when the local
  default branch (`main`/`master`) tip strictly descends from the remote tip
  (rewelded history, unpushed work), `tk work`/`tk review`/`tk finish` pin
  the base at the local line instead of the remote one — previously a stale
  remote made changesets span the repo's entire local history. In-sync,
  diverged, and remote-ahead repos keep `origin/HEAD` precedence.
- `tk show` image evidences paint in Ghostty and other kitty-graphics
  terminals: emission uses the chunked transmit-and-display form (`a=T`)
  instead of virtual placements Ghostty 1.3.x never paints, alongside OSC
  1337 for iTerm2-family terminals. Detection and emission live in one
  shared `@tasks/terminal-image` package; TUI evidence images keep
  half-block rendering, now pinned at the render site instead of a
  process-wide `OPENTUI_IMAGE_PROTOCOL` default.
- TUI evidence images are area-resampled to the exact half-block cell grid
  before rendering, instead of relying on OpenTUI's point-sampling blocks
  path — large screenshots attached to issues (e.g. 1600×880) previously
  rendered as salt-and-pepper noise in the detail pane; they now downscale
  to a recognizable thumbnail. Decode failures fall back to the previous
  path.

## [0.6.0] - 2026-10-17

### Added

- `tk show` splits attachments into two sections: `ATTACHMENTS` (path refs)
  and `EVIDENCES` (ingested blobs, inline ones marked), with image blobs
  inlined when the terminal supports it (kitty graphics protocol, OSC 1337) —
  other terminals get a mime note instead. JSON output is unchanged for
  agents. The TUI detail pane shows the same attachments/evidences sections,
  rendering image blobs inline.
- `tk web` picks its port from `--port N` or the `TK_WEB_PORT` env var — flag
  wins; an unparsable value warns and falls back to the default instead of
  silently misconfiguring.
- `tk web --open` launches the browser at startup without dev mode, and in an
  interactive terminal the startup line shows `press w to open` — pressing `w`
  opens the browser at any time; Ctrl-C still quits.
- Per-command help: `tk <cmd> -h`, `tk <cmd> --help`, and `tk help <cmd>` now
  print that command's own usage and flags instead of the full help; `tk help`
  and `tk -h` keep the full reference.
- `tk web` opens evidence images in a full-screen viewer: zoom (wheel or
  `+`/`-`), pan, `‹`/`›` navigation across all image attachments of an issue,
  file name/mime/size/position in the toolbar, and a comment box that posts
  the text together with the `evidence:` reference — so the reference survives
  attachment deletion. Attachments can be deleted from the viewer with a
  confirm; existing comments keep the reference and render it as a chip.

### Changed

- `tk skill install` (and `tk skill --install <dir>`) now copies the real
  skill directory into the skills root instead of symlinking it — installed
  skills survive the install tree being cleaned or rebuilt. Copies no longer
  track `tk` upgrades: re-run the install after upgrading (`--force` on an
  existing install). `--tool <agents|claude|omp|pi|codex>` picks the agent
  whose skills root receives the copy (`.claude/skills`, `.omp/skills` /
  `~/.omp/agent/skills`, `~/.pi/agent/skills`, `.codex/skills`), with
  `agents` (`.agents/skills`) unchanged as the default.

### Fixed

- The TUI renders evidence images with OpenTUI's half-block protocol by
  default instead of kitty graphics: in Ghostty 1.3.x OpenTUI's kitty
  transport (virtual placements + Unicode placeholders) transmits but paints
  nothing, leaving an empty box. An explicit `OPENTUI_IMAGE_PROTOCOL` still
  wins.
- `tk worktree list|create|info|remove` dispatch again: `runWorktree` was
  implemented and documented in help, but `main()` never routed the `worktree`
  command, so every call failed with `unknown command: worktree`. Dispatch now
  happens before workspace resolution, so the commands also work in repos
  without a `.tasks/` workspace (`tk worktree info` correctly reports state
  `none`).
- `tk worktree create` records the worktree in the main root's `.gitignore`
  even when the working directory resolves through a symlink (macOS `/var` →
  `/private/var`): the relative path is now computed in real-path space.
- `tk web` review views match the TUI: the task view renders the full task
  rail (selection drives the center detail), and the filter chips bar only
  shows on views where the filter applies (list, board, insights) instead of
  every view.
- `tk web` daemon handoff survives terminal close: pressing `d` (or `-d` from
  a non-TTY) now spawns the daemon in its own session (`detached: true`), so
  closing the terminal or tearing down the PTY no longer SIGHUPs the detached
  server into dying moments after the handoff reports success.
- `tk web stop` no longer crosses workspaces: when the current workspace has
  no runtime row and the probed server belongs to a different workspace, it
  refuses with the foreign server's identity instead of POSTing `/api/stop`
  and killing it.

### Removed

- The `.tasks/current` last-selected-issue pointer. A single file shared by
  every worktree made multi-agent runs race on `--current` and silently target
  another agent's issue; `create`/`claim`/`close` also mutated it as a side
  effect. All id-scoped commands now require the id explicitly (the `tasks`
  tool, TUI and `tk` CLI included), and the runtime file is no longer written
  or read.

## [0.5.0] - 2026-10-05

### Added

- `tk skill install`: links the agent skill into the standard skills.sh roots —
  `.agents/skills` (project, default) or `~/.agents/skills` (`--global`) — with
  an interactive scope prompt on TTYs; refuses to clobber an existing install
  unless `--force` (interactive runs confirm first). `tk skill --install <dir>`
  still targets arbitrary directories, and `tk skill --json` gains
  `target`/`scope`. The symlink points at the skill directory, so installs track
  upgrades.
- Markdown issue rendering shows blob-backed attachments as `name (id)` next to
  path refs.

### Changed

- Help, PRIME, and the shipped SKILL.md document evidence ingest: `tk attach
  --evidence`, `evidence:<id>` comment refs, and blob-aware `tk detach`.

## [0.4.0] - 2026-10-04

### Added

- Blob-backed evidence attachments: path refs gain blob-backed siblings
  `{id, name, mime, size, sha256}` on issues, round-tripped through the bd wire
  format with unknown-field preservation. `tk attach --evidence <files>` ingests
  bytes into the configured store — fs under `.tasks/attachments/` (git-lfs
  staged automatically), any S3-compatible bucket, or the shared PostgreSQL
  database — sniffing mime from file content; `tk detach <id|name>` removes the
  stored bytes. Comment bodies reference blobs as `evidence:<id>`.
- Agent dispatch: agent, run, and sprint schemas persisted through every storage
  adapter; status moves drive run lifecycle with sprint operations and runtimes;
  `tk agent`, `tk run`, `tk runtime`, and inbox commands across CLI, TUI, and web.
- Web UI: browser client and server package sharing the issue command surface.

### Changed

- TUI keybindings and the destructive-action confirm flow.

### Fixed

- Self-update resolves the rolling `nightly` release by tag and buffers large
  asset downloads.

## [0.3.0] - 2026-09-11

### Added

- `tk update` — self-update for the installed binary. Homebrew installs delegate
  to `brew upgrade nsxbet/tap/tasks`; compiled binaries download the platform
  asset from GitHub releases, verify it against the release `checksums.txt`, and
  atomically replace the running binary. `--check` reports without updating,
  `--latest` opts into nightly pre-releases.
- Nightly channel: every push to `main` republishes the rolling `nightly`
  pre-release with fresh binaries.
- `install.sh` — one-line installer (stable by default, `--latest` for
  nightlies) with checksum verification for linux/darwin on arm64/x64.

### Changed

- Version is declared once in `package.json`; the CLI `VERSION` constant and
  the `version` command derive from the same source, and a test fails the build
  on drift.

## [0.2.0] - 2026-09-06

### Added

- File attachments on issues: `tk attach`/`tk detach` with per-attachment
  metadata, and `--plan <path>` to set an issue's plan file.
- `tk skill` — print or install the LLM-facing agent skill so docs ship with
  the binary.
- Agent lifecycle hooks: `tk setup cursor|codex`, plus pi/omp extension tooling.

### Fixed

- Surface build errors: duplicate `notes` field, `Metadata` typing, dropped
  `labelRemove`/`comment`/`comments`/`stats` entries.

## [0.1.0] - 2026-09-02

### Added

- Initial release: local-first issue tracker with dependency chains, pluggable
  storage backends (file, SQLite, PostgreSQL), beads migration, Dolt-based
  git sync, Hunk review integration, and the `tk` CLI.



## 2026-10-19 One Shared tk Web Instance

### Changed
- `tk web` from any workspace now repoints the live shared instance at that workspace instead of failing on a busy port — one browser URL serves whichever workspace you run it from
- The web UI's workspace picker (with `?path=` deep links) switches the shared instance between known workspaces without leaving the browser
- `tk web stop`/`port` resolve through the serving workspace's own registry row, so a repointed server is stoppable from the workspace it now serves
- Runtime-registry writes are serialized and atomic — the daemon's 250ms watch heartbeat no longer erases freshly registered web rows, and readers never see a torn `runtime.json`
- Removed `--random-port`; `tk web` shares one interface by default, and the daemon `web.start` verb accepts port `0` to bind an ephemeral port (tests)

## 2026-10-18 Onboard Managed Injection

### Added
- `tk onboard install` writes the task→review workflow directly into your agent instructions file as a marked, refreshable section — create and claim tasks, keep them updated, hand over ready-to-review, and print a work-done summary at close
- The managed section is stamped `<!-- BEGIN TK INTEGRATION v:1 hash:<8hex> -->`; install is a byte-identical no-op when the section body matches its hash stamp, `check` exits 0 only when current (missing/no-section/stale exit 1), and legacy unversioned markers parse as stale and migrate in place on install
- `--file <path>` targets another instruction file; `--tool claude|gemini` selects that agent's default instruction filename; `remove` strips only the managed section, leaving hand-written notes untouched
