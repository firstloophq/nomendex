import type { Transaction } from "prosemirror-state";
import { ReplaceStep, AddMarkStep, RemoveMarkStep, ReplaceAroundStep } from "prosemirror-transform";
import type { Node as PMNode, Slice, Schema } from "prosemirror-model";
import type { LamportClock } from "../core/lamport-clock";
import { increment } from "../core/lamport-clock";
import {
  createInsertOp,
  createDeleteOp,
  createFormatOp,
  createAttrUpdateOp,
  createReparentOp,
  createOperationId,
  type Operation,
  type OperationId,
  type BlockContent,
  type Content,
  type Mark as CRDTMark,
} from "../core/operations";
import { applyOperations, type CRDTDoc } from "../core/apply-operations";
import { proseMirrorPositionToCRDT, getItemsInProseMirrorRange } from "./state-mapping";
import type { Item } from "../core/item";

// Check if AttrStep is available (prosemirror-transform >= 1.7)
let AttrStepClass: (new (...args: Array<never>) => { pos: number; attr: string; value: string | number | boolean | null }) | null = null;
try {
  // Dynamic import at module load
  const mod = require("prosemirror-transform");
  if (mod.AttrStep) {
    AttrStepClass = mod.AttrStep;
  }
} catch {
  // AttrStep not available
}

type ReplaceStepLike = {
  from: number;
  to: number;
  slice: Slice;
};

type ReplaceAroundStepLike = ReplaceStepLike & {
  gapFrom: number;
  gapTo: number;
};

type MarkLike = {
  type: {
    name: string;
  };
  attrs?: Record<string, unknown> | null;
};

type MarkStepLike = {
  from: number;
  to: number;
  mark: MarkLike;
};

type AttrStepLike = {
  pos: number;
  attr: string;
  value: string | number | boolean | null;
};

type SupportedStepKind =
  | "replace"
  | "replaceAround"
  | "addMark"
  | "removeMark"
  | "attr";

export function transactionToCRDTOps(params: {
  crdtDoc: CRDTDoc;
  transaction: Transaction;
  clock: LamportClock;
}): { ops: ReadonlyArray<Operation>; clock: LamportClock } {
  const ops: Array<Operation> = [];
  let clock = params.clock;
  let crdtDoc = params.crdtDoc;
  const schema = params.transaction.doc.type.schema;

  for (const step of params.transaction.steps) {
    const stepKind = classifyStep(step);
    if (stepKind === "replace" && isReplaceStepLike(step)) {
      const result = handleReplaceStep({ step, crdtDoc, clock, schema });
      ops.push(...result.ops);
      if (result.ops.length > 0) {
        crdtDoc = applyOperations({ doc: crdtDoc, ops: result.ops });
      }
      clock = result.clock;
      continue;
    }

    if (stepKind === "addMark" && isMarkStepLike(step)) {
      const result = handleAddMarkStep({ step, crdtDoc, clock, schema });
      ops.push(...result.ops);
      if (result.ops.length > 0) {
        crdtDoc = applyOperations({ doc: crdtDoc, ops: result.ops });
      }
      clock = result.clock;
      continue;
    }

    if (stepKind === "removeMark" && isMarkStepLike(step)) {
      const result = handleRemoveMarkStep({ step, crdtDoc, clock, schema });
      ops.push(...result.ops);
      if (result.ops.length > 0) {
        crdtDoc = applyOperations({ doc: crdtDoc, ops: result.ops });
      }
      clock = result.clock;
      continue;
    }

    if (stepKind === "replaceAround" && isReplaceAroundStepLike(step)) {
      const result = handleReplaceAroundStep({ step, crdtDoc, clock, schema });
      ops.push(...result.ops);
      if (result.ops.length > 0) {
        crdtDoc = applyOperations({ doc: crdtDoc, ops: result.ops });
      }
      clock = result.clock;
      continue;
    }

    if (stepKind === "attr" && isAttrStepLike(step)) {
      const result = handleAttrStep({ step, crdtDoc, clock, schema });
      ops.push(...result.ops);
      if (result.ops.length > 0) {
        crdtDoc = applyOperations({ doc: crdtDoc, ops: result.ops });
      }
      clock = result.clock;
    }
  }

  return { ops, clock };
}

