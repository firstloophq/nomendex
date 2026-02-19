---
id: T-013
title: "Capture ProseMirror transactions as CRDT operations"
status: done
priority: high
tags: [prosemirror, operations, mapping]
depends_on: [T-012]
created: 2026-02-17
completed: 2026-02-17
---

## Description
When a user edits in ProseMirror, it produces `Transaction` objects with `Step`s (`ReplaceStep`, `AddMarkStep`, `RemoveMarkStep`). This task converts those steps into CRDT operations.

## Acceptance Criteria
- [x] `transactionToCRDTOps(crdtDoc, transaction)` → `Operation[]`
- [x] Handles `ReplaceStep` (insert and delete text/nodes)
- [x] Handles `AddMarkStep` and `RemoveMarkStep`
- [x] Handles multi-step transactions (e.g., replace selection = delete + insert)
- [x] Generated operations have correct IDs from the local clock
- [x] Handles paste (large insert) and cut (large delete)

## Test Plan
- Type a character → single insert operation
- Delete a character → single delete operation
- Select text and bold it → format operations for each item in range
- Replace selected text → delete ops + insert ops
- Paste multi-line text → correct block and inline insert operations

## Implementation Notes
Implemented at `src/crdt/prosemirror/transaction-capture.ts`. Handles ReplaceStep (insert/delete/replace), AddMarkStep, RemoveMarkStep. Uses `proseMirrorPositionToCRDT` for position mapping and `getItemsInRange` for finding items in a PM position range. 5 tests passing.
