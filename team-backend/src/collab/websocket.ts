import {
  applyDocOperation,
  applySnapshotToDoc,
  createRecord,
  decodeRecordSnapshot,
  encodeRecordSnapshot,
  getDoc,
  getRecordSnapshotVersion,
  mergeRecordSnapshots,
  receive,
  type RecordOp,
} from "@crdt/lib";
import {
  createCRDTWebSocketHandler,
  type WSClient,
} from "@crdt/lib/server";
import { upgradeWebSocket } from "hono/bun";
import type { Context } from "hono";
import { authenticateBearerToken, type AuthIdentity } from "../auth";
import { prisma } from "../db";
import { parseWorkspaceScopedDocId } from "./doc-id";
import {
  deleteCanonicalSnapshot,
  loadCanonicalSnapshot,
  saveCanonicalSnapshot,
} from "./persistence";

interface SocketState {
  client: WSClient;
  identity: AuthIdentity;
  workspaceAccessCache: Map<string, boolean>;
}

interface SnapshotPublishPayload {
  type: "snapshot-publish";
  docId: string;
  snapshot: string;
  expectedVersion?: string;
  mergeBias?: "local" | "remote";
}

const socketStateByRaw = new WeakMap<object, SocketState>();
const hydratedDocs = new Set<string>();
const hydrateByDoc = new Map<string, Promise<void>>();
const persistedVersionByDoc = new Map<string, string>();
const persistTimerByDoc = new Map<string, ReturnType<typeof setTimeout>>();
const persistInFlightByDoc = new Set<string>();

function logCollabInfo(event: string, data: Record<string, unknown>): void {
  console.info(`[COLLAB] ${event} ${JSON.stringify(data)}`);
}

function logCollabWarn(event: string, data: Record<string, unknown>): void {
  console.warn(`[COLLAB] ${event} ${JSON.stringify(data)}`);
}

function logCollabError(event: string, data: Record<string, unknown>): void {
  console.error(`[COLLAB] ${event} ${JSON.stringify(data)}`);
}

