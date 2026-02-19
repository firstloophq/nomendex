# CRDT Integration: Real-Time Notes Collaboration — Status

> **Branch**: `jake/nomendex-team-homemadecrdt`
> **Date**: 2026-02-19
> **Replaces**: Y.js + Cloudflare Durable Objects collab system
> **Uses**: `@crdt/lib` (local package at `../../crdt`)

---

## Overview

We are replacing the Y.js-based real-time collaboration system with a custom CRDT library (`@crdt/lib`). The new system runs a local WebSocket CRDT server inside the bun-sidecar process (no external services needed for local testing) and uses ProseMirror plugins from the CRDT lib to capture/apply operations.

The plan has 4 phases. Phases 1-2 are complete, Phase 4 has a shipped v1, and Phase 3 is now in progress.

| Phase | Scope | Status |
|---|---|---|
| **Phase 1: Plumbing** | Package install, WS handler, CollabContext rewrite | Done |
| **Phase 2: Notes Editor** | Replace Y.js PM plugins with CRDT plugins | Done (sync bugs remain) |
| **Phase 3: Team Backend Relay** | Route CRDT ops through team-backend for remote sync | In progress (backend WS/persistence + sidecar relay/doc IDs landed) |
| **Phase 4: Todos / Kanban** | CRDT sync for todo items and kanban boards | In progress (v1 shipped in team mode) |

---

## What's Been Done

### Phase 1: Plumbing

#### 1.1 Package & TypeScript Setup

- **`bun-sidecar/package.json`**: Added `"@crdt/lib": "file:../../crdt"` dependency; removed `y-prosemirror` usage (packages still listed — cleanup deferred).
- **`bun-sidecar/tsconfig.build.json`** (new file): Created to redirect `tsc` away from the crdt source (avoids prosemirror version mismatch between repos). Maps `@crdt/lib` and `@crdt/lib/server` to local `.d.ts` type stubs.
- **`bun-sidecar/src/types/crdt-lib/index.d.ts`** (new file): Type declarations for all `@crdt/lib` exports used by nomendex (operations, plugin, cursors, transport).
- **`bun-sidecar/src/types/crdt-server/index.d.ts`** (new file): Type declarations for `@crdt/lib/server` exports (WSClient, CRDTWebSocketHandler, createCRDTWebSocketHandler, createCRDTRelay).

> **Why type stubs?** The `@crdt/lib` source uses a different pinned version of prosemirror packages than nomendex. Running `tsc` over the crdt source produces false type errors (`Mapping` incompatibility, missing `defaultAttrs`, etc.). The stubs let `tsc --project tsconfig.build.json` validate nomendex code without touching crdt internals. At runtime, Bun resolves the real package via `file:../../crdt`.

#### 1.2 CRDT WebSocket Handler in `server.ts`

**File**: `bun-sidecar/src/server.ts`

- Added `CRDTWSData` interface to the `WSData` union type.
- Created module-level CRDT handler via local `createCRDTWebSocketHandler(...)` or `createCRDTRelay(...).handler` when relay is enabled.
- Added `/ws/crdt` HTTP route that upgrades to WebSocket with `{ data: { isCRDT: true, clientId } }`.
- In `websocket.open`, `websocket.message`, and `websocket.close`: checks for `isCRDT` flag on `ws.data`, creates a `WSClient` wrapper `{ id, send }`, and delegates to `crdtHandler.handleOpen/handleMessage/handleClose`.

#### 1.3 CollabContext Rewrite

**File**: `bun-sidecar/src/contexts/CollabContext.tsx` — full rewrite.

Old (Y.js):
- Created `Y.Doc`, `WebsocketProvider`, `Awareness`
- Exposed `{ ydoc, provider, awareness, connected }` via context

New (CRDT):
- Uses `createMultiDocTransport` from `@crdt/lib` connecting to `ws://localhost:{port}/ws/crdt`
- Exposes `CollabContextValue`: `{ clientId, userInfo, isConnected, subscribeDoc, subscribeAwareness, sendAwareness, sendOps }`
- Uses listener registries (`opsListenersRef`, `awarenessListenersRef`, `syncListenersRef`) and ref-counting (`docRefCountRef`) pattern from the crdt lib's CRDTProvider
- `clientId` is a unique per-tab ID (`Date.now()-random`), NOT the Clerk userId — CRDTs require unique IDs per client instance to avoid clock conflicts between tabs of the same user
- `userInfo` derived from Clerk `userName` + deterministic color
- `CollabProviderGate`: guards on `teamMode === "team"` + vaultId + isSignedIn. Falls back to `orgWorkspaceId` when `teamVaultId` is missing.

