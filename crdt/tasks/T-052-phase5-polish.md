---
id: T-052
title: "Phase 5: Polish + integration"
status: done
priority: low
tags: [crdt, prosemirror]
depends_on: [T-045, T-048, T-049, T-051]
created: 2026-02-18
completed: 2026-02-18
---

## Description
Server-side API compatibility, encoding round-trips, snapshot compatibility, undo/redo integration tests, documentation updates.

## Acceptance Criteria
- AttrUpdateOp, ReparentOp, InlineAtomContent encoding round-trips
- CRDTDoc snapshots with new content types
- CRDTRecord snapshots with blocks containing attrs
- applyRecordOp handles attr_update and reparent
- All 429 tests pass
- CLAUDE.md updated with new architecture notes

## Implementation Notes
- Server document-api unchanged (text-only API correctly skips inline atoms)
- JSON encoding handles new fields automatically
- Snapshot decode includes pendingAttrUpdates and pendingReparents
- 429 tests across 38 files
