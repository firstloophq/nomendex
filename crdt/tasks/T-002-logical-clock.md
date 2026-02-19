---
id: T-002
title: "Logical clock (Lamport clock)"
status: done
priority: high
tags: [crdt, core, clock]
depends_on: [T-001]
created: 2026-02-17
completed: 2026-02-17
---

## Description
Implement a Lamport logical clock. Each client has a monotonically increasing counter. On local operations, increment. On receiving remote operations, take the max of local and remote then increment. This provides a total causal ordering of operations.

## Acceptance Criteria
- [x] `LamportClock` class with `clientId` and `counter`
- [x] `increment()` returns a new timestamp and advances the clock
- [x] `receive(remoteTimestamp)` merges with a remote clock value
- [x] `compare(a, b)` provides total ordering (counter first, then clientId tiebreak)
- [x] Clocks are immutable-friendly (timestamps are plain objects, clock state is simple)

## Test Plan
- Clock starts at 0, increments to 1, 2, 3...
- `receive(5)` when local is 3 sets local to 6
- `receive(2)` when local is 5 keeps local at 5 (and increments to 6)
- Two clocks with same counter but different clientIds have deterministic ordering
- Serialization round-trip works

## Implementation Notes
Implemented as pure functions (not a class) at `src/crdt/core/lamport-clock.ts`. Functions: `createClock`, `increment`, `receive`, `compareTimestamps`. All return new objects (immutable). `ClientId` type re-exported from here. 15 tests passing.
