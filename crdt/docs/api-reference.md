# @crdt/lib API Reference

Quick reference for all public exports across the three entry points.

---

## `@crdt/lib` — Core

Everything needed to work with CRDT data structures. No React or ProseMirror dependency.

### Lamport Clock

```typescript
createClock(params: { clientId: string }): LamportClock
increment(params: { clock: LamportClock }): { clock: LamportClock; timestamp: Timestamp }
receive(params: { clock: LamportClock; remoteCounter: number }): LamportClock
compareTimestamps(params: { a: Timestamp; b: Timestamp }): number
generateClientId(): string
```

### Operations

```typescript
createOperationId(params: { clientId: string; clock: number }): OperationId
operationIdEquals(params: { a: OperationId; b: OperationId }): boolean
createInsertOp(params: {
  id: OperationId;
  parentId: OperationId | null;
  side: "left" | "right";
  secondParentId?: OperationId;
  content: Content;
  marks?: ReadonlyArray<Mark>;
}): InsertOp
createDeleteOp(params: { id: OperationId; targetId: OperationId }): DeleteOp
createFormatOp(params: {
  id: OperationId;
  targetId: OperationId;
  mark: Mark;
  action: "add" | "remove";
}): FormatOp
```

### CRDTDoc (Flat Document)

```typescript
createEmptyDocument(): CRDTDoc
applyOperation(params: { doc: CRDTDoc; op: Operation }): CRDTDoc
applyOperations(params: { doc: CRDTDoc; ops: ReadonlyArray<Operation> }): CRDTDoc
getDocumentText(params: { doc: CRDTDoc }): string
getDocumentStateVector(params: { doc: CRDTDoc }): StateVector
```

### Item Store

```typescript
createItemStore(): ItemStore
integrateItem(params: { store: ItemStore; item: Item }): ItemStore
deleteItem(params: { store: ItemStore; targetId: OperationId }): ItemStore
getItemById(params: { store: ItemStore; id: OperationId }): Item | undefined
getVisibleContent(params: { store: ItemStore }): ReadonlyArray<Item>
```

### Undo/Redo

```typescript
createUndoManager(params: {
  clientId: string;
  captureTimeoutMs: number;
  maxStackDepth?: number;
}): UndoManager
trackOperation(params: { um: UndoManager; op: Operation; timestamp: number }): UndoManager
undo(params: { um: UndoManager; doc: CRDTDoc; nextClock: number }): { um: UndoManager; ops: ReadonlyArray<Operation> } | null
redo(params: { um: UndoManager; doc: CRDTDoc; nextClock: number }): { um: UndoManager; ops: ReadonlyArray<Operation> } | null
canUndo(params: { um: UndoManager }): boolean
canRedo(params: { um: UndoManager }): boolean
```

### LWW Register

```typescript
createLWWRegister<T>(params: { value: T; timestamp: Timestamp }): LWWRegister<T>
setLWWRegister<T>(params: { register: LWWRegister<T>; value: T; timestamp: Timestamp }): LWWRegister<T>
```

### OR-Set

```typescript
createORSet<T>(): ORSet<T>
addToSet<T>(params: { set: ORSet<T>; value: T; id: OperationId }): ORSet<T>
removeFromSet<T>(params: { set: ORSet<T>; value: T; removeIds: ReadonlyArray<OperationId> }): ORSet<T>
getSetValues<T>(params: { set: ORSet<T> }): ReadonlyArray<T>
```

### Fractional Indexing

```typescript
generateKeyBetween(params: { a: string | null; b: string | null }): string
```

### CRDTRecord

```typescript
interface CRDTRecord {
  readonly fields: ReadonlyMap<string, LWWRegister<string>>;
  readonly sets: ReadonlyMap<string, ORSet<string>>;
  readonly body: CRDTDoc;
  readonly appliedOps: ReadonlySet<string>;
  readonly stateVector: StateVector;   // tracks max clock per clientId across all op types
}

createRecord(): CRDTRecord
applyRecordOp(params: { record: CRDTRecord; op: RecordOp }): CRDTRecord
applyRecordOps(params: { record: CRDTRecord; ops: ReadonlyArray<RecordOp> }): CRDTRecord
getField(params: { record: CRDTRecord; fieldName: string }): string | undefined
getFields(params: { record: CRDTRecord }): ReadonlyMap<string, string>
getSetField(params: { record: CRDTRecord; fieldName: string }): ReadonlyArray<string>
getBodyText(params: { record: CRDTRecord }): string
```

