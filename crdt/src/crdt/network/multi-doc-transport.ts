import type { RecordOp } from "../document/record";
import type { AwarenessState } from "./awareness";
import { encodeStateVector, type StateVector } from "./state-vector";

// --- Wire message types ---

interface DocOpsMessage {
  readonly type: "ops";
  readonly docId: string;
  readonly ops: ReadonlyArray<RecordOp>;
}

interface SubscribeMessage {
  readonly type: "subscribe";
  readonly docId: string;
  readonly stateVector?: string;
}

interface UnsubscribeMessage {
  readonly type: "unsubscribe";
  readonly docId: string;
}

interface AwarenessMessage {
  readonly type: "awareness";
  readonly docId: string;
  readonly clientId: string;
  readonly state: AwarenessState;
}

interface SyncResponseMessage {
  readonly type: "sync-response";
  readonly docId: string;
  readonly ops: ReadonlyArray<RecordOp>;
  readonly snapshot?: string; // base64-encoded CRDTRecord snapshot
}

type IncomingMessage = DocOpsMessage | SyncResponseMessage | AwarenessMessage;

// --- Public interface ---

export interface MultiDocTransport {
  readonly subscribe: (params: { docId: string; initialStateVector?: StateVector }) => void;
  readonly unsubscribe: (params: { docId: string }) => void;
  readonly send: (params: { docId: string; ops: ReadonlyArray<RecordOp> }) => void;
  readonly sendAwareness: (params: { docId: string; clientId: string; state: AwarenessState }) => void;
  readonly disconnect: () => void;
  readonly reconnect: () => void;
  readonly close: () => void;
  readonly isConnected: () => boolean;
  readonly isSyncing: (params: { docId: string }) => boolean;
  readonly pendingOpsCount: () => number;
}

