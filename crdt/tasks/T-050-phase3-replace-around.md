---
id: T-050
title: "Phase 3: ReplaceAroundStep + recursive insertion"
status: done
priority: medium
tags: [crdt, prosemirror]
depends_on: [T-049]
created: 2026-02-18
completed: 2026-02-18
---

## Description
Handle ReplaceAroundStep (wrap/lift), recursive insertBlockTree in handleReplaceStep.

## Acceptance Criteria
- ReplaceAroundStep for wrapping generates container insert + reparent ops
- ReplaceAroundStep for unwrapping generates reparent out + container delete
- Recursive block tree insertion with parentBlockId support

## Implementation Notes
- handleReplaceAroundStep detects wrap vs unwrap via slice content
- insertBlockTree recurses through PM node children
- insertInlineContent handles text + atom children
