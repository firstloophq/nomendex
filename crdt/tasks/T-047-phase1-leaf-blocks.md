---
id: T-047
title: "Phase 1: Leaf block position counting"
status: done
priority: high
tags: [crdt, prosemirror]
depends_on: [T-045]
created: 2026-02-18
completed: 2026-02-18
---

## Description
Add schema param to proseMirrorPositionToCRDT and getItemsInRange. Leaf blocks count as 1 PM position instead of 2.

## Acceptance Criteria
- proseMirrorPositionToCRDT accepts optional schema parameter
- Leaf blocks (isLeaf) count as 1 position
- Non-leaf blocks count as 2 positions (open + close)
- Position mapping correct in docs with mixed leaf/non-leaf blocks

## Implementation Notes
- lastBlockWasLeaf tracking prevents adding close tag for previous leaf block
- Schema parameter is optional for backward compatibility
