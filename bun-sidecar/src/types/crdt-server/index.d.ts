/**
 * Type stubs for @crdt/lib/server
 */
import type { RecordOp, AwarenessState, DocManager, LamportClock } from "@crdt/lib";

export interface WSClient {
    readonly id: string;
    send(message: string): void;
}

export interface CardApiState {
    manager: DocManager;
    clock: LamportClock;
}

export interface CRDTWebSocketHandler {
    handleOpen(params: { client: WSClient }): void;
    handleMessage(params: { client: WSClient; message: string }): void;
    handleClose(params: { client: WSClient }): void;
    broadcastDocOps(params: { docId: string; ops: ReadonlyArray<RecordOp> }): void;
    broadcastAwareness(params: { docId: string; clientId: string; state: AwarenessState }): void;
    broadcastSnapshot(params: { docId: string; snapshot: Uint8Array; version?: string }): void;
    getDocManagerState(): CardApiState;
    setDocManagerState(params: { state: CardApiState }): void;
    getDocOps(params: { docId: string }): ReadonlyArray<RecordOp>;
    appendDocOps(params: { docId: string; ops: ReadonlyArray<RecordOp> }): void;
    checkpointDoc(params: { docId: string }): void;
    hasCheckpoint(params: { docId: string }): boolean;
}

export declare function createCRDTWebSocketHandler(params?: {
    serverClientId?: string;
    onDocChanged?: (params: { docId: string; ops: ReadonlyArray<RecordOp>; source: "client" | "server" }) => void;
    onAwareness?: (params: { docId: string; clientId: string; state: AwarenessState }) => void;
}): CRDTWebSocketHandler;

export interface CRDTRelay {
    readonly handler: CRDTWebSocketHandler;
    readonly addDoc: (params: { docId: string }) => void;
    readonly removeDoc: (params: { docId: string }) => void;
    readonly getDocIds: () => ReadonlyArray<string>;
    readonly isConnected: () => boolean;
    readonly close: () => void;
}

export declare function createCRDTRelay(params: {
    remoteUrl: string;
    clientId: string;
    serverClientId?: string;
    docIds?: ReadonlyArray<string>;
    getAuthToken?: () => string | Promise<string>;
    onConnect?: () => void;
    onDisconnect?: () => void;
}): CRDTRelay;