function handleReplaceStep(params: {
  step: ReplaceStepLike;
  crdtDoc: CRDTDoc;
  clock: LamportClock;
  schema: Schema;
}): { ops: Array<Operation>; clock: LamportClock } {
  const { step, crdtDoc, schema } = params;
  const ops: Array<Operation> = [];
  let clock = params.clock;

  const from = step.from;
  const to = step.to;

  // Delete the range [from, to)
  if (from < to) {
    const itemsToDelete = getItemsInRange({ doc: crdtDoc, from, to, schema });

    for (const item of itemsToDelete) {
      const { clock: newClock, timestamp } = increment({ clock });
      clock = newClock;
      ops.push(
        createDeleteOp({
          id: createOperationId({
            clientId: timestamp.clientId,
            clock: timestamp.clock,
          }),
          targetId: item.id,
        })
      );
    }
  }

  // Insert the slice content
  const slice = step.slice;
  if (slice.content.childCount === 0) return { ops, clock };

  const insertPos = proseMirrorPositionToCRDT({ doc: crdtDoc, pos: from, schema });
  let parentId = insertPos.leftItemId;
  const rightAnchorId = insertPos.rightItemId;
  let contextBlockId = insertPos.blockId;

  if (!contextBlockId) {
    const fallbackTopLevelBlock = crdtDoc.store.items.find((item) => {
      if (item.deleted || item.content.type !== "block") return false;
      return !item.content.parentBlockId;
    });
    contextBlockId = fallbackTopLevelBlock?.id ?? null;
  }

  const inferParentBlockIdForInsert = (node: PMNode): OperationId | null => {
    if (!contextBlockId) return null;

    const contextKey = `${contextBlockId.clientId}:${contextBlockId.clock}`;
    const contextItem = crdtDoc.store.map.get(contextKey);
    if (!contextItem || contextItem.content.type !== "block") {
      return null;
    }

    const contextBlockType = contextItem.content.blockType;
    const contextParent = contextItem.content.parentBlockId ?? null;
    let inferredParent = contextParent;

    // If insertion context is the list_item wrapper itself, non-list_item block
    // inserts (e.g. paragraph created by list exit) must remain inside list_item.
    // Otherwise we can emit paragraph directly under ordered/bullet_list, which
    // violates PM schema and corrupts CRDT snapshots.
    if (contextBlockType === "list_item" && node.type.name !== "list_item") {
      return contextBlockId;
    }

    // Splitting a list item inserts a sibling list_item. If the cursor is inside
    // the list item's paragraph, context parent is the list_item itself; lift one
    // level so the inserted list_item stays under the list container.
    if (node.type.name === "list_item" && inferredParent) {
      const parentKey = `${inferredParent.clientId}:${inferredParent.clock}`;
      const parentItem = crdtDoc.store.map.get(parentKey);
      if (parentItem && parentItem.content.type === "block" && parentItem.content.blockType === "list_item") {
        inferredParent = parentItem.content.parentBlockId ?? null;
      }
    }

    return inferredParent;
  };

  const inferBlockSiblingAnchorForInsert = (node: PMNode): OperationId | null => {
    if (!contextBlockId) return null;
    if (!node.isBlock) return null;

    const contextKey = `${contextBlockId.clientId}:${contextBlockId.clock}`;
    const contextItem = crdtDoc.store.map.get(contextKey);
    if (!contextItem || contextItem.content.type !== "block") {
      return null;
    }

    // For split list-item flows, ensure the new list_item is anchored after
    // the current list_item sibling instead of after trailing inline text.
    if (node.type.name === "list_item") {
      if (contextItem.content.blockType === "list_item") {
        return contextBlockId;
      }
      const parent = contextItem.content.parentBlockId ?? null;
      if (!parent) return null;
      const parentKey = `${parent.clientId}:${parent.clock}`;
      const parentItem = crdtDoc.store.map.get(parentKey);
      if (parentItem && parentItem.content.type === "block" && parentItem.content.blockType === "list_item") {
        return parent;
      }
    }

    return null;
  };

  // Check if slice contains block nodes (Enter key, paste with paragraphs)
  let hasBlocks = false;
  for (let i = 0; i < slice.content.childCount; i++) {
    if (slice.content.child(i).isBlock) { hasBlocks = true; break; }
  }

  if (hasBlocks) {
    for (let i = 0; i < slice.content.childCount; i++) {
      const node = slice.content.child(i);
      if (!node.isBlock) continue;

      const maybeDeleteContextBlockForReplacement = () => {
        if (slice.content.childCount !== 1) return;
        if (from >= to) return;
        if (node.type.name !== "heading") return;

        const resolveParagraphReplacementBlockId = (): OperationId | null => {
          if (contextBlockId) {
            const contextKey = `${contextBlockId.clientId}:${contextBlockId.clock}`;
            const contextItem = crdtDoc.store.map.get(contextKey);
            if (contextItem && contextItem.content.type === "block" && contextItem.content.blockType === "paragraph") {
              return contextBlockId;
            }
          }
          const fallbackParagraph = crdtDoc.store.items.find((item) => {
            if (item.deleted || item.content.type !== "block") return false;
            if (item.content.blockType !== "paragraph") return false;
            return !item.content.parentBlockId;
          });
          return fallbackParagraph?.id ?? null;
        };

        const replacementBlockId = resolveParagraphReplacementBlockId();
        if (!replacementBlockId) return;

        const { clock: newClock, timestamp } = increment({ clock });
        clock = newClock;
        ops.push(
          createDeleteOp({
            id: createOperationId({
              clientId: timestamp.clientId,
              clock: timestamp.clock,
            }),
            targetId: replacementBlockId,
          })
        );
      };
      maybeDeleteContextBlockForReplacement();

      // First child with openStart > 0 = continuation of existing block (no new block needed)
      const isNewBlock = !(i === 0 && slice.openStart > 0);

      if (isNewBlock) {
        const parentBlockId = inferParentBlockIdForInsert(node);
        const siblingAnchorId = inferBlockSiblingAnchorForInsert(node);
        const result = insertBlockTree({
          node,
          parentBlockId,
          insertAfter: siblingAnchorId ?? parentId,
          rightAnchor: rightAnchorId,
          clock,
          schema,
        });
        ops.push(...result.ops);
        clock = result.clock;
        parentId = result.lastItemId;
      } else {
        // Continuation of existing block — insert inline content only
        const result = insertInlineContent({
          node,
          parentId,
          rightAnchor: rightAnchorId,
          clock,
        });
        ops.push(...result.ops);
        clock = result.clock;
        parentId = result.lastItemId;
      }
    }
  } else {
    // Simple inline insertion (no blocks)
    const result = insertInlineContentFromSlice({
      slice,
      parentId,
      rightAnchor: rightAnchorId,
      clock,
    });
    ops.push(...result.ops);
    clock = result.clock;
  }

  return { ops, clock };
}