function getSocketState(ws: { raw?: unknown }): SocketState | null {
  const raw = ws.raw;
  if (!raw || typeof raw !== "object") return null;
  return socketStateByRaw.get(raw) ?? null;
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function canAccessWorkspace(params: {
  identity: AuthIdentity;
  orgWorkspaceId: string;
  cache: Map<string, boolean>;
}): Promise<boolean> {
  const cached = params.cache.get(params.orgWorkspaceId);
  if (cached !== undefined) {
    return cached;
  }

  const workspace = await prisma.orgWorkspace.findFirst({
    where: {
      id: params.orgWorkspaceId,
      org: {
        memberships: {
          some: {
            userId: params.identity.userId,
          },
        },
      },
    },
    select: { id: true },
  });

  const allowed = !!workspace;
  params.cache.set(params.orgWorkspaceId, allowed);
  return allowed;
}

async function persistCanonicalSnapshot(params: {
  docId: string;
  orgWorkspaceId: string;
}): Promise<void> {
  if (persistInFlightByDoc.has(params.docId)) {
    logCollabInfo("persist_skip_inflight", {
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
    });
    return;
  }
  persistInFlightByDoc.add(params.docId);

  try {
    logCollabInfo("persist_start", {
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
    });
    const state = crdtHandler.getDocManagerState();
    const currentRecord = getDoc({
      manager: state.manager,
      docId: params.docId,
    });
    if (!currentRecord) {
      logCollabWarn("persist_skip_no_record", {
        docId: params.docId,
        orgWorkspaceId: params.orgWorkspaceId,
      });
      return;
    }

    const localBytes = encodeRecordSnapshot({ record: currentRecord });
    const expectedVersion = persistedVersionByDoc.get(params.docId);
    const saveResult = await saveCanonicalSnapshot({
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
      bytes: localBytes,
      expectedVersion,
    });

    if (saveResult.status === "saved") {
      persistedVersionByDoc.set(params.docId, saveResult.snapshotVersion);
      logCollabInfo("persist_saved", {
        docId: params.docId,
        orgWorkspaceId: params.orgWorkspaceId,
        bytes: localBytes.byteLength,
        expectedVersion: expectedVersion ?? null,
        savedVersion: saveResult.snapshotVersion,
      });
      return;
    }

    if (!saveResult.current) {
      // No current remote snapshot to merge against; retry without CAS.
      logCollabWarn("persist_conflict_no_current_retry", {
        docId: params.docId,
        orgWorkspaceId: params.orgWorkspaceId,
        bytes: localBytes.byteLength,
        expectedVersion: expectedVersion ?? null,
      });
      const forced = await saveCanonicalSnapshot({
        docId: params.docId,
        orgWorkspaceId: params.orgWorkspaceId,
        bytes: localBytes,
      });
      if (forced.status === "saved") {
        persistedVersionByDoc.set(params.docId, forced.snapshotVersion);
        logCollabInfo("persist_retry_saved", {
          docId: params.docId,
          orgWorkspaceId: params.orgWorkspaceId,
          bytes: localBytes.byteLength,
          savedVersion: forced.snapshotVersion,
        });
      }
      return;
    }

    logCollabWarn("persist_conflict_merge_retry", {
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
      bytes: localBytes.byteLength,
      expectedVersion: expectedVersion ?? null,
      remoteVersion: saveResult.current.snapshotVersion ?? null,
      remoteBytes: saveResult.current.bytes.byteLength,
    });
    const merged = mergeRecordSnapshots({
      local: decodeRecordSnapshot({ data: localBytes }),
      remote: decodeRecordSnapshot({ data: saveResult.current.bytes }),
      bias: "remote",
    });
    const mergedBytes = encodeRecordSnapshot({ record: merged });
    const retried = await saveCanonicalSnapshot({
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
      bytes: mergedBytes,
      expectedVersion: saveResult.current.snapshotVersion ?? undefined,
    });
    if (retried.status === "saved") {
      persistedVersionByDoc.set(params.docId, retried.snapshotVersion);
      logCollabInfo("persist_merge_retry_saved", {
        docId: params.docId,
        orgWorkspaceId: params.orgWorkspaceId,
        mergedBytes: mergedBytes.byteLength,
        savedVersion: retried.snapshotVersion,
      });
    } else {
      logCollabWarn("persist_merge_retry_conflict", {
        docId: params.docId,
        orgWorkspaceId: params.orgWorkspaceId,
        mergedBytes: mergedBytes.byteLength,
      });
    }
  } catch (error) {
    logCollabError("persist_error", {
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    persistInFlightByDoc.delete(params.docId);
  }
}

function scheduleCanonicalPersist(params: {
  docId: string;
  orgWorkspaceId: string;
}): void {
  const existingTimer = persistTimerByDoc.get(params.docId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    logCollabInfo("persist_schedule_debounced", {
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
    });
  }
  const timer = setTimeout(() => {
    persistTimerByDoc.delete(params.docId);
    void persistCanonicalSnapshot({
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
    });
  }, 1200);
  persistTimerByDoc.set(params.docId, timer);
  logCollabInfo("persist_scheduled", {
    docId: params.docId,
    orgWorkspaceId: params.orgWorkspaceId,
    delayMs: 1200,
  });
}

async function handleSnapshotPublish(params: {
  payload: SnapshotPublishPayload;
}): Promise<void> {
  const scopedDoc = parseWorkspaceScopedDocId({ docId: params.payload.docId });
  if (!scopedDoc) {
    logCollabWarn("snapshot_publish_invalid_doc", {
      docId: params.payload.docId,
    });
    return;
  }
  logCollabInfo("snapshot_publish_received", {
    docId: params.payload.docId,
    orgWorkspaceId: scopedDoc.orgWorkspaceId,
    payloadBytes: params.payload.snapshot.length,
    expectedVersion: params.payload.expectedVersion ?? null,
    mergeBias: params.payload.mergeBias ?? null,
  });

  await hydrateDocIfNeeded({
    docId: params.payload.docId,
    orgWorkspaceId: scopedDoc.orgWorkspaceId,
  });

  const incoming = decodeRecordSnapshot({
    data: fromBase64(params.payload.snapshot),
  });
  const currentState = crdtHandler.getDocManagerState();
  const currentRecord = getDoc({
    manager: currentState.manager,
    docId: params.payload.docId,
  });
  const mergedRecord = currentRecord
    ? mergeRecordSnapshots({
      local: incoming,
      remote: currentRecord,
      bias: params.payload.mergeBias ?? "remote",
    })
    : incoming;
  const mergedBytes = encodeRecordSnapshot({ record: mergedRecord });
  const mergedVersion = getRecordSnapshotVersion({ data: mergedBytes });
  logCollabInfo("snapshot_publish_merged", {
    docId: params.payload.docId,
    orgWorkspaceId: scopedDoc.orgWorkspaceId,
    hadCurrentRecord: !!currentRecord,
    mergeBias: params.payload.mergeBias ?? "remote",
    mergedBytes: mergedBytes.byteLength,
    mergedVersion,
  });

  const nextManager = applySnapshotToDoc({
    manager: currentState.manager,
    docId: params.payload.docId,
    snapshot: mergedBytes,
    mode: currentRecord ? "merge" : "replace",
    mergeBias: params.payload.mergeBias ?? "remote",
  });
  crdtHandler.setDocManagerState({
    state: { ...currentState, manager: nextManager },
  });
  crdtHandler.checkpointDoc({ docId: params.payload.docId });
  crdtHandler.broadcastSnapshot({
    docId: params.payload.docId,
    snapshot: mergedBytes,
    version: mergedVersion,
  });

  const persistResult = await saveCanonicalSnapshot({
    docId: params.payload.docId,
    orgWorkspaceId: scopedDoc.orgWorkspaceId,
    bytes: mergedBytes,
    expectedVersion: persistedVersionByDoc.get(params.payload.docId),
  });
  if (persistResult.status === "saved") {
    persistedVersionByDoc.set(params.payload.docId, persistResult.snapshotVersion);
    logCollabInfo("snapshot_publish_persist_saved", {
      docId: params.payload.docId,
      orgWorkspaceId: scopedDoc.orgWorkspaceId,
      persistedVersion: persistResult.snapshotVersion,
      bucketKey: persistResult.bucketKey,
    });
  } else if (persistResult.current?.snapshotVersion) {
    persistedVersionByDoc.set(params.payload.docId, persistResult.current.snapshotVersion);
    logCollabWarn("snapshot_publish_persist_conflict", {
      docId: params.payload.docId,
      orgWorkspaceId: scopedDoc.orgWorkspaceId,
      persistedVersion: persistResult.current.snapshotVersion,
    });
  } else {
    logCollabWarn("snapshot_publish_persist_conflict_no_current", {
      docId: params.payload.docId,
      orgWorkspaceId: scopedDoc.orgWorkspaceId,
    });
  }
}

const crdtHandler = createCRDTWebSocketHandler({
  serverClientId: "team-backend-crdt",
  onDocChanged({ docId, ops, source }) {
    if (source !== "client" || ops.length === 0) return;
    const scopedDoc = parseWorkspaceScopedDocId({ docId });
    if (!scopedDoc) return;
    scheduleCanonicalPersist({
      docId,
      orgWorkspaceId: scopedDoc.orgWorkspaceId,
    });
  },
});

export async function hardResetCollabDoc(params: {
  docId: string;
  identity: AuthIdentity;
}): Promise<void> {
  const scopedDoc = parseWorkspaceScopedDocId({ docId: params.docId });
  if (!scopedDoc) {
    throw new Error(`Invalid document id format: "${params.docId}"`);
  }

  const allowed = await canAccessWorkspace({
    identity: params.identity,
    orgWorkspaceId: scopedDoc.orgWorkspaceId,
    cache: new Map(),
  });
  if (!allowed) {
    throw new Error("Forbidden");
  }

  const existingTimer = persistTimerByDoc.get(params.docId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    persistTimerByDoc.delete(params.docId);
  }
  persistInFlightByDoc.delete(params.docId);
  hydrateByDoc.delete(params.docId);
  hydratedDocs.delete(params.docId);
  persistedVersionByDoc.delete(params.docId);
  crdtHandler.resetDoc({ docId: params.docId });

  await deleteCanonicalSnapshot({
    docId: params.docId,
    orgWorkspaceId: scopedDoc.orgWorkspaceId,
  });

  const emptyRecord = createRecord();
  const emptyBytes = encodeRecordSnapshot({ record: emptyRecord });
  const emptyVersion = getRecordSnapshotVersion({ data: emptyBytes });
  const currentState = crdtHandler.getDocManagerState();
  const nextManager = applySnapshotToDoc({
    manager: currentState.manager,
    docId: params.docId,
    snapshot: emptyBytes,
    mode: "replace",
  });
  crdtHandler.setDocManagerState({
    state: { ...currentState, manager: nextManager },
  });
  crdtHandler.checkpointDoc({ docId: params.docId });
  crdtHandler.broadcastSnapshot({
    docId: params.docId,
    snapshot: emptyBytes,
    version: emptyVersion,
  });

  logCollabInfo("hard_reset_completed", {
    docId: params.docId,
    orgWorkspaceId: scopedDoc.orgWorkspaceId,
    byClerkUserId: params.identity.clerkUserId,
    bytes: emptyBytes.byteLength,
    version: emptyVersion,
  });
}

async function hydrateDocIfNeeded(params: {
  docId: string;
  orgWorkspaceId: string;
}): Promise<void> {
  if (hydratedDocs.has(params.docId)) {
    logCollabInfo("hydrate_skip_already_hydrated", {
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
    });
    return;
  }
  const existing = hydrateByDoc.get(params.docId);
  if (existing) {
    logCollabInfo("hydrate_join_existing", {
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
    });
    return existing;
  }

  const hydration = (async () => {
    logCollabInfo("hydrate_start", {
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
    });
    const snapshot = await loadCanonicalSnapshot({
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
    });

    if (!snapshot) {
      logCollabInfo("hydrate_miss", {
        docId: params.docId,
        orgWorkspaceId: params.orgWorkspaceId,
      });
      hydratedDocs.add(params.docId);
      return;
    }

    const restored = decodeRecordSnapshot({ data: snapshot.bytes });
    const state = crdtHandler.getDocManagerState();
    const nextDocs = new Map(state.manager.docs);
    nextDocs.set(params.docId, restored);
    crdtHandler.setDocManagerState({
      state: {
        ...state,
        manager: { ...state.manager, docs: nextDocs },
      },
    });
    crdtHandler.checkpointDoc({ docId: params.docId });
    if (snapshot.snapshotVersion) {
      persistedVersionByDoc.set(params.docId, snapshot.snapshotVersion);
      logCollabInfo("hydrate_restored", {
        docId: params.docId,
        orgWorkspaceId: params.orgWorkspaceId,
        bytes: snapshot.bytes.byteLength,
        snapshotVersion: snapshot.snapshotVersion,
      });
    } else {
      persistedVersionByDoc.set(
        params.docId,
        getRecordSnapshotVersion({ data: snapshot.bytes }),
      );
      logCollabInfo("hydrate_restored_inferred_version", {
        docId: params.docId,
        orgWorkspaceId: params.orgWorkspaceId,
        bytes: snapshot.bytes.byteLength,
      });
    }
    hydratedDocs.add(params.docId);
  })()
    .catch((error) => {
      logCollabError("hydrate_error", {
        docId: params.docId,
        orgWorkspaceId: params.orgWorkspaceId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    })
    .finally(() => {
      hydrateByDoc.delete(params.docId);
    });

  hydrateByDoc.set(params.docId, hydration);
  return hydration;
}

function generateConnectionId(): string {
  return `team-ws-${crypto.randomUUID()}`;
}

function messageToString(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  if (
    data
    && typeof data === "object"
    && "buffer" in data
    && (data as { buffer?: unknown }).buffer instanceof ArrayBuffer
  ) {
    return new TextDecoder().decode((data as { buffer: ArrayBuffer }).buffer);
  }
  if (data instanceof Blob) return null;
  return null;
}

async function authorizeAndPrepareMessage(params: {
  state: SocketState;
  message: string;
}): Promise<{ ok: true } | { ok: false; closeCode: number; reason: string }> {
  let parsed: {
    type?: string;
    docId?: string;
  };
  try {
    parsed = JSON.parse(params.message) as { type?: string; docId?: string };
  } catch {
    return { ok: true };
  }

  const docId = typeof parsed.docId === "string" ? parsed.docId : null;
  if (!docId) return { ok: true };

  const scopedDoc = parseWorkspaceScopedDocId({ docId });
  if (!scopedDoc) {
    logCollabWarn("authorize_invalid_doc", {
      docId,
      clerkUserId: params.state.identity.clerkUserId,
    });
    return {
      ok: false,
      closeCode: 4400,
      reason: "Invalid document id format",
    };
  }

  const allowed = await canAccessWorkspace({
    identity: params.state.identity,
    orgWorkspaceId: scopedDoc.orgWorkspaceId,
    cache: params.state.workspaceAccessCache,
  });
  if (!allowed) {
    logCollabWarn("authorize_forbidden_workspace", {
      docId,
      orgWorkspaceId: scopedDoc.orgWorkspaceId,
      clerkUserId: params.state.identity.clerkUserId,
    });
    return {
      ok: false,
      closeCode: 4403,
      reason: "Forbidden",
    };
  }

  if (parsed.type === "subscribe" || parsed.type === "snapshot-publish") {
    await hydrateDocIfNeeded({
      docId,
      orgWorkspaceId: scopedDoc.orgWorkspaceId,
    });
  }

  return { ok: true };
}

export async function handleCollabWebSocketUpgrade(c: Context): Promise<Response> {
  const url = new URL(c.req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let identity: AuthIdentity;
  try {
    identity = await authenticateBearerToken({ token });
  } catch (error) {
    logCollabError("websocket_auth_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return c.json({ error: "Unauthorized" }, 401);
  }

  const requestedClientId = url.searchParams.get("clientId")?.trim();
  const logicalClientId = requestedClientId && requestedClientId.length > 0
    ? requestedClientId
    : `anon-${crypto.randomUUID()}`;

  return upgradeWebSocket(c, {
    onOpen(_event, ws) {
      const connectionId = generateConnectionId();
      const client: WSClient = {
        id: connectionId,
        send(message) {
          ws.send(message);
        },
      };
      const raw = ws.raw;
      if (raw && typeof raw === "object") {
        socketStateByRaw.set(raw, {
          client,
          identity,
          workspaceAccessCache: new Map(),
        });
      }

      logCollabInfo("websocket_open", {
        connectionId,
        logicalClientId,
        clerkUserId: identity.clerkUserId,
      });
      crdtHandler.handleOpen({ client });
    },

    async onMessage(event, ws) {
      const state = getSocketState(ws);
      if (!state) {
        ws.close(1011, "Missing socket state");
        return;
      }

      const message = messageToString(event.data);
      if (!message) return;

      const authResult = await authorizeAndPrepareMessage({
        state,
        message,
      });
      if (!authResult.ok) {
        logCollabWarn("websocket_message_rejected", {
          connectionId: state.client.id,
          closeCode: authResult.closeCode,
          reason: authResult.reason,
        });
        ws.close(authResult.closeCode, authResult.reason);
        return;
      }

      try {
        const parsed = JSON.parse(message) as SnapshotPublishPayload;
        if (
          parsed.type === "snapshot-publish"
          && typeof parsed.docId === "string"
          && typeof parsed.snapshot === "string"
        ) {
          await handleSnapshotPublish({ payload: parsed });
          return;
        }
      } catch {
        // fall through for non-JSON messages
      }

      crdtHandler.handleMessage({
        client: state.client,
        message,
      });
    },

    onClose(_event, ws) {
      const state = getSocketState(ws);
      if (!state) return;
      logCollabInfo("websocket_close", {
        connectionId: state.client.id,
        clerkUserId: state.identity.clerkUserId,
      });
      crdtHandler.handleClose({ client: state.client });
      const raw = ws.raw;
      if (raw && typeof raw === "object") {
        socketStateByRaw.delete(raw);
      }
    },
  });
}