### Board Helpers

```typescript
getColumns(params: { record: CRDTRecord }): ReadonlyArray<string>
getCardsInColumn(params: { record: CRDTRecord; column: string }): ReadonlyArray<{ cardId: string; order: string }>
getCardPosition(params: { record: CRDTRecord; cardId: string }): CardPosition | undefined

// CardPosition = { column: string; order: string }
```

### DocManager

```typescript
createDocManager(): DocManager
getOrCreateDoc(params: { manager: DocManager; docId: string }): { manager: DocManager; doc: CRDTRecord }
applyDocOperation(params: { manager: DocManager; docId: string; op: RecordOp }): DocManager
getDoc(params: { manager: DocManager; docId: string }): CRDTRecord | undefined
listDocIds(params: { manager: DocManager }): ReadonlyArray<string>
deleteDoc(params: { manager: DocManager; docId: string }): DocManager

BOARD_DOC_ID = "__board__"
```

### Serialization

```typescript
encodeSnapshot(params: { doc: CRDTDoc }): string
decodeSnapshot(params: { data: string }): CRDTDoc
recordToMarkdown(params: { record: CRDTRecord }): string
markdownToRecordOps(params: { markdown: string; clientId: string; clock: LamportClock }): { ops: ReadonlyArray<RecordOp>; clock: LamportClock }

// Binary record snapshots — lossless encode/decode of full CRDTRecord state
encodeRecordSnapshot(params: { record: CRDTRecord }): Uint8Array
decodeRecordSnapshot(params: { data: Uint8Array }): CRDTRecord
```

### Network / Sync

```typescript
createStateVector(): StateVector
updateStateVector(params: { sv: StateVector; clientId: string; clock: number }): StateVector
missingOps(params: { local: StateVector; remote: StateVector }): ReadonlyArray<MissingRange>
filterMissingOps<T extends { id: { clientId: string; clock: number } }>(params: {
  ops: ReadonlyArray<T>;
  missing: ReadonlyArray<MissingRange>;
}): ReadonlyArray<T>
encodeStateVector(params: { sv: StateVector }): string
decodeStateVector(params: { data: string }): StateVector
fullSync(params: { docA: CRDTDoc; opsA: ReadonlyArray<Operation>; docB: CRDTDoc; opsB: ReadonlyArray<Operation> }): { docA: CRDTDoc; docB: CRDTDoc }
encodeOperations(params: { ops: ReadonlyArray<Operation> }): string
decodeOperations(params: { data: string }): ReadonlyArray<Operation>
```

### Garbage Collection

```typescript
collectGarbage(params: { doc: CRDTDoc; peerStateVectors: ReadonlyArray<StateVector> }): CRDTDoc
```

---

## `@crdt/lib/server` — Server

### WebSocket Handler

```typescript
createCRDTWebSocketHandler(params?: {
  serverClientId?: string;   // default: "server"
  onDocChanged?: (params: {
    docId: string;
    ops: ReadonlyArray<RecordOp>;
    source: "client" | "server";   // "client" = from WS client, "server" = from appendDocOps
  }) => void;
  onAwareness?: (params: {
    docId: string;
    clientId: string;
    state: AwarenessState;
  }) => void;
}): CRDTWebSocketHandler

interface WSClient {
  readonly id: string;
  send(message: string): void;
}

interface CRDTWebSocketHandler {
  // Lifecycle — wire these to your WebSocket server
  handleOpen(params: { client: WSClient }): void;
  handleMessage(params: { client: WSClient; message: string }): void;
  handleClose(params: { client: WSClient }): void;

  // Broadcast — push changes from REST endpoints to WS clients
  broadcastDocOps(params: { docId: string; ops: ReadonlyArray<RecordOp> }): void;
  broadcastAwareness(params: { docId: string; clientId: string; state: AwarenessState }): void;

  // State access — for REST endpoints
  getDocManagerState(): CardApiState;
  setDocManagerState(params: { state: CardApiState }): void;
  getDocOps(params: { docId: string }): ReadonlyArray<RecordOp>;
  appendDocOps(params: { docId: string; ops: ReadonlyArray<RecordOp> }): void;

  // Checkpointing — snapshot state and clear op history
  checkpointDoc(params: { docId: string }): void;
  hasCheckpoint(params: { docId: string }): boolean;
}
```

