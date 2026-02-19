---
id: T-019
title: "Dual ProseMirror editor demo with CRDT sync"
status: done
priority: high
tags: [prosemirror, ui, demo, integration]
depends_on: [T-014]
created: 2026-02-17
completed: 2026-02-17
---

## Description
The final acceptance test: two ProseMirror editors in the UI, both editing the same document. When you type in editor A, the changes appear in editor B (and vice versa) via the CRDT sync layer.

## Acceptance Criteria
- [x] `CRDTEditor` React component wrapping a ProseMirror editor with the CRDT plugin
- [x] `CollaborativeDemo` component with two side-by-side editors
- [x] Typing in editor A appears in editor B after sync
- [x] Typing in editor B appears in editor A after sync
- [x] Undo in one editor only undoes that editor's changes
- [x] App.tsx renders the dual editor demo

## Test Plan
- Manual: open the app, type in one editor, see changes in the other
- This is primarily a visual/integration test

## Implementation Notes
Implemented across multiple files:
- `src/index.ts` — Bun server with WebSocket relay at `/ws?clientId=...`, broadcasts ops between clients
- `src/crdt/network/transport.ts` — `createWebSocketTransport()` client-side WS transport
- `src/components/CRDTEditor.tsx` — React component: PM EditorView + CRDT plugin + WS transport + undo/redo keybindings
- `src/App.tsx` — Two `CRDTEditor` instances in a 2-column grid

Each editor gets its own clientId, connects independently to the WS server, and syncs ops bidirectionally. Also see supplementary task files T-019-websocket-transport.md and T-020-dual-editor-ui.md.
