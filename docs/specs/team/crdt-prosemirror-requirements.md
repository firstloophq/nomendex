# CRDT ProseMirror Layer: Rich Schema Requirements

> **Status**: Requirements spec for `@crdt/lib` team
> **Consumer**: Nomendex desktop app (notes feature)
> **Date**: 2026-02-18

## Problem

The CRDT lib's ProseMirror integration currently supports flat `doc > paragraph > text` documents. Nomendex's note editor uses `tableSchema` (defined in `bun-sidecar/src/components/prosemirror/tables/schema.ts`) which extends `prosemirror-markdown`'s schema with tables and wiki links. The PM layer cannot represent headings with levels, lists, blockquotes, inline atoms, tables, or leaf blocks — all of which are required for Nomendex notes.

This document specifies every gap between the current CRDT PM layer and what Nomendex needs.

---

## Nomendex's Full ProseMirror Schema

### Block Nodes

| Node | Attrs | Content | Notes |
|---|---|---|---|
| `doc` | — | `block+` | Root |
| `paragraph` | — | `inline*` | |
| `heading` | `level: number` (1–6) | `inline*` | |
| `code_block` | `params: string` | `text*` | Language hint in `params` |
| `blockquote` | — | `block+` | Container (nests blocks) |
| `bullet_list` | — | `list_item+` | Container |
| `ordered_list` | `order: number` (default 1) | `list_item+` | Container |
| `list_item` | — | `paragraph block*` | Container (nests paragraphs + blocks) |
| `horizontal_rule` | — | empty | Leaf block (no content, no children) |
| `image` | `src, alt, title` | empty | Leaf block |
| `table` | — | `table_row+` | Container (nests rows) |
| `table_row` | — | `(table_cell \| table_header)+` | Container (nests cells) |
| `table_cell` | `colspan, rowspan, colwidth, alignment` | `inline*` | Leaf container |
| `table_header` | `colspan, rowspan, colwidth, alignment` | `inline*` | Leaf container |

### Inline Nodes

| Node | Attrs | Atom? | Notes |
|---|---|---|---|
| `text` | — | no | Already supported |
| `hard_break` | — | yes | Inline atom, 1 PM position |
| `wiki_link` | `href: string, title: string` | yes | Inline atom, 1 PM position |

### Marks

| Mark | Attrs | Notes |
|---|---|---|
| `em` | — | |
| `strong` | — | |
| `code` | — | |
| `link` | `href: string, title: string \| null` | `title` defaults to `null` |

---

## Category A: Block Attributes

### What's broken

`crdtToProseMirror` ignores `BlockContent.attrs` — line 62 calls `nodeType.create()` with no attrs, and line 66 calls `nodeType.create(null, inlineNodes)`. A heading stored as `{ type: "block", blockType: "heading", attrs: { level: 2 } }` renders as `<h1>` (the default) instead of `<h2>`.

`transactionToCRDTOps` drops attrs on block insertion — line 125 emits `content: { type: "block", blockType: node.type.name }` without `attrs`.

No operation exists to change attrs on an existing block (e.g., changing a heading from level 2 to level 3 via keyboard shortcut). ProseMirror emits an `AttrStep` for this.

### Required changes

**`state-mapping.ts` — `crdtToProseMirror`**:
```typescript
// Line 62: empty block
blocks.push(nodeType.create(blockItem.content.attrs ?? null));

// Line 66: block with content
blocks.push(nodeType.create(blockItem.content.attrs ?? null, inlineNodes));
```

**`transaction-capture.ts` — `handleReplaceStep`**:
```typescript
// Line 125: capture attrs from PM node
content: {
  type: "block",
  blockType: node.type.name,
  attrs: Object.keys(node.attrs).length > 0 ? node.attrs : undefined,
},
```

**`operations.ts` — new `AttrUpdateOp`**:
```typescript
export interface AttrUpdateOp {
  readonly type: "attr_update";
  readonly id: OperationId;
  readonly targetId: OperationId;         // The block item to update
  readonly attr: string;                   // Attribute key
  readonly value: string | number | boolean | null;  // New value
}

export type Operation = InsertOp | DeleteOp | FormatOp | AttrUpdateOp;
```

