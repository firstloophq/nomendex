# @firstloophq-demos/crdt-lib Integration Guide

A TypeScript CRDT library for collaborative editing and real-time data sync. Designed to work with ProseMirror editors, kanban boards, or any application needing conflict-free replicated data.

## Installation

Add the package from GitHub Packages:

```bash
bun add @firstloophq-demos/crdt-lib@^0.2.0
```

Configure scoped registry auth in your consumer's `.npmrc`:

```ini
@firstloophq-demos:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Export `GITHUB_TOKEN` in your shell/CI before install.

> **Note:** The library exports raw `.ts` files (no build step). Your consuming project must support TypeScript resolution. Bun handles this natively.

## Entry Points

The library exposes three entry points:

| Import | Use Case |
|--------|----------|
| `@firstloophq-demos/crdt-lib` | Core CRDT types, operations, data structures |
| `@firstloophq-demos/crdt-lib/server` | WebSocket handler, document API, card API |
| `@firstloophq-demos/crdt-lib/react` | React hooks, ProseMirror plugin, browser transport |

ProseMirror and React are **optional peer dependencies** — server-only consumers don't need them installed.

---

## Architecture Overview

```
  Browser (React)                         Server (Bun)
  ---------------                         ------------
  <CRDTProvider>                          createCRDTWebSocketHandler
    useKanbanCRDT ─┐                       (unified multi-doc protocol)
    CRDTEditor ────┤── single WebSocket ──
    usePresence ───┘                       REST API (optional)
```

All React components share a **single WebSocket** connection via `CRDTProvider` context. The library uses a **single unified protocol** for all document types. Every document — rich text editors, kanban boards, cards — is a `CRDTRecord` accessed by `docId`. The protocol supports:

- **Subscribe/unsubscribe** per document
- **Delta sync** via state vectors (only missing ops sent)
- **Awareness** (cursor positions, user presence) per document
- **Offline queue** with sync-phase buffering on reconnect
- **Auth** via `getAuthToken` callback

### Wire Protocol

```
Client -> Server:
  { type: "subscribe", docId, stateVector? }     // stateVector enables delta sync
  { type: "unsubscribe", docId }
  { type: "ops", docId, ops: RecordOp[] }
  { type: "awareness", docId, clientId, state }

Server -> Client:
  { type: "sync-response", docId, ops: RecordOp[], snapshot? }  // snapshot = base64 CRDTRecord
  { type: "ops", docId, ops: RecordOp[] }
  { type: "awareness", docId, clientId, state }
```

When `snapshot` is present in a sync-response, the client decodes it via `decodeRecordSnapshot` and restores the full `CRDTRecord` before applying trailing ops. This happens automatically in `createMultiDocTransport` via the `onSnapshot` callback.

---

## Server Setup

### 1. Create the WebSocket handler

```typescript
import { createCRDTWebSocketHandler } from "@firstloophq-demos/crdt-lib/server";

const handler = createCRDTWebSocketHandler({
  serverClientId: "my-server", // optional, defaults to "server"
  onDocChanged({ docId, ops, source }) {
    // Fires whenever ops are applied to a document
    // source: "client" = from a WS client, "server" = from appendDocOps()
    console.log(`${docId}: ${ops.length} ops from ${source}`);
  },
  onAwareness({ docId, clientId, state }) {
    // Fires when a client sends awareness (cursor, presence)
    console.log(`${clientId} awareness on ${docId}`);
  },
});
```

This creates a handler that manages all CRDT state internally — documents, kanban boards, connected clients, and message routing. No initial document setup needed — the first subscriber initializes each document.

The `onDocChanged` callback is key for building integrations like relays, persistence layers, or analytics — it fires for both client-initiated ops and server-side `appendDocOps()` calls, with `source` distinguishing the origin.

### 2. Wire it into your WebSocket server

The handler uses a runtime-agnostic `WSClient` interface, so it works with any WebSocket implementation (Bun, Node `ws`, Deno, etc.).

**Bun example:**

```typescript
import { serve, type ServerWebSocket } from "bun";

