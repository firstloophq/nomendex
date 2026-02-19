---
id: T-016
title: "Garbage collection of tombstones"
status: done
priority: low
tags: [crdt, core, optimization]
depends_on: [T-009]
created: 2026-02-17
completed: 2026-02-17
---

## Description
Deleted items (tombstones) accumulate over time and waste memory. Implement garbage collection that safely removes tombstones when all peers have seen the delete operation. This requires coordination via state vectors to know when it's safe to collect.

## Acceptance Criteria
- [x] `collectGarbage(doc, knownStateVectors)` removes safe tombstones
- [x] Only removes tombstones seen by ALL known peers
- [x] Remaining items maintain correct left/right references after GC
- [x] Document content is unchanged after GC
- [x] GC is optional and does not affect correctness if skipped

## Test Plan
- Delete items, run GC when all peers have seen the deletes → tombstones removed
- Delete items, run GC when some peers haven't seen deletes → tombstones preserved
- Document renders identically before and after GC
- New peer joining after GC can still sync correctly

## Implementation Notes
Implemented at `src/crdt/core/gc.ts`. Conservative approach: only GC when ALL peers' state vectors >= doc's state vector (full sync). This avoids per-item tracking of which op deleted each item. Trade-off: less aggressive GC but simpler and correct. 4 tests passing.
