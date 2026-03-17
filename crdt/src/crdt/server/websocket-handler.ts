import { createClock, receive } from "../core/lamport-clock";
import type { LamportClock } from "../core/lamport-clock";
import { createDocManager, applyDocOperations, deleteDoc } from "../document/doc-manager";
import type { RecordOp } from "../document/record";
import type { CardApiState } from "./card-api";
import type { AwarenessState } from "../network/awareness";
import {
  missingOps,
  filterMissingOps,
  decodeStateVector,
} from "../network/state-vector";
import { getDoc } from "../document/doc-manager";
import { encodeRecordSnapshot } from "../document/snapshot";
import { bytesToBase64 } from "./base64";

// --- Public interfaces ---

export interface WSClient {
  readonly id: string;
  send(message: string): void;
}

export interface CRDTWebSocketHandler {
  handleOpen(params: { client: WSClient }): void;
  handleMessage(params: { client: WSClient; message: string }): void;
  handleClose(params: { client: WSClient }): void;

  broadcastDocOps(params: { docId: string; ops: ReadonlyArray<RecordOp> }): void;
  broadcastTx(params: { txId: string; docId: string; ops: ReadonlyArray<RecordOp> }): void;
  broadcastAwareness(params: { docId: string; clientId: string; state: AwarenessState }): void;
  broadcastSnapshot(params: { docId: string; snapshot: Uint8Array; version?: string }): void;

  getDocManagerState(): CardApiState;
  setDocManagerState(params: { state: CardApiState }): void;

  getDocOps(params: { docId: string }): ReadonlyArray<RecordOp>;
  appendDocOps(params: { docId: string; ops: ReadonlyArray<RecordOp> }): void;

  /** Snapshot the current state of a doc and clear its op history. */
  checkpointDoc(params: { docId: string }): void;
  /** Whether a checkpoint exists for a doc. */
  hasCheckpoint(params: { docId: string }): boolean;
  /** Completely clear in-memory state for a doc (record, ops, checkpoints, tx dedupe state). */
  resetDoc(params: { docId: string }): void;
}

// --- Internal per-client state ---

interface ClientState {
  readonly subscribedDocs: Set<string>;
}

// --- Factory ---