**`transaction-capture.ts` — handle `AttrStep`**:
```typescript
import { AttrStep } from "prosemirror-transform";

// In transactionToCRDTOps step loop:
} else if (step instanceof AttrStep) {
  const result = handleAttrStep({ step, crdtDoc, clock });
  ops.push(...result.ops);
  clock = result.clock;
}
```

**`apply-operations.ts`**: Apply `attr_update` by finding the target item and updating its `content.attrs`.

**`operations.ts` — widen `BlockContent.attrs` value type**:
```typescript
export interface BlockContent {
  readonly type: "block";
  readonly blockType: string;
  readonly attrs?: Record<string, string | number | boolean | null>;
}
```

The `| null` is needed because ProseMirror attrs commonly default to `null` (e.g., `table_cell.alignment`).

### Affected nodes

| Node | Attr | Type |
|---|---|---|
| `heading` | `level` | `number` |
| `code_block` | `params` | `string` |
| `ordered_list` | `order` | `number` |
| `table_cell` | `alignment` | `string \| null` |
| `table_cell` | `colspan` | `number` |
| `table_cell` | `rowspan` | `number` |
| `table_cell` | `colwidth` | serialized JSON string (PM uses `number[] \| null`) |
| `table_header` | (same as table_cell) | |
| `image` | `src, alt, title` | `string` |

---

## Category B: Inline Atoms

### What's broken

`buildInlineNodes` (state-mapping.ts:78–109) only handles `item.content.type === "text"`. There is no content type to represent inline atoms like `wiki_link`, `hard_break`, or `image` (when inline).

`handleReplaceStep` (transaction-capture.ts:139–168) iterates child nodes with `child.isText` — non-text inline nodes are silently dropped.

`proseMirrorPositionToCRDT` and `getItemsInRange` only count `"text"` content as 1 position. Inline atoms also occupy 1 PM position but have no representation.

### Required changes

**`operations.ts` — new `InlineAtomContent`**:
```typescript
export interface InlineAtomContent {
  readonly type: "inline_atom";
  readonly nodeType: string;   // "wiki_link", "hard_break", "image"
  readonly attrs?: Record<string, string | number | boolean | null>;
}

export type Content = TextContent | BlockContent | InlineAtomContent;
```

**`state-mapping.ts` — `buildInlineNodes`**:

After the text-handling branch, add:
```typescript
if (item.content.type === "inline_atom") {
  // Flush any pending text first
  if (currentText) {
    const pmMarks = currentMarks.map((m) => schema.marks[m.type]!.create(m.attrs));
    nodes.push(schema.text(currentText, pmMarks));
    currentText = "";
  }
  const atomType = schema.nodes[item.content.nodeType];
  if (atomType) {
    const pmMarks = (item.marks ?? []).map((m) => schema.marks[m.type]!.create(m.attrs));
    nodes.push(atomType.create(item.content.attrs ?? null, null, pmMarks));
  }
}
```

**`state-mapping.ts` — `crdtToProseMirror`**:

When assigning items to blocks (line 33–49), include `inline_atom` items alongside `text` items:
```typescript
} else if (item.content.type === "text" || item.content.type === "inline_atom") {
```

**`state-mapping.ts` — `proseMirrorPositionToCRDT`**:

Count inline atoms as 1 position (same as text):
```typescript
} else if (item.content.type === "text" || item.content.type === "inline_atom") {
  currentPos++;
  // ... same logic
}
```

**`transaction-capture.ts` — `getItemsInRange`**:

Same position counting fix:
```typescript
} else if (item.content.type === "text" || item.content.type === "inline_atom") {
  currentPos++;
  if (currentPos > from && currentPos <= to) {
    result.push(item);
  }
}
```

**`transaction-capture.ts` — `handleReplaceStep`**:

When iterating block content children (lines 139–168), handle non-text inline nodes:
```typescript
node.content.forEach((child) => {
  if (child.isText && child.text) {
    // existing char-by-char insertion...
  } else if (child.isInline && child.isAtom) {
    // Insert inline atom as single op
    const { clock: newClock, timestamp } = increment({ clock });
    clock = newClock;
    const opId = createOperationId({
      clientId: timestamp.clientId,
      clock: timestamp.clock,
    });
    ops.push(createInsertOp({
      id: opId,
      parentId,
      side: "right",
      content: {
        type: "inline_atom",
        nodeType: child.type.name,
        attrs: Object.keys(child.attrs).length > 0 ? child.attrs : undefined,
      },
      marks: child.marks.length > 0
        ? child.marks.map((m) => ({ type: m.type.name, attrs: m.attrs }))
        : undefined,
    }));
    parentId = opId;
  }
});
```

Also handle inline atoms in the non-block branch (simple text insertion, lines 170–199) — currently `extractTextFromSlice` drops them.

### Affected nodes

| Node | Attrs | Notes |
|---|---|---|
| `wiki_link` | `href: string, title: string` | Most common inline atom in Nomendex |
| `hard_break` | — | `Shift+Enter` |
| `image` (inline) | `src: string, alt: string, title: string` | When schema defines image as inline |

---

## Category C: Leaf Blocks

### What's broken

`horizontal_rule` is a leaf block — it has no content and no opening/closing tag pair in PM's position model. It occupies exactly 1 PM position (not 2 like container blocks).

`proseMirrorPositionToCRDT` treats every block as 2 positions (opening + closing tag). A leaf block after the first paragraph would be at position `textLength + 2` but the code counts it as `textLength + 3`.

`getItemsInRange` has the same overcounting.

### Required changes

Both `proseMirrorPositionToCRDT` and `getItemsInRange` need to distinguish leaf blocks from container blocks. The simplest approach: accept the PM `schema` as a parameter and check `nodeType.isLeaf`:

```typescript
export function proseMirrorPositionToCRDT(params: {
  doc: CRDTDoc;
  pos: number;
  schema: Schema;  // NEW parameter
}): CRDTPosition {
  // ...
  if (item.content.type === "block") {
    const nodeType = params.schema.nodes[item.content.blockType];
    const isLeaf = nodeType?.isLeaf ?? false;

    if (isLeaf) {
      // Leaf blocks occupy 1 position total
      currentPos++;
      blockCount++;
      // ...
    } else {
      // Container blocks occupy opening + closing = 2 positions around content
      if (blockCount > 0) currentPos++; // closing tag of previous
      currentPos++; // opening tag
      blockCount++;
      // ...
    }
  }
}
```

Same pattern for `getItemsInRange`.

**`plugin.ts`**: Pass `schema` through to all `proseMirrorPositionToCRDT` and `getItemsInRange` calls.

### Affected nodes

| Node | Notes |
|---|---|
| `horizontal_rule` | Most common leaf block |
| `image` | Leaf block when schema defines it as block-level |

---

## Category D: Container Blocks (Nesting)

This is the largest change. Blockquote, lists, and tables all nest blocks inside other blocks. The current flat CRDT model has no concept of parent-child relationships between blocks.

### What's broken

A blockquote containing two paragraphs looks like:
```
blockquote > paragraph("hello") + paragraph("world")
```

The CRDT stores blocks in a flat sequence. There's no way to express that two paragraphs are *inside* a blockquote. Inserting a paragraph between them would place it at the document root, not inside the blockquote.

List structures are even deeper:
```
bullet_list > list_item > paragraph("item 1")
            > list_item > paragraph("item 2")
```

ProseMirror uses `ReplaceAroundStep` (not `ReplaceStep`) for wrap/unwrap operations (e.g., wrapping paragraphs in a blockquote, or converting paragraphs to list items). The current code doesn't handle `ReplaceAroundStep` at all.

### Required changes

**`operations.ts` — add `parentId` to `BlockContent`**:
```typescript
export interface BlockContent {
  readonly type: "block";
  readonly blockType: string;
  readonly attrs?: Record<string, string | number | boolean | null>;
  readonly parentId?: OperationId;  // NEW: which block contains this one
}
```

