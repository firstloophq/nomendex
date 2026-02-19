---
id: T-045
title: "Phase 1: Block attrs + null widening"
status: done
priority: high
tags: [crdt, prosemirror]
depends_on: []
created: 2026-02-18
completed: 2026-02-18
---

## Description
Widen attrs types to allow null, pass block attrs through PM reconstruction, capture attrs in transaction capture, add AttrUpdateOp + AttrStep handler, leaf block position counting.

## Acceptance Criteria
- Block attrs (e.g. heading level) round-trip through CRDT → PM → CRDT
- Null attrs preserved in encoding/decoding
- AttrUpdateOp changes block attrs
- AttrStep captured from PM transactions
- Leaf blocks (horizontal_rule) count as 1 PM position
- Undo of AttrUpdateOp restores old value

## Implementation Notes
- Widened BlockContent.attrs and Mark.attrs to allow null
- Added AttrUpdateOp with oldValue field for undo support
- Added schema param to proseMirrorPositionToCRDT for leaf block detection
- Leaf block tracking via lastBlockWasLeaf boolean
