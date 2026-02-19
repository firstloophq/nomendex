---
id: T-006
title: "Document model (tree of CRDT sequences)"
status: done
priority: high
tags: [crdt, document, data-structure]
depends_on: [T-005]
created: 2026-02-17
completed: 2026-02-17
---

## Description
ProseMirror documents are trees: `doc` contains block nodes (paragraphs, headings), which contain inline content (text, images). Our CRDT must model this hierarchy.

Each level of the tree is a CRDT sequence:
- The doc's children are a sequence of blocks
- Each block's children are a sequence of inline items

This task builds the `CRDTDocument` that wraps these nested sequences.

## Acceptance Criteria
- [x] `CRDTDocument` manages a tree of CRDT sequences
- [x] Root node represents the `doc`
- [x] Block-level nodes (paragraph, heading, etc.) are items in the root sequence
- [x] Inline content (text) are items in a block's child sequence
- [x] Can convert CRDT document → plain text (for testing)
- [x] Can insert text into a specific block at a specific position
- [x] Can insert a new block node
- [x] Can delete text and blocks

## Test Plan
- Create empty doc, add a paragraph, add text → get expected plain text
- Two paragraphs with text render correctly
- Delete text from middle of a paragraph
- Delete an entire block
- Insert a block between existing blocks

## Implementation Notes
Implemented at `src/crdt/document/document.ts`. CRDTDocument has a `blockStore` (ItemStore for blocks) and `blockChildren` (Map from blockKey → ItemStore for inline content). Functions: `createDocument`, `insertBlock`, `deleteBlock`, `insertText`, `deleteText`, `getBlockCount`, `getBlockText`, `getPlainText`. 9 tests passing.
