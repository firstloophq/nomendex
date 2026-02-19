import type { LamportClock } from "../core/lamport-clock";
import { increment } from "../core/lamport-clock";
import { createOperationId, type OperationId, type Operation } from "../core/operations";
import {
  createItem,
  createItemStore,
  integrateItem,
  deleteItem as deleteStoreItem,
  getItemById,
  type ItemStore,
  type Item,
} from "../core/item";

// --- Block ---

export interface Block {
  readonly id: OperationId;
  readonly blockType: string;
  readonly children: ItemStore; // inline content
  readonly deleted: boolean;
}

// --- CRDT Document ---

export interface CRDTDocument {
  readonly blockStore: ItemStore; // blocks are items in the root sequence
  readonly blockChildren: ReadonlyMap<string, ItemStore>; // blockKey → inline store
  readonly operations: ReadonlyArray<Operation>; // all applied operations
}

function blockKey(id: OperationId): string {
  return `${id.clientId}:${id.clock}`;
}

export function createDocument(): CRDTDocument {
  return {
    blockStore: createItemStore(),
    blockChildren: new Map(),
    operations: [],
  };
}

// --- Block operations ---

export function insertBlock(params: {
  doc: CRDTDocument;
  clock: LamportClock;
  blockType: string;
  index: number; // position among visible blocks
}): { doc: CRDTDocument; clock: LamportClock; blockId: OperationId } {
  const { clock: newClock, timestamp } = increment({ clock: params.clock });
  const id = createOperationId({
    clientId: timestamp.clientId,
    clock: timestamp.clock,
  });

  // Find left origin: the visible block at index-1, or null
  const visibleBlocks = getVisibleBlocks({ doc: params.doc });
  const leftOrigin =
    params.index > 0 && visibleBlocks[params.index - 1]
      ? visibleBlocks[params.index - 1]!.id
      : null;
  const rightOrigin =
    params.index < visibleBlocks.length && visibleBlocks[params.index]
      ? visibleBlocks[params.index]!.id
      : null;

  const blockItem = createItem({
    id,
    leftOrigin,
    rightOrigin,
    content: { type: "block", blockType: params.blockType },
    deleted: false,
  });

  const newBlockStore = integrateItem({
    store: params.doc.blockStore,
    item: blockItem,
  });

  const newBlockChildren = new Map(params.doc.blockChildren);
  newBlockChildren.set(blockKey(id), createItemStore());

  return {
    doc: {
      blockStore: newBlockStore,
      blockChildren: newBlockChildren,
      operations: params.doc.operations,
    },
    clock: newClock,
    blockId: id,
  };
}

export function deleteBlock(params: {
  doc: CRDTDocument;
  clock: LamportClock;
  blockIndex: number;
}): { doc: CRDTDocument; clock: LamportClock } {
  const visibleBlocks = getVisibleBlocks({ doc: params.doc });
  const block = visibleBlocks[params.blockIndex];
  if (!block) return { doc: params.doc, clock: params.clock };

  const { clock: newClock } = increment({ clock: params.clock });
  const newBlockStore = deleteStoreItem({
    store: params.doc.blockStore,
    targetId: block.id,
  });

  return {
    doc: {
      ...params.doc,
      blockStore: newBlockStore,
    },
    clock: newClock,
  };
}

// --- Text operations ---

export function insertText(params: {
  doc: CRDTDocument;
  clock: LamportClock;
  blockIndex: number;
  charIndex: number;
  text: string;
}): { doc: CRDTDocument; clock: LamportClock } {
  const visibleBlocks = getVisibleBlocks({ doc: params.doc });
  const block = visibleBlocks[params.blockIndex];
  if (!block) return { doc: params.doc, clock: params.clock };

  const key = blockKey(block.id);
  let childStore = params.doc.blockChildren.get(key) ?? createItemStore();
  let clock = params.clock;

  // Get visible items to find the insertion point
  const visibleItems = getVisibleItems({ store: childStore });

  for (let i = 0; i < params.text.length; i++) {
    const char = params.text[i]!;
    const { clock: newClock, timestamp } = increment({ clock });
    clock = newClock;

    const insertPos = params.charIndex + i;
    const leftOrigin =
      insertPos > 0 && visibleItems[insertPos - 1]
        ? visibleItems[insertPos - 1]!.id
        : i > 0
          ? createOperationId({
              clientId: timestamp.clientId,
              clock: timestamp.clock - 1,
            })
          : null;
    const rightOrigin =
      insertPos < visibleItems.length && visibleItems[insertPos]
        ? visibleItems[insertPos]!.id
        : null;

    const item = createItem({
      id: createOperationId({
        clientId: timestamp.clientId,
        clock: timestamp.clock,
      }),
      leftOrigin,
      rightOrigin,
      content: { type: "text", value: char },
      deleted: false,
    });

    childStore = integrateItem({ store: childStore, item });
  }

  const newBlockChildren = new Map(params.doc.blockChildren);
  newBlockChildren.set(key, childStore);

  return {
    doc: {
      ...params.doc,
      blockChildren: newBlockChildren,
    },
    clock,
  };
}

export function deleteText(params: {
  doc: CRDTDocument;
  clock: LamportClock;
  blockIndex: number;
  charIndex: number;
  length: number;
}): { doc: CRDTDocument; clock: LamportClock } {
  const visibleBlocks = getVisibleBlocks({ doc: params.doc });
  const block = visibleBlocks[params.blockIndex];
  if (!block) return { doc: params.doc, clock: params.clock };

  const key = blockKey(block.id);
  let childStore = params.doc.blockChildren.get(key) ?? createItemStore();
  let clock = params.clock;

  const visibleItems = getVisibleItems({ store: childStore });

  for (let i = 0; i < params.length; i++) {
    const item = visibleItems[params.charIndex + i];
    if (item) {
      const { clock: newClock } = increment({ clock });
      clock = newClock;
      childStore = deleteStoreItem({ store: childStore, targetId: item.id });
    }
  }

  const newBlockChildren = new Map(params.doc.blockChildren);
  newBlockChildren.set(key, childStore);

  return {
    doc: {
      ...params.doc,
      blockChildren: newBlockChildren,
    },
    clock,
  };
}

// --- Queries ---

function getVisibleBlocks(params: { doc: CRDTDocument }): ReadonlyArray<Item> {
  return params.doc.blockStore.items.filter((item) => !item.deleted);
}

function getVisibleItems(params: {
  store: ItemStore;
}): ReadonlyArray<Item> {
  return params.store.items.filter((item) => !item.deleted);
}

export function getBlockCount(params: { doc: CRDTDocument }): number {
  return getVisibleBlocks({ doc: params.doc }).length;
}

export function getBlockText(params: {
  doc: CRDTDocument;
  blockIndex: number;
}): string {
  const visibleBlocks = getVisibleBlocks({ doc: params.doc });
  const block = visibleBlocks[params.blockIndex];
  if (!block) return "";

  const key = blockKey(block.id);
  const childStore = params.doc.blockChildren.get(key);
  if (!childStore) return "";

  let result = "";
  for (const item of childStore.items) {
    if (!item.deleted && item.content.type === "text") {
      result += item.content.value;
    }
  }
  return result;
}

export function getPlainText(params: { doc: CRDTDocument }): string {
  const visibleBlocks = getVisibleBlocks({ doc: params.doc });
  const texts: Array<string> = [];
  for (let i = 0; i < visibleBlocks.length; i++) {
    texts.push(getBlockText({ doc: params.doc, blockIndex: i }));
  }
  return texts.join("\n");
}
