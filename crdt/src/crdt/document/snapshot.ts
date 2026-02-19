import type { CRDTDoc } from "../core/apply-operations";
import { createEmptyDocument } from "../core/apply-operations";
import type { Item } from "../core/item";
import type { OperationId, Content, Mark } from "../core/operations";
import type { StateVector } from "../network/state-vector";
import { createStateVector } from "../network/state-vector";
import type { ClientId } from "../core/client-id";
import type { CRDTRecord } from "./record";
import type { LWWRegister } from "../core/lww-register";
import { createLWWRegister } from "../core/lww-register";
import type { ORSet, ORSetEntry } from "../core/or-set";

// --- Serializable types ---

interface SerializedItem {
  id: { clientId: string; clock: number };
  leftOrigin: { clientId: string; clock: number } | null;
  rightOrigin: { clientId: string; clock: number } | null;
  content: Content;
  deleted: boolean;
  marks?: ReadonlyArray<Mark>;
}

interface SerializedSnapshot {
  items: Array<SerializedItem>;
  stateVector: Record<string, number>;
  appliedOps: Array<string>;
}

// --- Encode ---

export function encodeSnapshot(params: { doc: CRDTDoc }): Uint8Array {
  const { doc } = params;

  const items: Array<SerializedItem> = doc.store.items.map((item) => ({
    id: { clientId: item.id.clientId, clock: item.id.clock },
    leftOrigin: item.leftOrigin
      ? { clientId: item.leftOrigin.clientId, clock: item.leftOrigin.clock }
      : null,
    rightOrigin: item.rightOrigin
      ? { clientId: item.rightOrigin.clientId, clock: item.rightOrigin.clock }
      : null,
    content: item.content,
    deleted: item.deleted,
    marks: item.marks,
  }));

  const sv: Record<string, number> = {};
  for (const [clientId, clock] of doc.stateVector) {
    sv[clientId] = clock;
  }

  const snapshot: SerializedSnapshot = {
    items,
    stateVector: sv,
    appliedOps: [...doc.appliedOps],
  };

  const encoder = new TextEncoder();
  return encoder.encode(JSON.stringify(snapshot));
}

// --- Decode ---

export function decodeSnapshot(params: { data: Uint8Array }): CRDTDoc {
  const decoder = new TextDecoder();
  const json = decoder.decode(params.data);
  const snapshot = JSON.parse(json) as SerializedSnapshot;

  // Rebuild item store
  const items: Array<Item> = snapshot.items.map((si) => ({
    id: si.id,
    leftOrigin: si.leftOrigin,
    rightOrigin: si.rightOrigin,
    content: si.content,
    deleted: si.deleted,
    marks: si.marks,
  }));

  const map = new Map<string, Item>();
  for (const item of items) {
    map.set(`${item.id.clientId}:${item.id.clock}`, item);
  }

  // Rebuild state vector
  const stateVector = new Map<ClientId, number>();
  for (const [clientId, clock] of Object.entries(snapshot.stateVector)) {
    stateVector.set(clientId, clock);
  }

  return {
    store: { items, map, length: items.length },
    appliedOps: new Set(snapshot.appliedOps),
    pendingDeletes: new Map(),
    pendingFormats: new Map(),
    pendingAttrUpdates: new Map(),
    pendingReparents: new Map(),
    stateVector,
  };
}

// --- Record Snapshot ---

interface SerializedFieldEntry {
  fieldName: string;
  value: string;
  timestamp: { clientId: string; clock: number };
}

interface SerializedSetEntry {
  fieldName: string;
  entryValue: string;
  id: { clientId: string; clock: number };
  removed: boolean;
}

interface SerializedRecordSnapshot {
  fields: Array<SerializedFieldEntry>;
  sets: Array<SerializedSetEntry>;
  bodyItems: Array<SerializedItem>;
  stateVector: Record<string, number>;
  appliedOps: Array<string>;
}

