#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="Nomendex"
APP_DIR="bundle/${APP_NAME}.app"

echo "[pkg] assembling ${APP_DIR}..."
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources/public" "$APP_DIR/Contents/Resources/sidecar" "$APP_DIR/Contents/Frameworks"

# Copy host binary and plists/resources
cp -f macos-host/Info.plist "$APP_DIR/Contents/Info.plist"
cp -fR macos-host/Resources/. "$APP_DIR/Contents/Resources/" || true
cp -f build/host/${APP_NAME} "$APP_DIR/Contents/MacOS/${APP_NAME}"

# Copy Sparkle.framework for auto-updates
if [ -d "Frameworks/Sparkle/Sparkle.framework" ]; then
  echo "[pkg] copying Sparkle.framework..."
  cp -R "Frameworks/Sparkle/Sparkle.framework" "$APP_DIR/Contents/Frameworks/"
else
  echo "[pkg] Warning: Sparkle.framework not found. Run ./scripts/download_sparkle.sh"
fi

# No need to copy UI files - using direct HTML imports in sidecar binary
echo "[pkg] Using direct HTML imports (no separate UI build needed)"

# Copy sidecar binary (compiled) if present, else fallback to script
if [ -f build/sidecar/sidecar ]; then
  cp -f build/sidecar/sidecar "$APP_DIR/Contents/Resources/sidecar/sidecar"
  chmod +x "$APP_DIR/Contents/Resources/sidecar/sidecar"
  
else
  echo "[pkg] Warning: compiled sidecar missing. Falling back to server.ts"
  mkdir -p "$APP_DIR/Contents/Resources/sidecar"
  cp -f sidecar/server.ts "$APP_DIR/Contents/Resources/sidecar/server.ts"
fi

# Optional: codesign ad-hoc (skipped by default). Uncomment to sign locally.
# codesign --force --deep --sign - --entitlements macos-host/entitlements.plist "$APP_DIR"

echo "[pkg] done: $APP_DIR"

