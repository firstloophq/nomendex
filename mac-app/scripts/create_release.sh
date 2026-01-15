#!/usr/bin/env bash
# Creates a signed release for Sparkle auto-updates
# Usage: ./scripts/create_release.sh [version]
# Example: ./scripts/create_release.sh 0.2.0
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
    # Try to get version from Info.plist
    VERSION=$(plutil -extract CFBundleShortVersionString raw macos-host/Info.plist 2>/dev/null || echo "")
    if [[ -z "$VERSION" ]]; then
        echo "Usage: $0 <version>"
        echo "Example: $0 0.2.0"
        exit 1
    fi
    echo "[release] Using version from Info.plist: $VERSION"
fi

APP_NAME="Nomendex"
APP_DIR="bundle/${APP_NAME}.app"
RELEASE_DIR="releases"
ZIP_NAME="${APP_NAME}-${VERSION}.zip"
SIGN_TOOL="Frameworks/Sparkle/bin/sign_update"

# Ensure app is built
if [[ ! -d "$APP_DIR" ]]; then
    echo "[release] Error: $APP_DIR not found. Run 'make build' first."
    exit 1
fi

# Ensure Sparkle sign tool exists
if [[ ! -f "$SIGN_TOOL" ]]; then
    echo "[release] Error: Sparkle sign tool not found. Run ./scripts/download_sparkle.sh first."
    exit 1
fi

# Create releases directory
mkdir -p "$RELEASE_DIR"

echo "[release] Creating zip: $ZIP_NAME"
(cd bundle && zip -r -y "../$RELEASE_DIR/$ZIP_NAME" "${APP_NAME}.app")

echo "[release] Signing with EdDSA..."
SIGNATURE=$("$SIGN_TOOL" "$RELEASE_DIR/$ZIP_NAME" 2>&1 | grep "sparkle:edSignature" | sed 's/.*sparkle:edSignature="\([^"]*\)".*/\1/')

if [[ -z "$SIGNATURE" ]]; then
    echo "[release] Running sign_update for manual signature extraction..."
    "$SIGN_TOOL" "$RELEASE_DIR/$ZIP_NAME"
    echo ""
    echo "[release] Copy the edSignature value from above into your appcast.xml"
else
    echo ""
    echo "============================================================"
    echo "Release created: $RELEASE_DIR/$ZIP_NAME"
    echo "============================================================"
    echo ""
    echo "Add this to your appcast.xml:"
    echo ""
    echo "<item>"
    echo "  <title>Version $VERSION</title>"
    echo "  <pubDate>$(date -R)</pubDate>"
    echo "  <sparkle:version>$VERSION</sparkle:version>"
    echo "  <sparkle:shortVersionString>$VERSION</sparkle:shortVersionString>"
    echo "  <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>"
    echo "  <description><![CDATA["
    echo "    <h2>What's New</h2>"
    echo "    <ul>"
    echo "      <li>TODO: Add release notes</li>"
    echo "    </ul>"
    echo "  ]]></description>"
    echo "  <enclosure"
    echo "    url=\"https://github.com/YOUR_ORG/nomendex/releases/download/v${VERSION}/${ZIP_NAME}\""
    echo "    length=\"$(stat -f%z "$RELEASE_DIR/$ZIP_NAME")\""
    echo "    type=\"application/octet-stream\""
    echo "    sparkle:edSignature=\"$SIGNATURE\""
    echo "  />"
    echo "</item>"
    echo ""
fi

echo "[release] Next steps:"
echo "  1. Upload $RELEASE_DIR/$ZIP_NAME to GitHub Releases as v$VERSION"
echo "  2. Update appcast.xml on nomendex.com with the XML above"
echo "  3. Test by running the previous version and checking for updates"
