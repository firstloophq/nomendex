---
id: T-051
title: "Phase 4: Tables (colwidth serialization)"
status: done
priority: medium
tags: [crdt, prosemirror]
depends_on: [T-049]
created: 2026-02-18
completed: 2026-02-18
---

## Description
Tables use Phase 3 nesting infrastructure. colwidth serialization as JSON string.

## Acceptance Criteria
- table > table_row > table_cell > paragraph hierarchy renders correctly
- Cell attrs (colspan, rowspan) round-trip
- colwidth stored as JSON string in CRDT
- AttrUpdate changes cell colspan
- 2x2 table with all cells populated

## Implementation Notes
- Tables are just deeply nested blocks using parentBlockId
- colwidth as JSON string is a PM bridge concern, not CRDT core
