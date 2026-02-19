import type { OperationId, Content, Mark } from "./operations";
import { operationIdEquals } from "./operations";
import { compareTimestamps, type Timestamp } from "./lamport-clock";

// --- Item ---

export interface Item {
  readonly id: OperationId;
  readonly leftOrigin: OperationId | null; // left neighbor at time of insert
  readonly rightOrigin: OperationId | null; // right neighbor at time of insert
  readonly content: Content;
  readonly deleted: boolean;
  readonly marks?: ReadonlyArray<Mark>;
}

export function createItem(params: {
  id: OperationId;
  leftOrigin: OperationId | null;
  rightOrigin: OperationId | null;
  content: Content;
  deleted: boolean;
  marks?: ReadonlyArray<Mark>;
}): Item {
  const item: Item = {
    id: params.id,
    leftOrigin: params.leftOrigin,
    rightOrigin: params.rightOrigin,
    content: params.content,
    deleted: params.deleted,
  };
  if (params.marks !== undefined) {
    return { ...item, marks: params.marks };
  }
  return item;
}

// --- Item Store ---
// A doubly-linked list backed by an array + a lookup map.
// Items are stored in document order in the array.

export interface ItemStore {
  readonly items: ReadonlyArray<Item>;
  readonly map: ReadonlyMap<string, Item>; // key = "clientId:clock"
  readonly length: number;
}

function itemKey(id: OperationId): string {
  return `${id.clientId}:${id.clock}`;
}

export function createItemStore(): ItemStore {
  return { items: [], map: new Map(), length: 0 };
}

export function getItemById(params: {
  store: ItemStore;
  id: OperationId;
}): Item | null {
  return params.store.map.get(itemKey(params.id)) ?? null;
}

function findIndex(store: ItemStore, id: OperationId): number {
  // Find position of item with this id in the items array
  for (let i = 0; i < store.items.length; i++) {
    if (operationIdEquals({ a: store.items[i]!.id, b: id })) {
      return i;
    }
  }
  return -1;
}

/**
 * Integrate a new item into the store using the YATA conflict resolution algorithm.
 *
 * The algorithm:
 * 1. Find the position of leftOrigin in the list
 * 2. Find the position of rightOrigin in the list
 * 3. Scan between those positions, comparing timestamps with all items
 *    in the range. Lower timestamp wins (goes first).
 *
 * When both leftOrigin and rightOrigin are set, the scanning range is
 * tightly bounded, preventing high-clock items from sliding past
 * sequential chains.
 */
export function integrateItem(params: {
  store: ItemStore;
  item: Item;
}): ItemStore {
  const { store, item } = params;

  // Idempotency: if already in store, return unchanged
  if (store.map.has(itemKey(item.id))) {
    return store;
  }

  const items = [...store.items];
  const newMap = new Map(store.map);

  // Find the insertion range [left+1, right)
  let left: number;
  if (item.leftOrigin === null) {
    left = -1; // before all items
  } else {
    left = findIndex(store, item.leftOrigin);
    if (left === -1) {
      // Left origin not found — insert at beginning
      left = -1;
    }
  }

  let right: number;
  if (item.rightOrigin === null) {
    right = items.length; // after all items
  } else {
    right = findIndex(store, item.rightOrigin);
    if (right === -1) {
      right = items.length;
    }
  }

  // YATA conflict resolution:
  // Compare timestamps with all items in [left+1, right).
  // Lower timestamp (clock first, then clientId) wins position.
  let insertPos = left + 1;

  const newTimestamp: Timestamp = {
    clientId: item.id.clientId,
    clock: item.id.clock,
  };

  for (let i = left + 1; i < right; i++) {
    const existing = items[i]!;
    const existingTimestamp: Timestamp = {
      clientId: existing.id.clientId,
      clock: existing.id.clock,
    };
    const cmp = compareTimestamps({ a: existingTimestamp, b: newTimestamp });
    if (cmp < 0) {
      // existing has lower timestamp → goes first
      insertPos = i + 1;
    } else {
      break;
    }
  }

  items.splice(insertPos, 0, item);
  newMap.set(itemKey(item.id), item);

  return { items, map: newMap, length: items.length };
}

export function deleteItem(params: {
  store: ItemStore;
  targetId: OperationId;
}): ItemStore {
  const key = itemKey(params.targetId);
  const existing = params.store.map.get(key);
  if (!existing || existing.deleted) {
    return params.store; // idempotent
  }

  const updated: Item = { ...existing, deleted: true };
  const newItems = params.store.items.map((item) =>
    operationIdEquals({ a: item.id, b: params.targetId }) ? updated : item
  );
  const newMap = new Map(params.store.map);
  newMap.set(key, updated);

  return { items: newItems, map: newMap, length: params.store.length };
}

export function getVisibleContent(params: { store: ItemStore }): string {
  let result = "";
  for (const item of params.store.items) {
    if (!item.deleted && item.content.type === "text") {
      result += item.content.value;
    }
  }
  return result;
}
