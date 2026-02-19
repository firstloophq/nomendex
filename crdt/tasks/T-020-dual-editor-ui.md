---
id: T-020
title: "Dual ProseMirror editor UI"
status: done
priority: high
tags: [ui, prosemirror, integration]
depends_on: [T-019, T-014, T-015]
created: 2026-02-17
completed: 2026-02-17
---

## Description
Build the final acceptance test UI: two ProseMirror editors side by side in the browser, both editing the same CRDT document in real time. One editor initializes the document, the second connects and syncs via WebSocket.

## Acceptance Criteria
- [x] Two ProseMirror editors rendered side by side
- [x] Typing in editor A appears in editor B in real time
- [x] Typing in editor B appears in editor A in real time
- [x] Concurrent edits converge to the same state
- [x] Undo in one editor only undoes that editor's changes
- [x] Client IDs and awareness shown in the UI

## Test Plan
- Manual: open the page, type in both editors, verify sync
- This is a visual/manual acceptance test

## Implementation Notes
`src/components/CRDTEditor.tsx` — React component wrapping ProseMirror EditorView with:
- CRDT plugin with auto-generated clientId
- WebSocket transport for sending/receiving ops
- Undo/redo keybindings (Mod-z, Mod-y, Mod-Shift-z)
- Status bar showing connection state, clientId, and op count

`src/App.tsx` — Two `CRDTEditor` instances in a 2-column grid inside a Card.

Each editor independently connects to the WebSocket server, gets its own clientId, and syncs ops bidirectionally.