#### 1.4 Git Sync Disabled in Team Mode

**File**: `bun-sidecar/src/contexts/GHSyncContext.tsx`

- Changed `skipSync` from `isTeamMode && !hasGitHubInstallation` to just `isTeamMode`.
- In team mode the CRDT layer handles real-time sync; git sync is no longer needed and was producing noisy `[GIT-SYNC]` log spam.

### Phase 2: Notes Editor

#### 2.1 Y.js Plugin Replacement in `note-view.tsx`

**File**: `bun-sidecar/src/features/notes/note-view.tsx`

Removed:
- `import * as Y from "yjs"`
- `import { ySyncPlugin, yCursorPlugin, yUndoPlugin, prosemirrorToYXmlFragment } from "y-prosemirror"`
- Y.XmlFragment bootstrap logic

Added:
- `import { createCRDTPlugin, applyRemoteOps, undoCommand, redoCommand, createCursorPlugin, updateRemoteCursors, awarenessToRemoteCursor } from "@crdt/lib"`
- Type imports: `Operation`, `CRDTPluginState`, `RemoteCursor`, `ClientId`

Key changes:
- Both solo and collab modes parse doc from markdown (no Y.XmlFragment conversion)
- `createCRDTPlugin` captures local edits as CRDT ops via `onLocalOps` callback
- `createCursorPlugin` renders remote cursor decorations
- CRDT undo/redo keymap (`Mod-z`, `Mod-Shift-z`) using `undoCommand`/`redoCommand`
- In collab mode, `history: false` passed to `exampleSetup` to disable built-in PM history

#### 2.2 Remote Ops & Awareness Subscriptions

After EditorView creation (in collab mode):
- `collab.subscribeDoc({ docId, onOps, onSyncComplete })` — receives remote ops, filters to `Operation` types (excludes `field`/`set`), calls `applyRemoteOps`
- `collab.subscribeAwareness({ docId, onAwareness })` — converts awareness states to `RemoteCursor` decorations via `awarenessToRemoteCursor`, updates via `updateRemoteCursors`
- `dispatchTransaction` sends cursor awareness on selection changes

#### 2.3 Bootstrap Logic

The bootstrap problem: when a client opens a note, it parses markdown into a PM doc. The CRDT plugin captures this as insert ops. If two tabs open the same note, both would send full-doc bootstrap ops, causing duplicate content.

Solution implemented:
1. `syncComplete` flag (initially `false`) gates the `onLocalOps` callback — no ops sent before sync completes.
2. `onSyncComplete` callback fires when initial sync with the server finishes:
   - If remote ops were received (`receivedRemoteOps === true`): server already has content, don't bootstrap.
   - If no remote ops received: this is the first client. Dispatch a self-replacing transaction (`replaceWith(0, size, content)`) to trigger `onLocalOps` and send the full doc to the server.

### Phase 4: Todos / Kanban (Team Mode v1)

#### 4.1 CRDT Kanban Hook and File Backing

**Files**:
- `bun-sidecar/src/features/todos/useKanban.ts`
- `bun-sidecar/src/features/todos/browser-view.tsx`
- `bun-sidecar/src/features/todos/archived-view.tsx`
- `bun-sidecar/src/features/todos/CreateTodoCommandDialog.tsx`

Key implementation details:
- Team mode uses a custom local hook (`useKanban`) instead of `@crdt/lib`'s demo hook.
- Each board is a CRDT board record scoped per workspace + project (`ws:{orgWorkspaceId}:kanban:{projectKey}`).
- Each todo card is its own CRDT record (`ws:{orgWorkspaceId}:card:{todoId}`), while board record stores layout/ordering.
- Card fields include `todoId` for file persistence compatibility and legacy card-id fallback.
- On first sync of a board, file-backed todos are loaded and merged into CRDT state to prevent data loss.
- Mutations in team mode remain file-backed for compatibility:
  - `createTodo` persists file first, then creates CRDT card.
  - `updateTodo` persists file, then updates/moves CRDT card.
  - `reorderTodos` persists file ordering, then applies CRDT move operations.
- Soft delete is implemented in v1 (`archived + deleted` flags), matching current team-mode behavior.

#### 4.2 Presence and Editing Awareness

