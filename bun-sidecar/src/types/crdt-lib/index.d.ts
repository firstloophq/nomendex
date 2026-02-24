/**
 * Type stubs for @crdt/lib
 *
 * Used by tsconfig.build.json to avoid type-checking the crdt source directly,
 * which would cause prosemirror version mismatches between repos.
 * Bun's bundler resolves the actual source via package.json "file:" dependency.
 */
import type { Schema } from "prosemirror-model";
import type { EditorState, Plugin, Transaction } from "prosemirror-state";

// --- Core types ---

export type ClientId = string;

export interface OperationId {
    readonly clientId: ClientId;
    readonly clock: number;
}

export interface Timestamp {
    readonly clientId: ClientId;
    readonly clock: number;
}

export interface LamportClock {
    readonly clientId: ClientId;
    readonly counter: number;
}

interface TextContent {
    readonly type: "text";
    readonly value: string;
}

interface BlockContent {
    readonly type: "block";
    readonly blockType: string;
    readonly attrs?: Record<string, string | number | boolean | null>;
    readonly parentBlockId?: OperationId;
}

interface InlineAtomContent {
    readonly type: "inline_atom";
    readonly nodeType: string;
    readonly attrs?: Record<string, string | number | boolean | null>;
}

type Content = TextContent | BlockContent | InlineAtomContent;

interface Mark {
    readonly type: string;
    readonly attrs?: Record<string, string | number | boolean | null>;
}

export interface InsertOp {
    readonly type: "insert";
    readonly id: OperationId;
    readonly parentId: OperationId | null;
    readonly side: "left" | "right";
    readonly secondParentId?: OperationId;
    readonly content: Content;
    readonly marks?: ReadonlyArray<Mark>;
}

export interface DeleteOp {
    readonly type: "delete";
    readonly id: OperationId;
    readonly targetId: OperationId;
}

export interface FormatOp {
    readonly type: "format";
    readonly id: OperationId;
    readonly targetId: OperationId;
    readonly mark: Mark;
    readonly action: "add" | "remove";
}

export interface AttrUpdateOp {
    readonly type: "attr_update";
    readonly id: OperationId;
    readonly targetId: OperationId;
    readonly attr: string;
    readonly value: string | number | boolean | null;
    readonly oldValue?: string | number | boolean | null;
}

export interface ReparentOp {
    readonly type: "reparent";
    readonly id: OperationId;
    readonly targetId: OperationId;
    readonly newParentBlockId: OperationId | null;
    readonly oldParentBlockId?: OperationId | null;
}

export type Operation = InsertOp | DeleteOp | FormatOp | AttrUpdateOp | ReparentOp;

// --- Record types ---

export interface FieldOp {
    readonly type: "field";
    readonly id: OperationId;
    readonly fieldName: string;
    readonly value: string;
    readonly timestamp: Timestamp;
}

export interface SetOp {
    readonly type: "set";
    readonly id: OperationId;
    readonly fieldName: string;
    readonly action: "add" | "remove";
    readonly value: string;
    readonly removeIds?: ReadonlyArray<OperationId>;
}

export type RecordOp = FieldOp | SetOp | Operation;

// --- Awareness ---

export interface CursorPosition {
    readonly anchor: number;
    readonly head: number;
}

export interface UserInfo {
    readonly name: string;
    readonly color: string;
}

export interface AwarenessState {
    readonly cursor?: CursorPosition;
    readonly viewingDocId?: string;
    readonly user: UserInfo;
    readonly lastUpdated: number;
}

// --- LWW Register ---

export interface LWWRegister<T> {
    readonly value: T;
    readonly timestamp: Timestamp;
}

// --- State vector ---

export type StateVector = ReadonlyMap<ClientId, number>;

export interface MissingRange {
    readonly clientId: ClientId;
    readonly from: number; // inclusive
    readonly to: number; // inclusive
}

// --- Snapshot helpers ---

export type SnapshotMergeBias = "local" | "remote";

// --- Transport ---