Root-level blocks have `parentId: undefined`. Nested blocks reference their container's operation ID.

**`operations.ts` — new `ReparentOp`**:
```typescript
export interface ReparentOp {
  readonly type: "reparent";
  readonly id: OperationId;
  readonly targetId: OperationId;          // Block to move
  readonly newParentId: OperationId | null; // New container (null = root)
}

export type Operation = InsertOp | DeleteOp | FormatOp | AttrUpdateOp | ReparentOp;
```

Used for wrap (paragraph → list_item child) and lift (list_item child → root paragraph) operations.

**`apply-operations.ts`**: Handle `reparent` op by updating the target item's `content.parentId`.

**`state-mapping.ts` — full rewrite of `crdtToProseMirror`**:

Replace the flat block iteration with recursive tree reconstruction:

```typescript
function crdtToProseMirror(params: { doc: CRDTDoc; schema: Schema }): PMNode {
  const visibleItems = params.doc.store.items.filter((i) => !i.deleted);

  // 1. Separate blocks from inline items
  // 2. Build parent→children map using parentId
  // 3. Assign inline items to their parent block (walk document order)
  // 4. Recursively build PM nodes:
  //    - For each root block (parentId === undefined):
  //      - If container (has children blocks): build children recursively
  //      - If leaf container (has inline content): buildInlineNodes
  //      - If leaf block (no content): create empty node
  // 5. Return doc node
}
```

Key detail: `buildInlineNodes` stays the same for leaf containers (paragraphs, headings, cells). Container blocks (blockquote, lists) delegate to recursive children.

**`state-mapping.ts` — rewrite `proseMirrorPositionToCRDT`**:

The current flat position counting breaks with nesting. A blockquote containing a paragraph has this PM position layout:

```
0: before doc
1: <blockquote>     (blockquote opening)
2:   <paragraph>    (paragraph opening)
3:   H              (text)
4:   i              (text)
5:   </paragraph>   (paragraph closing)
6: </blockquote>    (blockquote closing)
```

The function needs to walk the tree recursively, counting positions for each nesting level. Accept `schema` parameter to determine which nodes are containers vs leaves.

**`transaction-capture.ts` — handle `ReplaceAroundStep`**:

```typescript
import { ReplaceAroundStep } from "prosemirror-transform";

// In transactionToCRDTOps step loop:
} else if (step instanceof ReplaceAroundStep) {
  const result = handleReplaceAroundStep({ step, crdtDoc, clock, schema });
  ops.push(...result.ops);
  clock = result.clock;
}
```

`ReplaceAroundStep` wraps or unwraps content. It has `from`, `to`, `gapFrom`, `gapTo`, `insert`, `structure`:
- **Wrap** (e.g., paragraphs → blockquote): Insert new container block, reparent the wrapped blocks
- **Unwrap/Lift** (e.g., blockquote → paragraphs): Reparent children to parent's parent, delete the container

**`transaction-capture.ts` — recursive block insertion**:

When a `ReplaceStep` slice contains nested block structures (e.g., pasting a blockquote with paragraphs), the block insertion loop (lines 104–169) needs to recurse into child blocks and set `parentId` on each:

```typescript
function insertBlockRecursive(params: {
  node: PMNode;
  parentId: OperationId | null;
  // ...
}): { ops: Operation[]; clock: LamportClock } {
  // 1. Create InsertOp for this block with parentId
  // 2. For each inline child: insert text/atom ops
  // 3. For each block child: recurse with this block's ID as parentId
}
```

### Nesting model

```
bullet_list (parentId: null)         ← root block
  list_item (parentId: bullet_list)  ← child of bullet_list
    paragraph (parentId: list_item)  ← child of list_item
      text items...                  ← inline content of paragraph
  list_item (parentId: bullet_list)
    paragraph (parentId: list_item)
      text items...
```

### Affected nodes

| Node | Role | Children |
|---|---|---|
| `blockquote` | Container | `block+` |
| `bullet_list` | Container | `list_item+` |
| `ordered_list` | Container | `list_item+` |
| `list_item` | Container | `paragraph block*` |

