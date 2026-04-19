#!/usr/bin/env bash
# Braindump installer — downloads the latest GitHub release for your platform
# and installs it. On macOS, strips the quarantine attribute so Gatekeeper
# doesn't block the unsigned app.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/James-W-Berry/braindump/main/install.sh | bash
#
# Or after cloning:
#   ./install.sh
set -euo pipefail

REPO="James-W-Berry/braindump"
OS="$(uname -s)"
ARCH="$(uname -m)"

say() { printf "\033[36m==>\033[0m %s\n" "$*"; }
err() { printf "\033[31merror:\033[0m %s\n" "$*" >&2; }

# Match the artifact we want for this platform. Patterns are matched
# case-insensitively below (`grep -iE`) because Tauri uses the literal
# `productName` when naming artifacts — BRAINDUMP ships as
# `BRAINDUMP_…` in uppercase.
case "$OS" in
  Darwin)
    ARTIFACT_PATTERN='braindump_.*_(universal|aarch64|x64)\.dmg$'
    ;;
  Linux)
    case "$ARCH" in
      x86_64)  ARTIFACT_PATTERN='braindump_.*_amd64\.AppImage$' ;;
      aarch64) ARTIFACT_PATTERN='braindump_.*_aarch64\.AppImage$' ;;
      *) err "unsupported Linux arch: $ARCH"; exit 1 ;;
    esac
    ;;
  *)
    err "unsupported OS: $OS. Download the installer from https://github.com/$REPO/releases"
    exit 1
    ;;
esac

command -v curl >/dev/null || { err "curl is required"; exit 1; }

say "fetching latest release metadata"
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")
TAG=$(printf '%s' "$RELEASE_JSON" | grep -m1 '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

# Find the matching asset URL. `-i` is essential here — artifact names
# follow the product name's casing, which is upper-case for BRAINDUMP.
URL=$(printf '%s' "$RELEASE_JSON" \
  | grep -E '"browser_download_url":' \
  | sed -E 's/.*"(https:[^"]+)".*/\1/' \
  | grep -iE "$ARTIFACT_PATTERN" \
  | head -1 || true)

if [ -z "${URL:-}" ]; then
  err "no asset matching $ARTIFACT_PATTERN found in release $TAG"
  err "available assets:"
  printf '%s' "$RELEASE_JSON" | grep '"browser_download_url":' | sed -E 's/.*"(https:[^"]+)".*/  \1/' >&2
  exit 1
fi

FILENAME=$(basename "$URL")
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

say "downloading $FILENAME ($TAG)"
curl -fsSL -o "$TMP/$FILENAME" "$URL"

case "$OS" in
  Darwin)
    say "mounting dmg"
    MOUNT_OUT=$(hdiutil attach -quiet -nobrowse -plist "$TMP/$FILENAME")
    MOUNT_POINT=$(printf '%s' "$MOUNT_OUT" \
      | /usr/bin/awk -F'[<>]' '/<key>mount-point<\/key>/ { getline; print $3; exit }')
    if [ -z "${MOUNT_POINT:-}" ] || [ ! -d "$MOUNT_POINT" ]; then
      err "failed to locate mount point"
      exit 1
    fi

    APP_SRC=$(ls -d "$MOUNT_POINT"/*.app 2>/dev/null | head -1)
    if [ -z "$APP_SRC" ]; then
      hdiutil detach -quiet "$MOUNT_POINT" || true
      err "no .app bundle found inside the dmg"
      exit 1
    fi

    APP_NAME=$(basename "$APP_SRC")
    APP_DEST="/Applications/$APP_NAME"

    if [ -d "$APP_DEST" ]; then
      say "removing previous install at $APP_DEST"
      rm -rf "$APP_DEST"
    fi

    say "copying $APP_NAME to /Applications"
    cp -R "$APP_SRC" "$APP_DEST"
    hdiutil detach -quiet "$MOUNT_POINT" || true

    say "stripping Gatekeeper quarantine"
    xattr -dr com.apple.quarantine "$APP_DEST" || true

    say "installed. Launch with: open -a \"$(basename "$APP_DEST" .app)\""
    ;;

  Linux)
    DEST_DIR="$HOME/.local/bin"
    mkdir -p "$DEST_DIR"
    DEST="$DEST_DIR/braindump.AppImage"
    say "installing to $DEST"
    mv "$TMP/$FILENAME" "$DEST"
    chmod +x "$DEST"
    say "installed. Launch with: $DEST"
    case ":$PATH:" in
      *":$DEST_DIR:"*) : ;;
      *) say "note: $DEST_DIR isn't on your PATH. Add it to run 'braindump.AppImage' from anywhere." ;;
    esac
    ;;
esac
