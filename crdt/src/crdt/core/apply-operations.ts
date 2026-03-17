import type { Operation, OperationId, Mark, BlockContent, InsertOp, DeleteOp, DeleteBatchOp } from "./operations";
import { operationIdEquals } from "./operations";
import {
  createItem,
  createItemStore,
  integrateItem,
  deleteItem,
  getVisibleContent,
  getItemById,
  type ItemStore,
  type Item,
} from "./item";
import { compareTimestamps } from "./lamport-clock";
import {
  createStateVector,
  updateStateVector,
  type StateVector,
} from "../network/state-vector";

// --- Pending attr updates ---

interface PendingAttrUpdate {
  readonly attr: string;
  readonly value: string | number | boolean | null;
}

// --- Pending reparents ---

interface PendingReparent {
  readonly newParentBlockId: OperationId | null;
}

// --- CRDTDoc ---
// A flat document that is a single CRDT sequence of items.
// For the operation-level layer, we work with a flat list.
// The document model (T-006) adds tree structure on top.

export interface CRDTDoc {
  readonly store: ItemStore;
  readonly appliedOps: ReadonlySet<string>; // set of "clientId:clock" for idempotency
  readonly pendingDeletes: ReadonlyMap<string, OperationId>; // deletes for items not yet inserted
  readonly pendingFormats: ReadonlyMap<string, ReadonlyArray<{ mark: Mark; action: "add" | "remove" }>>;
  readonly pendingAttrUpdates: ReadonlyMap<string, ReadonlyArray<PendingAttrUpdate>>;
  readonly pendingReparents: ReadonlyMap<string, ReadonlyArray<PendingReparent>>;
  readonly stateVector: StateVector;
}

function opKey(id: OperationId): string {
  return `${id.clientId}:${id.clock}`;
}

export function createEmptyDocument(): CRDTDoc {
  return {
    store: createItemStore(),
    appliedOps: new Set(),
    pendingDeletes: new Map(),
    pendingFormats: new Map(),
    pendingAttrUpdates: new Map(),
    pendingReparents: new Map(),
    stateVector: createStateVector(),
  };
}