---

## Category E: Tables

Tables use the nesting model from Category D but have additional requirements.

### Structure

```
table (parentId: null)
  table_row (parentId: table)
    table_cell (parentId: table_row, attrs: { colspan, rowspan, colwidth, alignment })
      inline content...
    table_header (parentId: table_row, attrs: { colspan, rowspan, colwidth, alignment })
      inline content...
  table_row (parentId: table)
    ...
```

### Cell attributes

| Attr | Type | Default | Notes |
|---|---|---|---|
| `colspan` | `number` | `1` | |
| `rowspan` | `number` | `1` | |
| `colwidth` | `number[] \| null` | `null` | Serialize as JSON string in CRDT attrs |
| `alignment` | `"left" \| "center" \| "right" \| null` | `null` | Nomendex custom cell attr |

`colwidth` is a `number[]` in ProseMirror but the CRDT `attrs` type only supports scalar values. Serialize it as a JSON string:
```typescript
// PM → CRDT
attrs: {
  ...cellNode.attrs,
  colwidth: cellNode.attrs.colwidth ? JSON.stringify(cellNode.attrs.colwidth) : null,
}

// CRDT → PM
const pmAttrs = {
  ...blockItem.content.attrs,
  colwidth: typeof attrs.colwidth === "string" ? JSON.parse(attrs.colwidth) : null,
};
```

### Structural operations

ProseMirror's `prosemirror-tables` module generates these step patterns:

| User action | PM steps | CRDT ops needed |
|---|---|---|
| Add row | `ReplaceStep` (insert row + cells) | Insert `table_row` block + N `table_cell` blocks with `parentId` |
| Delete row | `ReplaceStep` (delete row range) | Delete `table_row` + all child cells |
| Add column | Multiple `ReplaceStep`s (one per row, insert cell) | Insert `table_cell` with `parentId` per row |
| Delete column | Multiple `ReplaceStep`s (one per row, delete cell) | Delete `table_cell` per row |
| Merge cells | `ReplaceStep` + `AttrStep` | Delete merged cells, update `colspan`/`rowspan` via `AttrUpdateOp` |
| Split cell | `ReplaceStep` | Insert new cells, update attrs |

These are all expressible through existing op types (Insert, Delete, AttrUpdate) once nesting is supported. No table-specific ops are needed.

### Dependencies

Tables require all of:
- Category A (block attrs) — cell attrs
- Category C (leaf blocks) — `image` inside cells is possible
- Category D (nesting) — `table > row > cell` hierarchy

---

## Category F: Marks

### What's broken

The `Mark.attrs` type is `Record<string, string | number | boolean>` but ProseMirror's `link` mark has `title: null` as its default. When `handleAddMarkStep` captures `step.mark.attrs` (line 224), the `null` value is passed into the CRDT mark but the type doesn't allow it.

### Required changes

**`operations.ts` — widen `Mark.attrs`**:
```typescript
export interface Mark {
  readonly type: string;
  readonly attrs?: Record<string, string | number | boolean | null>;
}
```

**`state-mapping.ts` — `marksEqual`**: Already handles this correctly since it compares with `===` which works for `null`.

### Affected marks

| Mark | Attr with null | Notes |
|---|---|---|
| `link` | `title` | Defaults to `null` in prosemirror-markdown |

---

## Files to Change (Summary)

| File | Changes | Category |
|---|---|---|
| `src/crdt/core/operations.ts` | `InlineAtomContent` type, `AttrUpdateOp`, `ReparentOp`, `parentId` on `BlockContent`, widen attrs to allow `null` | A, B, D, F |
| `src/crdt/core/apply-operations.ts` | Handle `attr_update` and `reparent` op types | A, D |
| `src/crdt/prosemirror/state-mapping.ts` | Pass attrs to `nodeType.create()`, handle `inline_atom` in `buildInlineNodes` and position mapping, leaf block positions, recursive tree reconstruction | A, B, C, D |
| `src/crdt/prosemirror/transaction-capture.ts` | Capture block attrs, handle inline atoms in content iteration, `AttrStep` handler, `ReplaceAroundStep` handler, recursive block insertion with `parentId` | A, B, D |
| `src/crdt/prosemirror/plugin.ts` | Pass `schema` to `proseMirrorPositionToCRDT` and `getItemsInRange` calls | C |
| `src/crdt/core/undo-manager.ts` | Inverse ops for `AttrUpdateOp` (restore previous value) and `ReparentOp` (restore previous parent) | A, D |
| `src/crdt/core/encoding.ts` (if exists) | Encode/decode new op types and content types for wire format | All |