function handleAddMarkStep(params: {
  step: MarkStepLike;
  crdtDoc: CRDTDoc;
  clock: LamportClock;
  schema: Schema;
}): { ops: Array<Operation>; clock: LamportClock } {
  const { step, crdtDoc, schema } = params;
  const ops: Array<Operation> = [];
  let clock = params.clock;
  const mark = toCRDTMark(step.mark);

  const items = getItemsInRange({ doc: crdtDoc, from: step.from, to: step.to, schema });
  for (const item of items) {
    const { clock: newClock, timestamp } = increment({ clock });
    clock = newClock;
    ops.push(
      createFormatOp({
        id: createOperationId({
          clientId: timestamp.clientId,
          clock: timestamp.clock,
        }),
        targetId: item.id,
        mark,
        action: "add",
      })
    );
  }

  return { ops, clock };
}

function handleRemoveMarkStep(params: {
  step: MarkStepLike;
  crdtDoc: CRDTDoc;
  clock: LamportClock;
  schema: Schema;
}): { ops: Array<Operation>; clock: LamportClock } {
  const { step, crdtDoc, schema } = params;
  const ops: Array<Operation> = [];
  let clock = params.clock;
  const mark = toCRDTMark(step.mark);

  const items = getItemsInRange({ doc: crdtDoc, from: step.from, to: step.to, schema });
  for (const item of items) {
    const { clock: newClock, timestamp } = increment({ clock });
    clock = newClock;
    ops.push(
      createFormatOp({
        id: createOperationId({
          clientId: timestamp.clientId,
          clock: timestamp.clock,
        }),
        targetId: item.id,
        mark,
        action: "remove",
      })
    );
  }

  return { ops, clock };
}

function handleAttrStep(params: {
  step: AttrStepLike;
  crdtDoc: CRDTDoc;
  clock: LamportClock;
  schema: Schema;
}): { ops: Array<Operation>; clock: LamportClock } {
  const { step, crdtDoc, schema } = params;
  const ops: Array<Operation> = [];
  let clock = params.clock;

  // Find the block item at the given position
  const position = proseMirrorPositionToCRDT({ doc: crdtDoc, pos: step.pos, schema });
  // The block at this position is the leftItemId (opening tag position)
  // We need to find the block item — it should be at position step.pos which is the opening tag
  const targetId = position.leftItemId;
  if (!targetId) return { ops, clock };

  // Verify it's a block or inline atom
  const key = `${targetId.clientId}:${targetId.clock}`;
  const item = crdtDoc.store.map.get(key);
  if (!item || (item.content.type !== "block" && item.content.type !== "inline_atom")) {
    return { ops, clock };
  }

  // Read old value from the CRDT item for undo support
  const oldValue = (item.content.type === "block" || item.content.type === "inline_atom")
    ? (item.content.attrs?.[step.attr] ?? null)
    : null;

  const { clock: newClock, timestamp } = increment({ clock });
  clock = newClock;
  ops.push(
    createAttrUpdateOp({
      id: createOperationId({
        clientId: timestamp.clientId,
        clock: timestamp.clock,
      }),
      targetId,
      attr: step.attr,
      value: step.value,
      oldValue,
    })
  );

  return { ops, clock };
}

