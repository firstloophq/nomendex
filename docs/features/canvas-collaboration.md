# Team Canvas Collaboration (tldraw + CRDT)

This document explains how the canvas feature was added to the app, how team-mode sync works, and where canvas data is persisted.

## Scope

- Feature ID: `canvas`
- Views:
  - `browser`: list/search/create/delete canvases
  - `editor`: tldraw canvas editor
- Team mode: real-time sync through the existing CRDT transport
- Solo mode: local file snapshot persistence

## Entry Points

- Plugin + view registration:
  - `bun-sidecar/src/features/canvas/index.ts`
  - `bun-sidecar/src/registry/registry.ts`
- Browser/list view:
  - `bun-sidecar/src/features/canvas/browser-view.tsx`
- Editor view:
  - `bun-sidecar/src/features/canvas/editor-view.tsx`
- Canvas CRDT hook:
  - `bun-sidecar/src/features/canvas/useCanvasCRDT.ts`
- Canvas API client:
  - `bun-sidecar/src/hooks/useCanvasAPI.ts`
- Server routes:
  - `bun-sidecar/src/server-routes/canvas-routes.ts`
  - mounted in `bun-sidecar/src/server.ts`
- Persistence service:
  - `bun-sidecar/src/features/canvas/fx.ts`

## What Was Implemented

1. Added a first-class `canvas` plugin with browser and editor views.
2. Added a browser UX to:
   - list all canvases
   - filter by title
   - create canvases
   - delete canvases
3. Added a tldraw editor view with:
   - editable title (debounced save)
   - collab status pill (`Local`, `Connected`, `Offline`, `Syncing...`)
4. Added tab de-duplication for same `canvasId` so opening a canvas focuses existing tab:
   - `bun-sidecar/src/hooks/useWorkspace.tsx`
5. Added canvas REST endpoints:
   - `/api/canvas/list`
   - `/api/canvas/get`
   - `/api/canvas/create`
   - `/api/canvas/update`
   - `/api/canvas/delete`
   - `/api/canvas/snapshot/get`
   - `/api/canvas/snapshot/save`
6. Added workspace path plumbing + startup directory creation for `canvases/`:
   - `bun-sidecar/src/storage/root-path.ts`
   - `bun-sidecar/src/onStartup.ts`
   - `bun-sidecar/src/server-routes/workspace-routes.ts`
7. Hid `canvases/` from notes browser traversal:
   - `bun-sidecar/src/features/notes/fx.ts`

## CRDT Sync Design (Team Mode)

Doc ID is workspace-scoped:

- `ws:{orgWorkspaceId}:canvas:{canvasId}`
- built by `buildCanvasDocId(...)` in `bun-sidecar/src/lib/collab-doc-id.ts`

### Record Mapping

`tldraw` records are mirrored into CRDT field ops:

- Field key: `tl:{recordId}`
- Field value: serialized JSON of the tldraw record
- Deletion sentinel: empty string `""`

### Outbound Flow (local edit -> remote)

1. Listen to `editor.store.listen(...)`.
2. Convert added/updated/removed tldraw records into CRDT `field` ops.
3. Compact duplicate field updates in a batch (last-write per field).
4. Apply ops to local CRDT manager immediately.
5. Flush to transport every `32ms` (`OUTBOUND_FLUSH_MS`).

### Inbound Flow (remote -> editor)

1. Receive ops from `subscribeDoc`.
2. Queue ops and flush on next animation frame.
3. Apply ops into local CRDT manager.
4. Resolve latest field state and push to tldraw store via `mergeRemoteChanges`.

## Presence (Cursors + Room)

Canvas presence uses the existing CRDT awareness channel on the same canvas doc ID.

### Local Presence Broadcast

- `useCanvasCRDT` derives live tldraw presence from editor session state.
- It sends awareness with:
  - `user` (name/color from collab context)
  - `viewingDocId` set to the current tldraw page id (`page:...`)
  - `cursor` packed as `{ anchor: x, head: y }` (page-space cursor point)
  - extra tldraw hints in `tldraw` metadata (cursor rotation, selected shape ids)
- Broadcast behavior:
  - throttled on session updates (~48ms)
  - heartbeat every 2.5s

### Remote Presence Rendering

- Incoming awareness is converted to native tldraw `instance_presence` records via `InstancePresenceRecordType.create(...)`.
- Those presence records are inserted with `editor.store.mergeRemoteChanges(...)`.
- This activates tldraw's built-in collaborator UI:
  - live collaborator cursors on canvas
  - room avatars in the share/people menu
- Stale remote presence records are pruned after inactivity timeout (~10s).

## Persistence Model

Canvas data is split into **metadata** and **drawing content**.

### Filesystem Location

- Base folder: `{workspaceRoot}/canvases`
- Managed by `FeatureStorage` in `bun-sidecar/src/features/canvas/fx.ts`

