# CRDT Library for ProseMirror

## Project Overview
A fully TypeScript CRDT (Conflict-free Replicated Data Type) library designed to be dropped into applications using ProseMirror for collaborative editing. Homegrown alternative to y.js.

**Final acceptance test**: Two ProseMirror editors in the UI editing the same document in real time, with changes synced via the CRDT.

## Application Stack
- **Runtime / Server**: Bun (`bun --hot src/index.ts`)
- **Frontend**: React 19, Tailwind CSS 4, shadcn/ui (new-york style)
- **Build**: Bun (`bun run build.ts`)
- **Server entry**: `src/index.ts` — Bun HTTP server serving static + WebSocket relay + REST API + server-side CRDT state
- **CLI**: `bun run cli` — command-line tool for reading/editing the document via REST API
- **Frontend entry**: `src/frontend.tsx` — React root with HMR
- **UI components**: `src/components/ui/` — shadcn primitives

## Development Methodology
- **TDD (Test-Driven Development)**: Every feature must have tests written BEFORE implementation.
- Features are tracked as markdown files in `/tasks/` with YAML frontmatter.

## Task File Format
All tasks live in `/tasks/` as `.md` files. Each task uses YAML frontmatter:

```yaml
---
id: T-001
title: "Task title"
status: pending | in-progress | done
priority: high | medium | low
tags: [crdt, prosemirror, networking, etc.]
depends_on: [T-000]  # IDs of tasks that must be completed first
created: 2026-02-17
completed: null
---
```

Task body contains:
- **Description**: What this feature/task is
- **Acceptance Criteria**: Bullet list of what "done" means
- **Test Plan**: How to test this (written before implementation)
- **Implementation Notes**: Filled in during/after implementation

## Tech Stack
- **Language**: TypeScript (strict mode, no `any`, no `unknown`)
- **Runtime**: Bun
- **Testing**: Bun test (`bun test`)
- **Build**: Bun
- **Editor Integration**: ProseMirror
- **UI**: React 19, Tailwind CSS 4, shadcn/ui

## Code Conventions
- Never use `any` or `unknown` for types.
- Prefer functions with a single parameter object.
- Use Bun for running, testing, and building.
- Use UV for any Python tooling if needed.
- Never use `~` in file paths — use absolute paths or `@` aliases.
- Do not run the server — the user handles that.
- Never add color to shadcn components unless requested.
- No unnecessary abstractions — keep things minimal until needed.

## Project Structure
```
/src/
  /crdt/
    /core/          # Core CRDT types and algorithms (clock, client ID, operations)
    /document/      # Document-level CRDT operations (CRDTRecord, board helpers, DocManager)
    /network/       # Sync protocol, networking, WebSocket transport
    /prosemirror/   # ProseMirror plugin and bindings
    /server/        # Server-side document API (string-match → CRDT ops) + card API
    index.ts        # CRDT library entry point (all public exports)
  /components/
    /ui/            # shadcn components
    CRDTEditor.tsx  # ProseMirror editor with CRDT + WebSocket
    KanbanBoard.tsx # Kanban board UI (columns + cards, drag-and-drop)
    CardEditor.tsx  # Card detail editor (fields, tags, body)
  /hooks/
    useKanbanCRDT.ts # React hook: client-side CRDT state via WebSocket
  /lib/             # Shared utilities (cn, etc.)
  App.tsx           # Main React app — hash-based routing (#kanban, #collab)
  frontend.tsx      # React entry point
  index.ts          # Bun server entry (HTTP + WebSocket + REST API)
  cli.ts            # CLI tool for reading/editing via REST API
  index.html        # HTML template
/tests/
  /crdt/
    /core/
    /document/
    /network/
    /prosemirror/
    /server/
/tasks/             # Feature tracking with YAML frontmatter
/styles/            # Global CSS / Tailwind theme
```

## CRDT Architecture
This library implements a sequence CRDT suitable for rich text editing:
- **Clock**: Logical clocks (Lamport / Vector clocks) for causal ordering
- **Operations**: Insert, Delete, Format, AttrUpdate, and Reparent operations on a document tree
- **Conflict Resolution**: Deterministic ordering using client IDs + logical timestamps (YATA algorithm)
- **Document Model**: Tree structure mapping to ProseMirror's document model (doc > block > inline), with recursive nesting via `parentBlockId`
- **Sync Protocol**: State vectors + update exchange for peer synchronization
- **Undo/Redo**: CRDT-aware undo manager that respects concurrent edits
- **ProseMirror Plugin**: Bridges CRDT state ↔ ProseMirror transactions

