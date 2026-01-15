# macOS App Update Plan

This document outlines the automatic update system for the Nomendex macOS app using [Sparkle](https://sparkle-project.org/).

## Status: Implemented

Sparkle has been integrated into the build system. Follow the setup steps below to enable auto-updates.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Nomendex.app                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Sparkle.framework                                   │   │
│  │  - Checks https://nomendex.com/appcast.xml daily     │   │
│  │  - Downloads updates from GitHub Releases           │   │
│  │  - Verifies EdDSA signatures                        │   │
│  │  - Runs Autoupdate helper for install/relaunch      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  nomendex.com                                                │
│  - /appcast.xml (version manifest, points to GitHub)       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  GitHub Releases                                            │
│  - Nomendex-x.x.x.zip (signed releases)                     │
│  - Free, reliable hosting with CDN                          │
└─────────────────────────────────────────────────────────────┘
```

## Setup Steps

### 1. Generate EdDSA Signing Keys (One-Time)

```bash
cd mac-app
make sparkle-keys
```

This will:
- Download Sparkle framework if needed
- Generate an EdDSA key pair
- Store the private key in your macOS Keychain
- Display the public key to add to Info.plist

**Important:** Back up your Keychain. The private key is required to sign all future releases.

### 2. Add Public Key to Info.plist

Edit `mac-app/macos-host/Info.plist` and replace the placeholder:

```xml
<key>SUPublicEDKey</key>
<string>YOUR_PUBLIC_EDDSA_KEY_HERE</string>  <!-- Replace with your key -->
```

### 3. Build the App

```bash
cd mac-app
make build
make release  # Signs and notarizes for distribution
```

### 4. Create a Release

```bash
# Bump version in Info.plist first (CFBundleShortVersionString and CFBundleVersion)
make sparkle-release VERSION=0.2.0
```

This will:
- Create `releases/Nomendex-0.2.0.zip`
- Sign it with your EdDSA key
- Output the appcast.xml entry with the signature

### 5. Upload to GitHub

1. Go to your GitHub repo → Releases → Create new release
2. Tag: `v0.2.0`
3. Upload `releases/Nomendex-0.2.0.zip`
4. Publish

### 6. Update appcast.xml on nomendex.com

Host at `https://nomendex.com/appcast.xml`. Use `mac-app/appcast-template.xml` as a starting point.

Example entry:
```xml
<item>
  <title>Version 0.2.0</title>
  <pubDate>Mon, 13 Jan 2026 12:00:00 +0000</pubDate>
  <sparkle:version>2</sparkle:version>
  <sparkle:shortVersionString>0.2.0</sparkle:shortVersionString>
  <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
  <description><![CDATA[
    <h2>What's New</h2>
    <ul>
      <li>New feature X</li>
      <li>Bug fix Y</li>
    </ul>
  ]]></description>
  <enclosure
    url="https://github.com/YOUR_ORG/nomendex/releases/download/v0.2.0/Nomendex-0.2.0.zip"
    length="15728640"
    type="application/octet-stream"
    sparkle:edSignature="YOUR_SIGNATURE_FROM_STEP_4"
  />
</item>
```

## Release Workflow Summary

For each new version:

1. Update version in `Info.plist`:
   - `CFBundleShortVersionString` → `0.2.0` (display version)
   - `CFBundleVersion` → `2` (build number, must increment)

2. Build and sign:
   ```bash
   make build
   make release
   make sparkle-release VERSION=0.2.0
   ```

3. Upload `releases/Nomendex-0.2.0.zip` to GitHub Releases

4. Update `appcast.xml` on nomendex.com

5. Test: Install the previous version and check for updates

## Files Added

- `mac-app/scripts/download_sparkle.sh` - Downloads Sparkle framework
- `mac-app/scripts/generate_sparkle_keys.sh` - Generates EdDSA key pair
- `mac-app/scripts/create_release.sh` - Creates signed release zip
- `mac-app/appcast-template.xml` - Template for appcast.xml
- `mac-app/Frameworks/Sparkle/` - Sparkle framework (auto-downloaded)

## Code Changes

- `AppDelegate.swift` - Initializes Sparkle, adds "Check for Updates..." menu
- `Info.plist` - Added SUFeedURL, SUPublicEDKey, SUEnableAutomaticChecks
- `build_host_app.sh` - Links Sparkle framework
- `package_app.sh` - Copies Sparkle.framework to app bundle

## Why Sparkle

- Open source, battle-tested since 2006
- Handles the complex self-replacement dance (helper binary, permissions, atomic swap, relaunch)
- Built-in EdDSA signature verification
- Supports delta updates for smaller downloads
- Well-maintained with active development

## References

- [Sparkle Documentation](https://sparkle-project.org/documentation/)
- [Sparkle GitHub](https://github.com/sparkle-project/Sparkle)
- [Appcast XML Format](https://sparkle-project.org/documentation/publishing/)
