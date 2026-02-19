import { type Node as PMNode, Schema, Fragment } from "prosemirror-model";
import type { CRDTDoc } from "../core/apply-operations";
import type { OperationId, Mark as CRDTMark } from "../core/operations";
import type { Item } from "../core/item";

// --- CRDT → ProseMirror ---

export function crdtToProseMirror(params: {
  doc: CRDTDoc;
  schema: Schema;
}): PMNode {
  const { doc, schema } = params;

  const visibleItems = doc.store.items.filter((item) => !item.deleted);

  // Separate block items from inline items
  const blockItems: Array<Item> = [];
  const inlineByBlock: Map<string, Array<Item>> = new Map();

  // Build parentBlockId → children map for nesting
  const childBlocksByParent: Map<string | null, Array<Item>> = new Map();
  childBlocksByParent.set(null, []); // root blocks

  // Find blocks and build inline lists
  for (const item of visibleItems) {
    if (item.content.type === "block") {
      blockItems.push(item);
      inlineByBlock.set(itemKey(item.id), []);

      const parentKey = item.content.parentBlockId
        ? itemKey(item.content.parentBlockId)
        : null;
      if (!childBlocksByParent.has(parentKey)) {
        childBlocksByParent.set(parentKey, []);
      }
      childBlocksByParent.get(parentKey)!.push(item);
    }
  }

  // Assign inline items (text + inline_atom) to their parent block
  if (blockItems.length > 0) {
    let currentBlockKey = itemKey(blockItems[0]!.id);
    for (const item of visibleItems) {
      if (item.content.type === "block") {
        currentBlockKey = itemKey(item.id);
      } else if (item.content.type === "text" || item.content.type === "inline_atom") {
        if (item.leftOrigin) {
          const originItem = doc.store.map.get(itemKey(item.leftOrigin));
          if (originItem && originItem.content.type === "block") {
            currentBlockKey = itemKey(originItem.id);
          }
        }
        const arr = inlineByBlock.get(currentBlockKey);
        if (arr) {
          arr.push(item);
        }
      }
    }
  }

  // Recursive function to build a PM node from a block item
  function buildNode(blockItem: Item): PMNode | null {
    if (blockItem.content.type !== "block") return null;
    const nodeType = schema.nodes[blockItem.content.blockType];
    if (!nodeType) return null;

    const blockKey = itemKey(blockItem.id);
    const childBlocks = childBlocksByParent.get(blockKey) ?? [];
    const inlineItems = inlineByBlock.get(blockKey) ?? [];
    const attrs = blockItem.content.attrs ?? null;
    const paragraphType = schema.nodes["paragraph"];
    const isListItem = nodeType.name === "list_item";

    const withRequiredListItemParagraph = (children: Array<PMNode>): Array<PMNode> => {
      if (!isListItem || !paragraphType) {
        return children;
      }
      if (children.length > 0 && children[0]!.type.name === "paragraph") {
        return children;
      }
      return [paragraphType.create(), ...children];
    };

    if (childBlocks.length > 0 && inlineItems.length > 0) {
      // Mixed content container (e.g., list_item with paragraph + nested list)
      // Group inlines into an implicit paragraph, then add child blocks
      const inlineNodes = buildInlineNodes({ inlineItems, schema });
      const childNodes: Array<PMNode> = [];
      if (inlineNodes.length > 0 && paragraphType) {
        childNodes.push(paragraphType.create(null, inlineNodes));
      }
      for (const child of childBlocks) {
        const childNode = buildNode(child);
        if (childNode) childNodes.push(childNode);
      }
      return nodeType.create(attrs, withRequiredListItemParagraph(childNodes));
    } else if (childBlocks.length > 0) {
      // Pure container (blockquote, bullet_list, etc.)
      const childNodes: Array<PMNode> = [];
      for (const child of childBlocks) {
        const childNode = buildNode(child);
        if (childNode) childNodes.push(childNode);
      }
      return nodeType.create(attrs, withRequiredListItemParagraph(childNodes));
    } else if (inlineItems.length > 0) {
      // Leaf container with inline content (paragraph, heading, cell)
      const inlineNodes = buildInlineNodes({ inlineItems, schema });
      if (isListItem && paragraphType) {
        return nodeType.create(attrs, [paragraphType.create(null, inlineNodes)]);
      }
      return nodeType.create(attrs, inlineNodes);
    } else {
      // Leaf block (horizontal_rule) or empty container
      if (isListItem && paragraphType) {
        return nodeType.create(attrs, [paragraphType.create()]);
      }
      return nodeType.create(attrs);
    }
  }

  // Build root-level nodes
  const rootBlocks = childBlocksByParent.get(null) ?? [];
  const blocks: Array<PMNode> = [];

  for (const blockItem of rootBlocks) {
    const node = buildNode(blockItem);
    if (node) blocks.push(node);
  }

  // If no blocks, add an empty paragraph (ProseMirror requires at least one block)
  if (blocks.length === 0) {
    blocks.push(schema.nodes["paragraph"]!.create());
  }

  return schema.nodes["doc"]!.create(null, blocks);
}

