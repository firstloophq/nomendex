import type { CRDTDoc } from "../core/apply-operations";
import { createEmptyDocument } from "../core/apply-operations";
import type { Item, ItemStore } from "../core/item";
import { integrateItem } from "../core/item";
import type { OperationId, Content, Mark } from "../core/operations";
import type { StateVector } from "../network/state-vector";
import { createStateVector, missingOps, type MissingRange } from "../network/state-vector";
import type { ClientId } from "../core/client-id";
import type { CRDTRecord } from "./record";
import type { LWWRegister } from "../core/lww-register";
import { createLWWRegister } from "../core/lww-register";
import type { ORSet, ORSetEntry } from "../core/or-set";
import { compareTimestamps } from "../core/lamport-clock";

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

// --- Snapshot Merge + Version Helpers ---

export type SnapshotMergeBias = "local" | "remote";

type AttrValue = string | number | boolean | null;

function opIdKey(id: OperationId): string {
  return `${id.clientId}:${id.clock}`;
}

function cloneOperationId(id: OperationId): OperationId {
  return { clientId: id.clientId, clock: id.clock };
}

function cloneNullableOperationId(id: OperationId | null): OperationId | null {
  return id ? cloneOperationId(id) : null;
}

function cloneMark(mark: Mark): Mark {
  if (mark.attrs === undefined) {
    return { type: mark.type };
  }
  return {
    type: mark.type,
    attrs: { ...mark.attrs },
  };
}

function cloneMarks(marks?: ReadonlyArray<Mark>): ReadonlyArray<Mark> | undefined {
  if (marks === undefined) return undefined;
  return marks.map(cloneMark);
}

function cloneContent(content: Content): Content {
  if (content.type === "text") {
    return { type: "text", value: content.value };
  }

  if (content.type === "inline_atom") {
    if (content.attrs === undefined) {
      return { type: "inline_atom", nodeType: content.nodeType };
    }
    return {
      type: "inline_atom",
      nodeType: content.nodeType,
      attrs: { ...content.attrs },
    };
  }

  const out: {
    type: "block";
    blockType: string;
    attrs?: Record<string, AttrValue>;
    parentBlockId?: OperationId;
  } = {
    type: "block",
    blockType: content.blockType,
  };
  if (content.attrs !== undefined) {
    out.attrs = { ...content.attrs };
  }
  if (content.parentBlockId !== undefined) {
    out.parentBlockId = cloneOperationId(content.parentBlockId);
  }
  return out;
}

function cloneItem(item: Item): Item {
  const out: Item = {
    id: cloneOperationId(item.id),
    leftOrigin: cloneNullableOperationId(item.leftOrigin),
    rightOrigin: cloneNullableOperationId(item.rightOrigin),
    content: cloneContent(item.content),
    deleted: item.deleted,
  };
  const marks = cloneMarks(item.marks);
  if (marks !== undefined) {
    return { ...out, marks };
  }
  return out;
}

function mergeStateVectors(params: {
  local: StateVector;
  remote: StateVector;
}): StateVector {
  const merged = new Map<ClientId, number>();
  for (const [clientId, clock] of params.local) {
    merged.set(clientId, clock);
  }
  for (const [clientId, clock] of params.remote) {
    const current = merged.get(clientId) ?? 0;
    if (clock > current) {
      merged.set(clientId, clock);
    }
  }
  return merged;
}

function mergeAttrs(params: {
  preferred?: Record<string, AttrValue>;
  other?: Record<string, AttrValue>;
}): Record<string, AttrValue> | undefined {
  if (params.preferred === undefined && params.other === undefined) {
    return undefined;
  }
  return {
    ...(params.other ?? {}),
    ...(params.preferred ?? {}),
  };
}

function mergeContent(params: {
  preferred: Content;
  other: Content;
}): Content {
  const { preferred, other } = params;
  if (preferred.type !== other.type) {
    return cloneContent(preferred);
  }

  if (preferred.type === "text") {
    return cloneContent(preferred);
  }

  if (preferred.type === "inline_atom") {
    if (other.type !== "inline_atom") {
      return cloneContent(preferred);
    }
    const attrs = mergeAttrs({
      preferred: preferred.attrs,
      other: other.attrs,
    });
    if (attrs === undefined) {
      return {
        type: "inline_atom",
        nodeType: preferred.nodeType,
      };
    }
    return {
      type: "inline_atom",
      nodeType: preferred.nodeType,
      attrs,
    };
  }

  if (other.type !== "block") {
    return cloneContent(preferred);
  }
  const attrs = mergeAttrs({
    preferred: preferred.attrs,
    other: other.attrs,
  });
  const parent = preferred.parentBlockId ?? other.parentBlockId;
  const out: {
    type: "block";
    blockType: string;
    attrs?: Record<string, AttrValue>;
    parentBlockId?: OperationId;
  } = {
    type: "block",
    blockType: preferred.blockType,
  };
  if (attrs !== undefined) {
    out.attrs = attrs;
  }
  if (parent !== undefined) {
    out.parentBlockId = cloneOperationId(parent);
  }
  return out;
}

