import type { CRDTDoc } from "./apply-operations";
import type { StateVector } from "../network/state-vector";
import type { Item } from "./item";

/**
 * Garbage collect tombstones that all known peers have seen.
 *
 * A tombstone is safe to collect only when ALL peers have fully synced
 * with our state — meaning every peer's state vector is >= our state vector
 * for every client. This ensures the delete operation (which has a different
 * ID than the item itself) has been seen by everyone.
 *
 * This is conservative but correct. The alternative (tracking which operation
 * deleted each item) adds complexity for marginal gain.
 */
export function collectGarbage(params: {
  doc: CRDTDoc;
  peerStateVectors: ReadonlyArray<StateVector>;
}): CRDTDoc {
  const { doc, peerStateVectors } = params;

  // Check if all peers are fully synced with our doc
  if (!allPeersSynced({ docSV: doc.stateVector, peerStateVectors })) {
    return doc; // Not safe to GC anything
  }

  const newItems: Array<Item> = [];
  const newMap = new Map<string, Item>();

  for (const item of doc.store.items) {
    if (item.deleted) {
      // Safe to remove — all peers have seen everything including the delete
      continue;
    }
    newItems.push(item);
    newMap.set(`${item.id.clientId}:${item.id.clock}`, item);
  }

  return {
    ...doc,
    store: {
      items: newItems,
      map: newMap,
      length: newItems.length,
    },
  };
}

function allPeersSynced(params: {
  docSV: StateVector;
  peerStateVectors: ReadonlyArray<StateVector>;
}): boolean {
  const { docSV, peerStateVectors } = params;

  for (const peerSV of peerStateVectors) {
    for (const [clientId, docClock] of docSV) {
      const peerClock = peerSV.get(clientId) ?? 0;
      if (peerClock < docClock) {
        return false;
      }
    }
  }

  return true;
}