export function applyOperation(params: {
  doc: CRDTDoc;
  op: Operation;
}): CRDTDoc {
  const { doc, op } = params;
  const key = opKey(op.id);

  // Idempotency: skip if already applied
  if (doc.appliedOps.has(key)) return doc;

  const newAppliedOps = new Set(doc.appliedOps);
  newAppliedOps.add(key);

  const newSV = updateStateVector({
    sv: doc.stateVector,
    clientId: op.id.clientId,
    clock: op.id.clock,
  });

  switch (op.type) {
    case "insert": {
      // Compute both origins from parentId/side + optional secondParentId.
      // parentId is always the primary anchor. secondParentId (when present)
      // provides the opposite boundary, bounding integrateItem's scan range
      // and preventing high-clock items from sliding past sequential chains.
      const leftOrigin = op.side === "right"
        ? op.parentId
        : (op.secondParentId ?? null);
      const rightOrigin = op.side === "left"
        ? op.parentId
        : (op.secondParentId ?? null);

      const item = createItem({
        id: op.id,
        leftOrigin,
        rightOrigin,
        content: op.content,
        deleted: false,
        marks: op.marks ? [...op.marks] : undefined,
      });

      let newStore = integrateItem({ store: doc.store, item });

      // Check for pending deletes on this item
      const targetKey = opKey(op.id);
      let newPendingDeletes: ReadonlyMap<string, OperationId> = doc.pendingDeletes;
      if (doc.pendingDeletes.has(targetKey)) {
        newStore = deleteItem({ store: newStore, targetId: op.id });
        const mutableDeletes = new Map(doc.pendingDeletes);
        mutableDeletes.delete(targetKey);
        newPendingDeletes = mutableDeletes;
      }

      // Check for pending formats on this item
      let newPendingFormats: ReadonlyMap<string, ReadonlyArray<{ mark: Mark; action: "add" | "remove" }>> = doc.pendingFormats;
      if (doc.pendingFormats.has(targetKey)) {
        const formats = doc.pendingFormats.get(targetKey)!;
        for (const fmt of formats) {
          newStore = applyFormat({
            store: newStore,
            targetId: op.id,
            mark: fmt.mark,
            action: fmt.action,
          });
        }
        const mutableFormats = new Map(doc.pendingFormats);
        mutableFormats.delete(targetKey);
        newPendingFormats = mutableFormats;
      }

      // Check for pending attr updates on this item
      let newPendingAttrUpdates: ReadonlyMap<string, ReadonlyArray<PendingAttrUpdate>> = doc.pendingAttrUpdates;
      if (doc.pendingAttrUpdates.has(targetKey)) {
        const attrUpdates = doc.pendingAttrUpdates.get(targetKey)!;
        for (const upd of attrUpdates) {
          newStore = applyAttrUpdate({
            store: newStore,
            targetId: op.id,
            attr: upd.attr,
            value: upd.value,
          });
        }
        const mutableAttrUpdates = new Map(doc.pendingAttrUpdates);
        mutableAttrUpdates.delete(targetKey);
        newPendingAttrUpdates = mutableAttrUpdates;
      }

      // Check for pending reparents on this item
      let newPendingReparents: ReadonlyMap<string, ReadonlyArray<PendingReparent>> = doc.pendingReparents;
      if (doc.pendingReparents.has(targetKey)) {
        const reparents = doc.pendingReparents.get(targetKey)!;
        for (const rep of reparents) {
          newStore = applyReparent({
            store: newStore,
            targetId: op.id,
            newParentBlockId: rep.newParentBlockId,
          });
        }
        const mutableReparents = new Map(doc.pendingReparents);
        mutableReparents.delete(targetKey);
        newPendingReparents = mutableReparents;
      }

      return {
        store: newStore,
        appliedOps: newAppliedOps,
        pendingDeletes: newPendingDeletes,
        pendingFormats: newPendingFormats,
        pendingAttrUpdates: newPendingAttrUpdates,
        pendingReparents: newPendingReparents,
        stateVector: newSV,
      };
    }
    case "delete": {
      const existing = getItemById({ store: doc.store, id: op.targetId });
      if (existing) {
        return {
          store: deleteItem({ store: doc.store, targetId: op.targetId }),
          appliedOps: newAppliedOps,
          pendingDeletes: doc.pendingDeletes,
          pendingFormats: doc.pendingFormats,
          pendingAttrUpdates: doc.pendingAttrUpdates,
          pendingReparents: doc.pendingReparents,
          stateVector: newSV,
        };
      }
      // Item not yet inserted — store as pending
      const newPendingDeletes = new Map(doc.pendingDeletes);
      newPendingDeletes.set(opKey(op.targetId), op.targetId);
      return {
        store: doc.store,
        appliedOps: newAppliedOps,
        pendingDeletes: newPendingDeletes,
        pendingFormats: doc.pendingFormats,
        pendingAttrUpdates: doc.pendingAttrUpdates,
        pendingReparents: doc.pendingReparents,
        stateVector: newSV,
      };
    }
    case "delete_batch": {
      let pendingDeletes: ReadonlyMap<string, OperationId> = doc.pendingDeletes;
      let pendingDeletesChanged = false;

      const targetKeys = new Set<string>();
      for (const targetId of op.targetIds) {
        targetKeys.add(opKey(targetId));
      }

      let storeChanged = false;
      const newItems = doc.store.items.map((item) => {
        const keyItem = opKey(item.id);
        if (!targetKeys.has(keyItem) || item.deleted) {
          return item;
        }
        storeChanged = true;
        return { ...item, deleted: true } satisfies Item;
      });

      for (const targetId of op.targetIds) {
        const targetKey = opKey(targetId);
        if (doc.store.map.has(targetKey)) continue;
        if (!pendingDeletesChanged) {
          pendingDeletes = new Map(doc.pendingDeletes);
          pendingDeletesChanged = true;
        }
        (pendingDeletes as Map<string, OperationId>).set(targetKey, targetId);
      }

      let store: ItemStore = doc.store;
      if (storeChanged) {
        const newMap = new Map<string, Item>();
        for (const item of newItems) {
          newMap.set(opKey(item.id), item);
        }
        store = {
          items: newItems,
          map: newMap,
          length: newItems.length,
        };
      }

      return {
        store,
        appliedOps: newAppliedOps,
        pendingDeletes,
        pendingFormats: doc.pendingFormats,
        pendingAttrUpdates: doc.pendingAttrUpdates,
        pendingReparents: doc.pendingReparents,
        stateVector: newSV,
      };
    }
    case "format": {
      const existing = getItemById({ store: doc.store, id: op.targetId });
      if (existing) {
        return {
          store: applyFormat({
            store: doc.store,
            targetId: op.targetId,
            mark: op.mark,
            action: op.action,
          }),
          appliedOps: newAppliedOps,
          pendingDeletes: doc.pendingDeletes,
          pendingFormats: doc.pendingFormats,
          pendingAttrUpdates: doc.pendingAttrUpdates,
          pendingReparents: doc.pendingReparents,
          stateVector: newSV,
        };
      }
      // Item not yet inserted — store as pending
      const targetKeyFmt = opKey(op.targetId);
      const newPendingFormats = new Map(doc.pendingFormats);
      const existing2 = newPendingFormats.get(targetKeyFmt) ?? [];
      newPendingFormats.set(targetKeyFmt, [
        ...existing2,
        { mark: op.mark, action: op.action },
      ]);
      return {
        store: doc.store,
        appliedOps: newAppliedOps,
        pendingDeletes: doc.pendingDeletes,
        pendingFormats: newPendingFormats,
        pendingAttrUpdates: doc.pendingAttrUpdates,
        pendingReparents: doc.pendingReparents,
        stateVector: newSV,
      };
    }
    case "attr_update": {
      const existing = getItemById({ store: doc.store, id: op.targetId });
      if (existing) {
        return {
          store: applyAttrUpdate({
            store: doc.store,
            targetId: op.targetId,
            attr: op.attr,
            value: op.value,
          }),
          appliedOps: newAppliedOps,
          pendingDeletes: doc.pendingDeletes,
          pendingFormats: doc.pendingFormats,
          pendingAttrUpdates: doc.pendingAttrUpdates,
          pendingReparents: doc.pendingReparents,
          stateVector: newSV,
        };
      }
      // Item not yet inserted — store as pending
      const targetKeyAttr = opKey(op.targetId);
      const newPendingAttrUpdates = new Map(doc.pendingAttrUpdates);
      const existingAttr = newPendingAttrUpdates.get(targetKeyAttr) ?? [];
      newPendingAttrUpdates.set(targetKeyAttr, [
        ...existingAttr,
        { attr: op.attr, value: op.value },
      ]);
      return {
        store: doc.store,
        appliedOps: newAppliedOps,
        pendingDeletes: doc.pendingDeletes,
        pendingFormats: doc.pendingFormats,
        pendingAttrUpdates: newPendingAttrUpdates,
        pendingReparents: doc.pendingReparents,
        stateVector: newSV,
      };
    }
    case "reparent": {
      const existing = getItemById({ store: doc.store, id: op.targetId });
      if (existing) {
        return {
          store: applyReparent({
            store: doc.store,
            targetId: op.targetId,
            newParentBlockId: op.newParentBlockId,
          }),
          appliedOps: newAppliedOps,
          pendingDeletes: doc.pendingDeletes,
          pendingFormats: doc.pendingFormats,
          pendingAttrUpdates: doc.pendingAttrUpdates,
          pendingReparents: doc.pendingReparents,
          stateVector: newSV,
        };
      }
      // Item not yet inserted — store as pending
      const targetKeyRep = opKey(op.targetId);
      const newPendingReparents = new Map(doc.pendingReparents);
      const existingRep = newPendingReparents.get(targetKeyRep) ?? [];
      newPendingReparents.set(targetKeyRep, [
        ...existingRep,
        { newParentBlockId: op.newParentBlockId },
      ]);
      return {
        store: doc.store,
        appliedOps: newAppliedOps,
        pendingDeletes: doc.pendingDeletes,
        pendingFormats: doc.pendingFormats,
        pendingAttrUpdates: doc.pendingAttrUpdates,
        pendingReparents: newPendingReparents,
        stateVector: newSV,
      };
    }
  }
}