export function encodeRecordSnapshot(params: { record: CRDTRecord }): Uint8Array {
  const { record } = params;

  // Serialize fields
  const fields: Array<SerializedFieldEntry> = [];
  for (const [fieldName, reg] of record.fields) {
    fields.push({
      fieldName,
      value: reg.value,
      timestamp: { clientId: reg.timestamp.clientId, clock: reg.timestamp.clock },
    });
  }

  // Serialize sets (all entries including removed)
  const sets: Array<SerializedSetEntry> = [];
  for (const [fieldName, orSet] of record.sets) {
    for (const [, entries] of orSet.entries) {
      for (const entry of entries) {
        sets.push({
          fieldName,
          entryValue: String(entry.value),
          id: { clientId: entry.id.clientId, clock: entry.id.clock },
          removed: entry.removed,
        });
      }
    }
  }

  // Serialize body items
  const bodyItems: Array<SerializedItem> = record.body.store.items.map((item) => ({
    id: { clientId: item.id.clientId, clock: item.id.clock },
    leftOrigin: item.leftOrigin
      ? { clientId: item.leftOrigin.clientId, clock: item.leftOrigin.clock }
      : null,
    rightOrigin: item.rightOrigin
      ? { clientId: item.rightOrigin.clientId, clock: item.rightOrigin.clock }
      : null,
    content: item.content,
    deleted: item.deleted,
    marks: item.marks,
  }));

  // Serialize state vector
  const sv: Record<string, number> = {};
  for (const [clientId, clock] of record.stateVector) {
    sv[clientId] = clock;
  }

  const snapshot: SerializedRecordSnapshot = {
    fields,
    sets,
    bodyItems,
    stateVector: sv,
    appliedOps: [...record.appliedOps],
  };

  return new TextEncoder().encode(JSON.stringify(snapshot));
}

export function decodeRecordSnapshot(params: { data: Uint8Array }): CRDTRecord {
  const json = new TextDecoder().decode(params.data);
  const snapshot = JSON.parse(json) as SerializedRecordSnapshot;

  // Rebuild fields
  const fields = new Map<string, LWWRegister<string>>();
  for (const entry of snapshot.fields) {
    fields.set(entry.fieldName, createLWWRegister({
      value: entry.value,
      timestamp: entry.timestamp,
    }));
  }

  // Rebuild sets
  const sets = new Map<string, ORSet<string>>();
  for (const entry of snapshot.sets) {
    let orSet = sets.get(entry.fieldName);
    if (!orSet) {
      orSet = { entries: new Map() };
      sets.set(entry.fieldName, orSet);
    }
    const key = entry.entryValue;
    const existingEntries = orSet.entries.get(key) ?? [];
    const newEntry: ORSetEntry<string> = {
      value: entry.entryValue,
      id: entry.id,
      removed: entry.removed,
    };
    const newEntries = new Map(orSet.entries);
    newEntries.set(key, [...existingEntries, newEntry]);
    sets.set(entry.fieldName, { entries: newEntries });
  }

  // Rebuild body
  const bodyItems: Array<Item> = snapshot.bodyItems.map((si) => ({
    id: si.id,
    leftOrigin: si.leftOrigin,
    rightOrigin: si.rightOrigin,
    content: si.content,
    deleted: si.deleted,
    marks: si.marks,
  }));
  const bodyMap = new Map<string, Item>();
  for (const item of bodyItems) {
    bodyMap.set(`${item.id.clientId}:${item.id.clock}`, item);
  }
  const body: CRDTDoc = bodyItems.length > 0
    ? {
        store: { items: bodyItems, map: bodyMap, length: bodyItems.length },
        appliedOps: new Set<string>(),
        pendingDeletes: new Map(),
        pendingFormats: new Map(),
        pendingAttrUpdates: new Map(),
        pendingReparents: new Map(),
        stateVector: createStateVector(),
      }
    : createEmptyDocument();

  // Rebuild state vector
  const stateVector = new Map<ClientId, number>();
  for (const [clientId, clock] of Object.entries(snapshot.stateVector)) {
    stateVector.set(clientId, clock);
  }

  return {
    fields,
    sets,
    body,
    appliedOps: new Set(snapshot.appliedOps),
    stateVector,
  };
}
