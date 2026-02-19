interface SnapshotWriteResult {
  byteSize: number;
  etag: string | null;
}

let cachedClient: Bun.S3Client | null | undefined;

function normalizePrefix(raw: string): string {
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, "");
  return trimmed.length > 0 ? trimmed : "crdt";
}

function getSnapshotClient(): Bun.S3Client | null {
  if (cachedClient !== undefined) return cachedClient;

  const bucket = process.env.CRDT_SNAPSHOT_BUCKET?.trim();
  if (!bucket) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = new Bun.S3Client({
    bucket,
    endpoint: process.env.CRDT_S3_ENDPOINT?.trim() || undefined,
    region: process.env.CRDT_S3_REGION?.trim() || undefined,
    accessKeyId:
      process.env.CRDT_S3_ACCESS_KEY_ID?.trim()
      || process.env.AWS_ACCESS_KEY_ID?.trim()
      || undefined,
    secretAccessKey:
      process.env.CRDT_S3_SECRET_ACCESS_KEY?.trim()
      || process.env.AWS_SECRET_ACCESS_KEY?.trim()
      || undefined,
    sessionToken:
      process.env.CRDT_S3_SESSION_TOKEN?.trim()
      || process.env.AWS_SESSION_TOKEN?.trim()
      || undefined,
  });
  return cachedClient;
}

export function isSnapshotStoreEnabled(): boolean {
  return getSnapshotClient() !== null;
}

export function buildSnapshotKey(params: {
  docId: string;
  snapshotId: string;
}): string {
  const prefix = normalizePrefix(process.env.CRDT_SNAPSHOT_PREFIX ?? "crdt");
  return `${prefix}/${encodeURIComponent(params.docId)}/${params.snapshotId}.bin`;
}

export async function writeSnapshotBytes(params: {
  key: string;
  data: Uint8Array;
}): Promise<SnapshotWriteResult> {
  const client = getSnapshotClient();
  if (!client) {
    throw new Error("Snapshot store is not configured");
  }

  const byteSize = await client.write(params.key, params.data, {
    type: "application/octet-stream",
  });
  const stat = await client.stat(params.key);
  return {
    byteSize,
    etag: stat.etag ?? null,
  };
}

export async function readSnapshotBytes(params: {
  key: string;
}): Promise<Uint8Array | null> {
  const client = getSnapshotClient();
  if (!client) {
    return null;
  }

  const exists = await client.exists(params.key);
  if (!exists) return null;

  const file = client.file(params.key);
  const data = await file.arrayBuffer();
  return new Uint8Array(data);
}