### Metadata Persistence

Stored in `index.json`:

- schema:
  - `{ "version": 1, "items": CanvasItem[] }`
- each `CanvasItem`:
  - `id`, `title`, `createdAt`, `updatedAt`
- sorted by `updatedAt` desc on write/read

### Snapshot Persistence (solo/local mode)

- Snapshot file per canvas:
  - `{encodeURIComponent(canvasId)}.snapshot.json`
- Content:
  - JSON string from `editor.store.serialize("document")`
- Load path:
  - editor mount -> `/api/canvas/snapshot/get`
  - hydrate tldraw store if snapshot exists
  - if no snapshot exists, write initial empty snapshot
- Save path:
  - local changes debounce at `450ms` (`LOCAL_SAVE_DEBOUNCE_MS`)
  - write via `/api/canvas/snapshot/save`

### Team-Mode Persistence

In team mode (`collabEnabled === true`), drawing changes are sent through CRDT transport and **not** written through local snapshot saves on each edit.

Durability then depends on relay configuration:

- `CRDT_RELAY_ENABLED=true` and relay configured:
  - sidecar relays workspace-scoped canvas docs to team-backend `/ws/crdt`
  - team-backend persists CRDT state (op log + snapshots) per existing Phase 3 architecture
- relay disabled:
  - canvas CRDT state is sidecar-process local and not durable across sidecar restart

Metadata (`index.json`, title updates) is still persisted through the canvas API in both modes.

## Persistence Matrix

| Data | Solo Workspace | Team Workspace + Relay | Team Workspace (No Relay) |
|---|---|---|---|
| Canvas metadata (`index.json`) | Local file | Local file | Local file |
| Canvas title edits | Local file (`/api/canvas/update`) | Local file (`/api/canvas/update`) | Local file (`/api/canvas/update`) |
| Drawing content | Local snapshot file | Team CRDT backend persistence | In-memory only |

## Runtime Fix Added for tldraw

To avoid the tldraw startup crash (`TypeError: Illegal invocation`), we bind `structuredClone` in the app bootstrap:

- `bun-sidecar/src/index.html`

```html
if (typeof structuredClone === "function") {
  globalThis.structuredClone = structuredClone.bind(globalThis);
}
```

## OTel Logging and Debugging

Canvas/CRDT debug logs are now forwarded to OTEL so persistence and sync races can be inspected in one timeline.

### Pipeline

1. Browser CRDT/canvas events are emitted via `crdtDebugLog(...)`.
2. Browser posts to `/api/logs` (existing path).
3. Sidecar still appends JSON lines to `logs.txt`.
4. Sidecar also forwards structured OTLP logs to `otel-viewer` (`/v1/logs`) through `emitOTelLog(...)`.
5. Server-side persistence events (`canvas_snapshot_get/save/delete`) are emitted directly to OTEL as well.

### Key Correlation Fields

- `traceId` and `spanId` per browser debug event (OTEL trace filters)
- `sessionId` and `sequence` for strict in-tab event order
- `canvasId` and `docId` for room scoping
- `attemptId`, `transport`, `bytes`, `durationMs` for snapshot save diagnostics
- `nomendex.event` and `nomendex.context` attributes for event filtering

### Environment Variables

- `NOMENDEX_OTEL_LOGS_ENABLED` (default `1`)
- `NOMENDEX_OTEL_EXPORTER_ENDPOINT` (default `http://localhost:4318`, auto-appends `/v1/logs`)
- `NOMENDEX_OTEL_LOGS_ENDPOINT` (optional exact endpoint override)
- Standard OTEL fallback is also respected:
  - `OTEL_EXPORTER_OTLP_ENDPOINT`
  - `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`

### High-Signal Events to Watch

- Snapshot lifecycle:
  - `CRDT:canvas_snapshot_load_hit`
  - `CRDT:canvas_snapshot_load_miss`
  - `CRDT:canvas_snapshot_save_start`
  - `CRDT:canvas_snapshot_save_success`
  - `CRDT:canvas_snapshot_save_skipped`
  - `canvas_snapshot_save_success` (server persistence layer)
- Sync/bootstrap lifecycle:
  - `CRDT:canvas_receive_ops`
  - `CRDT:canvas_sync_complete`
  - `CRDT:canvas_collab_bootstrap_from_snapshot`
  - `CRDT:canvas_collab_bootstrap_skipped`

### Practical Debug Flow

1. Open OTEL viewer (`http://localhost:4318`).
2. Filter `service` to `nomendex-browser` for client timeline, then `nomendex-sidecar` for persistence confirmations.
3. Filter by `nomendex.canvasId` and inspect ordered `sequence` values.
4. Confirm each `canvas_snapshot_save_start` has a matching success/enqueued event.
5. Correlate with server-side `canvas_snapshot_save_success` and `bytes`/`durationMs`.
