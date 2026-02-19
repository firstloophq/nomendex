import {
  applyDocOperation,
  decodeRecordSnapshot,
  encodeRecordSnapshot,
  getDoc,
  receive,
  type RecordOp,
} from "@crdt/lib/server";
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
  appendCollabOps,
  getLatestCollabOpSeq,
  loadCollabOps,
  loadLatestCollabSnapshot,
  saveCollabSnapshot,
} from "./persistence";
import { isSnapshotStoreEnabled } from "./snapshot-store";

interface SocketState {
  client: WSClient;
  identity: AuthIdentity;
  workspaceAccessCache: Map<string, boolean>;
}

const socketStateByRaw = new WeakMap<object, SocketState>();
const hydratedDocs = new Set<string>();
const hydrateByDoc = new Map<string, Promise<void>>();
const checkpointInFlight = new Set<string>();

function getCheckpointThreshold(): number {
  const raw = process.env.CRDT_CHECKPOINT_OP_THRESHOLD;
  if (!raw) return 500;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
}

function getSocketState(ws: { raw?: unknown }): SocketState | null {
  const raw = ws.raw;
  if (!raw || typeof raw !== "object") return null;
  return socketStateByRaw.get(raw) ?? null;
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

async function maybeCheckpointDoc(params: {
  docId: string;
  orgWorkspaceId: string;
}): Promise<void> {
  if (!isSnapshotStoreEnabled()) return;

  const threshold = getCheckpointThreshold();
  const opCount = crdtHandler.getDocOps({ docId: params.docId }).length;
  if (opCount < threshold) return;
  if (checkpointInFlight.has(params.docId)) return;

  checkpointInFlight.add(params.docId);
  try {
    const state = crdtHandler.getDocManagerState();
    const record = getDoc({ manager: state.manager, docId: params.docId });
    if (!record) return;

    const baseSeq = await getLatestCollabOpSeq({
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
    });
    if (baseSeq === null) return;

    const snapshotBytes = encodeRecordSnapshot({ record });
    await saveCollabSnapshot({
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
      baseSeq,
      bytes: snapshotBytes,
    });

    crdtHandler.checkpointDoc({ docId: params.docId });
  } catch (error) {
    console.error(
      "[collab] failed to checkpoint doc",
      params.docId,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    checkpointInFlight.delete(params.docId);
  }
}

async function persistOps(params: {
  docId: string;
  ops: ReadonlyArray<RecordOp>;
}): Promise<void> {
  const scopedDoc = parseWorkspaceScopedDocId({ docId: params.docId });
  if (!scopedDoc) return;

  await appendCollabOps({
    docId: params.docId,
    orgWorkspaceId: scopedDoc.orgWorkspaceId,
    ops: params.ops,
  });
  await maybeCheckpointDoc({
    docId: params.docId,
    orgWorkspaceId: scopedDoc.orgWorkspaceId,
  });
}

const crdtHandler = createCRDTWebSocketHandler({
  serverClientId: "team-backend-crdt",
  onDocChanged({ docId, ops, source }) {
    if (source !== "client" || ops.length === 0) return;
    void persistOps({ docId, ops });
  },
});

async function hydrateDocIfNeeded(params: {
  docId: string;
  orgWorkspaceId: string;
}): Promise<void> {
  if (hydratedDocs.has(params.docId)) return;
  const existing = hydrateByDoc.get(params.docId);
  if (existing) return existing;

  const hydration = (async () => {
    const snapshot = await loadLatestCollabSnapshot({
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
    });

    let state = crdtHandler.getDocManagerState();
    let manager = state.manager;
    let clock = state.clock;

    if (snapshot) {
      const restoredRecord = decodeRecordSnapshot({ data: snapshot.bytes });
      const nextDocs = new Map(manager.docs);
      nextDocs.set(params.docId, restoredRecord);
      manager = { ...manager, docs: nextDocs };
    }

    const ops = await loadCollabOps({
      docId: params.docId,
      orgWorkspaceId: params.orgWorkspaceId,
      afterSeq: snapshot?.baseSeq,
    });

    for (const op of ops) {
      manager = applyDocOperation({ manager, docId: params.docId, op });
      if ("id" in op && op.id && typeof op.id.clock === "number") {
        clock = receive({ clock, remoteCounter: op.id.clock });
      }
    }

    state = { ...state, manager, clock };
    crdtHandler.setDocManagerState({ state });

    // Keep subscribe payloads compact by serving hydrated docs as snapshots.
    if (snapshot || ops.length > 0) {
      crdtHandler.checkpointDoc({ docId: params.docId });
    }

    hydratedDocs.add(params.docId);
  })()
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
    return {
      ok: false,
      closeCode: 4403,
      reason: "Forbidden",
    };
  }

  if (parsed.type === "subscribe") {
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
    console.error(
      "[collab] websocket auth failed",
      error instanceof Error ? error.message : String(error),
    );
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

      console.log(
        "[collab] open",
        JSON.stringify({ connectionId, logicalClientId, clerkUserId: identity.clerkUserId }),
      );
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
        ws.close(authResult.closeCode, authResult.reason);
        return;
      }

      crdtHandler.handleMessage({
        client: state.client,
        message,
      });
    },

    onClose(_event, ws) {
      const state = getSocketState(ws);
      if (!state) return;
      crdtHandler.handleClose({ client: state.client });
      const raw = ws.raw;
      if (raw && typeof raw === "object") {
        socketStateByRaw.delete(raw);
      }
    },
  });
}
