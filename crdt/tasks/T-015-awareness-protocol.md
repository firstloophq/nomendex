---
id: T-015
title: "Awareness protocol (cursors and presence)"
status: done
priority: low
tags: [network, prosemirror, awareness]
depends_on: [T-014]
created: 2026-02-17
completed: 2026-02-17
---

## Description
Track and display remote users' cursor positions and presence information (name, color, online status). This is separate from the document CRDT — it's ephemeral state that doesn't need conflict resolution.

## Acceptance Criteria
- [x] `AwarenessState` type: `{ clientId, cursor: { anchor, head }, user: { name, color } }`
- [x] `AwarenessProtocol` manages local and remote awareness states
- [x] State is broadcast periodically and on cursor change
- [x] Stale states are removed after a timeout
- [x] ProseMirror decoration plugin renders remote cursors

## Test Plan
- Set local awareness state, encode it, decode on remote → matches
- Remote cursor appears as a decoration in ProseMirror
- Client goes offline → cursor disappears after timeout
- Multiple clients → multiple colored cursors

## Implementation Notes
Implemented at `src/crdt/network/awareness.ts`. Ephemeral state tracking: `createAwareness`, `setLocalState`, `applyRemoteState`, `removeStaleStates`, `encodeAwareness`, `decodeAwareness`.

Cursor decoration plugin at `src/crdt/prosemirror/cursor-decorations.ts`: `createCursorPlugin`, `updateRemoteCursors`, `awarenessToRemoteCursor`. Renders colored cursor lines + name labels for remote peers, selection highlight for ranges. 6 awareness tests + 6 cursor decoration tests passing.

Transport updated to support typed messages (ops + awareness) at `src/crdt/network/transport.ts`. CRDTEditor integrates awareness: sends cursor updates on selection change, receives and renders remote cursors.
