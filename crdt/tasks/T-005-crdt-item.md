---
id: T-005
title: "CRDT item and linked list structure"
status: done
priority: high
tags: [crdt, core, data-structure]
depends_on: [T-004]
created: 2026-02-17
completed: 2026-02-17
---

## Description
Implement the core `Item` type and the doubly-linked list that forms the CRDT sequence. Each character (or node) in the document is an `Item` with:
- A unique ID (from the operation that created it)
- Left/right origin references (the items that were neighbors when this item was inserted)
- Content (character, node type, etc.)
- A deleted flag (tombstone)
- Marks (formatting)

The linked list supports traversal, insertion between existing items, and conflict resolution when two items have the same position.

## Acceptance Criteria
- [x] `Item` type with id, leftOrigin, rightOrigin, content, deleted, marks
- [x] `ItemStore` (map from OperationId → Item) for O(1) lookup
- [x] Items form a doubly-linked list via `left` / `right` pointers
- [x] Insert between two items works correctly
- [x] Conflict resolution: when two inserts target the same position, ordering is deterministic (by clientId)
- [x] Tombstoned items remain in the list but are skipped in visible content

## Test Plan
- Insert item A, then insert B after A → list is [A, B]
- Insert C between A and B → list is [A, C, B]
- Two concurrent inserts at the same position from different clients → deterministic order
- Delete an item → it's still in the list but marked deleted
- Visible content skips deleted items
- 100 random concurrent inserts resolve consistently regardless of application order

## Implementation Notes
Implemented at `src/crdt/core/item.ts`. Uses array-backed list + Map for O(1) lookup. YATA conflict resolution algorithm for concurrent inserts. Key functions: `createItem`, `createItemStore`, `integrateItem`, `deleteItem`, `getVisibleContent`, `getItemById`. Store is immutable (returns new store on each mutation). 14 tests passing including 100-item convergence test.
