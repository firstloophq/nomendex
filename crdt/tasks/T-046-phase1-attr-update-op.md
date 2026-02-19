---
id: T-046
title: "Phase 1: AttrUpdateOp + AttrStep"
status: done
priority: high
tags: [crdt, prosemirror]
depends_on: [T-045]
created: 2026-02-18
completed: 2026-02-18
---

## Description
AttrUpdateOp type + factory, applyOperation case, AttrStep handler in transaction capture, undo/redo for attr updates.

## Acceptance Criteria
- AttrUpdateOp applied to CRDTDoc updates block attrs
- AttrStep from PM generates AttrUpdateOp
- Undo restores previous attr value using oldValue field
- Idempotent application
- Pending attr update mechanism for out-of-order ops

## Implementation Notes
- Design deviation from plan: added oldValue to AttrUpdateOp for correct undo
- computeInverse uses oldValue from op, not doc lookup (doc already has new value applied)