function handleReplaceAroundStep(params: {
  step: ReplaceAroundStepLike;
  crdtDoc: CRDTDoc;
  clock: LamportClock;
  schema: Schema;
}): { ops: Array<Operation>; clock: LamportClock } {
  const { step, crdtDoc, schema } = params;
  const ops: Array<Operation> = [];
  let clock = params.clock;

  // ReplaceAroundStep wraps or unwraps content.
  // step.from, step.to: outer range
  // step.gapFrom, step.gapTo: inner range (content that's preserved)
  // step.slice: the wrapper to insert around the gap

  const from = step.from;
  const to = step.to;
  const gapFrom = step.gapFrom;
  const gapTo = step.gapTo;
  const slice = step.slice;
  const topWrapperNode = slice.content.firstChild;
  const treatAsLiftUnwrap =
    Boolean(topWrapperNode)
    && Boolean(topWrapperNode?.isBlock)
    && slice.content.childCount === 1
    && (topWrapperNode?.childCount ?? 0) === 0
    && slice.openStart > 0;

  if (slice.content.childCount > 0 && !treatAsLiftUnwrap) {
    // Wrapping: insert the full wrapper chain (e.g. bullet_list -> list_item)
    // and then reparent the preserved gap blocks into the deepest wrapper.
    if (topWrapperNode && topWrapperNode.isBlock) {
      if (topWrapperNode.type.name === "heading" && gapFrom === gapTo) {
        const existingTopLevelParagraph = crdtDoc.store.items.find((item) => {
          if (item.deleted || item.content.type !== "block") return false;
          if (item.content.blockType !== "paragraph") return false;
          return !item.content.parentBlockId;
        });
        if (existingTopLevelParagraph) {
          const { clock: delClock, timestamp: delTs } = increment({ clock });
          clock = delClock;
          ops.push(createDeleteOp({
            id: createOperationId({
              clientId: delTs.clientId,
              clock: delTs.clock,
            }),
            targetId: existingTopLevelParagraph.id,
          }));
        }
      }

      const insertPos = proseMirrorPositionToCRDT({ doc: crdtDoc, pos: from, schema });
      const wrapperChain = collectReplaceAroundWrapperChain(topWrapperNode);
      ensureImplicitListItemWrapper({ wrapperChain, schema });

      let linearInsertParent = insertPos.leftItemId;
      let parentWrapperId: OperationId | null = null;
      let deepestWrapperId: OperationId | null = null;

      for (let i = 0; i < wrapperChain.length; i++) {
        const wrapperNode = wrapperChain[i]!;
        const { clock: newClock, timestamp } = increment({ clock });
        clock = newClock;

        const wrapperId = createOperationId({
          clientId: timestamp.clientId,
          clock: timestamp.clock,
        });

        const blockContent: Content = {
          type: "block",
          blockType: wrapperNode.type.name,
          ...extractBlockAttrs(wrapperNode),
          ...(parentWrapperId ? { parentBlockId: parentWrapperId } : {}),
        };

        if (i === 0 && insertPos.rightItemId) {
          ops.push(createInsertOp({
            id: wrapperId,
            parentId: insertPos.rightItemId,
            side: "left",
            secondParentId: insertPos.leftItemId ?? undefined,
            content: blockContent,
          }));
        } else {
          ops.push(createInsertOp({
            id: wrapperId,
            parentId: linearInsertParent,
            side: "right",
            content: blockContent,
          }));
        }

        linearInsertParent = wrapperId;
        parentWrapperId = wrapperId;
        deepestWrapperId = wrapperId;
      }

      if (deepestWrapperId) {
        const gapBlocks = getBlockItemsInRange({ doc: crdtDoc, from: gapFrom, to: gapTo, schema });
        for (const block of gapBlocks) {
          const { clock: repClock, timestamp: repTs } = increment({ clock });
          clock = repClock;
          ops.push(createReparentOp({
            id: createOperationId({ clientId: repTs.clientId, clock: repTs.clock }),
            targetId: block.id,
            newParentBlockId: deepestWrapperId,
          }));
        }
      }
    }
  } else {
    if (
      treatAsLiftUnwrap
      && topWrapperNode
      && (topWrapperNode.type.name === "ordered_list" || topWrapperNode.type.name === "bullet_list")
    ) {
      const gapBlocks = getBlockItemsInRange({ doc: crdtDoc, from: gapFrom, to: gapTo, schema });
      const deletedListItemKeys = new Set<string>();
      const deletedListContainerKeys = new Set<string>();

      for (const block of gapBlocks) {
        if (block.content.type !== "block") continue;
        const parentListItemId = block.content.parentBlockId ?? null;
        if (!parentListItemId) continue;

        const listItemKey = `${parentListItemId.clientId}:${parentListItemId.clock}`;
        const listItemItem = crdtDoc.store.map.get(listItemKey);
        if (!listItemItem || listItemItem.content.type !== "block" || listItemItem.content.blockType !== "list_item") {
          continue;
        }

        const listContainerId = listItemItem.content.parentBlockId ?? null;
        let newParentBlockId: OperationId | null = null;
        if (listContainerId) {
          const listContainerKey = `${listContainerId.clientId}:${listContainerId.clock}`;
          const listContainerItem = crdtDoc.store.map.get(listContainerKey);
          if (listContainerItem && listContainerItem.content.type === "block") {
            newParentBlockId = listContainerItem.content.parentBlockId ?? null;
          }
        }

        const { clock: repClock, timestamp: repTs } = increment({ clock });
        clock = repClock;
        ops.push(createReparentOp({
          id: createOperationId({ clientId: repTs.clientId, clock: repTs.clock }),
          targetId: block.id,
          newParentBlockId,
        }));

        if (!deletedListItemKeys.has(listItemKey)) {
          deletedListItemKeys.add(listItemKey);
          const { clock: delClock, timestamp: delTs } = increment({ clock });
          clock = delClock;
          ops.push(createDeleteOp({
            id: createOperationId({ clientId: delTs.clientId, clock: delTs.clock }),
            targetId: listItemItem.id,
          }));
        }

        if (listContainerId) {
          const listContainerKey = `${listContainerId.clientId}:${listContainerId.clock}`;
          if (!deletedListContainerKeys.has(listContainerKey)) {
            const hasOtherListItems = crdtDoc.store.items.some((item) => {
              if (item.deleted || item.content.type !== "block") return false;
              if (item.content.blockType !== "list_item") return false;
              const parent = item.content.parentBlockId;
              if (!parent) return false;
              if (parent.clientId !== listContainerId.clientId || parent.clock !== listContainerId.clock) return false;
              return !(item.id.clientId === listItemItem.id.clientId && item.id.clock === listItemItem.id.clock);
            });

            if (!hasOtherListItems) {
              deletedListContainerKeys.add(listContainerKey);
              const { clock: delListClock, timestamp: delListTs } = increment({ clock });
              clock = delListClock;
              ops.push(createDeleteOp({
                id: createOperationId({ clientId: delListTs.clientId, clock: delListTs.clock }),
                targetId: listContainerId,
              }));
            }
          }
        }
      }

      return { ops, clock };
    }

    // Unwrapping/lifting: reparent children out of container, delete container
    // Find blocks to delete in [from, gapFrom) and (gapTo, to]
    const beforeBlocks = getBlockItemsInRange({ doc: crdtDoc, from, to: gapFrom, schema });
    const afterBlocks = getBlockItemsInRange({ doc: crdtDoc, from: gapTo, to, schema });

    // Find the container block (the block item in the before range)
    const containerBlock = beforeBlocks[0];

    if (containerBlock) {
      // Reparent gap content to the container's parent
      const containerContent = containerBlock.content as BlockContent;
      const newParent = containerContent.parentBlockId ?? null;

      const gapBlocks = getBlockItemsInRange({ doc: crdtDoc, from: gapFrom, to: gapTo, schema });
      for (const block of gapBlocks) {
        const { clock: repClock, timestamp: repTs } = increment({ clock });
        clock = repClock;
        ops.push(createReparentOp({
          id: createOperationId({ clientId: repTs.clientId, clock: repTs.clock }),
          targetId: block.id,
          newParentBlockId: newParent,
        }));
      }

      // Delete the container block(s)
      for (const block of [...beforeBlocks, ...afterBlocks]) {
        const { clock: delClock, timestamp: delTs } = increment({ clock });
        clock = delClock;
        ops.push(createDeleteOp({
          id: createOperationId({ clientId: delTs.clientId, clock: delTs.clock }),
          targetId: block.id,
        }));
      }
    }
  }

  return { ops, clock };
}