export interface MultiDocTransport {
    readonly subscribe: (params: { docId: string; initialStateVector?: StateVector }) => void;
    readonly unsubscribe: (params: { docId: string }) => void;
    readonly send: (params: { docId: string; ops: ReadonlyArray<RecordOp> }) => void;
    readonly sendTx: (params: { txId: string; docId: string; ops: ReadonlyArray<RecordOp> }) => void;
    readonly sendSnapshot?: (params: {
        docId: string;
        snapshot: Uint8Array;
        expectedVersion?: string;
        mergeBias?: SnapshotMergeBias;
    }) => void;
    readonly sendAwareness: (params: { docId: string; clientId: string; state: AwarenessState }) => void;
    readonly disconnect: () => void;
    readonly reconnect: () => void;
    readonly close: () => void;
    readonly isConnected: () => boolean;
    readonly isSyncing: (params: { docId: string }) => boolean;
    readonly pendingOpsCount: () => number;
}

export declare function createMultiDocTransport(params: {
    url: string;
    clientId: string;
    onOps: (params: { docId: string; ops: ReadonlyArray<RecordOp> }) => void;
    onTx?: (params: { txId: string; docId: string; ops: ReadonlyArray<RecordOp> }) => void;
    onAwareness?: (params: { docId: string; clientId: string; state: AwarenessState }) => void;
    onSnapshot?: (params: { docId: string; data: Uint8Array; version?: string }) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onDocSyncComplete?: (params: { docId: string }) => void;
    onProtocolError?: (params: { docId?: string; reason: string }) => void;
    onDebug?: (params: { event: string; data?: Record<string, unknown> }) => void;
    getAuthToken?: () => string | Promise<string>;
}): MultiDocTransport;

// --- Clock ---

export declare function createClock(params: {
    clientId: ClientId;
}): LamportClock;

export declare function increment(params: {
    clock: LamportClock;
}): { clock: LamportClock; timestamp: Timestamp };

export declare function receive(params: {
    clock: LamportClock;
    remoteCounter: number;
}): LamportClock;

// --- Operation helpers ---

export declare function createOperationId(params: {
    clientId: ClientId;
    clock: number;
}): OperationId;

// --- Record Docs / Board ---

export interface CRDTRecord {
    readonly fields: ReadonlyMap<string, unknown>;
    readonly sets: ReadonlyMap<string, unknown>;
    readonly body: unknown;
    readonly appliedOps: ReadonlySet<string>;
    readonly stateVector: StateVector;
}

export interface DocManager {
    readonly docs: ReadonlyMap<string, CRDTRecord>;
}

export type SnapshotHydrationMode = "replace" | "merge";

export declare function createDocManager(): DocManager;

export declare function applyDocOperation(params: {
    manager: DocManager;
    docId: string;
    op: RecordOp;
}): DocManager;

export declare function applySnapshotToDoc(params: {
    manager: DocManager;
    docId: string;
    snapshot: CRDTRecord | Uint8Array;
    mode?: SnapshotHydrationMode;
    mergeBias?: SnapshotMergeBias;
}): DocManager;

export declare function getDoc(params: {
    manager: DocManager;
    docId: string;
}): CRDTRecord | undefined;

export declare function getFields(params: {
    record: CRDTRecord;
}): ReadonlyMap<string, string>;

export declare function encodeRecordSnapshot(params: {
    record: CRDTRecord;
}): Uint8Array;

export declare function decodeRecordSnapshot(params: {
    data: Uint8Array;
}): CRDTRecord;

export declare function mergeRecordSnapshots(params: {
    local: CRDTRecord;
    remote: CRDTRecord;
    bias?: SnapshotMergeBias;
}): CRDTRecord;

export declare function getRecordSnapshotVersion(params: {
    data: Uint8Array;
}): string;

export declare function isRecordSnapshotVersion(params: {
    data: Uint8Array;
    expectedVersion: string;
}): boolean;

export declare function getRecordSnapshotStateVector(params: {
    data: Uint8Array;
}): StateVector;

export declare function missingFromRecordSnapshot(params: {
    data: Uint8Array;
    remoteStateVector: StateVector;
}): ReadonlyArray<MissingRange>;

export interface CardApiState {
    manager: DocManager;
    clock: LamportClock;
}

