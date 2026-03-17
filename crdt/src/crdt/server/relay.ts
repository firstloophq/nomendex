import { createCRDTWebSocketHandler, type CRDTWebSocketHandler } from "./websocket-handler";
import type { RecordOp } from "../document/record";
import type { AwarenessState } from "../network/awareness";
import { createMultiDocTransport, type MultiDocTransport } from "../network/multi-doc-transport";
import { applyDocOperations, applySnapshotToDoc, getDoc } from "../document/doc-manager";
import { receive } from "../core/lamport-clock";
import { encodeRecordSnapshot, getRecordSnapshotVersion } from "../document/snapshot";
import { getBodyText } from "../document/record";
import { bytesToBase64 } from "./base64";

// --- Public interface ---

export interface CRDTRelay {
  /** The local WebSocket handler. Wire this to your WS server. */
  readonly handler: CRDTWebSocketHandler;
  /** Subscribe a doc for bidirectional relay between local handler and remote server. */
  readonly addDoc: (params: { docId: string }) => void;
  /** Unsubscribe a doc from relay. */
  readonly removeDoc: (params: { docId: string }) => void;
  /** Get all currently relayed doc IDs. */
  readonly getDocIds: () => ReadonlyArray<string>;
  /** Whether the remote transport is connected. */
  readonly isConnected: () => boolean;
  /** Close the relay and disconnect from remote. */
  readonly close: () => void;
}

// --- Factory ---

