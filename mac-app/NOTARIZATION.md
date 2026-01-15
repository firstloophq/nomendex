# Notarization Status Check

## Check Notarization Status

After submitting your app for notarization, you can check its status at any time:

```bash
xcrun notarytool info <submission-id> --keychain-profile AC_NOTARY
```

## Get Submission History

To see all recent submissions:

```bash
xcrun notarytool history --keychain-profile AC_NOTARY
```

## Current Submissions

| Date | Submission ID | Status |
|------|---------------|--------|
| 2026-01-05 | `a0214f50-4a72-410f-9f9f-0c5874f0db0b` | Accepted |
| 2025-09-30 | `ad18311a-f922-40a1-8c07-b70b486f92d8` | — |
| 2025-09-30 | `b708190d-f0fd-44ca-a7ac-ec97e8bf714c` | — |

### Check specific submission:
```bash
xcrun notarytool info <submission-id> --keychain-profile AC_NOTARY
```

> **Note:** For comprehensive documentation, see [docs/macos-signing.md](docs/macos-signing.md)

## When Notarization Completes

Once status changes from "In Progress" to "Accepted":

1. **Staple the ticket to the app:**
```bash
cd /Users/jacobcolling/mcp-client/mac-app
xcrun stapler staple bundle/Nomendex.app
```

2. **Verify stapling:**
```bash
xcrun stapler validate bundle/Nomendex.app
```

3. **Create notarized DMG:**
```bash
create-dmg \
  --volname "Nomendex" \
  --window-pos 200 120 \
  --window-size 800 400 \
  --icon-size 100 \
  --icon "Nomendex.app" 200 190 \
  --hide-extension "Nomendex.app" \
  --app-drop-link 600 185 \
  "Nomendex-notarized.dmg" \
  "bundle/Nomendex.app"
```

Or simply re-run the script with DMG flag:
```bash
./scripts/sign_and_notarize.sh --dmg
```

## Get Notarization Logs

If notarization fails or you want to see details:

```bash
xcrun notarytool log <submission-id> --keychain-profile AC_NOTARY
```

## Typical Timeline

- **Normal**: 5-10 minutes
- **Busy periods**: 15-30 minutes
- **Very busy**: 1+ hours

Apple's notarization service is entirely server-side, so there's no way to expedite the process.