export function createMultiDocTransport(params: {
  url: string;
  clientId: string;
  onOps: (params: { docId: string; ops: ReadonlyArray<RecordOp> }) => void;
  onAwareness?: (params: { docId: string; clientId: string; state: AwarenessState }) => void;
  onSnapshot?: (params: { docId: string; data: Uint8Array }) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onDocSyncComplete?: (params: { docId: string }) => void;
  getAuthToken?: () => string | Promise<string>;
}): MultiDocTransport {
  let ws: WebSocket | null = null;
  let connected = false;
  let intentionalDisconnect = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Per-doc state vectors — updated on send/receive
  const docStateVectors = new Map<string, StateVector>();
  // Per-doc sync tracking
  const syncingDocs = new Set<string>();
  const bufferedDocOps = new Map<string, RecordOp[]>();
  // Subscribed docs (for re-subscribe on reconnect)
  const subscribedDocs = new Set<string>();
  // Global offline queue
  const pendingOps: Array<{ docId: string; ops: ReadonlyArray<RecordOp> }> = [];

  function updateDocSV(docId: string, ops: ReadonlyArray<RecordOp>) {
    const sv = new Map<string, number>(docStateVectors.get(docId) ?? []);
    let changed = false;
    for (const op of ops) {
      if ("id" in op && op.id && typeof op.id.clock === "number") {
        const current = sv.get(op.id.clientId) ?? 0;
        if (op.id.clock > current) {
          sv.set(op.id.clientId, op.id.clock);
          changed = true;
        }
      }
    }
    if (changed || !docStateVectors.has(docId)) {
      docStateVectors.set(docId, sv);
    }
  }

  async function connect() {
    let url = `${params.url}?clientId=${encodeURIComponent(params.clientId)}`;

    if (params.getAuthToken) {
      const token = await params.getAuthToken();
      url += `&token=${encodeURIComponent(token)}`;
    }

    ws = new WebSocket(url);

    ws.onopen = () => {
      connected = true;

      // Re-subscribe to all docs with current state vectors for delta sync
      for (const docId of subscribedDocs) {
        const sv = docStateVectors.get(docId);
        const msg: SubscribeMessage = sv && sv.size > 0
          ? { type: "subscribe", docId, stateVector: encodeStateVector({ sv }) }
          : { type: "subscribe", docId };
        syncingDocs.add(docId);
        bufferedDocOps.set(docId, []);
        ws!.send(JSON.stringify(msg));
      }

      params.onConnect?.();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as IncomingMessage;

        if (msg.type === "sync-response" && msg.docId) {
          // If a snapshot is included, decode and apply it first
          if (msg.snapshot && params.onSnapshot) {
            const binaryStr = atob(msg.snapshot);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            params.onSnapshot({ docId: msg.docId, data: bytes });
          }

          // Apply sync-response ops
          if (msg.ops.length > 0) {
            updateDocSV(msg.docId, msg.ops);
            params.onOps({ docId: msg.docId, ops: msg.ops });
          }

          // Apply buffered ops that arrived during sync
          const buffered = bufferedDocOps.get(msg.docId);
          if (buffered && buffered.length > 0) {
            updateDocSV(msg.docId, buffered);
            params.onOps({ docId: msg.docId, ops: buffered });
          }
          bufferedDocOps.delete(msg.docId);

          // Flush pending ops for this doc
          const toSend: RecordOp[] = [];
          for (let i = pendingOps.length - 1; i >= 0; i--) {
            if (pendingOps[i]!.docId === msg.docId) {
              toSend.unshift(...pendingOps[i]!.ops);
              pendingOps.splice(i, 1);
            }
          }
          if (toSend.length > 0 && ws && connected) {
            ws.send(JSON.stringify({ type: "ops", docId: msg.docId, ops: toSend }));
          }

          syncingDocs.delete(msg.docId);
          params.onDocSyncComplete?.({ docId: msg.docId });
        } else if (msg.type === "ops" && msg.docId && Array.isArray(msg.ops)) {
          if (syncingDocs.has(msg.docId)) {
            // Buffer during sync phase
            const buf = bufferedDocOps.get(msg.docId);
            if (buf) {
              buf.push(...msg.ops);
            } else {
              bufferedDocOps.set(msg.docId, [...msg.ops]);
            }
          } else {
            updateDocSV(msg.docId, msg.ops);
            params.onOps({ docId: msg.docId, ops: msg.ops });
          }
        } else if (msg.type === "awareness" && msg.docId) {
          params.onAwareness?.({
            docId: msg.docId,
            clientId: msg.clientId,
            state: msg.state,
          });
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      connected = false;
      // Clear sync state on disconnect
      syncingDocs.clear();
      bufferedDocOps.clear();
      params.onDisconnect?.();

      if (!intentionalDisconnect) {
        reconnectTimer = setTimeout(() => { connect(); }, 1000);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  connect();

  return {
    subscribe({ docId, initialStateVector }) {
      subscribedDocs.add(docId);

      // Seed the SV if provided (for first subscribe before any ops)
      if (initialStateVector && !docStateVectors.has(docId)) {
        docStateVectors.set(docId, initialStateVector);
      }

      if (connected && ws) {
        const sv = docStateVectors.get(docId);
        const msg: SubscribeMessage = sv && sv.size > 0
          ? { type: "subscribe", docId, stateVector: encodeStateVector({ sv }) }
          : { type: "subscribe", docId };
        syncingDocs.add(docId);
        bufferedDocOps.set(docId, []);
        ws.send(JSON.stringify(msg));
      }
    },

    unsubscribe({ docId }) {
      subscribedDocs.delete(docId);
      syncingDocs.delete(docId);
      bufferedDocOps.delete(docId);
      if (connected && ws) {
        ws.send(JSON.stringify({ type: "unsubscribe", docId }));
      }
    },

    send({ docId, ops }) {
      // Update local SV tracking
      updateDocSV(docId, ops);

      if (connected && ws && !syncingDocs.has(docId)) {
        ws.send(JSON.stringify({ type: "ops", docId, ops }));
      } else {
        pendingOps.push({ docId, ops });
      }
    },

    sendAwareness({ docId, clientId, state }) {
      // Awareness is fire-and-forget, never queued
      if (connected && ws) {
        ws.send(JSON.stringify({
          type: "awareness",
          docId,
          clientId,
          state,
        }));
      }
    },

    disconnect() {
      intentionalDisconnect = true;
      syncingDocs.clear();
      bufferedDocOps.clear();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      ws?.close();
      ws = null;
      connected = false;
    },

    reconnect() {
      intentionalDisconnect = false;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
      }
      connect();
    },

    close() {
      intentionalDisconnect = true;
      syncingDocs.clear();
      bufferedDocOps.clear();
      pendingOps.length = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
      connected = false;
    },

    isConnected() {
      return connected;
    },

    isSyncing({ docId }) {
      return syncingDocs.has(docId);
    },

    pendingOpsCount() {
      return pendingOps.reduce((sum, entry) => sum + entry.ops.length, 0);
    },
  };
}
