import {
  getRecordSnapshotStateVector,
  getRecordSnapshotVersion,
} from "@firstloophq-demos/crdt-lib/server";
import { prisma } from "../db";
import {
  buildSnapshotKey,
  isSnapshotStoreEnabled,
  readSnapshotBytes,
  writeSnapshotBytes,
} from "./snapshot-store";

function logCollabPersistenceInfo(event: string, data: Record<string, unknown>): void {
  console.info(`[COLLAB-PERSISTENCE] ${event} ${JSON.stringify(data)}`);
}

function logCollabPersistenceWarn(event: string, data: Record<string, unknown>): void {
  console.warn(`[COLLAB-PERSISTENCE] ${event} ${JSON.stringify(data)}`);
}

async function getOrCreateCollabDoc(params: {
  docId: string;
  orgWorkspaceId: string;
}): Promise<{ id: string; snapshotVersion: string | null }> {
  const existing = await prisma.collabDoc.findUnique({
    where: { docId: params.docId },
    select: {
      id: true,
      orgWorkspaceId: true,
      snapshotVersion: true,
    },
  });

  if (existing) {
    if (existing.orgWorkspaceId !== params.orgWorkspaceId) {
      throw new Error("Doc/workspace ownership mismatch");
    }
    logCollabPersistenceInfo("collab_doc_found", {
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
      collabDocId: existing.id,
      snapshotVersion: existing.snapshotVersion,
    });
    return { id: existing.id, snapshotVersion: existing.snapshotVersion };
  }

  const created = await prisma.collabDoc.create({
    data: {
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
    },
    select: { id: true, snapshotVersion: true },
  });
  logCollabPersistenceInfo("collab_doc_created", {
    docId: params.docId,
    orgWorkspaceId: params.orgWorkspaceId,
    collabDocId: created.id,
  });
  return created;
}

function serializeStateVector(params: { bytes: Uint8Array }): string {
  const sv = getRecordSnapshotStateVector({ data: params.bytes });
  return JSON.stringify(Object.fromEntries(sv));
}

export interface CanonicalSnapshotRecord {
  id: string;
  docId: string;
  bucketKey: string;
  snapshotVersion: string | null;
  stateVectorJson: string | null;
  bytes: Uint8Array;
}

export async function loadCanonicalSnapshot(params: {
  docId: string;
  orgWorkspaceId: string;
}): Promise<CanonicalSnapshotRecord | null> {
  if (!isSnapshotStoreEnabled()) {
    logCollabPersistenceWarn("load_skip_store_disabled", {
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
    });
    return null;
  }

  const collabDoc = await prisma.collabDoc.findUnique({
    where: { docId: params.docId },
    select: {
      id: true,
      orgWorkspaceId: true,
    },
  });

  if (!collabDoc) {
    logCollabPersistenceInfo("load_miss_no_collab_doc", {
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
    });
    return null;
  }
  if (collabDoc.orgWorkspaceId !== params.orgWorkspaceId) {
    throw new Error("Doc/workspace ownership mismatch");
  }

  const snapshot = await prisma.collabSnapshot.findUnique({
    where: { collabDocId: collabDoc.id },
    select: {
      id: true,
      docId: true,
      bucketKey: true,
      snapshotVersion: true,
      stateVectorJson: true,
    },
  });

  if (!snapshot) {
    logCollabPersistenceInfo("load_miss_no_snapshot_row", {
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
      collabDocId: collabDoc.id,
    });
    return null;
  }

  const bytes = await readSnapshotBytes({ key: snapshot.bucketKey });
  if (!bytes) {
    logCollabPersistenceWarn("load_miss_snapshot_bytes", {
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
      bucketKey: snapshot.bucketKey,
    });
    return null;
  }

  logCollabPersistenceInfo("load_hit", {
    docId: params.docId,
    orgWorkspaceId: params.orgWorkspaceId,
    snapshotId: snapshot.id,
    snapshotVersion: snapshot.snapshotVersion,
    bytes: bytes.byteLength,
    bucketKey: snapshot.bucketKey,
  });

  return {
    id: snapshot.id,
    docId: snapshot.docId,
    bucketKey: snapshot.bucketKey,
    snapshotVersion: snapshot.snapshotVersion,
    stateVectorJson: snapshot.stateVectorJson,
    bytes,
  };
}

export type SaveCanonicalSnapshotResult =
  | {
    status: "saved";
    snapshotVersion: string;
    stateVectorJson: string;
    bucketKey: string;
  }
  | {
    status: "conflict";
    current: CanonicalSnapshotRecord | null;
  };

export async function saveCanonicalSnapshot(params: {
  docId: string;
  orgWorkspaceId: string;
  bytes: Uint8Array;
  expectedVersion?: string;
}): Promise<SaveCanonicalSnapshotResult> {
  if (!isSnapshotStoreEnabled()) {
    throw new Error("Snapshot store is not configured");
  }
  logCollabPersistenceInfo("save_start", {
    docId: params.docId,
    orgWorkspaceId: params.orgWorkspaceId,
    bytes: params.bytes.byteLength,
    expectedVersion: params.expectedVersion ?? null,
  });

  const collabDoc = await getOrCreateCollabDoc({
    docId: params.docId,
    orgWorkspaceId: params.orgWorkspaceId,
  });

  if (
    params.expectedVersion
    && collabDoc.snapshotVersion
    && collabDoc.snapshotVersion !== params.expectedVersion
  ) {
    logCollabPersistenceWarn("save_conflict", {
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
      expectedVersion: params.expectedVersion,
      currentVersion: collabDoc.snapshotVersion,
    });
    return {
      status: "conflict",
      current: await loadCanonicalSnapshot({
        docId: params.docId,
        orgWorkspaceId: params.orgWorkspaceId,
      }),
    };
  }

  const snapshotId = crypto.randomUUID();
  const bucketKey = buildSnapshotKey({
    docId: params.docId,
    snapshotId,
  });
  const writeResult = await writeSnapshotBytes({
    key: bucketKey,
    data: params.bytes,
  });
  const snapshotVersion = getRecordSnapshotVersion({ data: params.bytes });
  const stateVectorJson = serializeStateVector({ bytes: params.bytes });

  await prisma.$transaction([
    prisma.collabSnapshot.upsert({
      where: { collabDocId: collabDoc.id },
      create: {
        id: snapshotId,
        collabDocId: collabDoc.id,
        docId: params.docId,
        bucketKey,
        byteSize: writeResult.byteSize,
        etag: writeResult.etag,
        snapshotVersion,
        stateVectorJson,
      },
      update: {
        docId: params.docId,
        bucketKey,
        byteSize: writeResult.byteSize,
        etag: writeResult.etag,
        snapshotVersion,
        stateVectorJson,
      },
    }),
    prisma.collabDoc.update({
      where: { id: collabDoc.id },
      data: {
        snapshotVersion,
        stateVectorJson,
      },
    }),
  ]);

  logCollabPersistenceInfo("save_success", {
    docId: params.docId,
    orgWorkspaceId: params.orgWorkspaceId,
    snapshotVersion,
    bytes: writeResult.byteSize,
    etag: writeResult.etag,
    bucketKey,
  });

  return {
    status: "saved",
    snapshotVersion,
    stateVectorJson,
    bucketKey,
  };
}