function buildInlineNodes(params: {
  inlineItems: Array<Item>;
  schema: Schema;
}): Array<PMNode> {
  const { inlineItems, schema } = params;
  const nodes: Array<PMNode> = [];

  let currentText = "";
  let currentMarks: ReadonlyArray<CRDTMark> = [];

  function flushText() {
    if (currentText) {
      const pmMarks = currentMarks.map((m) => schema.marks[m.type]!.create(m.attrs));
      nodes.push(schema.text(currentText, pmMarks));
      currentText = "";
    }
  }

  for (const item of inlineItems) {
    if (item.content.type === "text") {
      const itemMarks = item.marks ?? [];
      if (currentText && !marksEqual(currentMarks, itemMarks)) {
        flushText();
      }
      currentMarks = itemMarks;
      currentText += item.content.value;
    } else if (item.content.type === "inline_atom") {
      // Flush any pending text before the inline atom
      flushText();
      currentMarks = [];

      const atomType = schema.nodes[item.content.nodeType];
      if (atomType) {
        const pmMarks = (item.marks ?? []).map((m) => schema.marks[m.type]!.create(m.attrs));
        nodes.push(atomType.create(item.content.attrs ?? null, null, pmMarks));
      }
    }
  }

  // Flush remaining text
  flushText();

  return nodes;
}

function marksEqual(a: ReadonlyArray<CRDTMark>, b: ReadonlyArray<CRDTMark>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.type !== b[i]!.type) return false;
    const aAttrs = a[i]!.attrs;
    const bAttrs = b[i]!.attrs;
    if (aAttrs === undefined && bAttrs === undefined) continue;
    if (aAttrs === undefined || bAttrs === undefined) return false;
    const aKeys = Object.keys(aAttrs);
    const bKeys = Object.keys(bAttrs);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (aAttrs[key] !== bAttrs[key]) return false;
    }
  }
  return true;
}

// --- ProseMirror position → CRDT item ---

export interface CRDTPosition {
  readonly leftItemId: OperationId | null;
  readonly rightItemId: OperationId | null;
  readonly blockId: OperationId | null;
}

interface LayoutToken {
  kind: "item" | "meta";
  itemId?: OperationId;
  pushBlockId?: OperationId;
  popBlock?: boolean;
}

interface PositionLayout {
  tokens: Array<LayoutToken>;
  visibleItemByKey: Map<string, Item>;
  prevItemAtPos: Array<OperationId | null>;
  nextItemAtPos: Array<OperationId | null>;
  blockAtPos: Array<OperationId | null>;
}

export function getItemsInProseMirrorRange(params: {
  doc: CRDTDoc;
  from: number;
  to: number;
  schema?: Schema;
  onlyBlocks?: boolean;
}): Array<Item> {
  const layout = buildPositionLayout({
    doc: params.doc,
    schema: params.schema,
  });

  const maxPos = layout.tokens.length;
  const from = clampPos({ pos: params.from, maxPos });
  const to = clampPos({ pos: params.to, maxPos });
  if (from >= to) return [];

  const result: Array<Item> = [];
  const seen = new Set<string>();

  for (let i = 0; i < layout.tokens.length; i++) {
    const pos = i + 1;
    if (pos <= from || pos > to) continue;
    const token = layout.tokens[i]!;
    if (token.kind !== "item" || !token.itemId) continue;
    const key = itemKey(token.itemId);
    if (seen.has(key)) continue;

    const item = layout.visibleItemByKey.get(key);
    if (!item) continue;
    if (params.onlyBlocks && item.content.type !== "block") continue;

    result.push(item);
    seen.add(key);
  }

  return result;
}

