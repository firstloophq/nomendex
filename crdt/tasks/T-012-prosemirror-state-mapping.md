---
id: T-012
title: "Map between CRDT state and ProseMirror document"
status: done
priority: high
tags: [prosemirror, document, mapping]
depends_on: [T-006]
created: 2026-02-17
completed: 2026-02-17
---

## Description
Build the bidirectional mapping between CRDT document state and ProseMirror's `Node` tree. This is the bridge layer:
- CRDT → ProseMirror: Convert CRDT items into a ProseMirror `Node` (doc with paragraphs, text, marks)
- ProseMirror → CRDT positions: Map ProseMirror positions (integer offsets) to CRDT item IDs

## Acceptance Criteria
- [x] `crdtToProseMirror(crdtDoc, schema)` → ProseMirror `Node`
- [x] `proseMirrorPositionToCRDT(crdtDoc, pos)` → item ID (left neighbor for insertion)
- [x] Handles text content with marks (bold, italic, etc.)
- [x] Handles block nodes (paragraph, heading, blockquote, code_block)
- [x] Handles empty documents and empty paragraphs
- [x] Position mapping is consistent after insertions and deletions

## Test Plan
- Empty CRDT doc → empty ProseMirror doc (with empty paragraph)
- CRDT doc with "hello" in one paragraph → correct PM node
- CRDT doc with marks → PM node with marks
- PM position 0 → correct CRDT item
- PM position at end of text → correct CRDT item
- Position mapping after delete still points to correct items

## Implementation Notes
Implemented at `src/crdt/prosemirror/state-mapping.ts`. `crdtToProseMirror` walks the flat item store, separates blocks from text, groups text by parent block, builds PM nodes with marks. `proseMirrorPositionToCRDT` walks items tracking PM position offsets. 7 tests passing.
