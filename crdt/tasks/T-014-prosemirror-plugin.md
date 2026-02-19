---
id: T-014
title: "ProseMirror plugin"
status: done
priority: high
tags: [prosemirror, plugin, integration]
depends_on: [T-013, T-009, T-011]
created: 2026-02-17
completed: 2026-02-17
---

## Description
The main ProseMirror plugin that ties everything together. It:
- Holds the CRDT document in plugin state
- Intercepts local transactions and converts them to CRDT ops
- Applies remote CRDT ops and dispatches ProseMirror transactions
- Provides a sync interface for connecting to other peers
- Integrates the undo manager with ProseMirror's undo/redo keybindings

## Acceptance Criteria
- [x] `crdtPlugin(config)` returns a ProseMirror `Plugin`
- [x] Local edits produce CRDT operations emitted via a callback/event
- [x] Remote operations can be applied via `applyRemoteOps()`
- [x] Document stays in sync between CRDT state and PM view
- [x] Cursor/selection is preserved after remote edits (as much as possible)
- [x] Undo/redo work through ProseMirror keybindings (`undoCommand`/`redoCommand`)
- [x] Plugin exposes the CRDT doc and sync utilities for the transport layer

## Test Plan
- Create two PM editors with the plugin, simulate edits on both, verify they converge
- Type text in editor A → appears in editor B after sync
- Concurrent edits in both editors → both converge to same state
- Undo in editor A only undoes A's changes
- Cursor position in B is not disrupted by A's edits (unless at same position)

## Implementation Notes
Implemented at `src/crdt/prosemirror/plugin.ts` with 9 tests passing.

Key exports: `createCRDTPlugin`, `getCRDTState`, `applyRemoteOps`, `undoCommand`, `redoCommand`.

Architecture:
- Plugin init creates a paragraph block in the CRDT doc to match PM's default structure (skipped if `initialDoc` provided)
- Local edits captured via `transactionToCRDTOps` in the plugin's `apply` method
- Remote ops applied via `applyRemoteOps` which rebuilds PM doc from CRDT state using `crdtToProseMirror`
- Uses meta key `crdt-remote-update` to distinguish remote updates from local
- UndoManager integrated: tracks local ops, `undoCommand`/`redoCommand` compute inverse ops and emit them
- `onLocalOps` callback stored in WeakMap keyed by plugin instance for undo/redo emission

Known consideration: When two editors both initialize fresh, each creates its own paragraph block. For true collab, one client should init and sync to the other, or provide `initialDoc`.