export function createCRDTWebSocketHandler(params?: {
  serverClientId?: string;
  onDocChanged?: (params: {
    docId: string;
    ops: ReadonlyArray<RecordOp>;
    txId?: string;
    source: "client" | "server";
  }) => void;
  onAwareness?: (params: { docId: string; clientId: string; state: AwarenessState }) => void;
}): CRDTWebSocketHandler {
  const serverClientId = params?.serverClientId ?? "server";
  const onDocChanged = params?.onDocChanged;
  const onAwareness = params?.onAwareness;

  // --- DocManager state (all documents) ---
  let docManagerState: CardApiState = {
    manager: createDocManager(),
    clock: createClock({ clientId: serverClientId }),
  };
  const allDocOps = new Map<string, Array<RecordOp>>();
  // Raw record snapshots (checkpoints). Encode only at JSON wire boundary.
  const docCheckpoints = new Map<string, Uint8Array>();
  const seenTxIdsByDoc = new Map<string, Map<string, number>>();
  const TX_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
  const TX_DEDUPE_MAX_PER_DOC = 4000;

  // --- Client tracking ---
  const clients = new Map<string, { client: WSClient; state: ClientState }>();

  function getOpsForDoc(docId: string): Array<RecordOp> {
    let ops = allDocOps.get(docId);
    if (!ops) {
      ops = [];
      allDocOps.set(docId, ops);
    }
    return ops;
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

  function broadcastDocOps(broadcastParams: {
    docId: string;
    ops: ReadonlyArray<RecordOp>;
    excludeClientId?: string;
  }): void {
    const opKey = broadcastParams.ops
      .map((op) => ("id" in op && op.id ? `${op.id.clientId}:${op.id.clock}` : "no-id"))
      .join("|");
    const txId = `${serverClientId}:server-broadcast:${broadcastParams.docId}:${opKey}`;
    const message = JSON.stringify({
      type: "tx",
      txId,
      docId: broadcastParams.docId,
      ops: broadcastParams.ops,
    });
    for (const [, entry] of clients) {
      if (
        entry.client.id !== broadcastParams.excludeClientId &&
        entry.state.subscribedDocs.has(broadcastParams.docId)
      ) {
        entry.client.send(message);
      }
    }
  }

  function broadcastTx(broadcastParams: {
    txId: string;
    docId: string;
    ops: ReadonlyArray<RecordOp>;
    excludeClientId?: string;
  }): void {
    const message = JSON.stringify({
      type: "tx",
      txId: broadcastParams.txId,
      docId: broadcastParams.docId,
      ops: broadcastParams.ops,
    });
    for (const [, entry] of clients) {
      if (
        entry.client.id !== broadcastParams.excludeClientId &&
        entry.state.subscribedDocs.has(broadcastParams.docId)
      ) {
        entry.client.send(message);
      }
    }
  }

  function broadcastAwareness(broadcastParams: {
    docId: string;
    clientId: string;
    state: AwarenessState;
    excludeClientId?: string;
  }): void {
    const message = JSON.stringify({
      type: "awareness",
      docId: broadcastParams.docId,
      clientId: broadcastParams.clientId,
      state: broadcastParams.state,
    });
    for (const [, entry] of clients) {
      if (
        entry.client.id !== broadcastParams.excludeClientId &&
        entry.state.subscribedDocs.has(broadcastParams.docId)
      ) {
        entry.client.send(message);
      }
    }
  }

  function broadcastSnapshot(broadcastParams: {
    docId: string;
    snapshot: Uint8Array;
    version?: string;
    excludeClientId?: string;
  }): void {
    const snapshotBase64 = bytesToBase64(broadcastParams.snapshot);
    const message = JSON.stringify({
      type: "snapshot",
      docId: broadcastParams.docId,
      snapshot: snapshotBase64,
      version: broadcastParams.version,
    });
    for (const [, entry] of clients) {
      if (
        entry.client.id !== broadcastParams.excludeClientId &&
        entry.state.subscribedDocs.has(broadcastParams.docId)
      ) {
        entry.client.send(message);
      }
    }
  }

  return {
    handleOpen({ client }) {
      clients.set(client.id, { client, state: { subscribedDocs: new Set() } });
      // No ops sent on connect — client must subscribe explicitly
    },

    handleMessage({ client, message: msgStr }) {
      const entry = clients.get(client.id);
      if (!entry) return;

      try {
        const parsed = JSON.parse(msgStr) as {
          type: string;
          ops?: Array<RecordOp>;
          txId?: string;
          stateVector?: string;
          docId?: string;
          clientId?: string;
          state?: AwarenessState;
        };

        if (!parsed.docId) return;

        const docId = parsed.docId;

        if (parsed.type === "subscribe") {
          entry.state.subscribedDocs.add(docId);

          const existingOps = allDocOps.get(docId) ?? [];
          const checkpoint = docCheckpoints.get(docId);

          if (parsed.stateVector && !checkpoint) {
            // Delta sync: compute missing ops (only when no checkpoint)
            const remoteStateVector = decodeStateVector({ data: parsed.stateVector });
            const record = getDoc({ manager: docManagerState.manager, docId });
            const localSV = record?.stateVector ?? new Map();
            const missing = missingOps({ local: localSV, remote: remoteStateVector });
            const deltaOps = filterMissingOps({ ops: existingOps, missing });

            client.send(JSON.stringify({
              type: "sync-response",
              docId,
              ops: deltaOps,
            }));
          } else if (checkpoint) {
            // Checkpoint exists — send snapshot + post-checkpoint ops
            client.send(JSON.stringify({
              type: "sync-response",
              docId,
              snapshot: bytesToBase64(checkpoint),
              ops: existingOps,
            }));
          } else {
            // No state vector, no checkpoint — send all ops as sync-response
            client.send(JSON.stringify({
              type: "sync-response",
              docId,
              ops: existingOps,
            }));
          }
          return;
        }

        if (parsed.type === "unsubscribe") {
          entry.state.subscribedDocs.delete(docId);
          seenTxIdsByDoc.delete(docId);
          return;
        }

        if (parsed.type === "tx" && typeof parsed.txId === "string" && Array.isArray(parsed.ops)) {
          if (!entry.state.subscribedDocs.has(docId)) {
            client.send(JSON.stringify({
              type: "protocol-error",
              code: "NOT_SUBSCRIBED",
              docId,
              message: "subscribe required before tx",
            }));
            return;
          }

          const ops = parsed.ops as ReadonlyArray<RecordOp>;
          const txId = parsed.txId;
          if (isDuplicateTx({ docId, txId })) {
            return;
          }

          docManagerState = {
            ...docManagerState,
            manager: applyDocOperations({
              manager: docManagerState.manager,
              docId,
              ops,
            }),
          };
          let maxRemoteClock: number | null = null;
          for (const op of ops) {
            if ("id" in op && op.id && typeof op.id.clock === "number") {
              if (maxRemoteClock === null || op.id.clock > maxRemoteClock) {
                maxRemoteClock = op.id.clock;
              }
            }
          }
          if (maxRemoteClock !== null) {
            docManagerState = {
              ...docManagerState,
              clock: receive({ clock: docManagerState.clock, remoteCounter: maxRemoteClock }),
            };
          }
          getOpsForDoc(docId).push(...ops);

          onDocChanged?.({ docId, txId, ops, source: "client" });

          broadcastTx({
            txId,
            docId,
            ops,
            excludeClientId: client.id,
          });
          return;
        }

        if (parsed.type === "awareness" && parsed.clientId && parsed.state) {
          if (!entry.state.subscribedDocs.has(docId)) {
            client.send(JSON.stringify({
              type: "protocol-error",
              code: "NOT_SUBSCRIBED",
              docId,
              message: "subscribe required before awareness",
            }));
            return;
          }
          onAwareness?.({ docId, clientId: parsed.clientId, state: parsed.state });
          broadcastAwareness({
            docId,
            clientId: parsed.clientId,
            state: parsed.state,
            excludeClientId: client.id,
          });
          return;
        }
      } catch {
        // Non-parseable messages — ignore
      }
    },

    handleClose({ client }) {
      const entry = clients.get(client.id);
      if (entry) {
        for (const docId of entry.state.subscribedDocs) {
          seenTxIdsByDoc.delete(docId);
        }
      }
      clients.delete(client.id);
    },

    broadcastDocOps({ docId, ops }) {
      broadcastDocOps({ docId, ops });
    },

    broadcastTx({ txId, docId, ops }) {
      broadcastTx({ txId, docId, ops });
    },

    broadcastAwareness({ docId, clientId: awarenessClientId, state }) {
      broadcastAwareness({ docId, clientId: awarenessClientId, state });
    },

    broadcastSnapshot({ docId, snapshot, version }) {
      broadcastSnapshot({ docId, snapshot, version });
    },

    getDocManagerState() {
      return docManagerState;
    },

    setDocManagerState({ state }) {
      docManagerState = state;
    },

    getDocOps({ docId }) {
      return allDocOps.get(docId) ?? [];
    },

    appendDocOps({ docId, ops }) {
      const existing = getOpsForDoc(docId);
      existing.push(...ops);
      onDocChanged?.({ docId, ops, source: "server" });
    },

    checkpointDoc({ docId }) {
      const record = getDoc({ manager: docManagerState.manager, docId });
      if (!record) return;

      const snapshotData = encodeRecordSnapshot({ record });
      docCheckpoints.set(docId, snapshotData);

      // Clear ops — the snapshot contains all state
      allDocOps.delete(docId);
    },

    hasCheckpoint({ docId }) {
      return docCheckpoints.has(docId);
    },

    resetDoc({ docId }) {
      docManagerState = {
        ...docManagerState,
        manager: deleteDoc({ manager: docManagerState.manager, docId }),
      };
      allDocOps.delete(docId);
      docCheckpoints.delete(docId);
      seenTxIdsByDoc.delete(docId);
    },
  };
}