function mergeItemPair(params: {
  local: Item;
  remote: Item;
  bias: SnapshotMergeBias;
}): Item {
  const preferred = params.bias === "remote" ? params.remote : params.local;
  const other = params.bias === "remote" ? params.local : params.remote;

  const marks = cloneMarks(preferred.marks ?? other.marks);
  const out: Item = {
    id: cloneOperationId(preferred.id),
    leftOrigin: cloneNullableOperationId(preferred.leftOrigin ?? other.leftOrigin),
    rightOrigin: cloneNullableOperationId(preferred.rightOrigin ?? other.rightOrigin),
    content: mergeContent({ preferred: preferred.content, other: other.content }),
    deleted: params.local.deleted || params.remote.deleted,
  };
  if (marks !== undefined) {
    return { ...out, marks };
  }
  return out;
}

function mergePendingArrays<T>(params: {
  preferred: ReadonlyArray<T>;
  other: ReadonlyArray<T>;
}): ReadonlyArray<T> {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const value of params.preferred) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }
  for (const value of params.other) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }
  return merged;
}

function cloneORSet(set: ORSet<string>): ORSet<string> {
  const entries = new Map<string, ReadonlyArray<ORSetEntry<string>>>();
  for (const [value, valueEntries] of set.entries) {
    entries.set(value, valueEntries.map((entry) => ({
      value: entry.value,
      id: cloneOperationId(entry.id),
      removed: entry.removed,
    })));
  }
  return { entries };
}

function mergeORSet(params: {
  local?: ORSet<string>;
  remote?: ORSet<string>;
}): ORSet<string> {
  if (!params.local && !params.remote) {
    return { entries: new Map() };
  }
  if (!params.local) return cloneORSet(params.remote!);
  if (!params.remote) return cloneORSet(params.local);

  const mergedByValue = new Map<string, Map<string, ORSetEntry<string>>>();

  function addEntries(set: ORSet<string>) {
    for (const [value, entries] of set.entries) {
      const byId = mergedByValue.get(value) ?? new Map<string, ORSetEntry<string>>();
      for (const entry of entries) {
        const idKey = opIdKey(entry.id);
        const existing = byId.get(idKey);
        if (existing) {
          byId.set(idKey, {
            ...existing,
            removed: existing.removed || entry.removed,
          });
        } else {
          byId.set(idKey, {
            value: entry.value,
            id: cloneOperationId(entry.id),
            removed: entry.removed,
          });
        }
      }
      mergedByValue.set(value, byId);
    }
  }

  addEntries(params.local);
  addEntries(params.remote);

  const entries = new Map<string, ReadonlyArray<ORSetEntry<string>>>();
  for (const [value, byId] of mergedByValue) {
    const valueEntries = [...byId.values()].sort((a, b) => {
      const clockDiff = a.id.clock - b.id.clock;
      if (clockDiff !== 0) return clockDiff;
      if (a.id.clientId < b.id.clientId) return -1;
      if (a.id.clientId > b.id.clientId) return 1;
      return 0;
    });
    entries.set(value, valueEntries);
  }

  return { entries };
}

function mergeFields(params: {
  local: CRDTRecord;
  remote: CRDTRecord;
}): ReadonlyMap<string, LWWRegister<string>> {
  const fieldNames = new Set<string>([
    ...params.local.fields.keys(),
    ...params.remote.fields.keys(),
  ]);
  const merged = new Map<string, LWWRegister<string>>();

  for (const fieldName of fieldNames) {
    const local = params.local.fields.get(fieldName);
    const remote = params.remote.fields.get(fieldName);
    if (local && remote) {
      const cmp = compareTimestamps({ a: remote.timestamp, b: local.timestamp });
      const winner = cmp >= 0 ? remote : local;
      merged.set(fieldName, createLWWRegister({
        value: winner.value,
        timestamp: { clientId: winner.timestamp.clientId, clock: winner.timestamp.clock },
      }));
    } else if (local) {
      merged.set(fieldName, createLWWRegister({
        value: local.value,
        timestamp: { clientId: local.timestamp.clientId, clock: local.timestamp.clock },
      }));
    } else if (remote) {
      merged.set(fieldName, createLWWRegister({
        value: remote.value,
        timestamp: { clientId: remote.timestamp.clientId, clock: remote.timestamp.clock },
      }));
    }
  }

  return merged;
}

function mergeSets(params: {
  local: CRDTRecord;
  remote: CRDTRecord;
}): ReadonlyMap<string, ORSet<string>> {
  const fieldNames = new Set<string>([
    ...params.local.sets.keys(),
    ...params.remote.sets.keys(),
  ]);
  const merged = new Map<string, ORSet<string>>();

  for (const fieldName of fieldNames) {
    merged.set(fieldName, mergeORSet({
      local: params.local.sets.get(fieldName),
      remote: params.remote.sets.get(fieldName),
    }));
  }

  return merged;
}