export function createCRDTRelay(params: {
  remoteUrl: string;
  clientId: string;
  serverClientId?: string;
  docIds?: ReadonlyArray<string>;
  getAuthToken?: () => string | Promise<string>;
  onConnect?: () => void;
  onDisconnect?: () => void;
  getDiagnosticsPayload?: (params: { docId: string }) => Record<string, unknown>;
}): CRDTRelay {
  const relayedDocs = new Set<string>();
  const seenRemoteTxIdsByDoc = new Map<string, Set<string>>();
  const MAX_SEEN_REMOTE_TX_IDS = 2000;

  function shouldAcceptRemoteTx(paramsTx: { docId: string; txId: string }): boolean {
    const { docId, txId } = paramsTx;
    let seen = seenRemoteTxIdsByDoc.get(docId);
    if (!seen) {
      seen = new Set<string>();
      seenRemoteTxIdsByDoc.set(docId, seen);
    }
    if (seen.has(txId)) return false;
    seen.add(txId);
    if (seen.size > MAX_SEEN_REMOTE_TX_IDS) {
      const iterator = seen.values();
      const first = iterator.next();
      if (!first.done) {
        seen.delete(first.value);
      }
    }
    return true;
  }

  // We need the transport to exist before creating the handler (so onDocChanged can forward ops).
  // But the transport needs to call handler methods when it receives ops.
  // Solve via a late-binding ref.
  let transport: MultiDocTransport | null = null;
  let handler: CRDTWebSocketHandler | null = null;

  // Create handler with forwarding callbacks
  handler = createCRDTWebSocketHandler({
    serverClientId: params.serverClientId,
    onDocChanged({ docId, txId, ops, source }) {
      // Only forward locally-originated ops to remote (avoid echo loop)
      if (source === "client" && relayedDocs.has(docId) && transport) {
        transport.sendTx({
          txId: txId ?? `${params.clientId}:relay:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          docId,
          ops,
        });
      }
    },
    onAwareness({ docId, clientId: awarenessClientId, state }) {
      // Forward local awareness to remote
      if (relayedDocs.has(docId) && transport) {
        transport.sendAwareness({ docId, clientId: awarenessClientId, state });
      }
    },
  });

  const handlerRef = handler;
  function ensureTransport(): MultiDocTransport {
    if (transport) return transport;

    transport = createMultiDocTransport({
      url: params.remoteUrl,
      clientId: params.clientId,
      getAuthToken: params.getAuthToken,

      onOps({ docId, ops }) {
        if (!relayedDocs.has(docId)) return;

        // Apply remote ops to local handler state
        const state = handlerRef.getDocManagerState();
        const manager = applyDocOperations({ manager: state.manager, docId, ops });
        let maxRemoteClock: number | null = null;
        for (const op of ops) {
          if ("id" in op && op.id && typeof op.id.clock === "number") {
            if (maxRemoteClock === null || op.id.clock > maxRemoteClock) {
              maxRemoteClock = op.id.clock;
            }
          }
        }
        const clock = maxRemoteClock === null
          ? state.clock
          : receive({ clock: state.clock, remoteCounter: maxRemoteClock });

        handlerRef.setDocManagerState({ state: { manager, clock } });
        handlerRef.appendDocOps({ docId, ops });
        handlerRef.broadcastTx({
          txId: `${params.clientId}:relay-sync:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          docId,
          ops,
        });
      },
      onTx({ txId, docId, ops }) {
        if (!relayedDocs.has(docId)) return;
        if (!shouldAcceptRemoteTx({ docId, txId })) return;

        const state = handlerRef.getDocManagerState();
        const manager = applyDocOperations({ manager: state.manager, docId, ops });
        let maxRemoteClock: number | null = null;
        for (const op of ops) {
          if ("id" in op && op.id && typeof op.id.clock === "number") {
            if (maxRemoteClock === null || op.id.clock > maxRemoteClock) {
              maxRemoteClock = op.id.clock;
            }
          }
        }
        const clock = maxRemoteClock === null
          ? state.clock
          : receive({ clock: state.clock, remoteCounter: maxRemoteClock });

        handlerRef.setDocManagerState({ state: { manager, clock } });
        handlerRef.appendDocOps({ docId, ops });
        handlerRef.broadcastTx({ txId, docId, ops });
      },

      onAwareness({ docId, clientId: remoteClientId, state }) {
        if (!relayedDocs.has(docId)) return;
        // Forward remote awareness to local clients
        handlerRef.broadcastAwareness({ docId, clientId: remoteClientId, state });
      },

      onSnapshot({ docId, data, version }) {
        if (!relayedDocs.has(docId)) return;

        const state = handlerRef.getDocManagerState();
        const nextManager = applySnapshotToDoc({
          manager: state.manager,
          docId,
          snapshot: data,
          mode: "replace",
        });
        handlerRef.setDocManagerState({
          state: { ...state, manager: nextManager },
        });
        handlerRef.checkpointDoc({ docId });
        handlerRef.broadcastSnapshot({
          docId,
          snapshot: data,
          version,
        });
      },

      onClientDiagnosticsRequest({ requestId, docId }) {
        const diagnosticsPayload = params.getDiagnosticsPayload
          ? params.getDiagnosticsPayload({ docId })
          : (() => {
            const record = getDoc({
              manager: handlerRef.getDocManagerState().manager,
              docId,
            });
            const ops = handlerRef.getDocOps({ docId });
            if (!record) {
              return {
                relayClientId: params.clientId,
                generatedAt: new Date().toISOString(),
                hasDoc: false,
                opCount: ops.length,
              };
            }
            const snapshotBytes = encodeRecordSnapshot({ record });
            return {
              relayClientId: params.clientId,
              generatedAt: new Date().toISOString(),
              hasDoc: true,
              snapshotVersion: getRecordSnapshotVersion({ data: snapshotBytes }),
              snapshotBytes: snapshotBytes.byteLength,
              snapshotBase64: bytesToBase64(snapshotBytes),
              bodyText: getBodyText({ record }),
              stateVector: Object.fromEntries(record.stateVector),
              bodyItemsCount: record.body.store.items.length,
              fieldsCount: record.fields.size,
              setsCount: record.sets.size,
              opCount: ops.length,
            };
          })();

        transport?.sendClientDiagnosticsResponse({
          requestId,
          docId,
          payload: diagnosticsPayload,
        });
      },

      onConnect() {
        // Subscribe to all relayed docs on the remote
        for (const docId of relayedDocs) {
          const record = getDoc({
            manager: handlerRef.getDocManagerState().manager,
            docId,
          });
          transport!.subscribe({
            docId,
            initialStateVector: record?.stateVector,
          });
        }
        params.onConnect?.();
      },

      onDisconnect() {
        params.onDisconnect?.();
      },
    });

    return transport;
  }

  // Subscribe initial docs
  if (params.docIds) {
    for (const docId of params.docIds) {
      relayedDocs.add(docId);
    }
    if (relayedDocs.size > 0) {
      ensureTransport();
    }
  }

  return {
    handler: handlerRef,

    addDoc({ docId }) {
      if (relayedDocs.has(docId)) return;
      relayedDocs.add(docId);
      const activeTransport = ensureTransport();

      if (activeTransport.isConnected()) {
        const record = getDoc({
          manager: handlerRef.getDocManagerState().manager,
          docId,
        });
        activeTransport.subscribe({
          docId,
          initialStateVector: record?.stateVector,
        });
      }
    },

    removeDoc({ docId }) {
      if (!relayedDocs.has(docId)) return;
      relayedDocs.delete(docId);
      seenRemoteTxIdsByDoc.delete(docId);
      transport?.unsubscribe({ docId });
    },

    getDocIds() {
      return [...relayedDocs];
    },

    isConnected() {
      return transport?.isConnected() ?? false;
    },

    close() {
      relayedDocs.clear();
      seenRemoteTxIdsByDoc.clear();
      transport?.close();
    },
  };
}