interface WSData {
  clientId: string;      // logical client id from query param
  connectionId: string;  // unique id per socket connection
}

// Adapter: Bun's ServerWebSocket -> WSClient
function wrapBunWS(ws: ServerWebSocket<WSData>) {
  return {
    // Must be unique per socket. Do not use logical clientId here.
    id: ws.data.connectionId,
    send(message: string) {
      if (ws.readyState === 1) ws.send(message);
    },
  };
}

serve<WSData>({
  port: 1212,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const clientId = url.searchParams.get("clientId") ?? "unknown";
      const connectionId = crypto.randomUUID();
      // Optional: validate auth token from url.searchParams.get("token")
      server.upgrade(req, { data: { clientId, connectionId } });
      return;
    }
    // ... serve your app
  },
  websocket: {
    open(ws) {
      handler.handleOpen({ client: wrapBunWS(ws) });
    },
    message(ws, message) {
      const msgStr = typeof message === "string"
        ? message
        : new TextDecoder().decode(message);
      handler.handleMessage({ client: wrapBunWS(ws), message: msgStr });
    },
    close(ws) {
      handler.handleClose({ client: wrapBunWS(ws) });
    },
  },
});
```

**Node `ws` example:**

```typescript
import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 1212 });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const clientId = url.searchParams.get("clientId") ?? "unknown";
  const connectionId = crypto.randomUUID();

  const client = {
    // Must be unique per socket. Keep clientId separately for app semantics.
    id: connectionId,
    send(message: string) { ws.send(message); },
  };

  handler.handleOpen({ client });

  ws.on("message", (data) => {
    handler.handleMessage({ client, message: data.toString() });
  });

  ws.on("close", () => {
    handler.handleClose({ client });
  });
});
```

Important: `WSClient.id` is the server's internal connection key. It must be unique per socket connection. Reusing the logical `clientId` for `WSClient.id` can cause reconnect/HMR collisions that break subscriptions and shared sync.

### 3. Add REST endpoints (optional)

The handler exposes state accessors for building REST APIs. All documents use the same pattern:

```typescript
import { getDocumentText, createEmptyDocument, getDoc, applyDocOperation } from "@firstloophq-demos/crdt-lib";
import { editDocument, listSuggestions } from "@firstloophq-demos/crdt-lib/server";

const COLLAB_DOC_ID = "__collab__";

// Read document
app.get("/api/doc", () => {
  const record = getDoc({ manager: handler.getDocManagerState().manager, docId: COLLAB_DOC_ID });
  const body = record?.body ?? createEmptyDocument();
  return { content: getDocumentText({ doc: body }) };
});

// Edit document (content-addressed)
app.post("/api/doc/edit", async (req) => {
  const { oldString, newString } = await req.json();
  const record = getDoc({ manager: handler.getDocManagerState().manager, docId: COLLAB_DOC_ID });
  const body = record?.body ?? createEmptyDocument();
  const { clock } = handler.getDocManagerState();

  const result = editDocument({ doc: body, clock, oldString, newString });
  if (!result.success) return { error: result.error };

  // Apply ops to DocManager
  let state = handler.getDocManagerState();
  let manager = state.manager;
  for (const op of result.ops) {
    manager = applyDocOperation({ manager, docId: COLLAB_DOC_ID, op });
  }
  handler.setDocManagerState({ state: { manager, clock: result.clock } });
  handler.appendDocOps({ docId: COLLAB_DOC_ID, ops: result.ops });
  handler.broadcastDocOps({ docId: COLLAB_DOC_ID, ops: result.ops });

  return { success: true };
});