function collectReplaceAroundWrapperChain(node: PMNode): Array<PMNode> {
  const chain: Array<PMNode> = [node];
  let current = node;

  while (true) {
    const blockChildren: Array<PMNode> = [];
    current.forEach((child) => {
      if (child.isBlock) {
        blockChildren.push(child);
      }
    });

    if (blockChildren.length !== 1) break;

    const next = blockChildren[0]!;
    if (next.isTextblock) break;

    chain.push(next);
    current = next;
  }

  return chain;
}

function ensureImplicitListItemWrapper(params: {
  wrapperChain: Array<PMNode>;
  schema: Schema;
}): void {
  const { wrapperChain, schema } = params;
  if (wrapperChain.length === 0) return;

  const deepest = wrapperChain[wrapperChain.length - 1]!;
  const deepestType = deepest.type.name;
  const isListContainer = deepestType === "bullet_list" || deepestType === "ordered_list";
  if (!isListContainer) return;

  const hasListItem = wrapperChain.some((node) => node.type.name === "list_item");
  if (hasListItem) return;

  const listItemType = schema.nodes["list_item"];
  if (!listItemType) return;

  const placeholder = listItemType.createAndFill();
  if (placeholder) {
    wrapperChain.push(placeholder);
  }
}

function classifyStep(step: unknown): SupportedStepKind | null {
  if (step instanceof ReplaceAroundStep) return "replaceAround";
  if (step instanceof ReplaceStep) return "replace";
  if (step instanceof AddMarkStep) return "addMark";
  if (step instanceof RemoveMarkStep) return "removeMark";
  if (AttrStepClass && step instanceof AttrStepClass) return "attr";

  const normalizedHint = normalizeStepHint(getStepHint(step));

  if (normalizedHint.includes("replacearound") && isReplaceAroundStepLike(step)) return "replaceAround";
  if ((normalizedHint === "replace" || normalizedHint.includes("replacestep")) && isReplaceStepLike(step)) return "replace";
  if (normalizedHint.includes("addmark") && isMarkStepLike(step)) return "addMark";
  if (normalizedHint.includes("removemark") && isMarkStepLike(step)) return "removeMark";
  if ((normalizedHint === "attr" || normalizedHint.includes("attrstep")) && isAttrStepLike(step)) return "attr";

  // Structural fallback for cases where step class identity and metadata are unavailable.
  if (isReplaceAroundStepLike(step)) return "replaceAround";
  if (isReplaceStepLike(step)) return "replace";
  if (isAttrStepLike(step)) return "attr";

  return null;
}