**Files**:
- `bun-sidecar/src/features/todos/useKanban.ts`
- `bun-sidecar/src/features/todos/browser-view.tsx`
- `bun-sidecar/src/features/todos/TodoCard.tsx`
- `bun-sidecar/src/features/todos/TaskCardEditor.tsx`

Presence model:
- Awareness is sent on the board doc channel.
- Focused card is represented as `viewingDocId = cardDocId` and mapped back to `todoId` in UI state.
- Editing state is represented with awareness `cursor` presence (sentinel value), and aggregated separately.
- `useKanban` exposes:
  - `presenceByDoc: Map<todoId, UserInfo[]>`
  - `editingByDoc: Map<todoId, UserInfo[]>`
  - `sendPresence({ todoId, editing })`

UI behavior:
- Kanban cards show viewer count and editing badge.
- Cards get remote-presence outline tint when another user is focused/editing that card.
- Task editor dialog shows remote editor avatars for the active card.

For the full behavior and data flow, see `docs/features/todos-collaboration.md`.

### Phase 3: Relay + Production Config (Progress)

Implemented in-progress Phase 3 pieces:

1. Team-backend now serves authenticated `/ws/crdt` with workspace-scoped authz and durable CRDT state (DB op tail + S3 snapshots).
2. Sidecar now supports relay mode (`createCRDTRelay`) behind `CRDT_RELAY_ENABLED`.
3. Sidecar tracks CRDT doc subscribe/unsubscribe and relays only workspace-scoped doc IDs.
4. Team backend base URL in frontend team flows is now runtime-resolved from sidecar (`/api/team-backend/config`) instead of hardcoded localhost.
5. Notes + kanban now use workspace-scoped doc-id builders:
   - `ws:{orgWorkspaceId}:note:{noteFileName}`
   - `ws:{orgWorkspaceId}:kanban:{projectKey}`
   - `ws:{orgWorkspaceId}:card:{todoId}`

---

## Known Issues / Active Bugs

### 1. Content Divergence Between Tabs

**Status**: Partially fixed, needs testing

**Symptom**: Two browser tabs open the same note. Edits in one tab appear in the other (cursor labels visible), but content drifts out of sync — text appears duplicated or in wrong positions.

**Root causes identified and fixed**:
1. **Shared clientId across tabs** — Was using Clerk `userId` (same for all tabs of one user). CRDT clocks collided. Fixed: now generates unique per-tab ID.
2. **Double bootstrap** — Both tabs sent full-doc insert ops on open. Fixed: `syncComplete` flag + `onSyncComplete` callback gates bootstrap to first client only.

**Possible remaining issues** (if divergence persists after testing):
- The `@crdt/lib` ProseMirror layer may not correctly handle Nomendex's `tableSchema` node types yet. The requirements spec (`crdt-prosemirror-requirements.md`) documents 6 categories of gaps (block attrs, inline atoms, leaf blocks, nesting, tables, marks). The CRDT lib team has been working on these but the extent of current support is unclear.
- `applyRemoteOps` may produce PM state that's inconsistent with the schema if ops reference node types or structures the PM layer doesn't fully support yet.
- The `onLocalOps` filter (`op.type !== "field" && op.type !== "set"`) may be too aggressive or not aggressive enough.

### 2. Schema Support Gaps in `@crdt/lib`

**Status**: Documented in `crdt-prosemirror-requirements.md`, partially addressed by CRDT lib team

The CRDT lib's ProseMirror integration was originally built for flat `doc > paragraph > text` documents. Nomendex needs:

| Category | What | Status in CRDT lib |
|---|---|---|
| A: Block Attrs | `heading.level`, `code_block.params`, `ordered_list.order` | Unknown |
| B: Inline Atoms | `wiki_link`, `hard_break` | Unknown |
| C: Leaf Blocks | `horizontal_rule`, block-level `image` | Unknown |
| D: Nesting | `blockquote > paragraph`, `list > list_item > paragraph` | Unknown |
| E: Tables | `table > row > cell` hierarchy + cell attrs | Unknown |
| F: Marks | `link.title: null` (null attr values) | Unknown |

If basic paragraph-only editing works but headings/lists/tables diverge, the CRDT lib needs the changes described in `crdt-prosemirror-requirements.md`.

### 3. Y.js Package Cleanup

**Status**: Deferred

The following packages are still in `package.json` but no longer imported:
- `y-prosemirror`
- `y-protocols`
- `y-websocket`
- `yjs`

These should be removed once the CRDT integration is confirmed stable.

---

## Files Modified