// Kanban board state
app.get("/api/board", () => {
  const { getBoardState } = require("@firstloophq-demos/crdt-lib/server");
  return getBoardState({ manager: handler.getDocManagerState().manager });
});
```

For sync debugging, add an ops inspection endpoint with optional `docId` query:

```typescript
app.get("/api/doc/ops", (req) => {
  const docId = req.query.docId ?? "__collab__";
  const ops = handler.getDocOps({ docId });
  return { docId, ops, count: ops.length };
});
```

---

## Browser / React Setup

### 1. Wrap your app in CRDTProvider

The `CRDTProvider` creates a single WebSocket connection shared by all components. Every hook and component that needs CRDT access must be a descendant of this provider.

```tsx
import { CRDTProvider } from "@firstloophq-demos/crdt-lib/react";

function App() {
  return (
    <CRDTProvider>
      <MyApp />
    </CRDTProvider>
  );
}
```

With options:

```tsx
<CRDTProvider
  url="ws://my-server:1212/ws"           // optional, defaults to current host
  getAuthToken={() => getSessionToken()}  // optional, for authenticated connections
>
  <MyApp />
</CRDTProvider>
```

The provider handles:
- **Single WebSocket** for the entire app (no duplicate connections)
- **Shared `clientId`** and `UserInfo` across all components
- **Ref-counted doc subscriptions** — first listener triggers subscribe, last unsubscribe triggers unsubscribe
- **Listener multiplexing** — multiple components can subscribe to the same docId
- **Connection state** — `isConnected` boolean available via `useCRDT()`

### 2. Use hooks to access CRDT context

```tsx
import { useCRDT, useClientId, useTransport } from "@firstloophq-demos/crdt-lib/react";

function MyComponent() {
  // Full context — all CRDT operations
  const {
    clientId,           // stable client ID
    userInfo,           // { name, color }
    isConnected,        // WebSocket connection state
    subscribeDoc,       // subscribe to a doc's ops (returns unsub function)
    subscribeAwareness, // subscribe to a doc's awareness (returns unsub function)
    sendOps,            // send ops for a doc
    sendAwareness,      // send awareness for a doc
    disconnect,         // go offline
    reconnect,          // go online
    pendingOpsCount,    // number of queued ops
  } = useCRDT();

  // Or just the parts you need:
  const clientId = useClientId();
  const { sendOps, isConnected } = useTransport();
}
```

### 3. Subscribe to a document

The `subscribeDoc` function returns an unsubscribe function — perfect for React cleanup:

```tsx
import { useCRDT } from "@firstloophq-demos/crdt-lib/react";
import { applyDocOperation, createDocManager } from "@firstloophq-demos/crdt-lib";

function MyDocViewer({ docId }: { docId: string }) {
  const { subscribeDoc } = useCRDT();
  const [manager, setManager] = useState(createDocManager);

  useEffect(() => {
    const unsub = subscribeDoc({
      docId,
      onOps: ({ docId, ops }) => {
        setManager((prev) => {
          let m = prev;
          for (const op of ops) {
            m = applyDocOperation({ manager: m, docId, op });
          }
          return m;
        });
      },
      onSyncComplete: () => console.log("initial sync done"),
    });

    return unsub; // cleanup unsubscribes automatically
  }, [docId, subscribeDoc]);

  // render from manager state...
}
```

### 4. Presence (kanban / any multi-doc UI)

Generic presence hooks that work with any UI — not just kanban. Both hooks accept an optional `boardDocId` to target a specific board's awareness channel (defaults to `BOARD_DOC_ID`):

```tsx
import { usePresenceByDoc, useSendPresence } from "@firstloophq-demos/crdt-lib/react";