---

## Suggested Implementation Phases

### Phase 1: Block Attrs + Leaf Blocks

**Scope**: Categories A + C + F (attrs null widening)

- Pass `blockItem.content.attrs` through in `crdtToProseMirror`
- Capture `node.attrs` in `transactionToCRDTOps` block insertion
- Add `AttrUpdateOp` and handle `AttrStep`
- Widen `null` in `BlockContent.attrs` and `Mark.attrs`
- Add `schema` param to position functions, handle leaf block positions
- Add `AttrUpdateOp` inverse to undo manager

**Unblocks**: Headings with levels, code blocks with language, ordered lists with start number.

**Test**: Create a heading-2, change it to heading-3 via `AttrStep`, verify round-trip.

### Phase 2: Inline Atoms

**Scope**: Category B

- Add `InlineAtomContent` type
- Update `buildInlineNodes` to handle inline atoms
- Update position mapping to count inline atoms
- Update `handleReplaceStep` to emit inline atom ops
- Update `getItemsInRange` to include inline atoms
- Update `extractTextFromSlice` or replace with richer slice walker

**Unblocks**: Wiki links, hard breaks, inline images.

**Test**: Insert `[[My Note]]` wiki link, verify it round-trips with correct attrs. Insert `Shift+Enter` hard break, verify position mapping.

### Phase 3: Nesting

**Scope**: Category D

- Add `parentId` to `BlockContent`
- Add `ReparentOp`
- Rewrite `crdtToProseMirror` with recursive tree building
- Rewrite `proseMirrorPositionToCRDT` with nested position counting
- Handle `ReplaceAroundStep` for wrap/lift
- Recursive block insertion in `handleReplaceStep`
- `ReparentOp` inverse in undo manager

**Unblocks**: Blockquotes, bullet lists, ordered lists, list items.

**Test**: Create a bullet list with 3 items, wrap in blockquote, unwrap, verify CRDT state at each step. Concurrent list edits (two clients adding items to same list).

### Phase 4: Tables

**Scope**: Category E

- Table nesting uses Phase 3 infrastructure
- Cell attr serialization (especially `colwidth` as JSON string)
- Table structural operations (add/remove row/column, merge/split)
- Integration test with `prosemirror-tables` commands

**Unblocks**: Full table editing in collaborative notes.

**Test**: Create 3x3 table, add row, delete column, merge cells, verify CRDT state. Two clients editing different cells concurrently.

### Phase 5: Polish

- Undo/redo for all new op types with full round-trip verification
- Encoding/decoding round-trips for new content types and ops
- Integration test suite using Nomendex's `tableSchema` directly
- Performance: ensure tree reconstruction doesn't regress for large documents
- Edge cases: empty containers, deeply nested lists (4+ levels), mixed table content

---

## Nomendex Integration (After Lib Updates)

Once all phases are complete, the Nomendex integration work is:

1. Install updated `@crdt/lib` in `bun-sidecar`
2. Replace `ySyncPlugin`/`yCursorPlugin`/`yUndoPlugin` in `note-view.tsx` with `createCRDTPlugin` + cursor decorations
3. Connect `onLocalOps` callback to WebSocket transport
4. Handle `applyRemoteOps` on incoming WebSocket messages
5. Bootstrap: convert existing markdown notes to CRDT docs on first collab session
6. Remove `y-prosemirror`, `yjs`, `y-websocket` dependencies
7. Delete `CollabContext.tsx` and `nomendex-collab/` Durable Objects

No changes to the PM schema itself — `tableSchema` stays exactly as-is.
