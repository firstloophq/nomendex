---
id: T-003
title: "Client ID generation"
status: done
priority: high
tags: [crdt, core]
depends_on: [T-001]
created: 2026-02-17
completed: 2026-02-17
---

## Description
Generate unique client identifiers. Each peer in the system needs a stable, unique ID. IDs must be comparable (for deterministic tiebreaking in conflict resolution).

## Acceptance Criteria
- [x] `generateClientId()` produces a unique string ID
- [x] IDs are lexicographically comparable
- [x] IDs are reasonably short but collision-resistant
- [x] `ClientId` type alias exported

## Test Plan
- Generate 1000 IDs, all are unique
- IDs are valid strings that can be compared with `<` / `>`
- IDs are deterministic given the same seed (optional, for testing)

## Implementation Notes
Implemented at `src/crdt/core/client-id.ts`. Uses `crypto.getRandomValues` with base-62 encoding, 16 chars long. 6 tests passing.
