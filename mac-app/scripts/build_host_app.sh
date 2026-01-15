#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD_DIR="build/host"
APP_NAME="Nomendex"
BIN_NAME="${APP_NAME}"
SPARKLE_DIR="Frameworks/Sparkle"

mkdir -p "$BUILD_DIR"

# Ensure Sparkle is downloaded
./scripts/download_sparkle.sh

SWIFT_FILES=(
  macos-host/Sources/main.swift
  macos-host/Sources/AppDelegate.swift
  macos-host/Sources/Logger.swift
  macos-host/Sources/StatusBarController.swift
  macos-host/Sources/WebViewWindowController.swift
  macos-host/Sources/GlobalHotKey.swift
  macos-host/Sources/SidecarLauncher.swift
)

echo "[host] compiling Swift sources..."
xcrun swiftc "${SWIFT_FILES[@]}" \
  -framework Cocoa -framework WebKit -framework Carbon \
  -F "$SPARKLE_DIR" -framework Sparkle \
  -Xlinker -rpath -Xlinker @executable_path/../Frameworks \
  -o "$BUILD_DIR/$BIN_NAME"

if [[ "${1:-}" == "--run" ]]; then
  echo "[host] running (DEV: uses BUN_DEV_SERVER_URL if set)..."
  "$BUILD_DIR/$BIN_NAME"
fi