export interface CardApiResult {
    state: CardApiState;
    ops?: ReadonlyArray<{ docId: string; op: RecordOp }>;
}

export declare function createCard(params: {
    state: CardApiState;
    cardId: string;
    fields?: Record<string, string>;
    tags?: ReadonlyArray<string>;
    column?: string;
    boardDocId?: string;
}): CardApiResult;

export declare function updateCardFields(params: {
    state: CardApiState;
    cardId: string;
    fields: Record<string, string>;
}): CardApiResult;

export declare function addCardTags(params: {
    state: CardApiState;
    cardId: string;
    tags: ReadonlyArray<string>;
}): CardApiResult;

export declare function removeCardTags(params: {
    state: CardApiState;
    cardId: string;
    tags: ReadonlyArray<string>;
}): CardApiResult;

export declare function moveCard(params: {
    state: CardApiState;
    cardId: string;
    column: string;
    beforeCardId?: string;
    afterCardId?: string;
    boardDocId?: string;
}): CardApiResult;

export declare function addColumn(params: {
    state: CardApiState;
    column: string;
    boardDocId?: string;
}): CardApiResult;

export declare function removeColumn(params: {
    state: CardApiState;
    column: string;
    boardDocId?: string;
}): CardApiResult;

export declare function getBoardState(params: {
    manager: DocManager;
    boardDocId?: string;
}): {
    columns: ReadonlyArray<string>;
    cardsByColumn: Record<string, ReadonlyArray<{ cardId: string; title: string; description: string; order: string }>>;
};

export declare function getCardDetail(params: {
    manager: DocManager;
    cardId: string;
    boardDocId?: string;
}): {
    id: string;
    fields: Record<string, string>;
    tags: ReadonlyArray<string>;
    body: string;
    position: { column: string; order: string } | null;
} | null;

// --- ProseMirror CRDT Plugin ---

export interface CRDTPluginState {
    readonly clientId: string;
    readonly doc: unknown;
    readonly isRemoteUpdate: boolean;
}

export declare function createCRDTPlugin(params: {
    clientId: string;
    schema: Schema;
    onLocalOps?: (ops: ReadonlyArray<Operation>) => void;
    initialDoc?: unknown;
    captureTimeoutMs?: number;
}): Plugin<CRDTPluginState>;

export declare function getCRDTState(params: {
    state: EditorState;
    plugin: Plugin<CRDTPluginState>;
}): CRDTPluginState;

export declare function applyRemoteOps(params: {
    state: EditorState;
    plugin: Plugin<CRDTPluginState>;
    ops: ReadonlyArray<Operation>;
}): { state: EditorState };

export declare function applyRemoteSnapshot(params: {
    state: EditorState;
    plugin: Plugin<CRDTPluginState>;
    snapshotDoc: unknown;
}): { state: EditorState };

export declare function undoCommand(params: {
    state: EditorState;
    plugin: Plugin<CRDTPluginState>;
}): { state: EditorState; ops: ReadonlyArray<Operation> } | null;

export declare function redoCommand(params: {
    state: EditorState;
    plugin: Plugin<CRDTPluginState>;
}): { state: EditorState; ops: ReadonlyArray<Operation> } | null;

// --- Suggestion API ---

export interface SuggestionSummary {
    readonly id: string;
    readonly insertText: string;
    readonly deleteText: string;
}

export declare function listSuggestions(params: {
    doc: unknown;
}): ReadonlyArray<SuggestionSummary>;

// --- Cursor Plugin ---

export interface RemoteCursor {
    readonly clientId: ClientId;
    readonly cursor: { anchor: number; head: number };
    readonly user: { name: string; color: string };
}

export declare function createCursorPlugin(params: {
    localClientId: ClientId;
}): Plugin;

export declare function updateRemoteCursors(params: {
    view: { state: EditorState; dispatch: (tr: Transaction) => void };
    cursors: ReadonlyMap<ClientId, RemoteCursor>;
}): void;

export declare function awarenessToRemoteCursor(params: {
    clientId: ClientId;
    state: AwarenessState;
}): RemoteCursor | null;