function applyFormat(params: {
  store: ItemStore;
  targetId: OperationId;
  mark: Mark;
  action: "add" | "remove";
}): ItemStore {
  const key = `${params.targetId.clientId}:${params.targetId.clock}`;
  const item = params.store.map.get(key);
  if (!item) return params.store;

  const currentMarks = item.marks ? [...item.marks] : [];

  let newMarks: Array<Mark>;
  if (params.action === "add") {
    // Add if not already present
    const exists = currentMarks.some((m) => m.type === params.mark.type);
    newMarks = exists ? currentMarks : [...currentMarks, params.mark];
  } else {
    // Remove
    newMarks = currentMarks.filter((m) => m.type !== params.mark.type);
  }

  const updated: Item = { ...item, marks: newMarks };
  const newItems = params.store.items.map((i) =>
    operationIdEquals({ a: i.id, b: params.targetId }) ? updated : i
  );
  const newMap = new Map(params.store.map);
  newMap.set(key, updated);

  return { items: newItems, map: newMap, length: params.store.length };
}

function applyAttrUpdate(params: {
  store: ItemStore;
  targetId: OperationId;
  attr: string;
  value: string | number | boolean | null;
}): ItemStore {
  const key = `${params.targetId.clientId}:${params.targetId.clock}`;
  const item = params.store.map.get(key);
  if (!item) return params.store;

  // Only applicable to block and inline_atom content types
  if (item.content.type !== "block" && item.content.type !== "inline_atom") return params.store;

  const currentAttrs = item.content.attrs ?? {};
  const newAttrs = { ...currentAttrs, [params.attr]: params.value };
  const newContent = { ...item.content, attrs: newAttrs } as BlockContent;
  const updated: Item = { ...item, content: newContent };

  const newItems = params.store.items.map((i) =>
    operationIdEquals({ a: i.id, b: params.targetId }) ? updated : i
  );
  const newMap = new Map(params.store.map);
  newMap.set(key, updated);

  return { items: newItems, map: newMap, length: params.store.length };
}

