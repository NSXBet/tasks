# Changelog

All notable changes to `tk` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/). Each release on GitHub embeds the
matching section as its release notes — add a section for every new version
(see `.agents/skills/release/SKILL.md` for the full release procedure).

## [Unreleased]

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

### Fixed

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
