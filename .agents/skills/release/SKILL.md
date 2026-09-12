---
name: release
description: Create and publish a tk release using the LLM — cut a version, update CHANGELOG.md, tag, and verify the automated pipelines (GitHub release with binaries, Homebrew tap formula, nightly channel). Use when the user asks to "release", "cut a version", "publish a new version", "ship a release", or when preparing a version tag for the tasks repo.
---

# Release

Cut a stable release of `tk` (repo: `NSXBet/tasks`). Automation publishes
binaries and the GitHub Release; you own the version, the changelog, and the
Homebrew formula bump.

## Channels

| Channel | Trigger | Outcome |
|---|---|---|
| Stable | push a `v*.*.*` tag | GitHub Release (notes from CHANGELOG.md) + `tk-<os>-<arch>` binaries + `checksums.txt`; wins the "Latest" badge |
| Nightly | every push to `main` | Rolling `nightly` pre-release re-published (`nightly.yml`); opt-in via `tk update --latest` / `install.sh --latest` |

Both call the shared build workflow (`.github/workflows/build-binaries.yml`),
which runs the full test suite before compiling. A failed build or test means
no release is published.

## Release procedure

### 1. Pre-flight

```bash
cd <tasks checkout>
git status --short                      # must be clean, on main, synced
bun run --filter '*' build && bun test packages/*/test/*.test.ts
tk version                              # sanity: prints current VERSION
```

### 2. Pick the version

Read the diff since the last tag (`git log --oneline v<prev>..HEAD`) and
classify per semver: breaking → major, features → minor, fixes → patch.
Bump **both** places (a test keeps them in lockstep — the build fails on
drift):

- root `package.json` → `"version"`
- `packages/cli/src/presentation.ts` → `export const VERSION`

### 3. Update CHANGELOG.md

Rename `## [Unreleased]` → `## [X.Y.Z] - YYYY-MM-DD` and open a fresh empty
`## [Unreleased]` above it. Write the section from the actual diff — user-facing
changes only (commands, flags, behavior, fixes), each entry starting `Added` /
`Changed` / `Fixed` / `Removed`. The release workflow extracts exactly this
section as the release notes and refuses to publish if the section is missing,
so the heading format (`## [X.Y.Z]`) is load-bearing.

### 4. Commit and tag

```bash
git add package.json packages/cli/src/presentation.ts CHANGELOG.md
git commit -m "chore: release vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z: <one-line summary from the changelog>"
git push && git push origin vX.Y.Z
```

The tag push triggers the Release workflow. Note: commits must be on the
remote tag's commit — push the branch first, then the tag.

### 5. Verify the pipeline

```bash
gh run watch --repo NSXBet/tasks          # Release workflow: build + publish
gh release view vX.Y.Z --repo NSXBet/tasks --json tagName,isPrerelease,assets --jq '{tag:.tagName,pre:.isPrerelease,assets:[.assets[].name]}'
# assets must be: checksums.txt, tk-darwin-arm64, tk-darwin-x64, tk-linux-arm64, tk-linux-x64
```

### 6. Update the Homebrew tap

Repo: `NSXBet/homebrew-tap`, file `Formula/tasks.rb`. For each of the four
targets, download the new asset and compute its sha256:

```bash
for target in linux-x64 linux-arm64 darwin-x64 darwin-arm64; do
  curl -fsSL -o /tmp/tk-$target "https://github.com/NSXBet/tasks/releases/download/vX.Y.Z/tk-$target"
  shasum -a 256 /tmp/tk-$target | awk '{print $2, $1}'
done
```

Set `version "X.Y.Z"` in the formula and paste each sha256 into its platform
block (`on_macos`/`on_linux` × `Hardware::CPU.arm?`/`intel?`). The asset names
are `tk-<target>` and Homebrew stages them under that name, so `install` maps
`"tk-<target>" => "tk"`. Commit and push the tap.

```bash
brew update && brew info nsxbet/tap/tasks   # shows the new version
brew install nsxbet/tap/tasks && tk version # clean-machine verification if available
```

### 7. Self-update sanity

On any machine with the previous release installed: `tk update --check` should
report `update_available: true` with `latest: vX.Y.Z`, and `tk update` should
land on the new release (`tk version` afterwards). Nightly builds identify
themselves via the baked `TK_BUILD_REF` (`nightly`), so `tk update --latest`
on them is a no-op until the next nightly lands.

## Rules

- Never publish a release whose CHANGELOG section is missing or empty; the
  workflow fails on purpose — fix the changelog, do not bypass it.
- Never hand-edit release assets or re-tag a published version to "fix" an
  asset; cut a new patch version instead. Deleting and re-pushing a tag makes
  already-installed binaries disagree with `checksums.txt`.
- The tap formula and the release must agree; a formula pointing at
  nonexistent assets fails `brew install` for everyone.
- Nightlies are disposable; do not pin them in the tap and do not backfill
  changelog entries for them.
