#!/usr/bin/env bash
set -euo pipefail

# Sign innermost to outermost, zip, notarize, staple, verify
# Defaults target app path to bundle/Nomendex.app
# Requires: Developer ID Application cert in keychain, and a saved notarytool keychain profile
# Usage examples:
#   ./scripts/sign_and_notarize.sh
#   CODESIGN_IDENTITY="Developer ID Application: Your Org (TEAMID)" ./scripts/sign_and_notarize.sh
#   ./scripts/sign_and_notarize.sh --app bundle/Nomendex.app --keychain-profile AC_NOTARY

cd "$(dirname "$0")/.."

APP_PATH="${APP_PATH:-bundle/Nomendex.app}"
ENTITLEMENTS="${ENTITLEMENTS:-macos-host/entitlements.plist}"
NOTARY_PROFILE="${NOTARY_PROFILE:-AC_NOTARY}"
CODESIGN_IDENTITY="${CODESIGN_IDENTITY:-}"
SIGN_ONLY=0
NOTARIZE_ONLY=0
MAKE_DMG=0
ZIP_PATH=""

usage() {
  cat >&2 <<EOF
Usage: $0 [--app <path .app>] [--identity <codesign id>] [--entitlements <path>] \
          [--keychain-profile <profile>] [--sign-only | --notarize-only] [--zip <path.zip>] [--dmg]

Environment vars:
  APP_PATH           Path to .app (default: bundle/Nomendex.app)
  ENTITLEMENTS       Path to entitlements.plist for host + sidecar (default: macos-host/entitlements.plist)
  CODESIGN_IDENTITY  Developer ID Application identity string (auto-detects if unset)
  NOTARY_PROFILE     notarytool keychain profile (default: AC_NOTARY)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) APP_PATH="$2"; shift 2 ;;
    --identity) CODESIGN_IDENTITY="$2"; shift 2 ;;
    --entitlements) ENTITLEMENTS="$2"; shift 2 ;;
    --keychain-profile) NOTARY_PROFILE="$2"; shift 2 ;;
    --sign-only) SIGN_ONLY=1; shift ;;
    --notarize-only) NOTARIZE_ONLY=1; shift ;;
    --zip) ZIP_PATH="$2"; shift 2 ;;
    --dmg) MAKE_DMG=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[release] Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

log() { echo -e "$*"; }
run() { log "+ $*"; "$@"; }

# Resolve defaults
if [[ -z "$ZIP_PATH" ]]; then
  app_base="$(basename "$APP_PATH")"
  app_name_no_ext="${app_base%.app}"
  ZIP_PATH="bundle/${app_name_no_ext}.zip"
fi

if [[ ! -d "$APP_PATH" ]]; then
  log "[release] ERROR: App not found: $APP_PATH" >&2
  log "[release] Hint: run 'make build' first." >&2
  exit 1
fi
if [[ ! -f "$ENTITLEMENTS" ]]; then
  log "[release] ERROR: Entitlements not found: $ENTITLEMENTS" >&2
  exit 1
fi

if [[ -z "${CODESIGN_IDENTITY}" ]]; then
  # Try to auto-detect a Developer ID Application identity
  DETECTED_ID=$(security find-identity -p codesigning -v 2>/dev/null | grep 'Developer ID Application:' | head -n1 | sed -E 's/.*"(.+)"/\1/') || true
  if [[ -z "$DETECTED_ID" ]]; then
    log "[release] ERROR: No 'Developer ID Application' identity found."
    log "[release] Set CODESIGN_IDENTITY or install your Developer ID cert in the login keychain."
    exit 1
  fi
  CODESIGN_IDENTITY="$DETECTED_ID"
  log "[release] Using codesign identity: $CODESIGN_IDENTITY"
fi

# Determine paths to inner components
INFO_PLIST="$APP_PATH/Contents/Info.plist"
if [[ ! -f "$INFO_PLIST" ]]; then
  log "[release] ERROR: Missing Info.plist at $INFO_PLIST" >&2
  exit 1
