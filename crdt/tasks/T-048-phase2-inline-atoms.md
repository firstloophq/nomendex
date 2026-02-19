---
id: T-048
title: "Phase 2: Inline atoms (InlineAtomContent)"
status: done
priority: high
tags: [crdt, prosemirror]
depends_on: [T-045]
created: 2026-02-18
completed: 2026-02-18
---

## Description
InlineAtomContent type, update crdtToProseMirror classification + buildInlineNodes, position mapping, transaction capture for inline atom ops.

## Acceptance Criteria
- InlineAtomContent with nodeType and optional attrs
- hard_break renders as PM node
- wiki_link with attrs preserves href/title
- Position mapping counts inline atoms as 1 position
- Marks on inline atoms work
- Delete inline atom via DeleteOp

## Implementation Notes
- Inline atoms treated same as text for parent block classification
- buildInlineNodes flushes text run before creating atom node
- Transaction capture emits InsertOp with inline_atom content for PM atom nodes