| File | Change | Phase |
|---|---|---|
| `bun-sidecar/package.json` | Added `@crdt/lib` dep, updated build script to use `tsconfig.build.json` | 1.1 |
| `bun-sidecar/tsconfig.build.json` | **New** — tsc config with `.d.ts` stubs for crdt lib | 1.1 |
| `bun-sidecar/src/types/crdt-lib/index.d.ts` | **New** — type stubs for `@crdt/lib` | 1.1 |
| `bun-sidecar/src/types/crdt-server/index.d.ts` | **New** — type stubs for `@crdt/lib/server` | 1.1 |
| `bun-sidecar/src/server.ts` | CRDT WS handler, `/ws/crdt` route, `CRDTWSData` type | 1.2 |
| `bun-sidecar/src/lib/collab-doc-id.ts` | **New** — shared workspace-scoped CRDT doc-id builders/parsers | 3.x |
| `bun-sidecar/src/lib/team-backend-config.ts` | **New** — runtime team-backend URL resolver via sidecar config route | 3.x |
| `bun-sidecar/.env.example` | **New** — sidecar relay/team-backend production env keys | 3.x |
| `bun-sidecar/src/contexts/CollabContext.tsx` | Full rewrite: Y.js → CRDT transport + listener registries | 1.3 |
| `bun-sidecar/src/contexts/GHSyncContext.tsx` | Disabled git sync in team mode (`skipSync = isTeamMode`) | 1.4 |
| `bun-sidecar/src/components/WorkspaceOnboarding.tsx` | Team-backend requests now use runtime base URL | 3.x |
| `bun-sidecar/src/components/GitHubRepoPickerDialog.tsx` | Team-backend requests now use runtime base URL | 3.x |
| `bun-sidecar/src/features/notes/note-view.tsx` | Replaced Y.js PM plugins with CRDT plugins, bootstrap logic | 2.1-2.3 |
| `bun-sidecar/src/features/todos/useKanban.ts` | **New** — team-mode kanban CRDT hook (board/card sync, bootstrap, presence) | 4.1-4.2 |
| `bun-sidecar/src/features/todos/browser-view.tsx` | Team-mode data source switch + presence send/render integration | 4.1-4.2 |
| `bun-sidecar/src/features/todos/archived-view.tsx` | Team-mode data source switch for archived todos | 4.1 |
| `bun-sidecar/src/features/todos/TodoCard.tsx` | Presence badges and edit indicators on cards | 4.2 |
| `bun-sidecar/src/features/todos/TaskCardEditor.tsx` | Presence avatars in editor dialog | 4.2 |
| `docs/features/todos-collaboration.md` | **New** — v1 team-mode todos CRDT/presence architecture | 4.x |

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  Browser Tab 1                   Browser Tab 2               │
│  ┌─────────────┐                 ┌─────────────┐             │
│  │ ProseMirror │                 │ ProseMirror │             │
│  │  + CRDT     │                 │  + CRDT     │             │
│  │    Plugin   │                 │    Plugin   │             │
│  └──────┬──────┘                 └──────┬──────┘             │
│         │ onLocalOps / applyRemoteOps   │                    │
│  ┌──────┴──────┐                 ┌──────┴──────┐             │
│  │ CollabCtx   │                 │ CollabCtx   │             │
│  │ (transport) │                 │ (transport) │             │
│  └──────┬──────┘                 └──────┴──────┘             │
│         │ ws://localhost:PORT/ws/crdt   │                    │
└─────────┼───────────────────────────────┼────────────────────┘
          │                               │
    ┌─────┴───────────────────────────────┴─────┐
    │         bun-sidecar (server.ts)            │
    │  ┌─────────────────────────────────────┐   │
    │  │  createCRDTWebSocketHandler         │   │
    │  │  - Manages per-doc CRDT state       │   │
    │  │  - Broadcasts ops between clients   │   │
    │  │  - Handles subscribe/unsubscribe    │   │
    │  └─────────────────────────────────────┘   │
    └────────────────────────────────────────────┘
```

---

## Next Steps

1. **Notes hardening** — continue closing remaining notes sync edge cases (especially schema-heavy structures).
2. **Phase 3: Team Backend Relay** — finish production rollout: relay env wiring, deploy config, and cross-machine validation.
   Plan doc: `docs/specs/team/phase-3-team-backend-relay-plan.md`
3. **Todos/Kanban v2** — add full customizable column UX on top of the existing CRDT board layout model.
4. **Remove Y.js packages** — once notes CRDT path is stable, remove `yjs`, `y-prosemirror`, `y-protocols`, `y-websocket`.