`WSClient.id` must be unique per physical socket connection (not a logical user/client id). The handler uses this value as the internal client map key.

**All documents** (collab editors, kanban boards, cards) are managed through the same `DocManager` + `getDocOps`/`appendDocOps`/`broadcastDocOps` pattern. There is no separate "collab" vs "kanban" state — everything is a `CRDTRecord` accessed by `docId`.

**Callbacks:** `onDocChanged` fires whenever ops are applied — from WS clients (`source: "client"`) or from `appendDocOps` (`source: "server"`). Use this to forward ops to external systems (e.g., a relay). `onAwareness` fires when a client sends an awareness message.

### File Fixture Helpers

Simple JSON fixture helpers for persisting a single doc's op log:

```typescript
interface DocOpsFixtureV1 {
  version: 1;
  docId: string;
  savedAt: string;               // ISO timestamp
  ops: ReadonlyArray<RecordOp>;
}

parseDocOpsFixture(params: {
  json: string;
  expectedDocId?: string;
}): DocOpsFixtureV1 | null

loadDocOpsFixtureFromFile(params: {
  filePath: string;
  expectedDocId?: string;
}): DocOpsFixtureV1 | null

saveDocOpsFixtureToFile(params: {
  filePath: string;
  docId: string;
  ops: ReadonlyArray<RecordOp>;
  now?: Date;
}): DocOpsFixtureV1
```

### Document API

Content-addressed editing — find text by string match, not position index.

```typescript
editDocument(params: {
  doc: CRDTDoc; clock: LamportClock;
  oldString: string; newString: string;
}): EditOutcome

insertAtAnchor(params: {
  doc: CRDTDoc; clock: LamportClock;
  content: string; anchor?: string; position?: "before" | "after";
}): EditOutcome

// EditOutcome = { success: true; doc; clock; ops } | { success: false; error: string }
```

### Suggestion API

```typescript
suggestEdit(params: { doc; clock; oldString; newString }): SuggestOutcome
suggestInsert(params: { doc; clock; content; anchor?; position? }): SuggestOutcome
acceptSuggestion(params: { doc; clock; suggestionId }): EditOutcome
rejectSuggestion(params: { doc; clock; suggestionId }): EditOutcome
listSuggestions(params: { doc }): ReadonlyArray<SuggestionSummary>

// SuggestionSummary = { id: string; insertText: string; deleteText: string }
```

### Card API

High-level kanban CRUD. Returns ops for broadcasting. All functions accept an optional `boardDocId` to target a specific board (defaults to `BOARD_DOC_ID`).

```typescript
interface CardApiState { manager: DocManager; clock: LamportClock }
interface CardApiResult { state: CardApiState; ops?: ReadonlyArray<{ docId: string; op: RecordOp }> }

createCard(params: { state; cardId; fields?; tags?; column?; boardDocId? }): CardApiResult
updateCardFields(params: { state; cardId; fields: Record<string, string> }): CardApiResult
addCardTags(params: { state; cardId; tags: ReadonlyArray<string> }): CardApiResult
removeCardTags(params: { state; cardId; tags: ReadonlyArray<string> }): CardApiResult
moveCard(params: { state; cardId; column; afterCardId?; beforeCardId?; boardDocId? }): CardApiResult
addColumn(params: { state; column: string; boardDocId? }): CardApiResult
removeColumn(params: { state; column: string; boardDocId? }): CardApiResult
getCardSummary(params: { manager; cardId }): { cardId; title; tags } | undefined
getCardDetail(params: { manager; cardId }): { ... } | undefined
listCards(params: { manager; boardDocId? }): ReadonlyArray<{ cardId; title; tags }>
getBoardState(params: { manager; boardDocId? }): { columns; cardsByColumn }
```

