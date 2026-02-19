---
id: T-017
title: "Document snapshot and restore"
status: done
priority: medium
tags: [crdt, document, persistence]
depends_on: [T-007]
created: 2026-02-17
completed: 2026-02-17
---

## Description
Serialize the entire CRDT document state to a binary/JSON snapshot that can be persisted to disk or a database, and restore it later. This is different from the sync protocol — a snapshot captures the full state, not just a diff.

## Acceptance Criteria
- [x] `encodeSnapshot(doc)` → `Uint8Array` (or JSON)
- [x] `decodeSnapshot(bytes)` → `CRDTDocument`
- [x] Round-trip: encode → decode produces identical document
- [x] Snapshot includes all items (including tombstones), clock state, and metadata
- [x] Restored document can continue to accept operations and sync normally

## Test Plan
- Create doc with edits, snapshot, restore → identical content
- Restore snapshot, make more edits → works correctly
- Restore snapshot, sync with a peer → works correctly
- Snapshot of large document (10k+ items) works

## Implementation Notes
Implemented at `src/crdt/document/snapshot.ts`. JSON-based serialization via TextEncoder/TextDecoder to Uint8Array. Serializes items (including tombstones), state vector, and applied ops set. 6 tests passing including 10k-item large doc.
