---
id: T-008
title: "State vector for sync"
status: done
priority: medium
tags: [crdt, network, sync]
depends_on: [T-002]
created: 2026-02-17
completed: 2026-02-17
---

## Description
A state vector summarizes what a client has seen: a map from `clientId → highest clock value received`. This is used during sync to determine which operations a peer is missing.

## Acceptance Criteria
- [x] `StateVector` type: `Map<ClientId, number>`
- [x] `createStateVector(doc)` builds a state vector from the document's applied operations
- [x] `missingOps(local, remote)` returns which clientId+clock ranges the remote is missing
- [x] State vectors are serializable to/from JSON

## Test Plan
- Empty doc → empty state vector
- Doc with ops from client A (clocks 1-5) and client B (clocks 1-3) → `{ A: 5, B: 3 }`
- `missingOps({ A: 5, B: 3 }, { A: 3, B: 3 })` → client A ops 4-5 are missing
- Serialize and deserialize round-trip

## Implementation Notes
Implemented at `src/crdt/network/state-vector.ts`. StateVector is a ReadonlyMap<ClientId, number>. Functions: `createStateVector`, `updateStateVector`, `missingOps`, `encodeStateVector`, `decodeStateVector`. 11 tests passing.
