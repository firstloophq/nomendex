---
id: T-011
title: "Undo/redo manager"
status: done
priority: medium
tags: [crdt, document, undo]
depends_on: [T-007]
created: 2026-02-17
completed: 2026-02-17
---

## Description
CRDT-aware undo/redo. Unlike simple undo, CRDT undo must:
- Only undo the local client's operations (not remote changes)
- Generate inverse operations (undo insert → delete, undo delete → re-insert)
- Handle the case where the item to undo has been modified by remote operations
- Support redo (re-apply undone operations)
- Group operations into undo batches (e.g., typing a word is one undo step)

## Acceptance Criteria
- [x] `UndoManager` tracks operations per client
- [x] `undo()` generates and applies inverse operations for the most recent batch
- [x] `redo()` re-applies undone operations
- [x] Only undoes local client's operations
- [x] Concurrent remote edits are preserved during undo
- [x] Operations are grouped into batches by time window (configurable)
- [x] Undo stack is bounded (configurable max depth)

## Test Plan
- Insert "hello", undo → empty, redo → "hello"
- Client A types "hello", client B types "world" concurrently. A undoes → "world" remains
- Delete text, undo → text reappears with correct marks
- Rapid typing groups into single undo batch
- Undo stack respects max depth

## Implementation Notes
Implemented at `src/crdt/core/undo-manager.ts`. Symmetric undo/redo using `computeInverse`: undo stack stores original ops, redo stack stores inverse ops. Both undo and redo compute the inverse of the popped batch. Supports time-based batching and max stack depth. Key insight: CRDT tombstones are permanent, so redo after undo-of-insert must create a NEW insert (not un-delete). 8 tests passing.
