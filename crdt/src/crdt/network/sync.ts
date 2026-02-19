import type { Operation } from "../core/operations";
import type { CRDTDoc } from "../core/apply-operations";
import { applyOperations } from "../core/apply-operations";
import {
  type StateVector,
  missingOps,
  encodeStateVector,
  decodeStateVector,
} from "./state-vector";

// --- Message types ---

export interface SyncStep1Message {
  readonly type: "sync-step-1";
  readonly stateVector: string; // encoded state vector
}

export interface SyncStep2Message {
  readonly type: "sync-step-2";
  readonly ops: ReadonlyArray<Operation>;
}

export type SyncMessage = SyncStep1Message | SyncStep2Message;

// --- Sync Engine ---

export interface SyncEngine {
  readonly doc: CRDTDoc;
}

export function createSyncEngine(params: { doc: CRDTDoc }): SyncEngine {
  return { doc: params.doc };
}

/**
 * Step 1: Generate a message containing our state vector.
 * Send this to the remote peer to tell them what we have.
 */
export function generateSyncStep1(params: {
  engine: SyncEngine;
}): SyncStep1Message {
  return {
    type: "sync-step-1",
    stateVector: encodeStateVector({ sv: params.engine.doc.stateVector }),
  };
}

/**
 * Receive a Step 1 message from a remote peer.
 * Compute what ops they're missing and return a Step 2 message.
 */
export function receiveSyncStep1(params: {
  engine: SyncEngine;
  message: SyncStep1Message;
  allOps: ReadonlyArray<Operation>;
}): SyncStep2Message {
  const remoteStateVector = decodeStateVector({ data: params.message.stateVector });
  const missing = missingOps({
    local: params.engine.doc.stateVector,
    remote: remoteStateVector,
  });

  // Filter allOps to only include ones in the missing ranges
  const opsToSend: Array<Operation> = [];
  for (const op of params.allOps) {
    for (const range of missing) {
      if (
        op.id.clientId === range.clientId &&
        op.id.clock >= range.from &&
        op.id.clock <= range.to
      ) {
        opsToSend.push(op);
        break;
      }
    }
  }

  return {
    type: "sync-step-2",
    ops: opsToSend,
  };
}

/**
 * Receive a Step 2 message from a remote peer.
 * Apply the missing operations to our document.
 */
export function receiveSyncStep2(params: {
  doc: CRDTDoc;
  message: SyncStep2Message;
}): { doc: CRDTDoc } {
  const doc = applyOperations({ doc: params.doc, ops: params.message.ops });
  return { doc };
}

/**
 * Convenience: full bidirectional sync between two documents.
 */
export function fullSync(params: {
  docA: CRDTDoc;
  opsA: ReadonlyArray<Operation>;
  docB: CRDTDoc;
  opsB: ReadonlyArray<Operation>;
}): { docA: CRDTDoc; docB: CRDTDoc } {
  const engineA = createSyncEngine({ doc: params.docA });
  const engineB = createSyncEngine({ doc: params.docB });

  // A → B: B tells A what it has, A sends missing ops
  const step1FromB = generateSyncStep1({ engine: engineB });
  const step2FromA = receiveSyncStep1({
    engine: engineA,
    message: step1FromB,
    allOps: params.opsA,
  });
  const resultB = receiveSyncStep2({ doc: params.docB, message: step2FromA });

  // B → A: A tells B what it has, B sends missing ops
  const step1FromA = generateSyncStep1({ engine: engineA });
  const step2FromB = receiveSyncStep1({
    engine: createSyncEngine({ doc: resultB.doc }),
    message: step1FromA,
    allOps: params.opsB,
  });
  const resultA = receiveSyncStep2({ doc: params.docA, message: step2FromB });

  return { docA: resultA.doc, docB: resultB.doc };
}
