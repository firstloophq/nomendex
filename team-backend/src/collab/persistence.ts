import type { RecordOp } from "@crdt/lib/server";
import { prisma } from "../db";
import {
  buildSnapshotKey,
  isSnapshotStoreEnabled,
  readSnapshotBytes,
  writeSnapshotBytes,
} from "./snapshot-store";

function getSourceId(op: RecordOp): { clientId: string | null; clock: number | null } {
  if ("id" in op && op.id) {
    return {
      clientId: op.id.clientId ?? null,
      clock: typeof op.id.clock === "number" ? op.id.clock : null,
    };
  }
  return { clientId: null, clock: null };
}

async function getOrCreateCollabDoc(params: {
  docId: string;
  orgWorkspaceId: string;
}): Promise<{ id: string }> {
  const existing = await prisma.collabDoc.findUnique({
    where: { docId: params.docId },
    select: { id: true, orgWorkspaceId: true },
  });

  if (existing) {
    if (existing.orgWorkspaceId !== params.orgWorkspaceId) {
      throw new Error("Doc/workspace ownership mismatch");
    }
    return { id: existing.id };
  }

  const created = await prisma.collabDoc.create({
    data: {
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
    },
    select: { id: true },
  });
  return created;
}

export async function appendCollabOps(params: {
  docId: string;
  orgWorkspaceId: string;
  ops: ReadonlyArray<RecordOp>;
}): Promise<void> {
  if (params.ops.length === 0) return;

  const collabDoc = await getOrCreateCollabDoc({
    docId: params.docId,
    orgWorkspaceId: params.orgWorkspaceId,
  });

  await prisma.collabOp.createMany({
    data: params.ops.map((op) => {
      const source = getSourceId(op);
      return {
        collabDocId: collabDoc.id,
        docId: params.docId,
        opJson: JSON.stringify(op),
        sourceClientId: source.clientId,
        sourceClock: source.clock,
      };
    }),
  });
}

export async function loadCollabOps(params: {
  docId: string;
  orgWorkspaceId: string;
  afterSeq?: bigint;
}): Promise<ReadonlyArray<RecordOp>> {
  const collabDoc = await prisma.collabDoc.findUnique({
    where: { docId: params.docId },
    select: {
      id: true,
      orgWorkspaceId: true,
    },
  });

  if (!collabDoc) return [];
  if (collabDoc.orgWorkspaceId !== params.orgWorkspaceId) {
    throw new Error("Doc/workspace ownership mismatch");
  }

  const rows = await prisma.collabOp.findMany({
    where: {
      collabDocId: collabDoc.id,
      ...(params.afterSeq !== undefined ? { seq: { gt: params.afterSeq } } : {}),
    },
    orderBy: { seq: "asc" },
    select: { opJson: true },
  });

  const ops: RecordOp[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.opJson) as RecordOp;
      ops.push(parsed);
    } catch {
      // Skip malformed records to keep hydration resilient.
    }
  }

  return ops;
}

export async function getLatestCollabOpSeq(params: {
  docId: string;
  orgWorkspaceId: string;
}): Promise<bigint | null> {
  const collabDoc = await prisma.collabDoc.findUnique({
    where: { docId: params.docId },
    select: { id: true, orgWorkspaceId: true },
  });

  if (!collabDoc) return null;
  if (collabDoc.orgWorkspaceId !== params.orgWorkspaceId) {
    throw new Error("Doc/workspace ownership mismatch");
  }

  const row = await prisma.collabOp.findFirst({
    where: { collabDocId: collabDoc.id },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  return row?.seq ?? null;
}

export interface CollabSnapshotRecord {
  id: string;
  docId: string;
  bucketKey: string;
  baseSeq: bigint;
  bytes: Uint8Array;
}

export async function loadLatestCollabSnapshot(params: {
  docId: string;
  orgWorkspaceId: string;
}): Promise<CollabSnapshotRecord | null> {
  if (!isSnapshotStoreEnabled()) return null;

  const collabDoc = await prisma.collabDoc.findUnique({
    where: { docId: params.docId },
    select: {
      id: true,
      orgWorkspaceId: true,
    },
  });

  if (!collabDoc) return null;
  if (collabDoc.orgWorkspaceId !== params.orgWorkspaceId) {
    throw new Error("Doc/workspace ownership mismatch");
  }

  const snapshot = await prisma.collabSnapshot.findFirst({
    where: { collabDocId: collabDoc.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      docId: true,
      bucketKey: true,
      baseSeq: true,
    },
  });

  if (!snapshot) return null;

  const bytes = await readSnapshotBytes({ key: snapshot.bucketKey });
  if (!bytes) return null;

  return {
    id: snapshot.id,
    docId: snapshot.docId,
    bucketKey: snapshot.bucketKey,
    baseSeq: snapshot.baseSeq,
    bytes,
  };
}

export async function saveCollabSnapshot(params: {
  docId: string;
  orgWorkspaceId: string;
  baseSeq: bigint;
  bytes: Uint8Array;
}): Promise<void> {
  if (!isSnapshotStoreEnabled()) {
    throw new Error("Snapshot store is not configured");
  }

  const collabDoc = await getOrCreateCollabDoc({
    docId: params.docId,
    orgWorkspaceId: params.orgWorkspaceId,
  });

  const snapshotId = crypto.randomUUID();
  const bucketKey = buildSnapshotKey({
    docId: params.docId,
    snapshotId,
  });
  const writeResult = await writeSnapshotBytes({
    key: bucketKey,
    data: params.bytes,
  });

  await prisma.$transaction([
    prisma.collabSnapshot.create({
      data: {
        id: snapshotId,
        collabDocId: collabDoc.id,
        docId: params.docId,
        bucketKey,
        baseSeq: params.baseSeq,
        byteSize: writeResult.byteSize,
        etag: writeResult.etag,
      },
    }),
    prisma.collabDoc.update({
      where: { id: collabDoc.id },
      data: { lastSnapshotSeq: params.baseSeq },
    }),
    prisma.collabOp.deleteMany({
      where: {
        collabDocId: collabDoc.id,
        seq: { lte: params.baseSeq },
      },
    }),
  ]);
}
