---
id: T-004
title: "Define core operation types"
status: done
priority: high
tags: [crdt, core, types]
depends_on: [T-002, T-003]
created: 2026-02-17
completed: 2026-02-17
---

## Description
Define the operation types that represent changes to the CRDT document. Operations are the atomic unit of change — every edit a user makes is encoded as one or more operations. Operations must be commutative and idempotent when applied via the CRDT merge rules.

### Operation Types
- **Insert**: Insert a character/node at a position identified by a unique ID
- **Delete**: Mark an item as deleted (tombstone — never physically removed)
- **Format**: Apply or remove a mark (bold, italic, etc.) on a range

Each operation carries:
- `id`: Unique identifier (clientId + counter from Lamport clock)
- `type`: insert | delete | format
- Type-specific fields

## Acceptance Criteria
- [x] `OperationId` type: `{ clientId: ClientId, clock: number }`
- [x] `InsertOp`: `{ id, type: 'insert', parentId, side: 'left' | 'right', content, marks? }`
- [x] `DeleteOp`: `{ id, type: 'delete', targetId }`
- [x] `FormatOp`: `{ id, type: 'format', targetId, mark, action: 'add' | 'remove' }`
- [x] `Operation` union type of the above
- [x] All types are serializable to JSON

## Test Plan
- Create each operation type and verify structure
- Serialize and deserialize operations round-trip correctly
- Type narrowing works (discriminated union on `type` field)

## Implementation Notes
Implemented at `src/crdt/core/operations.ts`. Types: `OperationId`, `InsertOp`, `DeleteOp`, `FormatOp`, `Operation` (discriminated union), `Content` (TextContent | BlockContent), `Mark`. Factory functions: `createOperationId`, `createInsertOp`, `createDeleteOp`, `createFormatOp`, `operationIdEquals`. 16 tests passing.