fi
HOST_EXEC_NAME=$( /usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$INFO_PLIST" )
HOST_BIN="$APP_PATH/Contents/MacOS/${HOST_EXEC_NAME}"
SIDECAR_BIN="$APP_PATH/Contents/Resources/sidecar/sidecar"
SIDECAR_LIB_DIR="$APP_PATH/Contents/Resources/sidecar/lib"

log "[release] === Signing components (Hardened Runtime) ==="

# Sign Sparkle.framework first (innermost to outermost)
SPARKLE_FRAMEWORK="$APP_PATH/Contents/Frameworks/Sparkle.framework"
if [[ -d "$SPARKLE_FRAMEWORK" ]]; then
  log "[release] Signing Sparkle.framework..."
  run codesign --force --timestamp --options runtime \
    --sign "$CODESIGN_IDENTITY" \
    "$SPARKLE_FRAMEWORK/Versions/B/XPCServices/Downloader.xpc" || true
  run codesign --force --timestamp --options runtime \
    --sign "$CODESIGN_IDENTITY" \
    "$SPARKLE_FRAMEWORK/Versions/B/XPCServices/Installer.xpc" || true
  run codesign --force --timestamp --options runtime \
    --sign "$CODESIGN_IDENTITY" \
    "$SPARKLE_FRAMEWORK/Versions/B/Autoupdate" || true
  run codesign --force --timestamp --options runtime \
    --sign "$CODESIGN_IDENTITY" \
    "$SPARKLE_FRAMEWORK/Versions/B/Updater.app" || true
  run codesign --force --timestamp --options runtime \
    --sign "$CODESIGN_IDENTITY" \
    "$SPARKLE_FRAMEWORK"
fi

# Sign any embedded dylibs first
if [[ -d "$SIDECAR_LIB_DIR" ]]; then
  while IFS= read -r -d '' dylib; do
    run codesign --force --timestamp --options runtime \
      --sign "$CODESIGN_IDENTITY" \
      "$dylib"
  done < <(find "$SIDECAR_LIB_DIR" -type f -name "*.dylib" -print0)
else
  log "[release] Note: No sidecar lib directory at $SIDECAR_LIB_DIR"
fi

# Sign sidecar binary with entitlements
if [[ -f "$SIDECAR_BIN" ]]; then
  run codesign --force --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS" \
    --sign "$CODESIGN_IDENTITY" \
    "$SIDECAR_BIN"
else
  log "[release] WARN: Sidecar binary not found at $SIDECAR_BIN; skipping"
fi

# Sign host binary with entitlements
if [[ -f "$HOST_BIN" ]]; then
  run codesign --force --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS" \
    --sign "$CODESIGN_IDENTITY" \
    "$HOST_BIN"
else
  log "[release] ERROR: Host binary not found at $HOST_BIN" >&2
  exit 1
fi

# Sign the .app wrapper
run codesign --force --timestamp --options runtime \
  --sign "$CODESIGN_IDENTITY" \
  "$APP_PATH"

# Verify local signature
run codesign --verify --deep --strict --verbose=2 "$APP_PATH"
run spctl -a -vvv -t install "$APP_PATH" || true

if [[ "$SIGN_ONLY" -eq 1 ]]; then
  log "[release] Sign-only requested; skipping notarization."
  exit 0
fi

log "[release] === Creating archive for notarization ==="
run ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"

if [[ "$NOTARIZE_ONLY" -eq 1 ]]; then
  log "[release] Notarize-only requested; proceeding to notarization."
fi

log "[release] === Submitting for notarization (profile: $NOTARY_PROFILE) ==="
# --wait blocks until complete and prints status
run xcrun notarytool submit "$ZIP_PATH" --keychain-profile "$NOTARY_PROFILE" --wait

log "[release] === Stapling ticket ==="
run xcrun stapler staple "$APP_PATH"
run xcrun stapler validate "$APP_PATH"
run spctl -a -vvv -t install "$APP_PATH" || true

if [[ "$MAKE_DMG" -eq 1 ]]; then
  VOLNAME="$(basename "$APP_PATH" .app)"
  DMG_PATH="${ZIP_PATH%.zip}.dmg"
  log "[release] === Creating DMG at $DMG_PATH ==="
  run hdiutil create -fs APFS -volname "$VOLNAME" -srcfolder "$APP_PATH" "$DMG_PATH"
  run xcrun stapler staple "$DMG_PATH" || true
fi

log "[release] Done. Signed app: $APP_PATH\n- Zip: $ZIP_PATH\n- Notarized and stapled."