function applyReparent(params: {
  store: ItemStore;
  targetId: OperationId;
  newParentBlockId: OperationId | null;
}): ItemStore {
  const key = `${params.targetId.clientId}:${params.targetId.clock}`;
  const item = params.store.map.get(key);
  if (!item) return params.store;

  // Only applicable to block content
  if (item.content.type !== "block") return params.store;

  const newContent: BlockContent = {
    ...item.content,
    parentBlockId: params.newParentBlockId ?? undefined,
  };
  const updated: Item = { ...item, content: newContent };

  const newItems = params.store.items.map((i) =>
    operationIdEquals({ a: i.id, b: params.targetId }) ? updated : i
  );
  const newMap = new Map(params.store.map);
  newMap.set(key, updated);

  return { items: newItems, map: newMap, length: params.store.length };
}

export function applyOperations(params: {
  doc: CRDTDoc;
  ops: ReadonlyArray<Operation>;
}): CRDTDoc {
  if (params.ops.length === 1 && params.ops[0]?.type === "delete_batch") {
    return applyDeleteTargetsBatchFastPath({
      doc: params.doc,
      op: params.ops[0],
    });
  }
  if (canUseInsertBatchFastPath({ doc: params.doc, ops: params.ops })) {
    return applyInsertBatchFastPath({
      doc: params.doc,
      ops: params.ops as ReadonlyArray<InsertOp>,
    });
  }
  if (canUseDeleteBatchFastPath({ ops: params.ops })) {
    return applyDeleteBatchFastPath({
      doc: params.doc,
      ops: params.ops as ReadonlyArray<DeleteOp>,
    });
  }

  let doc = params.doc;
  for (const op of params.ops) {
    doc = applyOperation({ doc, op });
  }
  return doc;
}

function canUseInsertBatchFastPath(params: {
  doc: CRDTDoc;
  ops: ReadonlyArray<Operation>;
}): boolean {
  if (params.ops.length < 128) return false;
  if (params.ops.some((op) => op.type !== "insert")) return false;
  if (
    params.doc.pendingDeletes.size > 0
    || params.doc.pendingFormats.size > 0
    || params.doc.pendingAttrUpdates.size > 0
    || params.doc.pendingReparents.size > 0
  ) {
    return false;
  }
  return true;
}

function canUseDeleteBatchFastPath(params: {
  ops: ReadonlyArray<Operation>;
}): boolean {
  if (params.ops.length < 128) return false;
  return params.ops.every((op) => op.type === "delete");
}