function CardList() {
  // Map<docId, UserInfo[]> — who's viewing which document
  const presenceByDoc = usePresenceByDoc();
  // Or for a custom board: usePresenceByDoc({ boardDocId: "my-board" })

  // Broadcast which document you're viewing
  const sendPresence = useSendPresence();

  const handleOpenCard = (cardId: string) => {
    sendPresence(cardId); // tell others you're viewing this card
  };

  const handleCloseCard = () => {
    sendPresence(null); // clear your presence
  };

  // Show presence dots on cards
  return cards.map((card) => (
    <div key={card.id}>
      {card.title}
      {presenceByDoc.get(card.id)?.map((user) => (
        <span key={user.name} style={{ color: user.color }}>
          {user.name}
        </span>
      ))}
    </div>
  ));
}
```

### Collaborative ProseMirror Editor

The `CRDTEditor` component uses the context automatically — just render it inside `CRDTProvider`:

```tsx
import { CRDTProvider } from "@firstloophq-demos/crdt-lib/react";
// CRDTEditor is an app-level component, not exported from the library
import { CRDTEditor } from "./components/CRDTEditor";

function CollabPage() {
  return (
    <CRDTProvider>
      {/* Two editors sharing the same document */}
      <CRDTEditor label="Editor A" docId="__collab__" />
      <CRDTEditor label="Editor B" docId="__collab__" />
    </CRDTProvider>
  );
}
```

Both editors share the same WebSocket. Ref-counted subscriptions mean the transport subscribes once to `__collab__`, and both editors receive ops via listener multiplexing. CRDT idempotency handles dedup.

### tldraw Canvas (Custom CRDT Bridge)

The tldraw integration stores each canvas record as a CRDT `FieldOp` in doc `__tldraw__`:

- Upsert: `fieldName = "tl:<recordId>"`, `value = JSON.stringify(record)`
- Delete: `fieldName = "tl:<recordId>"`, `value = ""` (deletion sentinel)

Fixes applied to make shared sync reliable:

1. **Connection identity fix (server):** `WSClient.id` now uses a per-socket `connectionId` instead of query `clientId`.
2. **Mount/sync race fix (client):** `useTldrawCRDT` restores from CRDT state on both `onMount` and `onSyncComplete`, so either order works.
3. **Base record seeding:** when listener starts and CRDT doc is empty, current tldraw document/page records are seeded as initial ops.

Performance improvements currently in place:

- Incremental op generation from `editor.store.listen(...).changes` (no full-document serialization per event)
- Batch + compact outbound field ops (`OUTBOUND_FLUSH_MS = 32`) so only latest write per `tl:<recordId>` is sent in a burst
- Queue inbound remote ops and apply once per animation frame
- Mirror current `tl:` fields locally to skip unchanged writes

Debugging checklist:

- Inspect op log: `GET /api/doc/ops?docId=__tldraw__`
- Enable verbose hook logs by setting `DEBUG = true` in `src/hooks/useTldrawCRDT.ts`
- During Bun HMR, a transient `WebSocket is closed before the connection is established` warning can appear during reconnect churn

Local file fixture example (easy persistence):

- The demo server can persist `__tldraw__` ops to a JSON file fixture.
- Default file path: `fixtures/tldraw.fixture.json`
- Override path with env var: `TLDRAW_FIXTURE_PATH=/absolute/or/relative/path.json`
- On server start, if the file exists and is valid, ops are replayed into server state.
- On every tldraw doc change, the server rewrites the fixture file (debounced).

Fixture shape:

```json
{
  "version": 1,
  "docId": "__tldraw__",
  "savedAt": "2026-02-19T12:00:00.000Z",
  "ops": []
}
```

### Auth Integration

The transport supports a `getAuthToken` callback that's called on each connect/reconnect. The token is appended to the WebSocket URL as `&token=<value>`:

```tsx
<CRDTProvider
  getAuthToken={async () => {
    // Works with Clerk, Auth0, Firebase, or any auth provider
    const token = await clerk.session?.getToken();
    return token ?? "";
  }}
>
  <MyApp />