export function proseMirrorPositionToCRDT(params: {
  doc: CRDTDoc;
  pos: number;
  schema?: Schema;
}): CRDTPosition {
  const layout = buildPositionLayout({
    doc: params.doc,
    schema: params.schema,
  });
  const clampedPos = clampPos({ pos: params.pos, maxPos: layout.tokens.length });
  return {
    leftItemId: layout.prevItemAtPos[clampedPos] ?? null,
    rightItemId: layout.nextItemAtPos[clampedPos] ?? null,
    blockId: layout.blockAtPos[clampedPos] ?? null,
  };
}

function buildPositionLayout(params: {
  doc: CRDTDoc;
  schema?: Schema;
}): PositionLayout {
  const maps = buildVisibleStructureMaps({ doc: params.doc });
  const tokens: Array<LayoutToken> = [];

  const rootBlocks = maps.childBlocksByParent.get(null) ?? [];
  for (const block of rootBlocks) {
    appendBlockTokens({
      blockItem: block,
      schema: params.schema,
      childBlocksByParent: maps.childBlocksByParent,
      inlineByBlock: maps.inlineByBlock,
      tokens,
    });
  }

  const prevItemAtPos = buildPrevItemAtPos(tokens);
  const nextItemAtPos = buildNextItemAtPos(tokens);
  const blockAtPos = buildBlockAtPos(tokens);

  return {
    tokens,
    visibleItemByKey: maps.visibleItemByKey,
    prevItemAtPos,
    nextItemAtPos,
    blockAtPos,
  };
}

function buildVisibleStructureMaps(params: {
  doc: CRDTDoc;
}): {
  childBlocksByParent: Map<string | null, Array<Item>>;
  inlineByBlock: Map<string, Array<Item>>;
  visibleItemByKey: Map<string, Item>;
} {
  const visibleItems = params.doc.store.items.filter((item) => !item.deleted);
  const blockItems: Array<Item> = [];
  const inlineByBlock: Map<string, Array<Item>> = new Map();
  const childBlocksByParent: Map<string | null, Array<Item>> = new Map();
  childBlocksByParent.set(null, []);

  for (const item of visibleItems) {
    if (item.content.type !== "block") continue;
    blockItems.push(item);
    inlineByBlock.set(itemKey(item.id), []);

    const parentKey = item.content.parentBlockId
      ? itemKey(item.content.parentBlockId)
      : null;
    if (!childBlocksByParent.has(parentKey)) {
      childBlocksByParent.set(parentKey, []);
    }
    childBlocksByParent.get(parentKey)!.push(item);
  }

  if (blockItems.length > 0) {
    let currentBlockKey = itemKey(blockItems[0]!.id);
    for (const item of visibleItems) {
      if (item.content.type === "block") {
        currentBlockKey = itemKey(item.id);
        continue;
      }

      if (item.content.type === "text" || item.content.type === "inline_atom") {
        if (item.leftOrigin) {
          const originItem = params.doc.store.map.get(itemKey(item.leftOrigin));
          if (originItem && originItem.content.type === "block") {
            currentBlockKey = itemKey(originItem.id);
          }
        }
        const arr = inlineByBlock.get(currentBlockKey);
        if (arr) arr.push(item);
      }
    }
  }

  const visibleItemByKey: Map<string, Item> = new Map();
  for (const item of visibleItems) {
    visibleItemByKey.set(itemKey(item.id), item);
  }

  return {
    childBlocksByParent,
    inlineByBlock,
    visibleItemByKey,
  };
}

