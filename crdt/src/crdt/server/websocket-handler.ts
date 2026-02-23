import { createClock, receive } from "../core/lamport-clock";
import type { LamportClock } from "../core/lamport-clock";
import { createDocManager, applyDocOperation } from "../document/doc-manager";
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
}

// --- Internal per-client state ---

interface ClientState {
  readonly subscribedDocs: Set<string>;
}

// --- Factory ---

export function createCRDTWebSocketHandler(params?: {
  serverClientId?: string;
  onDocChanged?: (params: { docId: string; ops: ReadonlyArray<RecordOp>; source: "client" | "server" }) => void;
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
  // Base64-encoded record snapshots (checkpoints)
  const docCheckpoints = new Map<string, string>();

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

  function broadcastDocOps(broadcastParams: {
    docId: string;
    ops: ReadonlyArray<RecordOp>;
    excludeClientId?: string;
  }): void {
    const message = JSON.stringify({
      type: "ops",
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
    const snapshotBase64 = btoa(String.fromCharCode(...broadcastParams.snapshot));
    const message = JSON.stringify({
      type: "sync-response",
      docId: broadcastParams.docId,
      snapshot: snapshotBase64,
      ops: [],
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
              snapshot: checkpoint,
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
          return;
        }

        if (parsed.type === "ops" && Array.isArray(parsed.ops)) {
          const ops = parsed.ops as ReadonlyArray<RecordOp>;

          // Apply ops to DocManager
          for (const op of ops) {
            docManagerState = {
              ...docManagerState,
              manager: applyDocOperation({
                manager: docManagerState.manager,
                docId,
                op,
              }),
            };
            // Sync server clock
            if ("id" in op && op.id && typeof op.id.clock === "number") {
              docManagerState = {
                ...docManagerState,
                clock: receive({ clock: docManagerState.clock, remoteCounter: op.id.clock }),
              };
            }
            getOpsForDoc(docId).push(op);
          }

          onDocChanged?.({ docId, ops, source: "client" });

          broadcastDocOps({
            docId,
            ops,
            excludeClientId: client.id,
          });
          return;
        }

        if (parsed.type === "awareness" && parsed.clientId && parsed.state) {
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
      clients.delete(client.id);
    },

    broadcastDocOps({ docId, ops }) {
      broadcastDocOps({ docId, ops });
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
      // Store as base64 for JSON serialization
      const base64 = btoa(String.fromCharCode(...snapshotData));
      docCheckpoints.set(docId, base64);

      // Clear ops — the snapshot contains all state
      allDocOps.delete(docId);
    },

    hasCheckpoint({ docId }) {
      return docCheckpoints.has(docId);
    },
  };
}
