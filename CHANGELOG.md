# Changelog

All notable changes to `tk` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/). Each release on GitHub embeds the
matching section as its release notes — add a section for every new version
(see `.agents/skills/release/SKILL.md` for the full release procedure).

## [Unreleased]

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
