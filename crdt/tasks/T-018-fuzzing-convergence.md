---
id: T-018
title: "Fuzz testing for convergence"
status: done
priority: medium
tags: [testing, crdt, correctness]
depends_on: [T-009]
created: 2026-02-17
completed: 2026-02-17
---

## Description
Property-based / fuzz testing to verify that the CRDT converges correctly under random concurrent operations. This is the ultimate correctness test: generate random operations on multiple simulated clients, sync them in random order, and verify all replicas produce identical documents.

## Acceptance Criteria
- [x] Fuzz test harness that simulates N clients
- [x] Random operation generation (insert, delete, format at random positions)
- [x] Random sync scheduling (sync pairs of clients at random intervals)
- [x] After all ops are synced, all replicas are identical
- [x] Test runs with at least 1000 iterations without failure
- [x] Failures produce a minimal reproduction case

## Test Plan
- This IS the test — run the fuzzer and ensure zero failures
- Vary number of clients (2, 3, 5, 10)
- Vary operation mix (mostly inserts, mostly deletes, balanced)
- Vary document size (empty start, pre-populated)

## Implementation Notes
Implemented at `tests/crdt/core/fuzz.test.ts`. Seeded PRNG for deterministic reproduction. Tests: 2 clients × 100 ops, 3 clients × 50 ops, 5 clients × 30 ops, 10 clients × 20 ops, mostly-inserts variant, and 1000-iteration sweep across different seeds. All converge correctly. 6 tests passing.
