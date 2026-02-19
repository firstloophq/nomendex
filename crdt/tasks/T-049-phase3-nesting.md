---
id: T-049
title: "Phase 3: Container block nesting (parentBlockId + ReparentOp)"
status: done
priority: medium
tags: [crdt, prosemirror]
depends_on: [T-048]
created: 2026-02-18
completed: 2026-02-18
---

## Description
parentBlockId on BlockContent, ReparentOp type + apply + undo, recursive tree building in crdtToProseMirror, recursive position counting.

## Acceptance Criteria
- parentBlockId on BlockContent identifies container parent
- ReparentOp changes block's parent
- crdtToProseMirror builds recursive tree using parentBlockId → children map
- blockquote > paragraph nesting works
- bullet_list > list_item > paragraph (3 levels) works
- Backward compatible: flat docs without parentBlockId still work

## Implementation Notes
- Design deviation: added oldParentBlockId to ReparentOp for undo support
- Recursive buildNode function handles mixed content, pure containers, leaf containers, leaf blocks
- Root blocks (parentBlockId === undefined) become doc children