function appendBlockTokens(params: {
  blockItem: Item;
  schema?: Schema;
  childBlocksByParent: Map<string | null, Array<Item>>;
  inlineByBlock: Map<string, Array<Item>>;
  tokens: Array<LayoutToken>;
}): void {
  const { blockItem, schema, childBlocksByParent, inlineByBlock, tokens } = params;
  if (blockItem.content.type !== "block") return;

  const nodeType = schema?.nodes[blockItem.content.blockType];
  if (schema && !nodeType) return;

  const isLeaf = schema
    ? nodeType?.isLeaf ?? false
    : false;
  const blockKey = itemKey(blockItem.id);
  const childBlocks = childBlocksByParent.get(blockKey) ?? [];
  const inlineItems = inlineByBlock.get(blockKey) ?? [];
  const firstChild = childBlocks[0];
  const firstChildIsParagraph = firstChild?.content.type === "block"
    && firstChild.content.blockType === "paragraph";
  const needsImplicitListItemParagraph = blockItem.content.blockType === "list_item"
    && (childBlocks.length === 0 || !firstChildIsParagraph);

  if (isLeaf) {
    tokens.push({
      kind: "item",
      itemId: blockItem.id,
    });
    return;
  }

  tokens.push({
    kind: "item",
    itemId: blockItem.id,
    pushBlockId: blockItem.id,
  });

  if (childBlocks.length > 0 && inlineItems.length > 0) {
    // `list_item` can contain both paragraph text and nested blocks; PM wraps
    // direct inline content in an implicit paragraph in this case.
    tokens.push({ kind: "meta" }); // implicit paragraph open
    appendInlineTokens({
      inlineItems,
      tokens,
    });
    tokens.push({ kind: "meta" }); // implicit paragraph close

    for (const child of childBlocks) {
      appendBlockTokens({
        blockItem: child,
        schema,
        childBlocksByParent,
        inlineByBlock,
        tokens,
      });
    }
  } else if (childBlocks.length > 0) {
    if (needsImplicitListItemParagraph) {
      // `list_item` requires a leading paragraph even when only nested blocks exist.
      tokens.push({ kind: "meta" }); // implicit paragraph open
      tokens.push({ kind: "meta" }); // implicit paragraph close
    }
    for (const child of childBlocks) {
      appendBlockTokens({
        blockItem: child,
        schema,
        childBlocksByParent,
        inlineByBlock,
        tokens,
      });
    }
  } else {
    if (blockItem.content.blockType === "list_item") {
      // `list_item` requires paragraph wrapping, including empty list items.
      tokens.push({ kind: "meta" }); // implicit paragraph open
      appendInlineTokens({
        inlineItems,
        tokens,
      });
      tokens.push({ kind: "meta" }); // implicit paragraph close
    } else {
      appendInlineTokens({
        inlineItems,
        tokens,
      });
    }
  }

  tokens.push({
    kind: "meta",
    popBlock: true,
  });
}

function appendInlineTokens(params: {
  inlineItems: Array<Item>;
  tokens: Array<LayoutToken>;
}): void {
  for (const inlineItem of params.inlineItems) {
    if (inlineItem.content.type !== "text" && inlineItem.content.type !== "inline_atom") continue;
    params.tokens.push({
      kind: "item",
      itemId: inlineItem.id,
    });
  }
}

function buildPrevItemAtPos(tokens: Array<LayoutToken>): Array<OperationId | null> {
  const result: Array<OperationId | null> = new Array(tokens.length + 1).fill(null);
  let prev: OperationId | null = null;

  for (let pos = 0; pos <= tokens.length; pos++) {
    result[pos] = prev;
    if (pos === tokens.length) continue;
    const token = tokens[pos]!;
    if (token.kind === "item" && token.itemId) {
      prev = token.itemId;
    }
  }

  return result;
}

function buildNextItemAtPos(tokens: Array<LayoutToken>): Array<OperationId | null> {
  const result: Array<OperationId | null> = new Array(tokens.length + 1).fill(null);
  let next: OperationId | null = null;

  for (let pos = tokens.length; pos >= 0; pos--) {
    result[pos] = next;
    if (pos === 0) continue;
    const token = tokens[pos - 1]!;
    if (token.kind === "item" && token.itemId) {
      next = token.itemId;
    }
  }

  return result;
}

function buildBlockAtPos(tokens: Array<LayoutToken>): Array<OperationId | null> {
  const result: Array<OperationId | null> = new Array(tokens.length + 1).fill(null);
  const openBlocks: Array<OperationId> = [];
  result[0] = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.pushBlockId) {
      openBlocks.push(token.pushBlockId);
    }
    if (token.popBlock) {
      openBlocks.pop();
    }
    result[i + 1] = openBlocks.length > 0
      ? openBlocks[openBlocks.length - 1]!
      : null;
  }

  return result;
}

function clampPos(params: {
  pos: number;
  maxPos: number;
}): number {
  if (!Number.isFinite(params.pos)) return 0;
  if (params.pos < 0) return 0;
  if (params.pos > params.maxPos) return params.maxPos;
  return Math.floor(params.pos);
}

function itemKey(id: OperationId): string {
  return `${id.clientId}:${id.clock}`;
}
