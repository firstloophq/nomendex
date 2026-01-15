# macOS App Signing & Notarization Guide

This guide covers the complete process for signing and notarizing the Nomendex macOS app for distribution.

## Prerequisites

### 1. Developer ID Certificate

You need a **Developer ID Application** certificate installed in your keychain.

**Check if installed:**
```bash
security find-identity -v -p codesigning
```

Look for: `Developer ID Application: Caret AI, Inc (V655D7TG3T)`

### 2. Notarytool Keychain Profile

A keychain profile stores your Apple ID credentials for notarization.

**Create profile (one-time setup):**
```bash
xcrun notarytool store-credentials "AC_NOTARY" \
  --apple-id "your-apple-id@email.com" \
  --team-id "V655D7TG3T" \
  --password "app-specific-password"
```

Generate an app-specific password at [appleid.apple.com](https://appleid.apple.com) under Security > App-Specific Passwords.

### 3. Apple Developer Agreements

**All of these must be accepted before notarization will work:**

1. **Apple Developer Program License Agreement**
   - [developer.apple.com/account](https://developer.apple.com/account)

2. **Paid Applications Schedule** (App Store Connect)
   - [appstoreconnect.apple.com/agreements](https://appstoreconnect.apple.com/agreements)
   - Requires tax/banking information to be completed

3. **Free Applications Agreement**
   - Also at App Store Connect

**Common Error:**
```
HTTP status code: 403. A required agreement is missing or has expired.
```
This means you need to accept agreements at one of the above locations.

## Signing & Notarization

### Quick Start

```bash
cd /Users/jacobcolling/mcp-client/mac-app
./scripts/sign_and_notarize.sh
```

This will:
1. Sign all components with hardened runtime
2. Submit to Apple for notarization
3. Wait for approval (typically 5-10 minutes)
4. Staple the notarization ticket to the app

### Script Options

```bash
# Full process (sign + notarize)
./scripts/sign_and_notarize.sh

# Sign only (skip notarization)
./scripts/sign_and_notarize.sh --sign-only

# Notarize only (skip signing)
./scripts/sign_and_notarize.sh --notarize-only

# Create DMG after notarization
./scripts/sign_and_notarize.sh --dmg

# Custom paths
./scripts/sign_and_notarize.sh \
  --app bundle/Nomendex.app \
  --identity "Developer ID Application: Caret AI, Inc (V655D7TG3T)" \
  --entitlements macos-host/entitlements.plist \
  --keychain-profile AC_NOTARY
```

### Using Make

```bash
make sign       # Sign only
make notarize   # Notarize only
make release    # Full build + sign + notarize
```

## Signing Order

Components must be signed from innermost to outermost:

1. **Dylibs** — `Contents/Resources/sidecar/lib/*.dylib`
2. **Sidecar binary** — `Contents/Resources/sidecar/sidecar`
3. **Host binary** — `Contents/MacOS/Nomendex`
4. **App bundle** — `Nomendex.app`

## Entitlements

Located at `macos-host/entitlements.plist`:

| Entitlement | Purpose |
|-------------|---------|
| `com.apple.security.network.client` | Outgoing network connections |
| `com.apple.security.cs.allow-jit` | JIT compilation for Bun runtime |
| `com.apple.security.cs.disable-library-validation` | Load embedded sidecar binaries |

## Verification Commands

### Check Signing Status
```bash
# Basic verification
codesign --verify --deep --strict --verbose=2 bundle/Nomendex.app

# Detailed signature info
codesign -dvvv bundle/Nomendex.app

# Gatekeeper check
spctl -a -vvv -t install bundle/Nomendex.app
```

**Expected output after notarization:**
```
bundle/Nomendex.app: accepted
source=Notarized Developer ID
origin=Developer ID Application: Caret AI, Inc (V655D7TG3T)
```

### Check Notarization Ticket
```bash
xcrun stapler validate bundle/Nomendex.app
```

### Check Notarization History
```bash
xcrun notarytool history --keychain-profile AC_NOTARY
```

### Check Specific Submission
```bash
xcrun notarytool info <submission-id> --keychain-profile AC_NOTARY
```

### Get Notarization Logs (if failed)
```bash
xcrun notarytool log <submission-id> --keychain-profile AC_NOTARY
```

## Troubleshooting

### 403 Agreement Error
```
HTTP status code: 403. A required agreement is missing or has expired.
```

**Fix:** Accept all agreements at:
- [developer.apple.com/account](https://developer.apple.com/account)
- [appstoreconnect.apple.com/agreements](https://appstoreconnect.apple.com/agreements)

May require completing tax/banking information.

### Adhoc Signature
```
Signature=adhoc
TeamIdentifier=not set
```

**Fix:** App was not signed with Developer ID. Run `./scripts/sign_and_notarize.sh`

### "Code has no resources but signature indicates they must be present"

**Fix:** App was modified after signing. Re-sign the app.

### Certificate Not Found

```bash
# List available certificates
security find-identity -v -p codesigning

# Import certificate if missing
security import developerID_application.cer -k ~/Library/Keychains/login.keychain-db
```

### Notarization Takes Too Long

Typical timeline:
- Normal: 5-10 minutes
- Busy periods: 15-30 minutes
- Very busy: 1+ hour

Check status with:
```bash
xcrun notarytool info <submission-id> --keychain-profile AC_NOTARY
```

## Successful Submissions

| Date | Submission ID | Status |
|------|---------------|--------|
| 2026-01-05 | `a0214f50-4a72-410f-9f9f-0c5874f0db0b` | Accepted |

## Output Files

After successful signing and notarization:

- `bundle/Nomendex.app` — Signed and notarized app bundle
- `bundle/Nomendex.zip` — Archive used for notarization submission
- `bundle/Nomendex.dmg` — (Optional) DMG for distribution