### Relay

Sidecar relay that bridges local WS clients to a remote CRDT server. Creates a handler + upstream transport pair with echo prevention built in.

```typescript
createCRDTRelay(params: {
  remoteUrl: string;                                    // upstream WS server URL
  clientId: string;                                     // relay's client ID on the remote
  serverClientId?: string;                              // local handler's server client ID
  docIds?: ReadonlyArray<string>;                       // docs to relay (can add/remove later)
  getAuthToken?: () => string | Promise<string>;        // auth for upstream connection
  onConnect?: () => void;                               // upstream connected
  onDisconnect?: () => void;                            // upstream disconnected
}): CRDTRelay

interface CRDTRelay {
  readonly handler: CRDTWebSocketHandler;               // wire to local WS server
  readonly addDoc: (params: { docId: string }) => void; // start relaying a doc
  readonly removeDoc: (params: { docId: string }) => void;
  readonly getDocIds: () => ReadonlyArray<string>;
  readonly isConnected: () => boolean;                  // upstream connection state
  readonly close: () => void;                           // close everything
}
```

**Echo prevention:** The relay uses `onDocChanged` with `source` checking — only `source: "client"` ops are forwarded upstream. Remote ops applied via `appendDocOps` have `source: "server"` and are NOT echoed back.

---

## `@crdt/lib/react` — Browser / React

### CRDTProvider

React context provider that creates a single WebSocket connection shared by all components.

```tsx
<CRDTProvider
  url?: string                                        // WebSocket URL (default: current host)
  getAuthToken?: () => string | Promise<string>       // auth token callback
>
  {children}
</CRDTProvider>
```

### Context Hooks

```typescript
// Full context — all CRDT operations (throws if no CRDTProvider ancestor)
function useCRDT(): CRDTContextValue

// Just the client ID
function useClientId(): string

// Transport subset: sendOps, disconnect, reconnect, pendingOpsCount, isConnected
function useTransport(): Pick<CRDTContextValue, "sendOps" | "disconnect" | "reconnect" | "pendingOpsCount" | "isConnected">

interface CRDTContextValue {
  readonly clientId: string;
  readonly userInfo: UserInfo;
  readonly isConnected: boolean;
  readonly subscribeDoc: (params: {
    docId: string;
    onOps: OpsListener;
    initialStateVector?: StateVector;
    onSyncComplete?: SyncCompleteListener;
  }) => () => void;  // returns unsubscribe function
  readonly subscribeAwareness: (params: {
    docId: string;
    onAwareness: AwarenessListener;
  }) => () => void;
  readonly sendAwareness: (params: { docId: string; state: AwarenessState }) => void;
  readonly sendOps: (params: { docId: string; ops: ReadonlyArray<RecordOp> }) => void;
  readonly disconnect: () => void;
  readonly reconnect: () => void;
  readonly pendingOpsCount: () => number;
}
```

### Presence Hooks

```typescript
// Aggregates remote users by viewingDocId — returns Map<docId, UserInfo[]>
function usePresenceByDoc(params?: { boardDocId?: string }): ReadonlyMap<string, ReadonlyArray<UserInfo>>

// Returns a function to broadcast which doc you're viewing
function useSendPresence(params?: { boardDocId?: string }): (viewingDocId: string | null) => void
```

The optional `boardDocId` param changes which board's awareness channel is used (defaults to `BOARD_DOC_ID`).

### Color Utility

```typescript
// Deterministic color from PRESENCE_COLORS palette based on clientId hash
function colorForClient(clientId: string): string
```

### useKanbanCRDT Hook

Must be used inside `CRDTProvider`. Manages kanban CRDT state via context.

