#!/bin/sh
# tk installer — downloads the self-contained tk binary from GitHub releases.
#
#   curl -fsSL https://raw.githubusercontent.com/NSXBet/tasks/main/install.sh | sh
#   install.sh              latest stable release
#   install.sh --latest     latest nightly pre-release
#   install.sh v0.3.0       a pinned version tag
#   TK_BIN_DIR=/usr/local/bin install.sh    custom install directory
#
# Verifies every download against the release checksums.txt. Supports
# linux/darwin on arm64/x64; installs to ~/.local/bin by default.

set -eu

REPO="NSXBet/tasks"
DEFAULT_INSTALL_DIR="${HOME}/.local/bin"
BIN_NAME="tk"

log() { printf '%s\n' "$*" >&2; }
die() { log "install.sh: $*"; exit 1; }

usage() {
  log "usage: install.sh [--latest | <version-tag>]"
  log "  (no argument)   install the latest stable release"
  log "  --latest        install the latest nightly pre-release"
  log "  v1.2.3          install a pinned version tag"
  log "environment: TK_BIN_DIR overrides the install directory (default: ${DEFAULT_INSTALL_DIR})"
}

channel_from_args() {
  [ "$#" -le 1 ] || { usage >&2; exit 2; }
  case "${1:-stable}" in
    stable | "") echo "stable" ;;
    --latest | -latest) echo "nightly" ;;
    -h | --help) usage; exit 0 ;;
    v*.*.*) echo "$1" ;;
    *) usage >&2; die "unknown argument: $1 (use a v*.*.* tag or --latest)" ;;
  esac
}

command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || die "curl or wget is required"
command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1 || die "shasum or sha256sum is required"

os_name() {
  case "$(uname -s)" in
    Darwin) echo "darwin" ;;
    Linux) echo "linux" ;;
    *) die "unsupported operating system: $(uname -s) (releases cover darwin and linux)" ;;
  esac
}

cpu_arch() {
  case "$(uname -m)" in
    arm64 | aarch64) echo "arm64" ;;
    x86_64 | amd64) echo "x64" ;;
    *) die "unsupported architecture: $(uname -m) (releases cover arm64 and x64)" ;;
  esac
}

fetch() {
  url=$1
  destination=$2
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$destination" "$url" || die "download failed: $url"
  else
    wget -q --tries=3 -O "$destination" "$url" || die "download failed: $url"
  fi
}

sha256_of() {
  file=$1
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$file" | cut -d' ' -f1
  else sha256sum "$file" | cut -d' ' -f1
  fi
}

CHANNEL=$(channel_from_args "$@")

OS=$(os_name)
ARCH=$(cpu_arch)
TARGET="tk-${OS}-${ARCH}"

BIN_DIR="${TK_BIN_DIR:-${DEFAULT_INSTALL_DIR}}"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

case "$CHANNEL" in
  stable) release_ref="latest" ;;
  nightly) release_ref="nightly" ;;
  *) release_ref="tags/$CHANNEL" ;;
esac
RELEASE_JSON="${TMP_DIR}/release.json"
fetch "https://api.github.com/repos/${REPO}/releases/${release_ref}" "$RELEASE_JSON"

if command -v jq >/dev/null 2>&1; then
  TAG=$(jq -r '.tag_name' "$RELEASE_JSON")
  ASSET_URL=$(jq -r --arg target "$TARGET" '.assets[] | select(.name == $target) | .browser_download_url' "$RELEASE_JSON")
  CHECKSUMS_URL=$(jq -r '.assets[] | select(.name == "checksums.txt") | .browser_download_url' "$RELEASE_JSON")
else
  # Field order in the GitHub API is fixed: tag_name first, then name, then
  # assets with browser_download_url last — the last URL in each asset object
  # is the download URL, and asset order matches our target listing.
  TAG=$(sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$RELEASE_JSON" | head -n1)
  asset_urls=$(sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$RELEASE_JSON")
  ASSET_URL=$(printf '%s\n' "$asset_urls" | grep "/${TARGET}$" | head -n1)
  CHECKSUMS_URL=$(printf '%s\n' "$asset_urls" | grep "/checksums.txt$" | head -n1)
fi

[ -n "$TAG" ] || die "could not resolve ${CHANNEL} release tag"
[ -n "$ASSET_URL" ] || die "release ${TAG} has no asset ${TARGET}"
[ -n "$CHECKSUMS_URL" ] || die "release ${TAG} has no checksums.txt"

log "==> Downloading ${TARGET} from release ${TAG}"
fetch "$ASSET_URL" "${TMP_DIR}/${TARGET}"
fetch "$CHECKSUMS_URL" "${TMP_DIR}/checksums.txt"

EXPECTED=$(grep -E "[[:space:]]${TARGET}\$" "${TMP_DIR}/checksums.txt" | cut -d' ' -f1)
[ -n "$EXPECTED" ] || die "checksums.txt has no entry for ${TARGET}"
ACTUAL=$(sha256_of "${TMP_DIR}/${TARGET}")
if [ "$ACTUAL" != "$EXPECTED" ]; then
  die "checksum mismatch for ${TARGET}
  expected: ${EXPECTED}
  actual:   ${ACTUAL}"
fi

mkdir -p "$BIN_DIR" || die "cannot create ${BIN_DIR}"
mv -f "${TMP_DIR}/${TARGET}" "${BIN_DIR}/${BIN_NAME}"
chmod 755 "${BIN_DIR}/${BIN_NAME}"

case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *) log "==> Note: ${BIN_DIR} is not on your PATH. Add it to your shell profile:
    export PATH=\"${BIN_DIR}:\$PATH\"" ;;
esac

log "==> Installed ${BIN_NAME} ${TAG} to ${BIN_DIR}/${BIN_NAME}"
"${BIN_DIR}/${BIN_NAME}" version