function applyInsertBatchFastPath(params: {
  doc: CRDTDoc;
  ops: ReadonlyArray<InsertOp>;
}): CRDTDoc {
  const items = [...params.doc.store.items];
  const map = new Map(params.doc.store.map);
  const appliedOps = new Set(params.doc.appliedOps);
  const sv = new Map(params.doc.stateVector);
  const cursor = { lastInsertKey: null as string | null, lastInsertIndex: -1 };

  for (const op of params.ops) {
    const opIdKey = opKey(op.id);
    if (appliedOps.has(opIdKey)) continue;
    appliedOps.add(opIdKey);

    const current = sv.get(op.id.clientId) ?? 0;
    if (op.id.clock > current) {
      sv.set(op.id.clientId, op.id.clock);
    }

    const leftOrigin = op.side === "right"
      ? op.parentId
      : (op.secondParentId ?? null);
    const rightOrigin = op.side === "left"
      ? op.parentId
      : (op.secondParentId ?? null);

    const item = createItem({
      id: op.id,
      leftOrigin,
      rightOrigin,
      content: op.content,
      deleted: false,
      marks: op.marks ? [...op.marks] : undefined,
    });

    integrateItemMutable({ items, map, item, cursor });
  }

  return {
    store: { items, map, length: items.length },
    appliedOps,
    pendingDeletes: params.doc.pendingDeletes,
    pendingFormats: params.doc.pendingFormats,
    pendingAttrUpdates: params.doc.pendingAttrUpdates,
    pendingReparents: params.doc.pendingReparents,
    stateVector: sv,
  };
}

function applyDeleteBatchFastPath(params: {
  doc: CRDTDoc;
  ops: ReadonlyArray<DeleteOp>;
}): CRDTDoc {
  let itemsMutable: Array<Item> | null = null;
  let mapMutable: Map<string, Item> | null = null;
  let indexByItemKey: Map<string, number> | null = null;

  let pendingDeletes: ReadonlyMap<string, OperationId> = params.doc.pendingDeletes;
  let appliedOpsMutable: Set<string> | null = null;
  let stateVectorMutable: Map<string, number> | null = null;
  const seenInBatch = new Set<string>();
  let changed = false;

  const ensureMutableStore = () => {
    if (itemsMutable && mapMutable && indexByItemKey) return;
    itemsMutable = [...params.doc.store.items];
    mapMutable = new Map(params.doc.store.map);
    indexByItemKey = new Map<string, number>();
    for (let i = 0; i < itemsMutable.length; i++) {
      indexByItemKey.set(opKey(itemsMutable[i]!.id), i);
    }
  };

  const ensureMutableAppliedOps = () => {
    if (appliedOpsMutable) return;
    appliedOpsMutable = new Set(params.doc.appliedOps);
  };

  const ensureMutableStateVector = () => {
    if (stateVectorMutable) return;
    stateVectorMutable = new Map(params.doc.stateVector);
  };

  const ensureMutablePendingDeletes = () => {
    if (pendingDeletes !== params.doc.pendingDeletes) return;
    pendingDeletes = new Map(params.doc.pendingDeletes);
  };

  for (const op of params.ops) {
    const opIdKey = opKey(op.id);
    if (params.doc.appliedOps.has(opIdKey) || seenInBatch.has(opIdKey)) continue;
    seenInBatch.add(opIdKey);

    changed = true;
    ensureMutableAppliedOps();
    appliedOpsMutable!.add(opIdKey);

    ensureMutableStateVector();
    const currentClock = stateVectorMutable!.get(op.id.clientId) ?? 0;
    if (op.id.clock > currentClock) {
      stateVectorMutable!.set(op.id.clientId, op.id.clock);
    }

    const targetKey = opKey(op.targetId);
    const existing = (mapMutable ?? params.doc.store.map).get(targetKey);
    if (existing) {
      if (!existing.deleted) {
        ensureMutableStore();
        const idx = indexByItemKey!.get(targetKey);
        if (typeof idx === "number") {
          const current = itemsMutable![idx]!;
          if (!current.deleted) {
            const updated: Item = { ...current, deleted: true };
            itemsMutable![idx] = updated;
            mapMutable!.set(targetKey, updated);
          }
        }
      }
      continue;
    }

    ensureMutablePendingDeletes();
    (pendingDeletes as Map<string, OperationId>).set(targetKey, op.targetId);
  }

  if (!changed) return params.doc;

  let store: ItemStore = params.doc.store;
  if (itemsMutable !== null && mapMutable !== null) {
    store = { items: itemsMutable, map: mapMutable, length: params.doc.store.length };
  }

  return {
    store,
    appliedOps: appliedOpsMutable ?? params.doc.appliedOps,
    pendingDeletes,
    pendingFormats: params.doc.pendingFormats,
    pendingAttrUpdates: params.doc.pendingAttrUpdates,
    pendingReparents: params.doc.pendingReparents,
    stateVector: stateVectorMutable ?? params.doc.stateVector,
  };
}

