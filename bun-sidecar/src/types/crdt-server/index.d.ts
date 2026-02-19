/**
 * Type stubs for @crdt/lib/server
 */
import type { RecordOp, AwarenessState } from "@crdt/lib";

export interface WSClient {
    readonly id: string;
    send(message: string): void;
}

export interface CRDTWebSocketHandler {
    handleOpen(params: { client: WSClient }): void;
    handleMessage(params: { client: WSClient; message: string }): void;
    handleClose(params: { client: WSClient }): void;
    broadcastDocOps(params: { docId: string; ops: ReadonlyArray<RecordOp> }): void;
    broadcastAwareness(params: { docId: string; clientId: string; state: AwarenessState }): void;
}

export declare function createCRDTWebSocketHandler(params?: {
    serverClientId?: string;
    onDocChanged?: (params: { docId: string; ops: ReadonlyArray<RecordOp>; source: "client" | "server" }) => void;
    onAwareness?: (params: { docId: string; clientId: string; state: AwarenessState }) => void;
}): CRDTWebSocketHandler;
