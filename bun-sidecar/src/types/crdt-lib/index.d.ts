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
    readonly timestamp: number;
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

// --- State vector ---

export type StateVector = ReadonlyMap<ClientId, number>;

// --- Transport ---

export interface MultiDocTransport {
    readonly subscribe: (params: { docId: string; initialStateVector?: StateVector }) => void;
    readonly unsubscribe: (params: { docId: string }) => void;
    readonly send: (params: { docId: string; ops: ReadonlyArray<RecordOp> }) => void;
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
    onAwareness?: (params: { docId: string; clientId: string; state: AwarenessState }) => void;
    onSnapshot?: (params: { docId: string; data: Uint8Array }) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onDocSyncComplete?: (params: { docId: string }) => void;
    getAuthToken?: () => string | Promise<string>;
}): MultiDocTransport;

// --- ProseMirror CRDT Plugin ---

export interface CRDTPluginState {
    readonly clientId: string;
    readonly isRemoteUpdate: boolean;
}

export declare function createCRDTPlugin(params: {
    clientId: string;
    schema: Schema;
    onLocalOps?: (ops: ReadonlyArray<Operation>) => void;
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

export declare function undoCommand(params: {
    state: EditorState;
    plugin: Plugin<CRDTPluginState>;
}): { state: EditorState; ops: ReadonlyArray<Operation> } | null;

export declare function redoCommand(params: {
    state: EditorState;
    plugin: Plugin<CRDTPluginState>;
}): { state: EditorState; ops: ReadonlyArray<Operation> } | null;

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