## Key Implementation Details

### Core Data Model (`src/crdt/core/`)
- **`CRDTDoc`** (in `apply-operations.ts`): Flat item store + appliedOps set (idempotency) + pendingDeletes/pendingFormats (out-of-order op handling) + stateVector
- **`ItemStore`** (in `item.ts`): Array-backed list + `Map<string, Item>` for O(1) lookup. Key format: `"clientId:clock"`
- **YATA conflict resolution**: When two inserts target the same position, compare `Timestamp` (clock first, then clientId) to determine order
- **All data structures are immutable** — functions return new objects

### Key Gotchas
- **CRDT tombstones are permanent**: `deleteItem` sets `deleted: true` but never removes the item. Redo after undo-of-insert must create a NEW insert (can't un-delete)
- **Undo/Redo symmetry**: Both undo and redo stacks store operations. `computeInverse` is called each time to generate the reverse ops based on current doc state
- **PM ↔ CRDT position mapping**: ProseMirror counts block nodes as **2 positions** (opening tag + closing tag), but CRDT block items count as **1 position**. Both `proseMirrorPositionToCRDT` and `getItemsInRange` must add +1 for the closing tag of the previous block when encountering a non-first block. Without this, positions in multi-paragraph documents drift by 1 per paragraph boundary
- **Plugin init must sync with PM**: The CRDT plugin inserts an initial paragraph block to match PM's default `<doc><paragraph/></doc>` structure
- **GC is conservative**: Only GC when ALL peers' state vectors >= doc's state vector. Avoids tracking which operation deleted each item
- **Sync requires all ops**: The sync protocol needs access to all operations (stored in `allOps` on plugin state) to compute missing ops for remote peers
- **Two fresh editors both create their own paragraph**: Each `createCRDTPlugin` init creates a paragraph block. For true collab, provide a shared `initialDoc` so both editors start from the same paragraph block (see `CollaborativeDemo.tsx`)
- **Plugin `onLocalOps` callback**: Stored in a WeakMap keyed by plugin instance so that `undoCommand`/`redoCommand` can emit ops through it
- **Undo/redo ops must be synced**: The inverse ops from undo/redo need to be sent over WebSocket to other editors. `undoCommand`/`redoCommand` return the ops for this purpose
- **`crdtToProseMirror` drops orphaned text**: If text items exist without a parent block item, they won't appear in the rebuilt PM doc. Always ensure a block item exists
- **Transport uses typed messages**: Wire messages include `docId` in every message: `{ type: "subscribe", docId, stateVector? }`, `{ type: "ops", docId, ops }`, `{ type: "awareness", docId, clientId, state }`, `{ type: "sync-response", docId, ops }`. Server routes messages per-doc to subscribed clients
- **Server-side CRDT state**: Server uses a single `DocManager` + `LamportClock` for ALL documents (collab editors, kanban, cards). Collab doc uses `docId: "__collab__"`. REST API edits generate ops and broadcast via `broadcastDocOps`
- **WS client identity must be per connection**: `createCRDTWebSocketHandler` stores clients in a map keyed by `WSClient.id`. Do NOT use query `clientId` for this key; use a unique `connectionId` per socket upgrade to avoid reconnect/HMR collisions
- **tldraw bridge uses LWW field mirroring**: `useTldrawCRDT` maps each tldraw record to `FieldOp` key `tl:<recordId>` (JSON value, empty-string delete sentinel) in `docId: "__tldraw__"`. Reliable sync depends on mount/sync race handling (restore on mount + sync complete), base record seeding, and batched incremental ops
- **Dual-anchor inserts (secondParentId)**: `InsertOp` has optional `secondParentId` field providing the other boundary anchor. When `side: "left"`, `secondParentId` is the leftOrigin; when `side: "right"`, it's the rightOrigin. This bounds the YATA scanning range, preventing high-clock items from sliding past sequential chains. PM plugin and document-api both set this when both anchors are available
- **Content-addressed edits use `side: "left"`**: When inserting in the middle of existing text, all new chars use `side: "left"` with the first item after the insertion point as rightOrigin + `secondParentId` for leftOrigin
- **Cursor decorations use widget + inline**: Remote cursors rendered as widget decorations (colored line + name label), selections as inline decorations with transparent background color
- **Suggestion mode uses CRDT marks**: Suggestions are normal FormatOps/InsertOps with `suggestion` marks (`{ type: "suggestion", attrs: { id, action: "insert"|"delete" } }`). They sync automatically via existing CRDT infrastructure. Accept removes marks (inserts) or deletes items (delete-marked). Reject deletes items (inserts) or removes marks (delete-marked)
- **Each item can have at most one suggestion mark**: `applyFormat` prevents adding a second mark of the same type. An item cannot be part of two suggestions simultaneously
- **Board card positions are JSON strings**: LWW fields store `{"column":"todo","order":"a"}` as a string, parsed by `getCardPosition`. This avoids needing a separate `LWWRegister<CardPosition>` type — the generic `LWWRegister<string>` + JSON handles it
- **card-api `nextId` uses `clock.clientId`**: Not a hardcoded server ID. This allows the same card-api functions to work both server-side and client-side (via `useKanbanCRDT`)
- **card-api `boardDocId` param**: All card-api functions that touch the board accept an optional `boardDocId` parameter (defaults to `BOARD_DOC_ID`). This allows multiple boards per app. `useKanbanCRDT`, `usePresenceByDoc`, and `useSendPresence` also accept optional `boardDocId`
- **`encodeRecordSnapshot` / `decodeRecordSnapshot`**: Lossless round-trip for full CRDTRecord state (fields with timestamps, sets with removed entries, body items, stateVector, appliedOps). Used by server checkpointing
- **Relay echo prevention**: `createCRDTRelay` uses `onDocChanged` source field to avoid echo loops — only forwards `source: "client"` ops to remote. Remote ops applied via `appendDocOps` have `source: "server"` and are NOT re-forwarded
- **Checkpoint + subscribe**: When a checkpoint exists, sync-response includes a base64 `snapshot` field. Transport calls `onSnapshot` callback before `onOps` if the snapshot field is present
- **Kanban UI has zero REST polling**: `KanbanBoard` and `CardEditor` read from local CRDT state managed by `useKanbanCRDT`. Mutations apply locally (instant) and send over WebSocket (async). No `setInterval`, no `fetch()`, no debounce
- **Auto-subscribe to card docs**: The `useKanbanCRDT` hook derives card IDs from board state and auto-subscribes/unsubscribes via WebSocket. Server sends all existing ops for a doc on subscribe, so the client catches up
- **`listCards` skips BOARD_DOC_ID**: Since board and cards are both `CRDTRecords` in the same `DocManager.docs` map, `listCards` filters out the `__board__` docId to avoid listing it as a card
- **Single WebSocket via CRDTProvider**: The entire app shares one `MultiDocTransport` created by `CRDTProvider`. Both `useKanbanCRDT` and `CRDTEditor` consume from context — they never create their own transport
- **Ref-counted doc subscriptions**: `CRDTProvider.subscribeDoc` ref-counts per docId. First listener triggers `transport.subscribe()`, last unsub triggers `transport.unsubscribe()`. Two `CRDTEditor`s on the same docId both receive ops via listener multiplexing
- **Offline toggle affects the whole app**: Since there's one WebSocket, `disconnect()`/`reconnect()` from any editor disconnects/reconnects everything. This is intentional for debugging
- **Leaf blocks count as 1 PM position**: `horizontal_rule` and other leaf blocks (no content) count as 1 position in PM, not 2. `proseMirrorPositionToCRDT` tracks `lastBlockWasLeaf` to avoid adding close tag for previous leaf block
- **Block nesting via `parentBlockId`**: `BlockContent.parentBlockId` creates a tree overlay on the flat CRDT. `crdtToProseMirror` builds the tree recursively. Root blocks have `parentBlockId === undefined`
- **AttrUpdateOp stores `oldValue` for undo**: Unlike the original plan (which said "no oldValue"), the implementation stores `oldValue` because `computeInverse` can't derive the old value from doc state (the op is already applied). Same for `ReparentOp.oldParentBlockId`
- **Inline atoms are non-text inline items**: `InlineAtomContent` represents `hard_break`, `wiki_link`, `image`, etc. They count as 1 PM position and are classified with text items (not blocks) for parent block assignment
- **`pendingAttrUpdates` and `pendingReparents`**: CRDTDoc has pending maps for attr_update and reparent ops whose target item hasn't been inserted yet. Applied when the target item arrives (same pattern as `pendingDeletes` and `pendingFormats`)
- **Block attrs use non-default filtering**: `extractBlockAttrs` in transaction-capture only includes attrs that differ from `node.type.defaultAttrs`, avoiding bloating every paragraph with empty attrs
- **Table `colwidth` as JSON string**: CRDT attrs only hold scalars. `colwidth: number[]` is serialized as JSON string `"[100,200]"` in CRDT, deserialized in `crdtToProseMirror`
- **`ReplaceAroundStep` for wrap/unwrap**: Wrapping inserts a container block + reparent children. Unwrapping reparents children to container's parent + deletes container

### Module Map
| Module | Purpose | Key exports |
|--------|---------|------------|
| `core/lamport-clock.ts` | Logical clocks | `createClock`, `increment`, `receive`, `compareTimestamps` |
| `core/client-id.ts` | Unique client IDs | `generateClientId`, `ClientId` |
| `core/operations.ts` | Operation types | `InsertOp`, `DeleteOp`, `FormatOp`, `AttrUpdateOp`, `ReparentOp`, `Operation` |
| `core/item.ts` | CRDT linked list | `ItemStore`, `integrateItem`, `deleteItem` |
| `core/apply-operations.ts` | Op application engine | `CRDTDoc`, `applyOperation`, `applyOperations` |
| `core/undo-manager.ts` | Undo/redo | `UndoManager`, `undo`, `redo`, `trackOperation` |
| `core/gc.ts` | Tombstone GC | `collectGarbage` |
| `core/lww-register.ts` | Last-Writer-Wins register | `createLWWRegister`, `setLWWRegister`, `LWWRegister` |
| `core/or-set.ts` | Observed-Remove Set (add-wins) | `createORSet`, `addToSet`, `removeFromSet`, `getSetValues` |
| `core/fractional-index.ts` | Base-62 fractional indexing | `generateKeyBetween` |
| `document/record.ts` | Generic CRDT record (fields + sets + body) | `CRDTRecord`, `applyRecordOp`, `getField`, `getSetField` |
| `document/board-document.ts` | Board read helpers on CRDTRecord | `getColumns`, `getCardsInColumn`, `getCardPosition` |
| `document/doc-manager.ts` | Multi-doc routing by docId | `DocManager`, `applyDocOperation`, `getDoc` |
| `document/document.ts` | Tree doc model | `CRDTDocument`, `insertBlock`, `insertText` |
| `document/snapshot.ts` | Persistence (CRDTDoc + CRDTRecord snapshots) | `encodeSnapshot`, `decodeSnapshot`, `encodeRecordSnapshot`, `decodeRecordSnapshot` |
| `document/yaml-serialization.ts` | CRDTRecord ↔ markdown+YAML | `recordToMarkdown`, `markdownToRecordOps` |
| `network/state-vector.ts` | Sync state | `StateVector`, `missingOps`, `filterMissingOps` |
| `network/sync.ts` | Sync protocol | `fullSync`, `generateSyncStep1`, `receiveSyncStep2` |
| `network/encoding.ts` | Wire format | `encodeOperations`, `decodeOperations` |
| `network/awareness.ts` | Cursor/presence | `Awareness`, `setLocalState`, `removeStaleStates` |
| `network/multi-doc-transport.ts` | Unified WS transport (multi-doc, delta sync, awareness, offline queue, auth) | `createMultiDocTransport`, `MultiDocTransport` |
| `prosemirror/state-mapping.ts` | CRDT ↔ PM | `crdtToProseMirror`, `proseMirrorPositionToCRDT` |
| `prosemirror/transaction-capture.ts` | PM → CRDT ops | `transactionToCRDTOps` |
| `prosemirror/plugin.ts` | PM plugin | `createCRDTPlugin`, `applyRemoteOps`, `undoCommand` |
| `prosemirror/cursor-decorations.ts` | Remote cursors | `createCursorPlugin`, `updateRemoteCursors`, `awarenessToRemoteCursor` |
| `server/document-api.ts` | String-match → CRDT ops + suggestions | `editDocument`, `insertAtAnchor`, `suggestEdit`, `suggestInsert`, `acceptSuggestion`, `rejectSuggestion`, `listSuggestions` |
| `server/card-api.ts` | Kanban card/board CRUD helpers (all accept optional `boardDocId`) | `createCard`, `moveCard`, `addColumn`, `getBoardState`, `getCardDetail` |
| `server/relay.ts` | Sidecar relay: bridges local handler ↔ remote server | `createCRDTRelay`, `CRDTRelay` |

### UI Components
| Component | Purpose |
|-----------|---------|
| `hooks/CRDTProvider.tsx` | React context provider: single `MultiDocTransport`, shared `clientId`, listener registries with ref-counted doc subscriptions |
| `hooks/useCRDT.ts` | Context hooks: `useCRDT()` (full context), `useClientId()`, `useTransport()` |
| `hooks/usePresence.ts` | Presence hooks: `usePresenceByDoc()` (aggregated remote users by docId), `useSendPresence()` |
| `hooks/useKanbanCRDT.ts` | React hook managing kanban CRDT state via context (no own transport). Uses `usePresenceByDoc` + `useSendPresence` |
| `components/CRDTEditor.tsx` | React wrapper: PM EditorView + CRDT plugin + context-based transport + undo/redo keybindings. Props: `label`, `docId`, optional `initialDoc` |
| `components/CollaborativeDemo.tsx` | Creates shared initial CRDT doc (with paragraph block) and renders two `CRDTEditor` instances + `SuggestionBar` |
| `components/SuggestionBar.tsx` | Polls server for pending suggestions, shows inline diff preview, accept/reject per-suggestion and bulk actions |
| `components/KanbanBoard.tsx` | Kanban board: columns, card list, drag-and-drop. Uses `useKanbanCRDT` hook — zero REST polling |
| `components/CardEditor.tsx` | Card detail editor: title, description, due date, tags, custom fields, body. Receives CRDT mutation functions via props |
| `App.tsx` | Hash-based routing: `#kanban` → KanbanBoard, `#collab` → CollaborativeDemo. Wrapped in `<CRDTProvider>` |

### Server (`src/index.ts`)
- Bun `serve()` with `fetch` handler upgrading `/ws?clientId=...` to WebSocket
- **Unified multi-doc**: Server maintains `CardApiState` (`DocManager` + `LamportClock`) for ALL documents. Collab editor uses `docId: "__collab__"`, kanban board uses `BOARD_DOC_ID`. Tracks all ops per docId. Clients subscribe/unsubscribe per doc with optional state vectors for delta sync
- REST API endpoints for programmatic document editing (see REST API section below)
- **Handler callbacks**: `onDocChanged({ docId, ops, source })` fires after ops are applied (source = "client" for WS ops, "server" for `appendDocOps`); `onAwareness({ docId, clientId, state })` fires when local clients send awareness
- **Checkpointing**: `handler.checkpointDoc({ docId })` snapshots the current CRDTRecord and clears the ops history. New subscribers receive the snapshot + post-checkpoint ops in the sync-response. Reduces server memory for long-lived docs
- **Relay** (`createCRDTRelay`): Creates a local handler + remote transport pair for sidecar pattern. Local client ops are forwarded to the remote server; remote ops are applied locally and broadcast to local clients. Awareness is bidirectional. Use for desktop apps that run a local WS server while syncing with a cloud server

### CRDTRecord (`src/crdt/document/record.ts`)

A generic, reusable CRDT data structure combining three kinds of fields:

```typescript
interface CRDTRecord {
  readonly fields: ReadonlyMap<string, LWWRegister<string>>;  // scalar LWW
  readonly sets: ReadonlyMap<string, ORSet<string>>;           // OR-Set
  readonly body: CRDTDoc;                                      // rich text
  readonly appliedOps: ReadonlySet<string>;                    // idempotency
  readonly stateVector: StateVector;                           // tracks max clock per clientId
}
```

**Operation types:**
- `FieldOp` (`type: "field"`) — LWW register write: `{ fieldName, value, timestamp }`
- `SetOp` (`type: "set"`) — OR-Set add/remove: `{ fieldName, action, value, removeIds? }`
- `RecordOp` = `FieldOp | SetOp | Operation` — unified type covering all record operations including rich text body ops

**Key functions:** `createRecord`, `applyRecordOp`, `applyRecordOps`, `getField`, `getFields`, `getSetField`, `getBodyText`

Both kanban cards and the board itself are `CRDTRecords`. A card uses `fields` for title/description/due_date, `sets` for tags, and `body` for rich text. The board uses `sets["columns"]` for column names and `fields["card:<cardId>"]` for card positions (JSON-encoded `{ column, order }`).

### Board Helpers (`src/crdt/document/board-document.ts`)

Read-only helpers that interpret a `CRDTRecord` as a kanban board:

- `getColumns({ record })` — reads `sets["columns"]`
- `getCardsInColumn({ record, column })` — scans `fields["card:*"]`, filters by column, sorts by fractional index order
- `getCardPosition({ record, cardId })` — reads `fields["card:<cardId>"]`, parses JSON

Board mutations are just regular `FieldOp`/`SetOp` operations targeting the board record:
| Action | RecordOp |
|--------|----------|
| Add column | `SetOp { fieldName: "columns", action: "add", value: "Todo" }` |
| Remove column | `SetOp { fieldName: "columns", action: "remove", value: "Todo", removeIds }` |
| Move card | `FieldOp { fieldName: "card:<cardId>", value: JSON.stringify({ column, order }), timestamp }` |

### DocManager (`src/crdt/document/doc-manager.ts`)

Routes operations to the correct `CRDTRecord` by `docId`. All documents — including the board (`docId: "__board__"`) — are stored in a single `ReadonlyMap<string, CRDTRecord>`. No special-casing for board vs card documents.

### Card API (`src/crdt/server/card-api.ts`)

High-level mutation functions that generate `RecordOp`s, apply them to the `DocManager`, and return both the updated state and the ops for broadcasting:

```typescript
interface CardApiResult {
  state: CardApiState;                                    // updated { manager, clock }
  ops?: ReadonlyArray<{ docId: string; op: RecordOp }>;  // ops to broadcast
}
```

Functions: `createCard`, `updateCardFields`, `addCardTags`, `removeCardTags`, `moveCard`, `addColumn`, `removeColumn`, `getCardSummary`, `getCardDetail`, `listCards`, `getBoardState`

The `nextId` helper uses `clock.clientId` (not a hardcoded server ID), allowing the same functions to be used client-side for local-first op generation.

### Kanban Real-Time Architecture

The kanban board uses client-side CRDT state with WebSocket sync — no REST polling. All transport is shared via `CRDTProvider` context.

**`CRDTProvider` (`src/hooks/CRDTProvider.tsx`):**

- Creates a single `clientId` + `UserInfo` + `MultiDocTransport` (one WebSocket for the whole app)
- Maintains listener registries: `Map<docId, Set<OpsListener>>` and `Map<docId, Set<AwarenessListener>>`
- Ref-counts doc subscriptions — first listener triggers `transport.subscribe()`, last unsub triggers `transport.unsubscribe()`
- Exposes stable callbacks: `subscribeDoc`, `subscribeAwareness`, `sendOps`, `sendAwareness`, `disconnect`, `reconnect`
- Both `useKanbanCRDT` and `CRDTEditor` consume from this context — no separate transports

**`useKanbanCRDT` hook (`src/hooks/useKanbanCRDT.ts`):**

1. On mount: gets `clientId` + `sendOps` + `subscribeDoc` from `useCRDT()`, creates a `LamportClock` and `DocManager`
2. Subscribes to `BOARD_DOC_ID` via `subscribeDoc` (ref-counted)
3. Auto-subscribes to card docIds as they appear in the board state (and unsubscribes when removed)
4. Uses `usePresenceByDoc()` and `useSendPresence()` from context for kanban presence
5. Mutation functions (e.g. `doAddColumn`, `doCreateCard`, `doMoveCard`, `doUpdateFields`):
   - Call card-api helpers to generate ops
   - Apply ops to local state (instant UI update)
   - Send ops via `sendOps` from context (async broadcast to server + other clients)

**Multi-doc WebSocket messages:**
- `{ type: "subscribe", docId, stateVector? }` — subscribe with optional SV for delta sync
- `{ type: "unsubscribe", docId }` — unsubscribe
- `{ type: "ops", docId, ops: RecordOp[] }` — bidirectional
- `{ type: "awareness", docId, clientId, state }` — bidirectional presence
- `{ type: "sync-response", docId, ops: RecordOp[] }` — server→client delta after subscribe

**Data flow:**
```
User types in CardEditor
  → doUpdateFields(cardId, { title: "new" })
    → card-api generates FieldOp
    → applyDocOperation (local CRDT state updated instantly)
    → transport.send (WS message to server)
      → server applies op, broadcasts to other clients
        → other client's onOps callback
          → applyDocOperation (their local state updates)
          → React re-renders with new data
```

### REST API

All endpoints use JSON. Content-addressed — no position indices.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/doc` | Read document text + state vector |
| `POST` | `/api/doc/edit` | Content-addressed replace: `{ oldString, newString }` |
| `POST` | `/api/doc/insert` | Anchor-based insert: `{ content, anchor?, position? }` |
| `GET` | `/api/doc/ops` | Get operations for a document (debug/sync). Optional `?docId=...`, default `__collab__` |
| `POST` | `/api/doc/suggest/edit` | Suggest a replace: `{ oldString, newString }` |
| `POST` | `/api/doc/suggest/insert` | Suggest an insert: `{ content, anchor?, position? }` |
| `POST` | `/api/doc/suggest/:id/accept` | Accept suggestion by ID |
| `POST` | `/api/doc/suggest/:id/reject` | Reject suggestion by ID |
| `GET` | `/api/doc/suggestions` | List pending suggestions |

**`GET /api/doc`** response:
```json
{ "content": "hello world", "stateVector": { "server": 3, "shared-init": 1 } }
```

**`GET /api/doc/ops`** — inspect operation history for any doc:
```http
GET /api/doc/ops?docId=__tldraw__
```

```json
{ "docId": "__tldraw__", "ops": [/* ... */], "count": 42 }
```

**`POST /api/doc/edit`** — find `oldString` in visible text, replace with `newString`:
```json
{ "oldString": "hello", "newString": "goodbye" }
```
Returns `{ "success": true }` or `{ "success": false, "error": "string not found" }` (400).
Fails if string not found or multiple matches exist.
Supports optional `"suggest": true` to route through suggestion mode.

**`POST /api/doc/insert`** — insert relative to an anchor string:
```json
{ "content": "beautiful ", "anchor": "world", "position": "before" }
```
`position` is `"before"` or `"after"` (default: `"after"`). If `anchor` is omitted, appends to end.
Supports optional `"suggest": true` to route through suggestion mode.

**`POST /api/doc/suggest/edit`** — suggest a content-addressed replace (text marked, not changed):
```json
{ "oldString": "hello", "newString": "goodbye" }
```
Returns `{ "success": true, "suggestionId": "uuid" }`. Old text gets `suggestion:delete` mark, new text inserted with `suggestion:insert` mark.

**`POST /api/doc/suggest/insert`** — suggest an anchor-based insert:
```json
{ "content": "beautiful ", "anchor": "world", "position": "before" }
```
Returns `{ "success": true, "suggestionId": "uuid" }`. New text inserted with `suggestion:insert` mark.

**`POST /api/doc/suggest/:id/accept`** — accept a suggestion:
- Insert items: suggestion marks removed, text stays
- Delete items: actually deleted

**`POST /api/doc/suggest/:id/reject`** — reject a suggestion:
- Insert items: deleted (removed from document)
- Delete items: suggestion marks removed, text stays

**`GET /api/doc/suggestions`** — list pending suggestions:
```json
{ "suggestions": [{ "id": "uuid", "insertText": "goodbye", "deleteText": "hello" }] }
```

### Kanban REST API

These endpoints remain available for programmatic access (e.g. CLI or external tools). The UI uses WebSocket instead.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/cards` | List all cards |
| `POST` | `/api/cards` | Create card: `{ title?, description?, tags?, column?, fields? }` |
| `GET` | `/api/cards/:id` | Get card detail (fields, tags, body, position) |
| `DELETE` | `/api/cards/:id` | Delete card |
| `PUT` | `/api/cards/:id/fields` | Update card fields: `{ fieldName: value, ... }` |
| `PUT` | `/api/cards/:id/tags` | Add/remove tags: `{ add?: string[], remove?: string[] }` |
| `GET` | `/api/board` | Get board state (columns + cards by column) |
| `POST` | `/api/board/columns` | Add column: `{ column: "name" }` |
| `DELETE` | `/api/board/columns/:name` | Remove column |
| `PUT` | `/api/board/move` | Move card: `{ cardId, column, afterCardId?, beforeCardId? }` |

### CLI (`src/cli.ts`)

Run via `bun run cli <command>`. Calls the REST API at `http://localhost:1212` (override with `CRDT_API_URL` env var).

```
bun run cli read                                    # Print document content
bun run cli edit --old "hello" --new "goodbye"      # Content-addressed replace
bun run cli insert "new text"                       # Append to end
bun run cli insert "text" --anchor "ref" --position before  # Insert before anchor
bun run cli status                                  # Show state vector and op count

# Suggestion mode
bun run cli suggest edit --old "hello" --new "goodbye"  # Suggest a replace
bun run cli suggest insert "text"                       # Suggest append
bun run cli suggest insert "text" --anchor "ref" --position before  # Suggest insert
bun run cli suggest list                                # List pending suggestions
bun run cli suggest accept <id>                         # Accept by ID
bun run cli suggest reject <id>                         # Reject by ID
bun run cli suggest accept-all                          # Accept all
bun run cli suggest reject-all                          # Reject all
```

### Offline Sync Protocol

The transport layer (`src/crdt/network/multi-doc-transport.ts`) supports local-first offline editing. Clients can disconnect, continue editing, and merge seamlessly on reconnect.

**State variables (per-doc):**
- `pendingOps` — ops generated while offline or during sync, queued for sending
- `bufferedDocOps` — per-doc remote ops that arrive during the sync phase, applied after sync completes
- `syncingDocs` — set of docIds currently between subscribe and sync-response

**Reconnect sync flow (per-doc):**
```
1. Client opens WebSocket
2. For each subscribed docId, client sends { type: "subscribe", docId, stateVector? }
   (stateVector = what ops this client already has for that doc)
3. Server decodes state vector, computes missing ops via filterMissingOps()
4. Server sends { type: "sync-response", docId, ops: [<missing ops>] }
5. Client applies sync-response ops for that doc
6. Client applies bufferedDocOps for that doc (any ops that arrived during steps 2-4)
7. Client sends pending ops for that doc to server
8. Normal real-time broadcast resumes for that doc
```

**Why buffer during sync?** Ops from other clients may arrive between steps 2 and 4. These ops might reference items not yet in the local store (the sync-response hasn't arrived yet). Buffering prevents out-of-order application.

**UI integration:** `CRDTEditor.tsx` shows connection state (Connected/Syncing/Offline), a Go Online/Offline toggle, and pending op count while offline.

### Dual-Anchor Inserts (secondParentId)

The YATA conflict resolution algorithm scans items between `leftOrigin` and `rightOrigin` to determine insertion position. Without `rightOrigin`, the scan extends to the end of the item array, causing high-clock inserts to slide past sequential chains of lower-clock items.

**Fix:** `InsertOp.secondParentId` provides the other boundary anchor:
- `side: "right"` + `parentId: A` + `secondParentId: B` → `leftOrigin=A, rightOrigin=B`
- `side: "left"` + `parentId: B` + `secondParentId: A` → `leftOrigin=A, rightOrigin=B`

**Example:** Client B inserts between items `a` and `b` in text "abc":
- Without `secondParentId`: leftOrigin=a, rightOrigin=null → scan range [a+1, end) → B's item slides past b and c
- With `secondParentId`: leftOrigin=a, rightOrigin=b → scan range [a+1, b) → empty → B's item stays between a and b

The PM plugin (`transactionToCRDTOps`) and server API (`buildInsertOps`) both pass both anchors when available. The old convergent algorithm (compare timestamps with ALL items in range) is used — the conflicting-set variant breaks convergence and must NOT be used.

### Rich Schema Support (Phases 1–5)

The PM layer supports full rich text schemas beyond flat `doc > paragraph > text`:

**Content types** (`Content` union in `operations.ts`):
- `TextContent` — single character (`{ type: "text", value: "a" }`)
- `BlockContent` — block node (`{ type: "block", blockType: "heading", attrs?: { level: 2 }, parentBlockId?: OperationId }`)
- `InlineAtomContent` — inline atom (`{ type: "inline_atom", nodeType: "hard_break", attrs?: { ... } }`)

**New operation types**:
- `AttrUpdateOp` — changes a block/inline_atom's attrs (`{ type: "attr_update", targetId, attr, value, oldValue? }`)
- `ReparentOp` — moves a block to a different parent (`{ type: "reparent", targetId, newParentBlockId, oldParentBlockId? }`)

**Block nesting via `parentBlockId`**: Each block can have a `parentBlockId` pointing to its container block. `crdtToProseMirror` builds the tree recursively using a `parentBlockId → children` map. Root blocks (`parentBlockId === undefined`) become direct `doc` children. This supports blockquotes, lists, tables, and arbitrary nesting.

**Key design decisions**:
- `AttrUpdateOp.oldValue` stores the previous value for undo (not derived from doc state, since doc already has new value applied)
- `ReparentOp.oldParentBlockId` stores previous parent for undo (same reason)
- Leaf blocks (e.g. `horizontal_rule`) count as 1 PM position (not 2)
- Inline atoms count as 1 PM position (same as text characters)
- `proseMirrorPositionToCRDT` accepts optional `schema` parameter for leaf block detection
- `colwidth` (table cell) stored as JSON string in CRDT attrs, deserialized in PM bridge
- `ReplaceAroundStep` handled for wrap/unwrap operations (blockquote, list wrapping)
- Pending mechanisms for `AttrUpdateOp` and `ReparentOp` (applied when target item arrives later)

**Supported PM node types** (tested): heading, blockquote, bullet_list, list_item, horizontal_rule, hard_break, table, table_row, table_cell, paragraph, text

## Testing
- **429 tests across 38 files** — all passing
- Tests cover: unit tests for each module, commutativity/idempotency proofs, convergence across up to 10 clients, 1000-iteration fuzz testing, CRDTRecord fields/sets/body, board helpers, DocManager routing, YAML serialization round-trips
- Run with `bun test`
- Fuzz tests use seeded PRNG for deterministic reproduction
