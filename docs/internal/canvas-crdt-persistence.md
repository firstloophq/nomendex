# Canvas CRDT Persistence & Resync

**Status**: In progress — core implementation complete, needs testing and refinement.

## Problem

Canvas data is lost in several scenarios:

1. **Team mode blocks local saves when unsynced** — `persistSnapshotNow` returned early if `collabEnabled && !didSyncRef.current`, so edits before sync completes (or when offline) were never written to disk.
2. **Unmount save is fire-and-forget** — The store listener cleanup called `persistSnapshotNow()` as async void with `transport: "fetch"`, which gets cancelled when the component tears down. In-app tab switches don't trigger `pagehide`.
3. **CRDT manager state is ephemeral** — `stateRef` holds the CRDT manager in a ref. On remount, a fresh empty `createDocManager()` is created. If the server also lost the doc (worker restart, no subscribers), data is gone.
4. **Bootstrap is all-or-nothing** — `bootstrapCollabDocFromPersistedSnapshot` skipped entirely if the CRDT manager had *any* tldraw content. A partial/stale remote doc prevented local data from being merged.
5. **No delta sync** — The client never passed `initialStateVector` when subscribing, so the server always sent the full doc state.

## Approach

Persist the CRDT field state (with LWW timestamps) locally alongside the tldraw snapshot. On reload, restore the CRDT manager from local state, subscribe with the local state vector for delta sync, and merge local+remote via the existing CRDT LWW protocol.

## What Was Implemented

### New Persistence Endpoints

- `saveCRDTState({ canvasId, crdtState })` — writes `{canvasId}.crdt-state.json`
- `getCRDTState({ canvasId })` — reads the CRDT state file
- Routes: `POST /api/canvas/crdt-state/save`, `POST /api/canvas/crdt-state/get`
- `deleteCanvas()` now also cleans up `.crdt-state.json`
- Client API: `canvasAPI.saveCRDTState()`, `canvasAPI.getCRDTState()`

### Persisted CRDT State Format

```typescript
interface PersistedCanvasCRDTState {
    version: 1;
    clockCounter: number;
    clientId: string;
    wasSynced: boolean;
    stateVector: Record<string, number>;
    fields: Array<{
        fieldName: string;
        value: string;
        timestamp: { clientId: string; clock: number };
    }>;
}
```

Only LWW field registers are persisted (canvas doesn't use sets or body). The `wasSynced` flag indicates whether the data had completed initial sync before being saved.

### CRDT State Save

`persistCRDTStateNow()` serializes the doc record's fields with their LWW timestamps, clock counter, clientId, and state vector. Called from:

- `queueLocalSnapshotPersist` — piggybacks on every debounced snapshot save
- Store listener cleanup — beacon transport (survives teardown)
- `pagehide` / `visibilitychange` handlers — beacon transport

### CRDT State Restore on Mount

The hydration `useEffect` fetches both snapshot AND CRDT state in parallel. If CRDT state exists:

1. Replays persisted fields as `FieldOp`s with original timestamps into a fresh manager
2. Restores the clock counter
3. Updates `mirroredFieldsRef` from restored fields
4. Stores the state vector in `restoredStateVectorRef` for delta sync

### Delta Sync via `initialStateVector`

`subscribeDoc` now passes the restored state vector:

```typescript
collab.subscribeDoc({
    docId,
    onOps: handleRemoteOps,
    initialStateVector: restoredStateVectorRef.current ?? undefined,
    onSyncComplete: () => handleSyncComplete(),
});
```

The server only sends ops the client doesn't have, reducing bandwidth.

### Snapshot Save Reliability Fixes

- **Removed unsynced guard** — `persistSnapshotNow` no longer returns early when collab is enabled but unsynced. The local snapshot is always saved as a safety net.
- **Beacon in cleanup save** — Store listener cleanup uses `transport: "beacon"` so saves survive component teardown during in-app tab switches.
- **Pre-reset save** — The reset `useEffect` persists both snapshot and CRDT state via beacon before clearing all state (prevents data loss on canvas/mode switch).

### Per-Record Bootstrap

`bootstrapCollabDocFromPersistedSnapshot` no longer uses the `hasTldrawContentInManager` all-or-nothing gate. Instead:

- Builds a set of field names already in the manager
- Iterates snapshot records, only seeding those NOT already present
- Records in both local and manager are skipped (remote CRDT version is authoritative via LWW)

### Type Stub Update

Added `LWWRegister<T>` to `bun-sidecar/src/types/crdt-lib/index.d.ts` (the type stubs for the CRDT lib used by the build).

## Files Modified

| File | Changes |
|------|---------|
| `bun-sidecar/src/features/canvas/useCanvasCRDT.ts` | Core logic: restore, save, delta sync, beacon cleanup, per-record bootstrap, removed unsynced guard |
| `bun-sidecar/src/features/canvas/fx.ts` | `saveCRDTState`, `getCRDTState`, `deleteCanvas` cleanup |
| `bun-sidecar/src/server-routes/canvas-routes.ts` | CRDT state routes |
| `bun-sidecar/src/hooks/useCanvasAPI.ts` | Client API methods |
| `bun-sidecar/src/types/crdt-lib/index.d.ts` | `LWWRegister<T>` type stub |

## Known Issues / TODO

- [ ] **Not yet tested end-to-end** — needs manual verification of all scenarios below
- [ ] **Pre-existing build error** in `auth-routes.ts` (`jwtExpiresAt` unused) blocks full `bun run build` — unrelated to this work
- [ ] **CRDT state file size** — for canvases with many records, the `.crdt-state.json` could get large. May want to consider compression or only persisting tldraw-prefixed fields (currently already filtered)
- [ ] **Race between hydration and subscribe** — if `subscribeDoc` fires and sync completes before the CRDT state fetch resolves, the restored state vector won't be used for the initial subscribe. The fallback is full sync (same as before this change)
- [ ] **Clock counter restoration** — when restoring from CRDT state, if the client reconnects with the same clientId but a lower clock, duplicate op IDs could theoretically occur. The `persisted.clockCounter` restore mitigates this but edge cases may exist

## Verification Plan

1. **Solo mode**: Draw on canvas -> close tab -> reopen -> data persists
2. **Team mode, server has data**: Draw -> close -> reopen -> data loads from remote via delta sync
3. **Team mode, server lost data**: Draw -> restart team-backend -> reopen -> local CRDT state bootstraps the remote doc
4. **Team mode, offline edits**: Draw while disconnected -> reconnect -> edits merge with remote
5. **Tab switching**: Draw -> switch to another tab -> switch back -> data persists (beacon save)
6. **Two clients**: Client A draws -> Client B opens same canvas -> sees A's work -> B draws -> A sees B's work
