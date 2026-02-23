import { createCRDTWebSocketHandler, type CRDTWebSocketHandler } from "./websocket-handler";
import type { AwarenessState } from "../network/awareness";
import { createMultiDocTransport, type MultiDocTransport } from "../network/multi-doc-transport";
import {
  applyDocOperation,
  applySnapshotToDoc,
  getDoc,
} from "../document/doc-manager";
import {
  encodeRecordSnapshot,
  getRecordSnapshotVersion,
} from "../document/snapshot";
import { receive } from "../core/lamport-clock";

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
}): CRDTRelay {
  const relayedDocs = new Set<string>();

  // We need the transport to exist before creating the handler (so onDocChanged can forward ops).
  // But the transport needs to call handler methods when it receives ops.
  // Solve via a late-binding ref.
  let transport: MultiDocTransport | null = null;
  let handler: CRDTWebSocketHandler | null = null;

  // Create handler with forwarding callbacks
  handler = createCRDTWebSocketHandler({
    serverClientId: params.serverClientId,
    onDocChanged({ docId, ops, source }) {
      // Only forward locally-originated ops to remote (avoid echo loop)
      if (source === "client" && relayedDocs.has(docId) && transport) {
        transport.send({ docId, ops });
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

  // Create remote transport
  transport = createMultiDocTransport({
    url: params.remoteUrl,
    clientId: params.clientId,
    getAuthToken: params.getAuthToken,

    onOps({ docId, ops }) {
      if (!relayedDocs.has(docId)) return;

      // Apply remote ops to local handler state
      const state = handlerRef.getDocManagerState();
      let manager = state.manager;
      let clock = state.clock;

      for (const op of ops) {
        manager = applyDocOperation({ manager, docId, op });
        if ("id" in op && op.id && typeof op.id.clock === "number") {
          clock = receive({ clock, remoteCounter: op.id.clock });
        }
      }

      handlerRef.setDocManagerState({ state: { manager, clock } });
      handlerRef.appendDocOps({ docId, ops });
      handlerRef.broadcastDocOps({ docId, ops });
    },

    onAwareness({ docId, clientId: remoteClientId, state }) {
      if (!relayedDocs.has(docId)) return;
      // Forward remote awareness to local clients
      handlerRef.broadcastAwareness({ docId, clientId: remoteClientId, state });
    },

    onSnapshot({ docId, data, version }) {
      if (!relayedDocs.has(docId)) return;
      const currentState = handlerRef.getDocManagerState();
      const hasLocalRecord = !!getDoc({
        manager: currentState.manager,
        docId,
      });
      const nextManager = applySnapshotToDoc({
        manager: currentState.manager,
        docId,
        snapshot: data,
        mode: hasLocalRecord ? "merge" : "replace",
        mergeBias: "remote",
      });
      handlerRef.setDocManagerState({ state: { ...currentState, manager: nextManager } });
      handlerRef.checkpointDoc({ docId });
      handlerRef.appendDocOps({ docId, ops: [] });
      const mergedRecord = getDoc({
        manager: handlerRef.getDocManagerState().manager,
        docId,
      });
      if (!mergedRecord) return;

      const mergedBytes = encodeRecordSnapshot({ record: mergedRecord });
      const mergedVersion = version ?? getRecordSnapshotVersion({ data: mergedBytes });
      handlerRef.broadcastSnapshot({
        docId,
        snapshot: mergedBytes,
        version: mergedVersion,
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

  // Subscribe initial docs
  if (params.docIds) {
    for (const docId of params.docIds) {
      relayedDocs.add(docId);
    }
  }

  return {
    handler: handlerRef,

    addDoc({ docId }) {
      if (relayedDocs.has(docId)) return;
      relayedDocs.add(docId);

      if (transport && transport.isConnected()) {
        const record = getDoc({
          manager: handlerRef.getDocManagerState().manager,
          docId,
        });
        transport.subscribe({
          docId,
          initialStateVector: record?.stateVector,
        });
      }
    },

    removeDoc({ docId }) {
      if (!relayedDocs.has(docId)) return;
      relayedDocs.delete(docId);
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
      transport?.close();
    },
  };
}
