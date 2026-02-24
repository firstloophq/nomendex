import {
  applyDocOperation,
  applySnapshotToDoc,
  crdtToProseMirror,
  createRecord,
  decodeRecordSnapshot,
  encodeRecordSnapshot,
  getDoc,
  getBodyText,
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
import { logError, logInfo, logWarn } from "../observability/logger";
import { withSpan } from "../observability/telemetry";
import {
  deleteCanonicalSnapshot,
  loadCanonicalSnapshot,
  saveCanonicalSnapshot,
} from "./persistence";
import { tableSchema } from "../../../bun-sidecar/src/components/prosemirror/tables/schema";
import { tableMarkdownSerializer } from "../../../bun-sidecar/src/components/prosemirror/tables/serializer";

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
const authoritativeResetVersionByDoc = new Map<string, string>();
const persistTimerByDoc = new Map<string, ReturnType<typeof setTimeout>>();
const persistInFlightByDoc = new Set<string>();

function renderRecordMarkdown(record: ReturnType<typeof decodeRecordSnapshot>): string {
  const pmDoc = crdtToProseMirror({ doc: record.body, schema: tableSchema });
  return tableMarkdownSerializer.serialize(pmDoc);
}

function logCollabInfo(event: string, data: Record<string, unknown>): void {
  logInfo(`collab.${event}`, data);
}

function logCollabWarn(event: string, data: Record<string, unknown>): void {
  logWarn(`collab.${event}`, data);
}

function logCollabError(event: string, data: Record<string, unknown>): void {
  logError(`collab.${event}`, data);
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

function toBase64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
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
  return withSpan({
    name: "collab.persist_snapshot",
    attributes: {
      "collab.doc_id": params.docId,
      "collab.org_workspace_id": params.orgWorkspaceId,
    },
    fn: async () => {
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
    },
  });
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
  return withSpan({
    name: "collab.snapshot_publish",
    attributes: {
      "collab.doc_id": params.payload.docId,
      "collab.merge_bias": params.payload.mergeBias ?? "remote",
    },
    fn: async () => {
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
    },
  });
}

const crdtHandler = createCRDTWebSocketHandler({
  serverClientId: "team-backend-crdt",
  onDocChanged({ docId, txId, ops, source }) {
    logCollabInfo("doc_changed", {
      docId,
      txId: txId ?? null,
      source,
      opsCount: ops.length,
      ops: ops.slice(0, 100).map((op) => ({
        type: op.type,
        id: "id" in op && op.id ? `${op.id.clientId}:${op.id.clock}` : null,
        targetId: "targetId" in op && op.targetId
          ? `${op.targetId.clientId}:${op.targetId.clock}`
          : null,
        parentId: "parentId" in op && op.parentId
          ? `${op.parentId.clientId}:${op.parentId.clock}`
          : null,
        side: "side" in op ? op.side : null,
        contentType: "content" in op && op.content ? op.content.type : null,
      })),
    });
    if (source !== "client" || ops.length === 0) return;
    authoritativeResetVersionByDoc.delete(docId);
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
  authoritativeResetVersionByDoc.set(params.docId, emptyVersion);
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

export async function inspectCollabDoc(params: {
  docId: string;
  includeOps: boolean;
  includeItems: boolean;
  includePersisted: boolean;
  includeMarkdown: boolean;
  maxOps: number;
  identity?: AuthIdentity;
  skipAccessCheck?: boolean;
}): Promise<Record<string, unknown>> {
  return withSpan({
    name: "collab.inspect_doc_internal",
    attributes: {
      "collab.doc_id": params.docId,
      "collab.include_ops": params.includeOps,
      "collab.include_items": params.includeItems,
      "collab.max_ops": params.maxOps,
    },
    fn: async () => {
      const scopedDoc = parseWorkspaceScopedDocId({ docId: params.docId });
      if (!scopedDoc) {
        throw new Error(`Invalid document id format: "${params.docId}"`);
      }
      if (!params.skipAccessCheck) {
        if (!params.identity) {
          throw new Error("Forbidden");
        }
        const allowed = await canAccessWorkspace({
          identity: params.identity,
          orgWorkspaceId: scopedDoc.orgWorkspaceId,
          cache: new Map(),
        });
        if (!allowed) {
          throw new Error("Forbidden");
        }
      }

      const managerState = crdtHandler.getDocManagerState();
      const record = getDoc({ manager: managerState.manager, docId: params.docId });
      const docOps = crdtHandler.getDocOps({ docId: params.docId });
      const hydrated = hydratedDocs.has(params.docId);
      const persistedVersion = persistedVersionByDoc.get(params.docId) ?? null;
      const hasPersistTimer = persistTimerByDoc.has(params.docId);
      const inFlightPersist = persistInFlightByDoc.has(params.docId);

      const summary: Record<string, unknown> = {
        docId: params.docId,
        orgWorkspaceId: scopedDoc.orgWorkspaceId,
        hydrated,
        hasRecord: !!record,
        persistedVersion,
        hasPersistTimer,
        inFlightPersist,
        opCount: docOps.length,
        stateVector: record ? Object.fromEntries(record.stateVector) : {},
        fieldsCount: record ? record.fields.size : 0,
        setsCount: record ? record.sets.size : 0,
        bodyItemsCount: record ? record.body.store.items.length : 0,
      };

      if (params.includeMarkdown && record) {
        try {
          summary.markdown = renderRecordMarkdown(record);
        } catch (error) {
          summary.markdownError = error instanceof Error ? error.message : String(error);
        }
      }

      if (params.includeOps) {
        summary.ops = docOps.slice(-params.maxOps).map((op) => ({
          type: op.type,
          id: "id" in op && op.id ? `${op.id.clientId}:${op.id.clock}` : null,
          targetId: "targetId" in op && op.targetId
            ? `${op.targetId.clientId}:${op.targetId.clock}`
            : null,
          parentId: "parentId" in op && op.parentId
            ? `${op.parentId.clientId}:${op.parentId.clock}`
            : null,
          side: "side" in op ? op.side : null,
          contentType: "content" in op && op.content ? op.content.type : null,
        }));
      }

      if (params.includeItems && record) {
        summary.bodyItems = record.body.store.items.map((item) => ({
          id: `${item.id.clientId}:${item.id.clock}`,
          leftOrigin: item.leftOrigin ? `${item.leftOrigin.clientId}:${item.leftOrigin.clock}` : null,
          rightOrigin: item.rightOrigin ? `${item.rightOrigin.clientId}:${item.rightOrigin.clock}` : null,
          deleted: item.deleted,
          contentType: item.content.type,
          blockType: item.content.type === "block" ? item.content.blockType : null,
          text: item.content.type === "text" ? item.content.value : null,
        }));
      }

      if (params.includePersisted) {
        const snapshot = await loadCanonicalSnapshot({
          docId: params.docId,
          orgWorkspaceId: scopedDoc.orgWorkspaceId,
        });
        if (snapshot) {
          const persisted = decodeRecordSnapshot({ data: snapshot.bytes });
          let markdown: string | null = null;
          let markdownError: string | null = null;
          if (params.includeMarkdown) {
            try {
              markdown = renderRecordMarkdown(persisted);
            } catch (error) {
              markdownError = error instanceof Error ? error.message : String(error);
            }
          }
          summary.persisted = {
            found: true,
            snapshotVersion: snapshot.snapshotVersion ?? null,
            bytes: snapshot.bytes.byteLength,
            bodyItemsCount: persisted.body.store.items.length,
            fieldsCount: persisted.fields.size,
            setsCount: persisted.sets.size,
            bodyText: getBodyText({ record: persisted }),
            markdown,
            markdownError,
          };
        } else {
          summary.persisted = { found: false };
        }
      }

      return summary;
    },
  });
}

export async function getCollabBootstrapSnapshot(params: {
  docId: string;
  identity: AuthIdentity;
}): Promise<{
  snapshot: string | null;
  meta: {
    snapshotVersion: string | null;
    source: "live" | "persisted" | "none";
    bytes: number;
    authoritativeReset: boolean;
  };
}> {
  return withSpan({
    name: "collab.get_bootstrap_snapshot",
    attributes: {
      "collab.doc_id": params.docId,
    },
    fn: async () => {
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

      await hydrateDocIfNeeded({
        docId: params.docId,
        orgWorkspaceId: scopedDoc.orgWorkspaceId,
      });

      const managerState = crdtHandler.getDocManagerState();
      const liveRecord = getDoc({ manager: managerState.manager, docId: params.docId });
      if (liveRecord) {
        const liveBytes = encodeRecordSnapshot({ record: liveRecord });
        const liveVersion = getRecordSnapshotVersion({ data: liveBytes });
        const authoritativeReset = authoritativeResetVersionByDoc.get(params.docId) === liveVersion;
        if (!authoritativeReset) {
          authoritativeResetVersionByDoc.delete(params.docId);
        }
        return {
          snapshot: toBase64(liveBytes),
          meta: {
            snapshotVersion: liveVersion,
            source: "live",
            bytes: liveBytes.byteLength,
            authoritativeReset,
          },
        };
      }

      const persisted = await loadCanonicalSnapshot({
        docId: params.docId,
        orgWorkspaceId: scopedDoc.orgWorkspaceId,
      });
      if (persisted) {
        const persistedVersion = persisted.snapshotVersion ?? getRecordSnapshotVersion({ data: persisted.bytes });
        const authoritativeReset = authoritativeResetVersionByDoc.get(params.docId) === persistedVersion;
        if (!authoritativeReset) {
          authoritativeResetVersionByDoc.delete(params.docId);
        }
        return {
          snapshot: toBase64(persisted.bytes),
          meta: {
            snapshotVersion: persistedVersion,
            source: "persisted",
            bytes: persisted.bytes.byteLength,
            authoritativeReset,
          },
        };
      }

      return {
        snapshot: null,
        meta: {
          snapshotVersion: null,
          source: "none",
          bytes: 0,
          authoritativeReset: false,
        },
      };
    },
  });
}

async function hydrateDocIfNeeded(params: {
  docId: string;
  orgWorkspaceId: string;
}): Promise<void> {
  return withSpan({
    name: "collab.hydrate_doc_if_needed",
    attributes: {
      "collab.doc_id": params.docId,
      "collab.org_workspace_id": params.orgWorkspaceId,
    },
    fn: async () => {
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
    },
  });
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
      await withSpan({
        name: "collab.ws_message",
        attributes: {
          "collab.connection_id": state.client.id,
          "collab.message_bytes": message.length,
        },
        fn: async () => {
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
            const parsed = JSON.parse(message) as SnapshotPublishPayload & {
              txId?: string;
              ops?: ReadonlyArray<RecordOp>;
            };
            logCollabInfo("websocket_message_received", {
              connectionId: state.client.id,
              type: parsed.type ?? "unknown",
              docId: parsed.docId ?? null,
              txId: parsed.txId ?? null,
              opsCount: Array.isArray(parsed.ops) ? parsed.ops.length : null,
            });
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
