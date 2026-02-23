import type { RecordOp } from "../document/record";
import type { AwarenessState } from "./awareness";
import { encodeStateVector, type StateVector } from "./state-vector";

// --- Wire message types ---

interface DocTxMessage {
  readonly type: "tx";
  readonly txId: string;
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

interface SnapshotMessage {
  readonly type: "snapshot";
  readonly docId: string;
  readonly snapshot: string; // base64-encoded CRDTRecord snapshot
  readonly version?: string;
}

type IncomingMessage = DocTxMessage | SyncResponseMessage | AwarenessMessage | SnapshotMessage;

type PendingMessage =
  | { type: "tx"; txId: string; docId: string; ops: ReadonlyArray<RecordOp> };

type BufferedTxMessage = { txId: string; ops: ReadonlyArray<RecordOp> };
type DocPhase = "syncing" | "live";

// --- Public interface ---

export interface MultiDocTransport {
  readonly subscribe: (params: { docId: string; initialStateVector?: StateVector }) => void;
  readonly unsubscribe: (params: { docId: string }) => void;
  readonly send: (params: { docId: string; ops: ReadonlyArray<RecordOp> }) => void;
  readonly sendTx: (params: { txId: string; docId: string; ops: ReadonlyArray<RecordOp> }) => void;
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
  onTx?: (params: { txId: string; docId: string; ops: ReadonlyArray<RecordOp> }) => void;
  onAwareness?: (params: { docId: string; clientId: string; state: AwarenessState }) => void;
  onSnapshot?: (params: { docId: string; data: Uint8Array; version?: string }) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onDocSyncComplete?: (params: { docId: string }) => void;
  onProtocolError?: (params: { docId?: string; reason: string }) => void;
  getAuthToken?: () => string | Promise<string>;
}): MultiDocTransport {
  let ws: WebSocket | null = null;
  let connected = false;
  let intentionalDisconnect = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let localTxCounter = 0;

  // Per-doc state vectors — updated on send/receive
  const docStateVectors = new Map<string, StateVector>();
  // Per-doc sync tracking
  const syncingDocs = new Set<string>();
  const docPhases = new Map<string, DocPhase>();
  const bufferedDocTx = new Map<string, Array<BufferedTxMessage>>();
  // Subscribed docs (for re-subscribe on reconnect)
  const subscribedDocs = new Set<string>();
  // Global offline queue
  const pendingMessages: Array<PendingMessage> = [];
  const seenTxIdsByDoc = new Map<string, Map<string, number>>();
  const TX_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
  const TX_DEDUPE_MAX_PER_DOC = 2000;

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

  function enqueueOrSendTx(paramsTx: { txId: string; docId: string; ops: ReadonlyArray<RecordOp> }) {
    const { txId, docId, ops } = paramsTx;
    if (!subscribedDocs.has(docId)) {
      params.onProtocolError?.({
        docId,
        reason: "send_tx_before_subscribe",
      });
      return;
    }
    updateDocSV(docId, ops);

    if (connected && ws && !syncingDocs.has(docId)) {
      ws.send(JSON.stringify({ type: "tx", txId, docId, ops }));
    } else {
      pendingMessages.push({ type: "tx", txId, docId, ops });
    }
  }

  function isDuplicateTx(paramsTx: { docId: string; txId: string }): boolean {
    const { docId, txId } = paramsTx;
    const now = Date.now();
    let seenForDoc = seenTxIdsByDoc.get(docId);
    if (!seenForDoc) {
      seenForDoc = new Map<string, number>();
      seenTxIdsByDoc.set(docId, seenForDoc);
    }

    const existing = seenForDoc.get(txId);
    if (typeof existing === "number") {
      seenForDoc.set(txId, now);
      return true;
    }

    seenForDoc.set(txId, now);
    if (seenForDoc.size > TX_DEDUPE_MAX_PER_DOC) {
      for (const [knownTxId, ts] of seenForDoc) {
        if (now - ts > TX_DEDUPE_WINDOW_MS || seenForDoc.size > TX_DEDUPE_MAX_PER_DOC) {
          seenForDoc.delete(knownTxId);
        } else {
          break;
        }
      }
    }
    return false;
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
        docPhases.set(docId, "syncing");
        bufferedDocTx.set(docId, []);
        ws!.send(JSON.stringify(msg));
      }

      params.onConnect?.();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as IncomingMessage;

        if (msg.type === "sync-response" && msg.docId) {
          if (!subscribedDocs.has(msg.docId)) {
            params.onProtocolError?.({
              docId: msg.docId,
              reason: "sync_response_for_unsubscribed_doc",
            });
            return;
          }
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
          const buffered = bufferedDocTx.get(msg.docId);
          if (buffered && buffered.length > 0) {
            for (const tx of buffered) {
              if (isDuplicateTx({ docId: msg.docId, txId: tx.txId })) continue;
              updateDocSV(msg.docId, tx.ops);
              params.onTx?.({ txId: tx.txId, docId: msg.docId, ops: tx.ops });
              if (!params.onTx) {
                params.onOps({ docId: msg.docId, ops: tx.ops });
              }
            }
          }
          bufferedDocTx.delete(msg.docId);

          // Flush pending messages for this doc in original queue order.
          const toFlush: Array<PendingMessage> = [];
          for (let i = pendingMessages.length - 1; i >= 0; i--) {
            const pending = pendingMessages[i]!;
            if (pending.docId === msg.docId) {
              toFlush.unshift(pending);
              pendingMessages.splice(i, 1);
            }
          }
          if (toFlush.length > 0 && ws && connected) {
            for (const pending of toFlush) {
              ws.send(JSON.stringify(pending));
            }
          }

          syncingDocs.delete(msg.docId);
          docPhases.set(msg.docId, "live");
          params.onDocSyncComplete?.({ docId: msg.docId });
        } else if (msg.type === "snapshot" && msg.docId && msg.snapshot && params.onSnapshot) {
          const binaryStr = atob(msg.snapshot);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          params.onSnapshot({ docId: msg.docId, data: bytes, version: msg.version });
        } else if (msg.type === "tx" && msg.docId && typeof msg.txId === "string" && Array.isArray(msg.ops)) {
          if (!subscribedDocs.has(msg.docId)) {
            params.onProtocolError?.({
              docId: msg.docId,
              reason: "tx_for_unsubscribed_doc",
            });
            return;
          }

          const phase = docPhases.get(msg.docId);
          if (!phase) {
            params.onProtocolError?.({
              docId: msg.docId,
              reason: "tx_before_subscribe",
            });
            return;
          }

          if (syncingDocs.has(msg.docId)) {
            const buf = bufferedDocTx.get(msg.docId);
            if (buf) {
              if (!buf.some((entry) => entry.txId === msg.txId)) {
                buf.push({ txId: msg.txId, ops: msg.ops });
              }
            } else {
              bufferedDocTx.set(msg.docId, [{ txId: msg.txId, ops: msg.ops }]);
            }
          } else {
            if (isDuplicateTx({ docId: msg.docId, txId: msg.txId })) {
              return;
            }
            updateDocSV(msg.docId, msg.ops);
            params.onTx?.({ txId: msg.txId, docId: msg.docId, ops: msg.ops });
            if (!params.onTx) {
              params.onOps({ docId: msg.docId, ops: msg.ops });
            }
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
      bufferedDocTx.clear();
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
      docPhases.set(docId, "syncing");
      syncingDocs.add(docId);
      bufferedDocTx.set(docId, []);

      // Seed the SV if provided (for first subscribe before any ops)
      if (initialStateVector && !docStateVectors.has(docId)) {
        docStateVectors.set(docId, initialStateVector);
      }

      if (connected && ws) {
        const sv = docStateVectors.get(docId);
        const msg: SubscribeMessage = sv && sv.size > 0
          ? { type: "subscribe", docId, stateVector: encodeStateVector({ sv }) }
          : { type: "subscribe", docId };
        ws.send(JSON.stringify(msg));
      }
    },

    unsubscribe({ docId }) {
      subscribedDocs.delete(docId);
      syncingDocs.delete(docId);
      docPhases.delete(docId);
      bufferedDocTx.delete(docId);
      seenTxIdsByDoc.delete(docId);
      if (connected && ws) {
        ws.send(JSON.stringify({ type: "unsubscribe", docId }));
      }
    },

    send({ docId, ops }) {
      const txId = `${params.clientId}:auto:${++localTxCounter}`;
      enqueueOrSendTx({ txId, docId, ops });
    },

    sendTx({ txId, docId, ops }) {
      enqueueOrSendTx({ txId, docId, ops });
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
      docPhases.clear();
      bufferedDocTx.clear();
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
      docPhases.clear();
      bufferedDocTx.clear();
      pendingMessages.length = 0;
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
      return pendingMessages.reduce((sum, entry) => sum + entry.ops.length, 0);
    },
  };
}