```typescript
function useKanbanCRDT(params?: { boardDocId?: string }): {
  boardState: { columns: string[]; cardsByColumn: Record<string, Card[]> };
  getCard: (cardId: string) => CardDetail | undefined;
  isConnected: boolean;                    // from CRDTProvider context
  presenceByDoc: ReadonlyMap<string, ReadonlyArray<UserInfo>>;  // from usePresenceByDoc()
  sendPresence: (viewingDocId: string | null) => void;          // from useSendPresence()
  doAddColumn: (name: string) => void;
  doRemoveColumn: (name: string) => void;
  doCreateCard: (params: { title: string; column: string }) => string;
  doDeleteCard: (cardId: string) => Promise<void>;
  doMoveCard: (params: { cardId: string; column: string; beforeCardId?; afterCardId? }) => void;
  doUpdateFields: (cardId: string, fields: Record<string, string>) => void;
  doAddTags: (cardId: string, tags: ReadonlyArray<string>) => void;
  doRemoveTags: (cardId: string, tags: ReadonlyArray<string>) => void;
}
```

### Multi-Doc Transport

The unified transport for all document types. Supports delta sync, awareness, offline queue, per-doc sync state, and auth.

```typescript
createMultiDocTransport(params: {
  url: string;                          // e.g., "ws://localhost:1212/ws"
  clientId: string;
  onOps: (params: { docId: string; ops: ReadonlyArray<RecordOp> }) => void;
  onAwareness?: (params: { docId: string; clientId: string; state: AwarenessState }) => void;
  onSnapshot?: (params: { docId: string; data: Uint8Array }) => void;  // checkpoint restore
  onConnect?: () => void;
  onDisconnect?: () => void;
  onDocSyncComplete?: (params: { docId: string }) => void;
  getAuthToken?: () => string | Promise<string>;
}): MultiDocTransport

interface MultiDocTransport {
  subscribe(params: { docId: string; initialStateVector?: StateVector }): void;
  unsubscribe(params: { docId: string }): void;
  send(params: { docId: string; ops: ReadonlyArray<RecordOp> }): void;
  sendAwareness(params: { docId: string; clientId: string; state: AwarenessState }): void;
  disconnect(): void;
  reconnect(): void;
  close(): void;
  isConnected(): boolean;
  isSyncing(params: { docId: string }): boolean;
  pendingOpsCount(): number;
}
```

**Wire protocol:**

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

When `snapshot` is present in a `sync-response`, the client should decode it (base64 → Uint8Array) and restore the full `CRDTRecord` state via `decodeRecordSnapshot` before applying the trailing `ops`.

### ProseMirror Plugin

```typescript
createCRDTPlugin(params: {
  clientId: string;
  schema: Schema;
  initialDoc?: CRDTDoc;
  onLocalOps?: (ops: ReadonlyArray<Operation>) => void;
}): Plugin<CRDTPluginState>

getCRDTState(params: { state: EditorState; plugin: Plugin }): CRDTPluginState
applyRemoteOps(params: { state: EditorState; plugin: Plugin; ops: ReadonlyArray<Operation> }): { state: EditorState }
undoCommand(params: { state: EditorState; plugin: Plugin }): { state: EditorState; ops: ReadonlyArray<Operation> } | null
redoCommand(params: { state: EditorState; plugin: Plugin }): { state: EditorState; ops: ReadonlyArray<Operation> } | null
```

### ProseMirror State Mapping

```typescript
crdtToProseMirror(params: { doc: CRDTDoc; schema: Schema }): Node
proseMirrorPositionToCRDT(params: { doc: CRDTDoc; pos: number }): CRDTPosition
transactionToCRDTOps(params: { tr: Transaction; doc: CRDTDoc; clock: LamportClock; clientId: string }): { ops: ReadonlyArray<Operation>; clock: LamportClock }
```

### Cursor Decorations

```typescript
createCursorPlugin(params: { localClientId: string }): Plugin
updateRemoteCursors(params: { view: EditorView; cursors: Map<string, RemoteCursor> }): void
awarenessToRemoteCursor(params: { clientId: string; state: AwarenessState }): RemoteCursor
```

### Awareness

```typescript
createAwareness(params: { clientId: string }): Awareness
setLocalState(params: { awareness: Awareness; state: AwarenessState }): Awareness
applyRemoteState(params: { awareness: Awareness; clientId: string; state: AwarenessState }): Awareness
removeStaleStates(params: { awareness: Awareness; timeout: number }): Awareness
getStates(params: { awareness: Awareness }): ReadonlyMap<string, AwarenessState>
encodeAwareness(params: { awareness: Awareness }): string
decodeAwareness(params: { data: string }): Map<string, AwarenessState>
```