function getStepHint(step: unknown): string | null {
  if (!isRecord(step)) return null;

  if (typeof step["jsonID"] === "string") {
    return step["jsonID"];
  }

  if (typeof step["toJSON"] === "function") {
    try {
      const json = step["toJSON"].call(step);
      if (isRecord(json) && typeof json["stepType"] === "string") {
        return json["stepType"];
      }
    } catch {
      // Ignore malformed toJSON implementations.
    }
  }

  const ctor = step["constructor"];
  if (isRecord(ctor) && typeof ctor["name"] === "string") {
    return ctor["name"];
  }

  return null;
}

function normalizeStepHint(stepHint: string | null): string {
  return stepHint ? stepHint.toLowerCase().replace(/[^a-z]/g, "") : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSliceLike(value: unknown): value is Slice {
  if (!isRecord(value)) return false;
  return (
    isRecord(value["content"]) &&
    typeof value["openStart"] === "number" &&
    typeof value["openEnd"] === "number"
  );
}

function isReplaceStepLike(step: unknown): step is ReplaceStepLike {
  if (!isRecord(step)) return false;
  return (
    typeof step["from"] === "number" &&
    typeof step["to"] === "number" &&
    isSliceLike(step["slice"])
  );
}

function isReplaceAroundStepLike(step: unknown): step is ReplaceAroundStepLike {
  if (!isRecord(step)) return false;
  const stepRecord = step as Record<string, unknown>;
  if (!isReplaceStepLike(step)) return false;
  return (
    typeof stepRecord["gapFrom"] === "number" &&
    typeof stepRecord["gapTo"] === "number"
  );
}

function isMarkLike(mark: unknown): mark is MarkLike {
  if (!isRecord(mark)) return false;
  if (!isRecord(mark["type"])) return false;
  return typeof mark["type"]["name"] === "string";
}

function isMarkStepLike(step: unknown): step is MarkStepLike {
  if (!isRecord(step)) return false;
  return (
    typeof step["from"] === "number" &&
    typeof step["to"] === "number" &&
    isMarkLike(step["mark"])
  );
}

function isPrimitiveAttrValue(value: unknown): value is string | number | boolean | null {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

function isAttrStepLike(step: unknown): step is AttrStepLike {
  if (!isRecord(step)) return false;
  return (
    typeof step["pos"] === "number" &&
    typeof step["attr"] === "string" &&
    isPrimitiveAttrValue(step["value"])
  );
}

function sanitizeAttrs(attrs: unknown): Record<string, string | number | boolean | null> | undefined {
  if (!isRecord(attrs)) return undefined;

  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (isPrimitiveAttrValue(value)) {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function toCRDTMark(mark: MarkLike): CRDTMark {
  const attrs = sanitizeAttrs(mark.attrs);
  if (attrs) {
    return { type: mark.type.name, attrs };
  }
  return { type: mark.type.name };
}

// --- Block tree insertion helpers ---

function insertBlockTree(params: {
  node: PMNode;
  parentBlockId: OperationId | null;
  insertAfter: OperationId | null;
  rightAnchor: OperationId | null;
  clock: LamportClock;
  schema: Schema;
}): { ops: Array<Operation>; clock: LamportClock; lastItemId: OperationId } {
  const { node, parentBlockId, schema } = params;
  const ops: Array<Operation> = [];
  let clock = params.clock;
  let parentId = params.insertAfter;
  const rightAnchor = params.rightAnchor;

  // Create the block item
  const { clock: newClock, timestamp } = increment({ clock });
  clock = newClock;
  const blockId = createOperationId({
    clientId: timestamp.clientId,
    clock: timestamp.clock,
  });

  const blockContent: Content = {
    type: "block",
    blockType: node.type.name,
    ...extractBlockAttrs(node),
    ...(parentBlockId ? { parentBlockId } : {}),
  };

  if (rightAnchor) {
    ops.push(createInsertOp({
      id: blockId,
      parentId: rightAnchor,
      side: "left",
      secondParentId: parentId ?? undefined,
      content: blockContent,
    }));
  } else {
    ops.push(createInsertOp({
      id: blockId,
      parentId,
      side: "right",
      content: blockContent,
    }));
  }

  let lastItemId: OperationId = blockId;

  // Insert inline content of this block
  if (node.isTextblock || (node.childCount > 0 && node.firstChild?.isInline)) {
    const result = insertInlineContent({
      node,
      parentId: blockId,
      rightAnchor: null, // inline content goes inside this block, no right anchor
      clock,
    });
    ops.push(...result.ops);
    clock = result.clock;
    if (result.lastItemId) {
      lastItemId = result.lastItemId;
    }
  }

  // Recursively insert child blocks
  node.forEach((child) => {
    if (child.isBlock) {
      const result = insertBlockTree({
        node: child,
        parentBlockId: blockId,
        insertAfter: lastItemId,
        rightAnchor: null,
        clock,
        schema,
      });
      ops.push(...result.ops);
      clock = result.clock;
      lastItemId = result.lastItemId;
    }
  });

  return { ops, clock, lastItemId };
}

function insertInlineContent(params: {
  node: PMNode;
  parentId: OperationId | null;
  rightAnchor: OperationId | null;
  clock: LamportClock;
}): { ops: Array<Operation>; clock: LamportClock; lastItemId: OperationId } {
  const ops: Array<Operation> = [];
  let clock = params.clock;
  let parentId = params.parentId;
  const rightAnchor = params.rightAnchor;
  let lastItemId = parentId!;

  params.node.content.forEach((child) => {
    if (child.isText && child.text) {
      const marks = child.marks.length > 0
        ? child.marks.map((m) => ({ type: m.type.name, attrs: m.attrs }))
        : undefined;

      for (const char of child.text) {
        const { clock: newClock, timestamp } = increment({ clock });
        clock = newClock;
        const opId = createOperationId({
          clientId: timestamp.clientId,
          clock: timestamp.clock,
        });

        if (rightAnchor) {
          ops.push(createInsertOp({
            id: opId,
            parentId: rightAnchor,
            side: "left",
            secondParentId: parentId ?? undefined,
            content: { type: "text", value: char },
            marks,
          }));
        } else {
          ops.push(createInsertOp({
            id: opId,
            parentId,
            side: "right",
            content: { type: "text", value: char },
            marks,
          }));
          parentId = opId;
        }
        lastItemId = opId;
      }
    } else if (child.isAtom && child.isInline) {
      const marks = child.marks.length > 0
        ? child.marks.map((m) => ({ type: m.type.name, attrs: m.attrs }))
        : undefined;

      const { clock: newClock, timestamp } = increment({ clock });
      clock = newClock;
      const opId = createOperationId({
        clientId: timestamp.clientId,
        clock: timestamp.clock,
      });

      const content: Content = {
        type: "inline_atom",
        nodeType: child.type.name,
        ...extractInlineAtomAttrs(child),
      };

      if (rightAnchor) {
        ops.push(createInsertOp({
          id: opId,
          parentId: rightAnchor,
          side: "left",
          secondParentId: parentId ?? undefined,
          content,
          marks,
        }));
      } else {
        ops.push(createInsertOp({
          id: opId,
          parentId,
          side: "right",
          content,
          marks,
        }));
        parentId = opId;
      }
      lastItemId = opId;
    }
  });

  return { ops, clock, lastItemId };
}

function insertInlineContentFromSlice(params: {
  slice: Slice;
  parentId: OperationId | null;
  rightAnchor: OperationId | null;
  clock: LamportClock;
}): { ops: Array<Operation>; clock: LamportClock } {
  const ops: Array<Operation> = [];
  let clock = params.clock;
  let parentId = params.parentId;
  const rightAnchor = params.rightAnchor;

  params.slice.content.forEach((node) => {
    if (node.isText && node.text) {
      const marks = node.marks.length > 0
        ? node.marks.map((m) => ({ type: m.type.name, attrs: m.attrs }))
        : undefined;

      for (const char of node.text) {
        const { clock: newClock, timestamp } = increment({ clock });
        clock = newClock;
        const opId = createOperationId({
          clientId: timestamp.clientId,
          clock: timestamp.clock,
        });

        if (rightAnchor) {
          ops.push(createInsertOp({
            id: opId,
            parentId: rightAnchor,
            side: "left",
            secondParentId: parentId ?? undefined,
            content: { type: "text", value: char },
            marks,
          }));
        } else {
          ops.push(createInsertOp({
            id: opId,
            parentId,
            side: "right",
            content: { type: "text", value: char },
            marks,
          }));
          parentId = opId;
        }
      }
    } else if (node.isAtom && node.isInline) {
      const marks = node.marks.length > 0
        ? node.marks.map((m) => ({ type: m.type.name, attrs: m.attrs }))
        : undefined;

      const { clock: newClock, timestamp } = increment({ clock });
      clock = newClock;
      const opId = createOperationId({
        clientId: timestamp.clientId,
        clock: timestamp.clock,
      });

      const content: Content = {
        type: "inline_atom",
        nodeType: node.type.name,
        ...extractInlineAtomAttrs(node),
      };

      if (rightAnchor) {
        ops.push(createInsertOp({
          id: opId,
          parentId: rightAnchor,
          side: "left",
          secondParentId: parentId ?? undefined,
          content,
          marks,
        }));
      } else {
        ops.push(createInsertOp({
          id: opId,
          parentId,
          side: "right",
          content,
          marks,
        }));
        parentId = opId;
      }
    } else {
      // Nested block in inline-only path — recurse into children
      node.content.forEach((child) => {
        if (child.isText && child.text) {
          const marks = child.marks.length > 0
            ? child.marks.map((m) => ({ type: m.type.name, attrs: m.attrs }))
            : undefined;

          for (const char of child.text) {
            const { clock: newClock, timestamp } = increment({ clock });
            clock = newClock;
            const opId = createOperationId({
              clientId: timestamp.clientId,
              clock: timestamp.clock,
            });

            if (rightAnchor) {
              ops.push(createInsertOp({
                id: opId,
                parentId: rightAnchor,
                side: "left",
                secondParentId: parentId ?? undefined,
                content: { type: "text", value: char },
                marks,
              }));
            } else {
              ops.push(createInsertOp({
                id: opId,
                parentId,
                side: "right",
                content: { type: "text", value: char },
                marks,
              }));
              parentId = opId;
            }
          }
        } else if (child.isAtom && child.isInline) {
          const marks = child.marks.length > 0
            ? child.marks.map((m) => ({ type: m.type.name, attrs: m.attrs }))
            : undefined;

          const { clock: newClock, timestamp } = increment({ clock });
          clock = newClock;
          const opId = createOperationId({
            clientId: timestamp.clientId,
            clock: timestamp.clock,
          });

          const content: Content = {
            type: "inline_atom",
            nodeType: child.type.name,
            ...extractInlineAtomAttrs(child),
          };

          if (rightAnchor) {
            ops.push(createInsertOp({
              id: opId,
              parentId: rightAnchor,
              side: "left",
              secondParentId: parentId ?? undefined,
              content,
              marks,
            }));
          } else {
            ops.push(createInsertOp({
              id: opId,
              parentId,
              side: "right",
              content,
              marks,
            }));
            parentId = opId;
          }
        }
      });
    }
  });

  return { ops, clock };
}

// --- Helpers ---

function getItemsInRange(params: {
  doc: CRDTDoc;
  from: number;
  to: number;
  schema?: Schema;
}): Array<Item> {
  return getItemsInProseMirrorRange({
    doc: params.doc,
    from: params.from,
    to: params.to,
    schema: params.schema,
  });
}

function getBlockItemsInRange(params: {
  doc: CRDTDoc;
  from: number;
  to: number;
  schema?: Schema;
}): Array<Item> {
  return getItemsInProseMirrorRange({
    doc: params.doc,
    from: params.from,
    to: params.to,
    schema: params.schema,
    onlyBlocks: true,
  });
}

function extractBlockAttrs(node: PMNode): { attrs?: Record<string, string | number | boolean | null> } {
  const attrSpecs = node.type.spec.attrs;
  if (!attrSpecs) return {};
  const attrs = node.attrs;
  const result: Record<string, string | number | boolean | null> = {};
  let hasNonDefault = false;

  for (const key of Object.keys(attrs)) {
    const defaultValue = attrSpecs[key]?.default;
    if (attrs[key] !== defaultValue) {
      result[key] = attrs[key] as string | number | boolean | null;
      hasNonDefault = true;
    }
  }

  return hasNonDefault ? { attrs: result } : {};
}

function extractInlineAtomAttrs(node: PMNode): { attrs?: Record<string, string | number | boolean | null> } {
  const attrs = node.attrs;
  if (!attrs || Object.keys(attrs).length === 0) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const key of Object.keys(attrs)) {
    result[key] = attrs[key] as string | number | boolean | null;
  }
  return { attrs: result };
}
