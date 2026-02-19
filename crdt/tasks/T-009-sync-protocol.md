---
id: T-009
title: "Sync protocol"
status: done
priority: medium
tags: [crdt, network, sync]
depends_on: [T-007, T-008]
created: 2026-02-17
completed: 2026-02-17
---

## Description
Implement the sync protocol for exchanging updates between peers. The protocol:
1. Peer A sends its state vector to Peer B
2. Peer B computes missing ops and sends them back
3. Peer A applies the missing ops
4. (Bidirectional: both sides do this)

This task implements the protocol logic (encoding/decoding messages, computing diffs) — not the transport layer.

## Acceptance Criteria
- [x] `SyncMessage` types: `SyncStep1` (state vector), `SyncStep2` (missing ops), `SyncComplete`
- [x] `encodeSyncStep1(doc)` → message with state vector
- [x] `decodeSyncStep1(msg)` → extract state vector
- [x] `encodeSyncStep2(doc, remoteStateVector)` → message with missing ops
- [x] `decodeSyncStep2(msg)` → extract operations to apply
- [x] Full sync between two documents produces identical states
- [x] Incremental sync (only new ops since last sync) works

## Test Plan
- Two docs with divergent edits sync to identical state
- Sync is idempotent (syncing again produces no new messages)
- One-way sync (only A → B) gives B all of A's changes
- Bidirectional sync with concurrent edits resolves correctly
- Large document (1000+ ops) syncs correctly

## Implementation Notes
Implemented at `src/crdt/network/sync.ts`. SyncEngine wraps a CRDTDoc. `generateSyncStep1` encodes state vector, `receiveSyncStep1` computes missing ops, `receiveSyncStep2` applies them. `fullSync` does bidirectional sync. The sync protocol requires passing `allOps` alongside the doc (for now ops are stored externally; will need an op log in the doc later). 5 tests passing including 1000-op large doc sync.