</CRDTProvider>
```

On the server, validate the token in the WebSocket upgrade handler:

```typescript
fetch(req, server) {
  const url = new URL(req.url);
  if (url.pathname === "/ws") {
    const token = url.searchParams.get("token");
    if (!validateToken(token)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const clientId = url.searchParams.get("clientId") ?? "unknown";
    server.upgrade(req, { data: { clientId } });
    return;
  }
},
```

### Kanban Board (React)

The `useKanbanCRDT` hook manages all CRDT state client-side with zero REST polling. It **must** be used inside `CRDTProvider`. Accepts an optional `boardDocId` for multi-board setups:

```tsx
import { CRDTProvider, useKanbanCRDT } from "@firstloophq-demos/crdt-lib/react";

function App() {
  return (
    <CRDTProvider>
      <KanbanBoard />
    </CRDTProvider>
  );
}

function KanbanBoard() {
  // Default board: useKanbanCRDT()
  // Custom board: useKanbanCRDT({ boardDocId: "project-alpha-board" })
  const {
    boardState,      // { columns: string[], cardsByColumn: Record<string, Card[]> }
    isConnected,     // from CRDTProvider context
    presenceByDoc,   // Map<docId, UserInfo[]> — from usePresenceByDoc()
    sendPresence,    // (viewingDocId: string | null) => void
    doAddColumn,     // (name: string) => void
    doRemoveColumn,  // (name: string) => void
    doCreateCard,    // ({ title, column }) => cardId
    doDeleteCard,    // (cardId) => Promise<void>
    doMoveCard,      // ({ cardId, column, beforeCardId?, afterCardId? }) => void
    doUpdateFields,  // (cardId, { title: "new" }) => void
    doAddTags,       // (cardId, ["tag1"]) => void
    doRemoveTags,    // (cardId, ["tag1"]) => void
    getCard,         // (cardId) => CardDetail | undefined
  } = useKanbanCRDT();

  return (
    <div>
      {boardState.columns.map((col) => (
        <div key={col}>
          <h2>{col}</h2>
          {boardState.cardsByColumn[col]?.map((card) => (
            <div key={card.cardId}>
              {card.title}
              {/* Show who's viewing this card */}
              {presenceByDoc.get(card.cardId)?.map((user) => (
                <span key={user.name} style={{ background: user.color }} />
              ))}
            </div>
          ))}
          <button onClick={() => doCreateCard({ title: "New", column: col })}>
            Add Card
          </button>
        </div>
      ))}
    </div>
  );
}
```

### Multi-Document Transport (Low-Level)

For non-React or custom use cases, `createMultiDocTransport` is still available directly:

```typescript
import { createMultiDocTransport } from "@firstloophq-demos/crdt-lib/react";
import { createDocManager, applyDocOperation } from "@firstloophq-demos/crdt-lib";

let manager = createDocManager();

const transport = createMultiDocTransport({
  url: "ws://localhost:1212/ws",
  clientId: "my-client",
  onOps({ docId, ops }) {
    for (const op of ops) {
      manager = applyDocOperation({ manager, docId, op });
    }
  },
  onConnect() { console.log("connected"); },
  onDisconnect() { console.log("disconnected"); },
  onDocSyncComplete({ docId }) { console.log(`synced: ${docId}`); },
});

// Subscribe to documents (with optional state vector for delta sync)
transport.subscribe({ docId: "my-doc" });

// Send operations
transport.send({ docId: "my-doc", ops: [myFieldOp] });

// Send awareness (cursor positions)
transport.sendAwareness({
  docId: "my-doc",
  clientId: "my-client",
  state: { cursor: { anchor: 5, head: 5 }, user: { name: "Alice", color: "#f00" }, lastUpdated: Date.now() },
});

// Offline support
transport.disconnect();  // Go offline (queues ops)
transport.reconnect();   // Reconnect + delta sync + flush pending ops
```

---

## Desktop App with Bun Sidecar

For the architecture where a desktop app has a Bun sidecar that acts as a WS server to the browser and a WS client to the central server:

```
  Browser ──WS──> Bun Sidecar ──WS──> Central Server
                  (local)              (remote)
```

Use `createCRDTRelay` — it wires up a local handler + upstream transport with echo prevention built in:

```typescript
import { createCRDTRelay } from "@firstloophq-demos/crdt-lib/server";

const relay = createCRDTRelay({
  remoteUrl: "ws://central-server:1212/ws",
  clientId: "sidecar",
  serverClientId: "sidecar-server",
  docIds: ["doc-1", "doc-2", "__board__"],  // docs to relay
  getAuthToken: () => getSidecarToken(),     // optional auth
  onConnect: () => console.log("connected to central"),
  onDisconnect: () => console.log("disconnected"),
});

// Wire the relay's handler to your local WS server (same pattern as server setup)
// relay.handler has all CRDTWebSocketHandler methods
serve({
  websocket: {
    open(ws) { relay.handler.handleOpen({ client: wrapBunWS(ws) }); },
    message(ws, msg) { relay.handler.handleMessage({ client: wrapBunWS(ws), message: String(msg) }); },
    close(ws) { relay.handler.handleClose({ client: wrapBunWS(ws) }); },
  },
  // ...
});

// Dynamically add/remove relayed docs
relay.addDoc({ docId: "new-doc" });
relay.removeDoc({ docId: "doc-2" });

// Check upstream connection state
relay.isConnected(); // true/false

// Cleanup
relay.close();
```

**How it works:** Local client ops are forwarded upstream automatically. Remote ops are applied locally and broadcast to all local clients. The relay uses `onDocChanged` source checking to prevent echo loops — only `source: "client"` ops go upstream.

---

## Checkpointing and Record Snapshots

Over time, a document accumulates ops. Checkpointing snapshots the current state and clears the op history, reducing memory and sync payload size.

### Server-Side Checkpointing

```typescript
// Checkpoint a document — saves state, clears ops
handler.checkpointDoc({ docId: "my-doc" });

// Check if a checkpoint exists
handler.hasCheckpoint({ docId: "my-doc" }); // true

// Next time a client subscribes to this doc, the sync-response
// will include a base64-encoded snapshot instead of replaying all ops.
// New ops after the checkpoint are sent as trailing ops.
```

### CRDTRecord Snapshots (Persistence)

Use `encodeRecordSnapshot` / `decodeRecordSnapshot` for lossless binary serialization of a full `CRDTRecord`:

```typescript
import {
  encodeRecordSnapshot,
  decodeRecordSnapshot,
  mergeRecordSnapshots,
  getRecordSnapshotVersion,
  isRecordSnapshotVersion,
  getRecordSnapshotStateVector,
  missingFromRecordSnapshot,
  applySnapshotToDoc,
  getDoc,
} from "@firstloophq-demos/crdt-lib";

// Save a record to disk / database
const record = getDoc({ manager, docId: "my-doc" });
if (record) {
  const bytes = encodeRecordSnapshot({ record });  // Uint8Array
  await Bun.write("snapshot.bin", bytes);
}

// Restore later
const data = new Uint8Array(await Bun.file("snapshot.bin").arrayBuffer());
const restored = decodeRecordSnapshot({ data });
// restored is a full CRDTRecord with fields, sets, body, stateVector, appliedOps

// Merge local and remote snapshots (snapshot-only persistence flows)
const localBytes = new Uint8Array(await Bun.file("local.bin").arrayBuffer());
const remoteBytes = new Uint8Array(await Bun.file("remote.bin").arrayBuffer());
const merged = mergeRecordSnapshots({
  local: localBytes,
  remote: remoteBytes,
  bias: "remote", // prefer remote content on equal-content conflicts
});

// Optional: deterministic version for optimistic compare-and-swap writes
const mergedBytes = encodeRecordSnapshot({ record: merged });
const version = getRecordSnapshotVersion({ data: mergedBytes });
const stillCurrent = isRecordSnapshotVersion({
  data: mergedBytes,
  expectedVersion: version,
});

// Optional: read state-vector directly from snapshot bytes
const snapshotSV = getRecordSnapshotStateVector({ data: mergedBytes });
const missing = missingFromRecordSnapshot({
  data: mergedBytes,
  remoteStateVector: snapshotSV, // returns []
});

// Hydrate a DocManager document from snapshot bytes
manager = applySnapshotToDoc({
  manager,
  docId: "my-doc",
  snapshot: mergedBytes,
  mode: "merge",      // or "replace"
  mergeBias: "remote",
});
```

The snapshot preserves everything: LWW timestamps, OR-Set entries (including tombstones for remove tracking), body items, state vectors, and applied op IDs for idempotency. You can continue applying new ops to a restored record.

### Multi-Board Setup

All card-api functions, `useKanbanCRDT`, `usePresenceByDoc`, and `useSendPresence` accept an optional `boardDocId` parameter. This enables multiple independent boards:

```tsx
// Two independent boards in the same app
function ProjectDashboard() {
  return (
    <CRDTProvider>
      <KanbanBoard boardId="alpha" />
      <KanbanBoard boardId="beta" />
    </CRDTProvider>
  );
}

function KanbanBoard({ boardId }: { boardId: string }) {
  const boardDocId = `board-${boardId}`;
  const kanban = useKanbanCRDT({ boardDocId });
  const presenceByDoc = usePresenceByDoc({ boardDocId });
  const sendPresence = useSendPresence({ boardDocId });
  // Each board has its own columns, cards, and presence channel
  // ...
}
```

---

## Core Data Structures

### CRDTDoc

A flat sequence CRDT for rich text. Used by ProseMirror integration.

```typescript
import {
  createEmptyDocument,
  applyOperation,
  getDocumentText,
} from "@firstloophq-demos/crdt-lib";
```

### CRDTRecord

A generic CRDT container with three kinds of fields:

- **fields** — LWW (Last-Writer-Wins) registers for scalar values
- **sets** — OR-Set (add-wins) for collections
- **body** — CRDTDoc for rich text content
- **stateVector** — Tracks max clock per clientId across all op types (enables delta sync)

```typescript
import {
  createRecord,
  applyRecordOp,
  getField,
  getSetField,
  getBodyText,
} from "@firstloophq-demos/crdt-lib";
```

### DocManager

Routes operations to the correct `CRDTRecord` by document ID. All documents (including kanban boards) are stored in a single map.

```typescript
import {
  createDocManager,
  applyDocOperation,
  getDoc,
  BOARD_DOC_ID,
} from "@firstloophq-demos/crdt-lib";
```

---

## Operation Types

All mutations are expressed as operations:

| Type | Description | Used By |
|------|-------------|---------|
| `InsertOp` | Insert text or block into a CRDTDoc | Collab editor |
| `DeleteOp` | Mark an item as deleted (tombstone) | Collab editor |
| `FormatOp` | Add/remove marks (bold, suggestion, etc.) | Collab editor |
| `FieldOp` | Set a LWW register value | Records, kanban |
| `SetOp` | Add/remove from an OR-Set | Records, kanban |

The unified type `RecordOp = FieldOp | SetOp | Operation` covers all record operations.

---

## Further Reading

- **`CLAUDE.md`** — Detailed architecture reference, module map, gotchas, and protocol specs
- **`tests/`** — 381 tests across 33 files demonstrating all APIs and edge cases
- **`src/index.ts`** — Demo server showing full REST + WebSocket integration
- **`src/App.tsx`** — Demo app wrapping everything in `CRDTProvider`
- **`src/hooks/CRDTProvider.tsx`** — Context provider implementation (transport, listener registries, ref-counting)
- **`src/hooks/useCRDT.ts`** — Context consumption hooks
- **`src/hooks/usePresence.ts`** — Generic presence hooks
- **`src/hooks/useKanbanCRDT.ts`** — Kanban CRDT hook (consumes from context)
- **`src/components/CRDTEditor.tsx`** — React ProseMirror editor (consumes from context)
