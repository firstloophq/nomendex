---
id: T-007
title: "Apply operations to document"
status: done
priority: high
tags: [crdt, core, operations]
depends_on: [T-006]
created: 2026-02-17
completed: 2026-02-17
---

## Description
Implement the operation application logic. Given a `CRDTDocument` and an `Operation`, apply the operation to mutate the document state. This is the heart of the CRDT — operations must be commutative (order-independent) and idempotent (applying twice is same as once).

## Acceptance Criteria
- [x] `applyOperation(doc, op)` applies an insert/delete/format operation
- [x] Insert operations use conflict resolution to find the correct position
- [x] Delete operations set the tombstone flag on the target item
- [x] Format operations add/remove marks on the target item
- [x] Duplicate operations are idempotent (no-op if already applied)
- [x] Operations can be applied in any order and produce the same final state

## Test Plan
- Apply insert ops in order → correct document
- Apply same insert ops in reverse order → same document
- Apply delete then insert vs insert then delete → same document
- Apply same operation twice → same result as once
- Three clients making concurrent edits at the same position → consistent result regardless of application order
- Format an item, then format again → marks are correct

## Implementation Notes
Implemented at `src/crdt/core/apply-operations.ts`. `CRDTDoc` wraps an `ItemStore` + `appliedOps` set (for idempotency) + `pendingDeletes`/`pendingFormats` maps (for out-of-order ops) + `stateVector`. Handles causal ordering: if a delete/format arrives before its target insert, it's queued and applied when the insert arrives. 12 tests passing including commutativity tests with 6 permutations.