function applyDeleteTargetsBatchFastPath(params: {
  doc: CRDTDoc;
  op: DeleteBatchOp;
}): CRDTDoc {
  const opIdKey = opKey(params.op.id);
  if (params.doc.appliedOps.has(opIdKey)) return params.doc;

  let pendingDeletes: ReadonlyMap<string, OperationId> = params.doc.pendingDeletes;
  let pendingDeletesChanged = false;

  const targetKeys = new Set<string>();
  for (const targetId of params.op.targetIds) {
    targetKeys.add(opKey(targetId));
  }

  let storeChanged = false;
  const newItems = params.doc.store.items.map((item) => {
    const keyItem = opKey(item.id);
    if (!targetKeys.has(keyItem) || item.deleted) {
      return item;
    }
    storeChanged = true;
    return { ...item, deleted: true } satisfies Item;
  });

  for (const targetId of params.op.targetIds) {
    const targetKey = opKey(targetId);
    if (params.doc.store.map.has(targetKey)) continue;
    if (!pendingDeletesChanged) {
      pendingDeletes = new Map(params.doc.pendingDeletes);
      pendingDeletesChanged = true;
    }
    (pendingDeletes as Map<string, OperationId>).set(targetKey, targetId);
  }

  const appliedOps = new Set(params.doc.appliedOps);
  appliedOps.add(opIdKey);

  const stateVector = new Map(params.doc.stateVector);
  const currentClock = stateVector.get(params.op.id.clientId) ?? 0;
  if (params.op.id.clock > currentClock) {
    stateVector.set(params.op.id.clientId, params.op.id.clock);
  }

  let store: ItemStore = params.doc.store;
  if (storeChanged) {
    const newMap = new Map<string, Item>();
    for (const item of newItems) {
      newMap.set(opKey(item.id), item);
    }
    store = {
      items: newItems,
      map: newMap,
      length: newItems.length,
    };
  }

  return {
    store,
    appliedOps,
    pendingDeletes,
    pendingFormats: params.doc.pendingFormats,
    pendingAttrUpdates: params.doc.pendingAttrUpdates,
    pendingReparents: params.doc.pendingReparents,
    stateVector,
  };
}

function integrateItemMutable(params: {
  items: Array<Item>;
  map: Map<string, Item>;
  item: Item;
  cursor: { lastInsertKey: string | null; lastInsertIndex: number };
}): void {
  const key = opKey(params.item.id);
  if (params.map.has(key)) return;

  const findIndex = (id: OperationId): number => {
    for (let i = 0; i < params.items.length; i++) {
      if (operationIdEquals({ a: params.items[i]!.id, b: id })) return i;
    }
    return -1;
  };

  const getKey = (id: OperationId | null): string | null =>
    id ? `${id.clientId}:${id.clock}` : null;

  let left = -1;
  if (params.item.leftOrigin !== null) {
    const leftKey = getKey(params.item.leftOrigin);
    if (leftKey && leftKey === params.cursor.lastInsertKey) {
      left = params.cursor.lastInsertIndex;
    } else {
      left = findIndex(params.item.leftOrigin);
    }
    if (left < 0) left = -1;
  }

  let right = params.items.length;
  if (params.item.rightOrigin !== null) {
    right = findIndex(params.item.rightOrigin);
    if (right < 0) right = params.items.length;
  }

  let insertPos = left + 1;
  const newTs = { clientId: params.item.id.clientId, clock: params.item.id.clock };
  for (let i = left + 1; i < right; i++) {
    const existing = params.items[i]!;
    const existingTs = { clientId: existing.id.clientId, clock: existing.id.clock };
    const cmp = compareTimestamps({ a: existingTs, b: newTs });
    if (cmp < 0) {
      insertPos = i + 1;
    } else {
      break;
    }
  }

  params.items.splice(insertPos, 0, params.item);
  params.map.set(key, params.item);
  params.cursor.lastInsertKey = key;
  params.cursor.lastInsertIndex = insertPos;
}

export function getDocumentText(params: { doc: CRDTDoc }): string {
  return getVisibleContent({ store: params.doc.store });
}

export function getDocumentStateVector(params: { doc: CRDTDoc }): StateVector {
  return params.doc.stateVector;
}
