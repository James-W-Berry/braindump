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
    PLIST_OUT="$TMP/mount.plist"
    if ! hdiutil attach -quiet -nobrowse -plist "$TMP/$FILENAME" > "$PLIST_OUT"; then
      err "hdiutil attach failed"
      exit 1
    fi

    # Extract the mount point from the plist. The awk approach used
    # previously was brittle — it assumed a specific line layout for
    # `<key>mount-point</key>` → `<string>…</string>`. Prefer plutil
    # (a macOS core tool) and iterate the `system-entities` array
    # since the mountable entity isn't always at index 0. Fall back
    # to a regex sweep if plutil somehow isn't present.
    MOUNT_POINT=""
    if command -v /usr/bin/plutil >/dev/null; then
      for i in 0 1 2 3 4 5; do
        mp=$(/usr/bin/plutil -extract "system-entities.$i.mount-point" raw -o - "$PLIST_OUT" 2>/dev/null || true)
        if [ -n "$mp" ] && [ -d "$mp" ]; then
          MOUNT_POINT="$mp"
          break
        fi
      done
    fi
    if [ -z "$MOUNT_POINT" ]; then
      MOUNT_POINT=$(/usr/bin/sed -nE 's|.*<string>(/Volumes/[^<]+)</string>.*|\1|p' "$PLIST_OUT" | head -1)
    fi
    if [ -z "${MOUNT_POINT:-}" ] || [ ! -d "$MOUNT_POINT" ]; then
      err "failed to locate mount point (dmg attached but path not found)"
      err "hdiutil plist:"
      /usr/bin/sed 's/^/  /' "$PLIST_OUT" >&2
      exit 1
    fi

    # From here on, make sure we detach the dmg even on error.
    cleanup_mount() {
      hdiutil detach -quiet "$MOUNT_POINT" 2>/dev/null || true
    }
    trap 'cleanup_mount; rm -rf "$TMP"' EXIT

    APP_SRC=$(ls -d "$MOUNT_POINT"/*.app 2>/dev/null | head -1)
    if [ -z "$APP_SRC" ]; then
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
    cleanup_mount
    trap 'rm -rf "$TMP"' EXIT

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