function mergeBodyDocs(params: {
  local: CRDTDoc;
  remote: CRDTDoc;
  bias: SnapshotMergeBias;
}): CRDTDoc {
  const preferred = params.bias === "remote" ? params.remote : params.local;
  const secondary = params.bias === "remote" ? params.local : params.remote;

  const localByKey = new Map(params.local.store.items.map((item) => [opIdKey(item.id), item]));
  const remoteByKey = new Map(params.remote.store.items.map((item) => [opIdKey(item.id), item]));

  const preferredItems = preferred.store.items.map((item) => {
    const key = opIdKey(item.id);
    const local = localByKey.get(key);
    const remote = remoteByKey.get(key);
    if (local && remote) {
      return mergeItemPair({ local, remote, bias: params.bias });
    }
    return cloneItem(item);
  });

  const preferredMap = new Map<string, Item>();
  for (const item of preferredItems) {
    preferredMap.set(opIdKey(item.id), item);
  }

  let mergedStore: ItemStore = {
    items: preferredItems,
    map: preferredMap,
    length: preferredItems.length,
  };

  for (const item of secondary.store.items) {
    const key = opIdKey(item.id);
    if (mergedStore.map.has(key)) continue;
    mergedStore = integrateItem({ store: mergedStore, item: cloneItem(item) });
  }

  const pendingDeletes = new Map<string, OperationId>();
  for (const [key, value] of preferred.pendingDeletes) {
    pendingDeletes.set(key, cloneOperationId(value));
  }
  for (const [key, value] of secondary.pendingDeletes) {
    if (!pendingDeletes.has(key)) {
      pendingDeletes.set(key, cloneOperationId(value));
    }
  }

  const pendingFormats = new Map(preferred.pendingFormats);
  for (const [key, value] of secondary.pendingFormats) {
    const existing = pendingFormats.get(key) ?? [];
    pendingFormats.set(key, mergePendingArrays({
      preferred: existing,
      other: value,
    }));
  }

  const pendingAttrUpdates = new Map(preferred.pendingAttrUpdates);
  for (const [key, value] of secondary.pendingAttrUpdates) {
    const existing = pendingAttrUpdates.get(key) ?? [];
    pendingAttrUpdates.set(key, mergePendingArrays({
      preferred: existing,
      other: value,
    }));
  }

  const pendingReparents = new Map(preferred.pendingReparents);
  for (const [key, value] of secondary.pendingReparents) {
    const existing = pendingReparents.get(key) ?? [];
    pendingReparents.set(key, mergePendingArrays({
      preferred: existing,
      other: value,
    }));
  }

  return {
    store: mergedStore,
    appliedOps: new Set([
      ...params.local.appliedOps,
      ...params.remote.appliedOps,
    ]),
    pendingDeletes,
    pendingFormats,
    pendingAttrUpdates,
    pendingReparents,
    stateVector: mergeStateVectors({
      local: params.local.stateVector,
      remote: params.remote.stateVector,
    }),
  };
}

function toRecord(input: CRDTRecord | Uint8Array): CRDTRecord {
  if (input instanceof Uint8Array) {
    return decodeRecordSnapshot({ data: input });
  }
  return input;
}

export function mergeRecordSnapshots(params: {
  local: CRDTRecord | Uint8Array;
  remote: CRDTRecord | Uint8Array;
  bias?: SnapshotMergeBias;
}): CRDTRecord {
  const bias = params.bias ?? "remote";
  const local = toRecord(params.local);
  const remote = toRecord(params.remote);

  return {
    fields: mergeFields({ local, remote }),
    sets: mergeSets({ local, remote }),
    body: mergeBodyDocs({
      local: local.body,
      remote: remote.body,
      bias,
    }),
    appliedOps: new Set([
      ...local.appliedOps,
      ...remote.appliedOps,
    ]),
    stateVector: mergeStateVectors({
      local: local.stateVector,
      remote: remote.stateVector,
    }),
  };
}

const FNV1A_64_OFFSET = 0xcbf29ce484222325n;
const FNV1A_64_PRIME = 0x100000001b3n;
const FNV1A_64_MASK = 0xffffffffffffffffn;

function fnv1a64Hex(data: Uint8Array): string {
  let hash = FNV1A_64_OFFSET;
  for (const byte of data) {
    hash ^= BigInt(byte);
    hash = (hash * FNV1A_64_PRIME) & FNV1A_64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Deterministic version for optimistic CAS checks on snapshot writes.
 */
export function getRecordSnapshotVersion(params: {
  data: Uint8Array;
}): string {
  return `fnv1a64:${fnv1a64Hex(params.data)}`;
}

export function isRecordSnapshotVersion(params: {
  data: Uint8Array;
  expectedVersion: string;
}): boolean {
  return getRecordSnapshotVersion({ data: params.data }) === params.expectedVersion;
}

export function getRecordSnapshotStateVector(params: {
  data: Uint8Array;
}): StateVector {
  return decodeRecordSnapshot({ data: params.data }).stateVector;
}

export function missingFromRecordSnapshot(params: {
  data: Uint8Array;
  remoteStateVector: StateVector;
}): ReadonlyArray<MissingRange> {
  return missingOps({
    local: getRecordSnapshotStateVector({ data: params.data }),
    remote: params.remoteStateVector,
  });
}
