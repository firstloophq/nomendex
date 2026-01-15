#!/usr/bin/env bun

const apiKey = process.env.APPCAST_API_KEY;
const version = process.env.VERSION;
const buildNumber = process.env.BUILD_NUMBER;
const signature = process.env.SPARKLE_SIGNATURE;
const fileSize = process.env.FILE_SIZE;
const downloadUrl = process.env.DOWNLOAD_URL;

if (!apiKey || !version || !buildNumber || !signature || !fileSize || !downloadUrl) {
  console.error("Missing required environment variables");
  console.error({ apiKey: !!apiKey, version, buildNumber, signature: !!signature, fileSize, downloadUrl });
  process.exit(1);
}

const pubDate = new Date().toUTCString();

// Use buildNumber for sparkle:version (numeric comparison) and version for display
const xmlItem = `<item><title>Version ${version}</title><pubDate>${pubDate}</pubDate><sparkle:version>${buildNumber}</sparkle:version><sparkle:shortVersionString>${version}</sparkle:shortVersionString><sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion><enclosure url="${downloadUrl}" length="${fileSize}" type="application/octet-stream" sparkle:edSignature="${signature}"/></item>`;

console.log("Sending item:", xmlItem);

const response = await fetch("https://releases.nomendex.com/appcast/entry", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ item: xmlItem }),
});

const body = await response.text();
console.log("Response:", response.status, body);

if (!response.ok) {
  console.error("Failed to update appcast");
  process.exit(1);
}

console.log("Appcast updated successfully");
