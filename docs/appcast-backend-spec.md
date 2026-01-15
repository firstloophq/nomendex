# Appcast Backend Spec

A minimal Bun server to host and update Sparkle appcast.xml for Nomendex auto-updates.

## Overview

- **URL:** `https://releases.nomendex.com`
- **Runtime:** Bun
- **Storage:** Local file (`data/appcast.xml`)
- **Auth:** API key via Authorization header

---

## Endpoints

### `GET /appcast.xml`

Serves the current appcast file.

| Field | Value |
|-------|-------|
| Method | GET |
| Auth | None (public) |
| Response Type | `application/xml` |

**Response:** Raw XML content of the appcast file.

**Example:**
```bash
curl https://releases.nomendex.com/appcast.xml
```

---

### `POST /appcast/entry`

Adds a new release entry to the appcast. Inserts the new entry at the top (newest first).

| Field | Value |
|-------|-------|
| Method | POST |
| Auth | `Authorization: Bearer <API_KEY>` |
| Content-Type | `application/json` |

**Request Body:**

```json
{
  "version": "0.1.0-alpha.3",
  "signature": "BASE64_EDDSA_SIGNATURE_HERE",
  "length": 15728640,
  "url": "https://github.com/firstloophq/nomendex/releases/download/v0.1.0-alpha.3/Nomendex-0.1.0-alpha.3.zip",
  "minimumSystemVersion": "12.0",
  "description": "<h2>What's New</h2><ul><li>Feature X</li></ul>"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| version | string | Yes | Semver version (e.g., "0.1.0-alpha.3") |
| signature | string | Yes | Sparkle EdDSA signature (base64) |
| length | number | Yes | File size in bytes |
| url | string | Yes | Download URL for the zip |
| minimumSystemVersion | string | No | Default: "12.0" |
| description | string | No | HTML release notes for Sparkle UI |

**Response:**

- `200 OK` - Entry added successfully
  ```json
  {
    "success": true,
    "version": "0.1.0-alpha.3",
    "totalEntries": 5
  }
  ```

- `400 Bad Request` - Missing required fields
  ```json
  {
    "error": "Missing required field: version"
  }
  ```

- `401 Unauthorized` - Invalid or missing API key
  ```json
  {
    "error": "Unauthorized"
  }
  ```

**Example:**
```bash
curl -X POST https://releases.nomendex.com/appcast/entry \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "0.1.0-alpha.3",
    "signature": "abc123...",
    "length": 15728640,
    "url": "https://github.com/firstloophq/nomendex/releases/download/v0.1.0-alpha.3/Nomendex-0.1.0-alpha.3.zip"
  }'
```

---

### `GET /health`

Health check endpoint.

| Field | Value |
|-------|-------|
| Method | GET |
| Auth | None |

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-13T12:00:00Z"
}
```

---

## File Storage

### Directory Structure

```
appcast-backend/
├── src/
│   └── server.ts
├── data/
│   └── appcast.xml      # Created on first run
├── .env                  # API_KEY
├── package.json
└── README.md
```

### Initial appcast.xml

On first run, if `data/appcast.xml` doesn't exist, create it with this template:

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Nomendex Updates</title>
    <link>https://github.com/firstloophq/nomendex</link>
    <description>Updates for Nomendex</description>
    <language>en</language>
  </channel>
</rss>
```

### Entry XML Format

When adding a new entry, generate this XML and insert it after `<language>en</language>`:

```xml
<item>
  <title>Version {version}</title>
  <pubDate>{RFC2822_DATE}</pubDate>
  <sparkle:version>{version}</sparkle:version>
  <sparkle:shortVersionString>{version}</sparkle:shortVersionString>
  <sparkle:minimumSystemVersion>{minimumSystemVersion}</sparkle:minimumSystemVersion>
  <description><![CDATA[
    {description}
  ]]></description>
  <enclosure
    url="{url}"
    length="{length}"
    type="application/octet-stream"
    sparkle:edSignature="{signature}"
  />
</item>
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `API_KEY` | Secret key for authenticating POST requests |
| `PORT` | Server port (default: 3000) |

---

## Implementation Notes

1. **XML Manipulation:** Use simple string manipulation or a lightweight XML library. Insert new entries after the `<language>en</language>` line so newest entries appear first.

2. **File Locking:** For simplicity, use synchronous file writes. Bun's `Bun.write()` is atomic.

3. **Persistence:** The `data/` directory should be persisted (mounted volume if containerized).

4. **CORS:** Not needed - Sparkle fetches from native macOS, not browser.

5. **No Database:** Single XML file is sufficient. Sparkle only reads the full feed.

---

## Deployment

Deploy wherever Bun runs:
- Railway
- Fly.io
- VPS with Docker
- Any container platform

Point `releases.nomendex.com` DNS to the deployment.

---

## GitHub Actions Integration

The release workflow will call this endpoint after signing:

```yaml
- name: Update appcast
  run: |
    curl -X POST https://releases.nomendex.com/appcast/entry \
      -H "Authorization: Bearer ${{ secrets.APPCAST_API_KEY }}" \
      -H "Content-Type: application/json" \
      -d '{
        "version": "${{ steps.version.outputs.version }}",
        "signature": "${{ env.SPARKLE_SIGNATURE }}",
        "length": '"$(stat -f%z "mac-app/Nomendex-${{ steps.version.outputs.version }}.zip")"',
        "url": "https://github.com/${{ github.repository }}/releases/download/v${{ steps.version.outputs.version }}/Nomendex-${{ steps.version.outputs.version }}.zip"
      }'
```
