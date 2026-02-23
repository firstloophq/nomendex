import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
    applyDocOperation,
    applySnapshotToDoc,
    createClock,
    createDocManager,
    decodeRecordSnapshot,
    encodeRecordSnapshot,
    getDoc,
    getRecordSnapshotStateVector,
    getRecordSnapshotVersion,
    receive,
    type AwarenessState,
    type FieldOp,
    type LamportClock,
    type DocManager,
    type RecordOp,
    type StateVector,
} from "@crdt/lib";
import type {
    Editor,
    TLPageId,
    TLShapeId,
    TLStore,
} from "tldraw";
import {
    getDefaultUserPresence,
    InstancePresenceRecordType,
} from "tldraw";
import { useCollab } from "@/contexts/CollabContext";
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher";
import { buildCanvasDocId, getWorkspaceCollabScope } from "@/lib/collab-doc-id";
import { crdtDebugLog, summarizeOpsForDebug } from "@/lib/crdt-debug";

const TL_FIELD_PREFIX = "tl:";
const DELETED_SENTINEL = "";
const OUTBOUND_FLUSH_MS = 32;
const LOCAL_SAVE_DEBOUNCE_MS = 450;
const AWARENESS_THROTTLE_MS = 48;
const AWARENESS_HEARTBEAT_MS = 2500;
const AWARENESS_STALE_MS = 10000;

interface ExtendedAwarenessState extends AwarenessState {
    tldraw?: {
        cursorType?: string;
        cursorRotation?: number;
        selectedShapeIds?: string[];
    };
}

interface CanvasCRDTState {
    manager: DocManager;
    clock: LamportClock;
}

interface SerializableRecord {
    id?: unknown;
    [key: string]: unknown;
}

interface RemotePresenceEntry {
    recordId: string;
    lastUpdated: number;
}

interface CanvasSnapshotMeta {
    docId: string;
    updatedAt: string;
    snapshotVersion?: string;
    lastKnownBackendVersion?: string;
    stateVector?: Record<string, number>;
    source?: "local" | "remote-merged";
}

export interface CanvasRemoteCollaborator {
    clientId: string;
    userName: string;
    color: string;
    currentPageId: TLPageId;
    cursor: {
        x: number;
        y: number;
        rotation: number;
    } | null;
    lastUpdated: number;
}

function compareCanvasRemoteCollaborators(
    a: CanvasRemoteCollaborator,
    b: CanvasRemoteCollaborator
): number {
    if (a.lastUpdated !== b.lastUpdated) return b.lastUpdated - a.lastUpdated;
    return a.userName.localeCompare(b.userName);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function toCursorFromAwareness(state: ExtendedAwarenessState): {
    x: number;
    y: number;
    rotation: number;
} | null {
    const x = state.cursor?.anchor;
    const y = state.cursor?.head;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
    const rotation = isFiniteNumber(state.tldraw?.cursorRotation) ? state.tldraw!.cursorRotation! : 0;
    return { x, y, rotation };
}

function toCurrentPageId(params: {
    state: ExtendedAwarenessState;
    editor: Editor;
}): TLPageId {
    const fromAwareness = params.state.viewingDocId;
    if (typeof fromAwareness === "string" && fromAwareness.startsWith("page:")) {
        return fromAwareness as TLPageId;
    }
    return params.editor.getCurrentPageId();
}

function sanitizeShapeIds(value: unknown): TLShapeId[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === "string" && item.startsWith("shape:"))
        .map((item) => item as TLShapeId);
}

function compactFieldOps(params: {
    ops: ReadonlyArray<FieldOp>;
}): FieldOp[] {
    const { ops } = params;
    if (ops.length <= 1) return [...ops];

    const seen = new Set<string>();
    const result: FieldOp[] = [];
    for (let i = ops.length - 1; i >= 0; i--) {
        const op = ops[i];
        if (!op) continue;
        if (seen.has(op.fieldName)) continue;
        seen.add(op.fieldName);
        result.push(op);
    }
    result.reverse();
    return result;
}

function createFieldOpId(params: { clientId: string; clock: number }): { clientId: string; clock: number } {
    return {
        clientId: params.clientId,
        clock: params.clock,
    };
}

function incrementClock(clock: LamportClock): {
    clock: LamportClock;
    timestamp: { clientId: string; clock: number };
} {
    const nextCounter = clock.counter + 1;
    return {
        clock: {
            ...clock,
            counter: nextCounter,
        },
        timestamp: {
            clientId: clock.clientId,
            clock: nextCounter,
        },
    };
}

export function extractTldrawRecords(params: {
    fields: ReadonlyMap<string, { value: string }>;
}): Array<{ id: string; [key: string]: unknown }> {
    const records: Array<{ id: string; [key: string]: unknown }> = [];
    for (const [fieldName, register] of params.fields) {
        if (!fieldName.startsWith(TL_FIELD_PREFIX)) continue;
        if (register.value === DELETED_SENTINEL) continue;
        try {
            const parsed = JSON.parse(register.value) as { id: string; [key: string]: unknown };
            if (typeof parsed.id === "string") {
                records.push(parsed);
            }
        } catch {
            // Ignore malformed CRDT field payloads.
        }
    }
    return records;
}

function canUseBeaconTransport(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function";
}

function decodeBase64Bytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function encodeBase64Bytes(data: Uint8Array): string {
    return btoa(String.fromCharCode(...data));
}

function stateVectorToObject(stateVector: ReadonlyMap<string, number>): Record<string, number> {
    return Object.fromEntries(stateVector);
}

function objectToStateVector(value: Record<string, number> | undefined): StateVector | null {
    if (!value || typeof value !== "object") return null;
    const sv = new Map<string, number>();
    for (const [clientId, clock] of Object.entries(value)) {
        if (typeof clock === "number" && Number.isFinite(clock)) {
            sv.set(clientId, clock);
        }
    }
    return sv.size > 0 ? sv : null;
}

function fieldNameToRecordId(fieldName: string): string | null {
    if (!fieldName.startsWith(TL_FIELD_PREFIX)) return null;
    const recordId = fieldName.slice(TL_FIELD_PREFIX.length);
    return recordId.length > 0 ? recordId : null;
}

export function useCanvasCRDT(params: { canvasId: string; forceLocal?: boolean }) {
    const { canvasId, forceLocal = false } = params;
    const collab = useCollab();
    const { activeWorkspace, appMode } = useWorkspaceSwitcher();
    const collabScope = useMemo(
        () => getWorkspaceCollabScope({ activeWorkspace }),
        [activeWorkspace]
    );
    const docId = useMemo(
        () => buildCanvasDocId({ scope: collabScope, canvasId }),
        [collabScope, canvasId]
    );

    const collabEnabled = !forceLocal
        && appMode === "team"
        && !!collab?.clientId
        && !!collab?.subscribeDoc
        && !!collab?.sendOps
        && !!collab?.sendSnapshot;
    const localClientId = useMemo(
        () => `canvas-local-${canvasId}`,
        [canvasId]
    );
    const clientId = collab?.clientId ?? localClientId;

    const stateRef = useRef<CanvasCRDTState>({
        manager: createDocManager(),
        clock: createClock({ clientId }),
    });

    const editorRef = useRef<Editor | null>(null);
    const [editor, setEditor] = useState<Editor | null>(null);
    const [isSynced, setIsSynced] = useState(false);
    const [remoteCollaborators, setRemoteCollaborators] = useState<CanvasRemoteCollaborator[]>([]);
    const [followedCollaboratorId, setFollowedCollaboratorId] = useState<string | null>(null);
    const didSyncRef = useRef(false);
    const sawRemoteDataDuringSyncRef = useRef(false);
    const isApplyingRemoteRef = useRef(false);
    const didHydrateLocalRef = useRef(false);
    const localSnapshotVersionRef = useRef<string | null>(null);
    const backendSnapshotVersionRef = useRef<string | null>(null);
    const persistAttemptCounterRef = useRef(0);
    const localSaveTimerRef = useRef<number | null>(null);
    const localSeedSnapshotRef = useRef<{
        bytes: Uint8Array;
        version: string;
        stateVector: StateVector;
    } | null>(null);
    const restoredStateVectorRef = useRef<StateVector | null>(null);

    // tl:<recordId> -> serialized record JSON
    const mirroredFieldsRef = useRef<Map<string, string>>(new Map());

    const pendingSendOpsRef = useRef<FieldOp[]>([]);
    const flushSendTimerRef = useRef<number | null>(null);
    const pendingRemoteOpsRef = useRef<RecordOp[]>([]);
    const flushRemoteTimerRef = useRef<number | null>(null);
    const awarenessFlushTimerRef = useRef<number | null>(null);
    const awarenessHeartbeatTimerRef = useRef<number | null>(null);
    const awarenessStaleSweepTimerRef = useRef<number | null>(null);
    const lastAwarenessSignatureRef = useRef<string | null>(null);
    const remotePresenceRef = useRef<Map<string, RemotePresenceEntry>>(new Map());
    const remoteCollaboratorsRef = useRef<Map<string, CanvasRemoteCollaborator>>(new Map());

    const scheduleNextFrame = useCallback((fn: () => void): number => {
        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
            return window.requestAnimationFrame(fn);
        }
        return setTimeout(fn, 16) as unknown as number;
    }, []);

    const cancelNextFrame = useCallback((id: number) => {
        if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
            window.cancelAnimationFrame(id);
            return;
        }
        clearTimeout(id);
    }, []);

    const publishRemoteCollaborators = useCallback(() => {
        const sorted = Array.from(remoteCollaboratorsRef.current.values())
            .sort(compareCanvasRemoteCollaborators);
        setRemoteCollaborators(sorted);
    }, []);

    const stopFollowingCollaborator = useCallback(() => {
        const ed = editorRef.current;
        if (ed) {
            ed.stopFollowingUser();
        }
        setFollowedCollaboratorId(null);
    }, []);

    const followCollaborator = useCallback((nextClientId: string | null) => {
        const ed = editorRef.current;
        if (!ed) {
            setFollowedCollaboratorId(nextClientId);
            return;
        }

        if (!nextClientId) {
            ed.stopFollowingUser();
            setFollowedCollaboratorId(null);
            return;
        }

        if (nextClientId === clientId) return;
        if (!remoteCollaboratorsRef.current.has(nextClientId)) {
            ed.stopFollowingUser();
            setFollowedCollaboratorId(null);
            return;
        }

        ed.stopFollowingUser();
        ed.zoomToUser(nextClientId, { animation: { duration: 220 } });
        ed.startFollowingUser(nextClientId);
        setFollowedCollaboratorId(nextClientId);
    }, [clientId]);

    const clearRemotePresenceRecords = useCallback((options?: { resetState?: boolean }) => {
        const shouldResetState = options?.resetState !== false;
        const ed = editorRef.current;
        if (ed && remotePresenceRef.current.size > 0) {
            const recordIds = Array.from(remotePresenceRef.current.values()).map((entry) => entry.recordId);
            if (recordIds.length > 0) {
                ed.store.mergeRemoteChanges(() => {
                    ed.store.remove(recordIds as Parameters<typeof ed.store.remove>[0]);
                });
            }
        }
        remotePresenceRef.current.clear();
        remoteCollaboratorsRef.current.clear();
        if (shouldResetState) {
            setRemoteCollaborators([]);
            stopFollowingCollaborator();
        } else if (ed) {
            ed.stopFollowingUser();
        }
    }, [stopFollowingCollaborator]);

    const applyRemotePresenceFromAwareness = useCallback((params: {
        remoteClientId: string;
        state: AwarenessState;
    }) => {
        const ed = editorRef.current;
        if (!ed) return;

        const awareness = params.state as ExtendedAwarenessState;
        const cursor = toCursorFromAwareness(awareness);
        const currentPageId = toCurrentPageId({
            state: awareness,
            editor: ed,
        });
        const selectedShapeIds = sanitizeShapeIds(awareness.tldraw?.selectedShapeIds);
        const presenceRecord = InstancePresenceRecordType.create({
            id: InstancePresenceRecordType.createId(params.remoteClientId),
            userId: params.remoteClientId,
            userName: awareness.user?.name ?? "Anonymous",
            color: awareness.user?.color ?? "#4f46e5",
            currentPageId,
            lastActivityTimestamp: isFiniteNumber(awareness.lastUpdated) ? awareness.lastUpdated : Date.now(),
            selectedShapeIds,
            cursor: cursor
                ? {
                    x: cursor.x,
                    y: cursor.y,
                    type: "default",
                    rotation: cursor.rotation,
                }
                : null,
            meta: {
                source: "canvas-crdt-awareness",
            },
        });

        ed.store.mergeRemoteChanges(() => {
            ed.store.put([presenceRecord] as unknown as Parameters<typeof ed.store.put>[0]);
        });

        remotePresenceRef.current.set(params.remoteClientId, {
            recordId: presenceRecord.id,
            lastUpdated: presenceRecord.lastActivityTimestamp ?? Date.now(),
        });
        remoteCollaboratorsRef.current.set(params.remoteClientId, {
            clientId: params.remoteClientId,
            userName: presenceRecord.userName,
            color: presenceRecord.color,
            currentPageId: presenceRecord.currentPageId,
            cursor: cursor ? {
                x: cursor.x,
                y: cursor.y,
                rotation: cursor.rotation,
            } : null,
            lastUpdated: presenceRecord.lastActivityTimestamp ?? Date.now(),
        });
        publishRemoteCollaborators();
    }, [publishRemoteCollaborators]);

    const pruneStaleRemotePresence = useCallback(() => {
        const ed = editorRef.current;
        if (!ed) return;
        if (remotePresenceRef.current.size === 0) return;

        const now = Date.now();
        const staleRecordIds: string[] = [];
        const removedClientIds: string[] = [];
        for (const [remoteClientId, entry] of remotePresenceRef.current) {
            if (now - entry.lastUpdated <= AWARENESS_STALE_MS) continue;
            staleRecordIds.push(entry.recordId);
            remotePresenceRef.current.delete(remoteClientId);
            remoteCollaboratorsRef.current.delete(remoteClientId);
            removedClientIds.push(remoteClientId);
        }

        if (staleRecordIds.length === 0) return;
        ed.store.mergeRemoteChanges(() => {
            ed.store.remove(staleRecordIds as Parameters<typeof ed.store.remove>[0]);
        });
        publishRemoteCollaborators();
        if (followedCollaboratorId && removedClientIds.includes(followedCollaboratorId)) {
            stopFollowingCollaborator();
        }
    }, [followedCollaboratorId, publishRemoteCollaborators, stopFollowingCollaborator]);

    const buildLocalAwarenessState = useCallback((ed: Editor): AwarenessState | null => {
        if (!collabEnabled || !collab?.userInfo) return null;

        const base = getDefaultUserPresence(ed.store as unknown as TLStore, {
            id: clientId,
            name: collab.userInfo.name,
            color: collab.userInfo.color,
        });

        if (!base) {
            return {
                viewingDocId: ed.getCurrentPageId(),
                user: collab.userInfo,
                lastUpdated: Date.now(),
            };
        }

        const awareness: ExtendedAwarenessState = {
            viewingDocId: base.currentPageId,
            user: collab.userInfo,
            lastUpdated: Date.now(),
            cursor: base.cursor
                ? {
                    anchor: base.cursor.x,
                    head: base.cursor.y,
                }
                : undefined,
            tldraw: {
                cursorType: base.cursor?.type,
                cursorRotation: base.cursor?.rotation,
                selectedShapeIds: base.selectedShapeIds,
            },
        };

        return awareness as AwarenessState;
    }, [clientId, collab, collabEnabled]);

    const sendLocalAwarenessNow = useCallback((params?: { force?: boolean }) => {
        if (!collabEnabled || !collab?.sendAwareness) return;
        const ed = editorRef.current;
        if (!ed) return;

        const awareness = buildLocalAwarenessState(ed);
        if (!awareness) return;

        const signature = JSON.stringify({
            viewingDocId: awareness.viewingDocId ?? null,
            cursor: awareness.cursor ?? null,
            user: awareness.user,
            tldraw: (awareness as ExtendedAwarenessState).tldraw ?? null,
        });

        if (!params?.force && lastAwarenessSignatureRef.current === signature) {
            return;
        }

        lastAwarenessSignatureRef.current = signature;
        collab.sendAwareness({
            docId,
            state: awareness,
        });
    }, [buildLocalAwarenessState, collab, collabEnabled, docId]);

    const queueLocalAwarenessSend = useCallback(() => {
        if (!collabEnabled) return;
        if (awarenessFlushTimerRef.current !== null) return;
        awarenessFlushTimerRef.current = setTimeout(() => {
            awarenessFlushTimerRef.current = null;
            sendLocalAwarenessNow();
        }, AWARENESS_THROTTLE_MS) as unknown as number;
    }, [collabEnabled, sendLocalAwarenessNow]);

    const buildFieldMapFromEditor = useCallback((ed: Editor): Map<string, string> => {
        const next = new Map<string, string>();
        const snapshot = ed.store.serialize("document") as unknown as Record<string, SerializableRecord>;
        for (const record of Object.values(snapshot)) {
            const recordId = record.id;
            if (typeof recordId !== "string") continue;
            try {
                next.set(`${TL_FIELD_PREFIX}${recordId}`, JSON.stringify(record));
            } catch {
                // Ignore non-serializable records.
            }
        }
        return next;
    }, []);

    const buildFieldMapFromManager = useCallback((manager: DocManager): Map<string, string> => {
        const next = new Map<string, string>();
        const record = getDoc({ manager, docId });
        if (!record) return next;
        const fields = record.fields as ReadonlyMap<string, { value: string }>;
        for (const [fieldName, register] of fields) {
            if (!fieldName.startsWith(TL_FIELD_PREFIX)) continue;
            if (register.value === DELETED_SENTINEL) continue;
            next.set(fieldName, register.value);
        }
        return next;
    }, [docId]);

    const refreshMirroredFieldsFromManager = useCallback((manager: DocManager) => {
        mirroredFieldsRef.current = buildFieldMapFromManager(manager);
    }, [buildFieldMapFromManager]);

    const restoreEditorFromState = useCallback((manager?: DocManager) => {
        const ed = editorRef.current;
        if (!ed) return;

        const currentManager = manager ?? stateRef.current.manager;
        const record = getDoc({ manager: currentManager, docId });
        if (!record) {
            mirroredFieldsRef.current = new Map();
            return;
        }

        const records = extractTldrawRecords({
            fields: record.fields as ReadonlyMap<string, { value: string }>,
        });
        if (records.length === 0) {
            refreshMirroredFieldsFromManager(currentManager);
            return;
        }

        isApplyingRemoteRef.current = true;
        try {
            ed.store.mergeRemoteChanges(() => {
                ed.store.put(records as unknown as Parameters<typeof ed.store.put>[0]);
            });
        } finally {
            isApplyingRemoteRef.current = false;
        }
        refreshMirroredFieldsFromManager(currentManager);
    }, [docId, refreshMirroredFieldsFromManager]);

    const flushSendOpsNow = useCallback(() => {
        if (flushSendTimerRef.current !== null) {
            clearTimeout(flushSendTimerRef.current);
            flushSendTimerRef.current = null;
        }
        if (pendingSendOpsRef.current.length === 0) return;
        if (!collabEnabled || !collab?.sendOps) return;

        const compacted = compactFieldOps({ ops: pendingSendOpsRef.current });
        pendingSendOpsRef.current = [];
        collab.sendOps({ docId, ops: compacted });
        crdtDebugLog({
            event: "canvas_send_ops",
            data: {
                canvasId,
                docId,
                count: compacted.length,
                ops: summarizeOpsForDebug(compacted),
            },
        });
    }, [canvasId, collab, collabEnabled, docId]);

    const queueSendOps = useCallback((ops: ReadonlyArray<FieldOp>) => {
        if (ops.length === 0) return;
        pendingSendOpsRef.current.push(...ops);
        if (flushSendTimerRef.current !== null) return;
        flushSendTimerRef.current = setTimeout(() => {
            flushSendTimerRef.current = null;
            flushSendOpsNow();
        }, OUTBOUND_FLUSH_MS) as unknown as number;
    }, [flushSendOpsNow]);

    const applyOpsToState = useCallback((ops: ReadonlyArray<RecordOp>): DocManager => {
        let { manager, clock } = stateRef.current;

        for (const op of ops) {
            manager = applyDocOperation({ manager, docId, op });
            if ("id" in op && op.id && typeof op.id.clock === "number") {
                clock = receive({ clock, remoteCounter: op.id.clock });
            }
        }

        stateRef.current = { manager, clock };
        return manager;
    }, [docId]);

    const pushToEditor = useCallback((manager: DocManager, ops: ReadonlyArray<RecordOp>) => {
        const ed = editorRef.current;
        if (!ed) return;

        const record = getDoc({ manager, docId });
        if (!record) return;
        const fields = record.fields as ReadonlyMap<string, { value: string }>;

        const toPut: Array<Record<string, unknown>> = [];
        const toRemove: string[] = [];

        for (const op of ops) {
            if (op.type !== "field") continue;
            const fieldOp = op as FieldOp;
            if (!fieldOp.fieldName.startsWith(TL_FIELD_PREFIX)) continue;

            const register = fields.get(fieldOp.fieldName);
            const resolvedValue = register?.value;
            if (resolvedValue === undefined || resolvedValue === DELETED_SENTINEL) {
                const recordId = fieldOp.fieldName.slice(TL_FIELD_PREFIX.length);
                toRemove.push(recordId);
                mirroredFieldsRef.current.delete(fieldOp.fieldName);
                continue;
            }

            mirroredFieldsRef.current.set(fieldOp.fieldName, resolvedValue);
            try {
                toPut.push(JSON.parse(resolvedValue) as Record<string, unknown>);
            } catch {
                // Ignore malformed payloads.
            }
        }

        if (toPut.length === 0 && toRemove.length === 0) return;

        isApplyingRemoteRef.current = true;
        try {
            ed.store.mergeRemoteChanges(() => {
                if (toPut.length > 0) {
                    ed.store.put(toPut as unknown as Parameters<typeof ed.store.put>[0]);
                }
                if (toRemove.length > 0) {
                    ed.store.remove(toRemove as Parameters<typeof ed.store.remove>[0]);
                }
            });
        } finally {
            isApplyingRemoteRef.current = false;
        }
    }, [docId]);

    const flushRemoteOpsNow = useCallback(() => {
        if (flushRemoteTimerRef.current !== null) {
            cancelNextFrame(flushRemoteTimerRef.current);
            flushRemoteTimerRef.current = null;
        }
        if (pendingRemoteOpsRef.current.length === 0) return;
        const ops = pendingRemoteOpsRef.current;
        pendingRemoteOpsRef.current = [];
        const manager = applyOpsToState(ops);
        pushToEditor(manager, ops);
    }, [applyOpsToState, cancelNextFrame, pushToEditor]);

    const queueRemoteOps = useCallback((ops: ReadonlyArray<RecordOp>) => {
        if (ops.length === 0) return;
        pendingRemoteOpsRef.current.push(...ops);
        if (flushRemoteTimerRef.current !== null) return;
        flushRemoteTimerRef.current = scheduleNextFrame(() => {
            flushRemoteTimerRef.current = null;
            flushRemoteOpsNow();
        });
    }, [flushRemoteOpsNow, scheduleNextFrame]);

    const persistSnapshotNow = useCallback(async (params?: {
        transport?: "fetch" | "beacon";
        finalizeEditing?: boolean;
        source?: "local" | "remote-merged";
        publish?: boolean;
    }) => {
        const ed = editorRef.current;
        if (!ed) return;
        const transport = params?.transport ?? "fetch";
        const source = params?.source ?? "local";
        const shouldPublish = params?.publish ?? (source === "local");
        const attemptId = `${canvasId}-${persistAttemptCounterRef.current + 1}`;
        persistAttemptCounterRef.current += 1;

        if (params?.finalizeEditing && ed.getEditingShapeId()) {
            try {
                ed.complete();
            } catch {
                // Best-effort.
            }
        }

        let { manager, clock } = stateRef.current;
        let record = getDoc({ manager, docId });
        if (!record) {
            const fieldMap = buildFieldMapFromEditor(ed);
            const seedOps: FieldOp[] = [];
            for (const [fieldName, value] of fieldMap) {
                const next = incrementClock(clock);
                clock = next.clock;
                seedOps.push({
                    type: "field",
                    id: createFieldOpId({ clientId, clock: next.timestamp.clock }),
                    fieldName,
                    value,
                    timestamp: next.timestamp,
                });
            }
            for (const op of seedOps) {
                manager = applyDocOperation({ manager, docId, op });
            }
            stateRef.current = { manager, clock };
            mirroredFieldsRef.current = fieldMap;
            record = getDoc({ manager, docId });
        }
        if (!record) {
            crdtDebugLog({
                event: "canvas_snapshot_save_skipped",
                data: { canvasId, docId, clientId, attemptId, reason: "no_record_in_manager" },
            });
            return;
        }

        const snapshot = encodeRecordSnapshot({ record });
        const snapshotVersion = getRecordSnapshotVersion({ data: snapshot });
        const snapshotStateVector = getRecordSnapshotStateVector({ data: snapshot });
        const snapshotBytes = snapshot.byteLength;
        const expectedVersion = backendSnapshotVersionRef.current ?? undefined;
        if (source === "local" && localSnapshotVersionRef.current === snapshotVersion && !params?.finalizeEditing) {
            crdtDebugLog({
                event: "canvas_snapshot_save_skipped",
                data: {
                    canvasId,
                    docId,
                    clientId,
                    attemptId,
                    reason: "unchanged_snapshot_version",
                    transport,
                    bytes: snapshotBytes,
                    version: snapshotVersion,
                },
            });
            return;
        }

        const payload = JSON.stringify({
            docId,
            snapshot: encodeBase64Bytes(snapshot),
            meta: {
                docId,
                snapshotVersion,
                updatedAt: new Date().toISOString(),
                stateVector: stateVectorToObject(snapshotStateVector),
                source,
                lastKnownBackendVersion: expectedVersion,
            } satisfies CanvasSnapshotMeta,
        });

        const startedAt = Date.now();
        crdtDebugLog({
            event: "canvas_snapshot_save_start",
            data: {
                canvasId,
                docId,
                clientId,
                attemptId,
                source,
                transport,
                bytes: snapshotBytes,
                finalizeEditing: !!params?.finalizeEditing,
            },
        });

        if (params?.transport === "beacon") {
            if (canUseBeaconTransport()) {
                const queued = navigator.sendBeacon(
                    "/api/crdt/canvas-snapshot/save",
                    new Blob([payload], { type: "application/json" })
                );
                if (queued) {
                    localSnapshotVersionRef.current = snapshotVersion;
                    localSeedSnapshotRef.current = {
                        bytes: snapshot,
                        version: snapshotVersion,
                        stateVector: new Map(snapshotStateVector),
                    };
                    return;
                }
            }
            fetch("/api/crdt/canvas-snapshot/save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: payload,
                keepalive: true,
            }).catch((error) => {
                crdtDebugLog({
                    event: "canvas_snapshot_save_error",
                    data: {
                        canvasId,
                        docId,
                        clientId,
                        attemptId,
                        source,
                        transport: "beacon_fetch_keepalive",
                        bytes: snapshotBytes,
                        message: error instanceof Error ? error.message : String(error),
                        durationMs: Date.now() - startedAt,
                    },
                });
            });
            return;
        }

        const response = await fetch("/api/crdt/canvas-snapshot/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
        });
        if (!response.ok) {
            throw new Error(`status ${response.status}`);
        }

        localSnapshotVersionRef.current = snapshotVersion;
        localSeedSnapshotRef.current = {
            bytes: snapshot,
            version: snapshotVersion,
            stateVector: new Map(snapshotStateVector),
        };
        if (shouldPublish && collabEnabled && collab?.sendSnapshot) {
            collab.sendSnapshot({
                docId,
                snapshot,
                expectedVersion,
                mergeBias: "remote",
            });
        }
        crdtDebugLog({
            event: "canvas_snapshot_save_success",
            data: {
                canvasId,
                docId,
                clientId,
                attemptId,
                source,
                transport: "fetch",
                bytes: snapshotBytes,
                durationMs: Date.now() - startedAt,
                version: snapshotVersion,
            },
        });
    }, [buildFieldMapFromEditor, canvasId, clientId, collab, collabEnabled, docId]);

    const queueLocalSnapshotPersist = useCallback(() => {
        if (localSaveTimerRef.current !== null) {
            clearTimeout(localSaveTimerRef.current);
        }
        localSaveTimerRef.current = setTimeout(() => {
            localSaveTimerRef.current = null;
            void persistSnapshotNow({ source: "local", publish: true }).catch((error) => {
                crdtDebugLog({
                    event: "canvas_snapshot_save_error",
                    data: {
                        canvasId,
                        message: error instanceof Error ? error.message : String(error),
                    },
                });
            });
        }, LOCAL_SAVE_DEBOUNCE_MS) as unknown as number;
    }, [canvasId, persistSnapshotNow]);

    const handleRemoteOps = useCallback((incoming: {
        docId: string;
        ops: ReadonlyArray<RecordOp>;
    }) => {
        if (incoming.ops.length > 0) {
            sawRemoteDataDuringSyncRef.current = true;
        }
        crdtDebugLog({
            event: "canvas_receive_ops",
            data: {
                canvasId,
                docId: incoming.docId,
                count: incoming.ops.length,
                ops: summarizeOpsForDebug(incoming.ops),
            },
        });
        queueRemoteOps(incoming.ops);
    }, [canvasId, queueRemoteOps]);

    const handleRemoteSnapshot = useCallback((incoming: {
        docId: string;
        snapshot: Uint8Array;
        version?: string;
    }) => {
        sawRemoteDataDuringSyncRef.current = true;
        try {
            const decoded = decodeRecordSnapshot({ data: incoming.snapshot });
            const manager = applySnapshotToDoc({
                manager: stateRef.current.manager,
                docId,
                snapshot: decoded,
                mode: "merge",
                mergeBias: "remote",
            });
            stateRef.current = { ...stateRef.current, manager };
            restoreEditorFromState(manager);

            const resolvedVersion = incoming.version ?? getRecordSnapshotVersion({ data: incoming.snapshot });
            const snapshotStateVector = new Map(getRecordSnapshotStateVector({ data: incoming.snapshot }));
            backendSnapshotVersionRef.current = resolvedVersion;
            localSnapshotVersionRef.current = resolvedVersion;
            localSeedSnapshotRef.current = {
                bytes: incoming.snapshot,
                version: resolvedVersion,
                stateVector: snapshotStateVector,
            };
            restoredStateVectorRef.current = snapshotStateVector;

            crdtDebugLog({
                event: "canvas_remote_snapshot_applied",
                data: {
                    canvasId,
                    docId,
                    bytes: incoming.snapshot.byteLength,
                    version: resolvedVersion,
                },
            });
            void persistSnapshotNow({
                source: "remote-merged",
                publish: false,
            }).catch((error) => {
                crdtDebugLog({
                    event: "canvas_snapshot_save_error",
                    data: {
                        canvasId,
                        docId,
                        source: "remote-merged",
                        message: error instanceof Error ? error.message : String(error),
                    },
                });
            });
        } catch (error) {
            crdtDebugLog({
                event: "canvas_remote_snapshot_apply_error",
                data: {
                    canvasId,
                    docId,
                    bytes: incoming.snapshot.byteLength,
                    message: error instanceof Error ? error.message : String(error),
                },
            });
        }
    }, [canvasId, docId, persistSnapshotNow, restoreEditorFromState]);

    const handleSyncComplete = useCallback(() => {
        crdtDebugLog({
            event: "canvas_sync_complete",
            data: {
                canvasId,
                docId,
                pendingRemoteOps: pendingRemoteOpsRef.current.length,
                remoteCollaborators: remoteCollaboratorsRef.current.size,
                sawRemoteDataDuringSync: sawRemoteDataDuringSyncRef.current,
            },
        });
        flushRemoteOpsNow();
        didSyncRef.current = true;
        restoreEditorFromState();
        if (
            collabEnabled
            && !sawRemoteDataDuringSyncRef.current
            && localSeedSnapshotRef.current
            && collab?.sendSnapshot
        ) {
            collab.sendSnapshot({
                docId,
                snapshot: localSeedSnapshotRef.current.bytes,
                expectedVersion: backendSnapshotVersionRef.current ?? undefined,
                mergeBias: "remote",
            });
            crdtDebugLog({
                event: "canvas_sync_publish_local_seed",
                data: {
                    canvasId,
                    docId,
                    bytes: localSeedSnapshotRef.current.bytes.byteLength,
                    version: localSeedSnapshotRef.current.version,
                    expectedVersion: backendSnapshotVersionRef.current ?? null,
                },
            });
        }
        sendLocalAwarenessNow({ force: true });
        setIsSynced(true);
    }, [canvasId, collab, collabEnabled, docId, flushRemoteOpsNow, restoreEditorFromState, sendLocalAwarenessNow]);

    const handleMount = useCallback((mountedEditor: Editor) => {
        editorRef.current = mountedEditor;
        setEditor(mountedEditor);
        if (collab?.userInfo) {
            mountedEditor.user.updateUserPreferences({
                id: clientId,
                name: collab.userInfo.name,
                color: collab.userInfo.color,
            });
        }
        if (collabEnabled) {
            restoreEditorFromState();
            if (didSyncRef.current) {
                setIsSynced(true);
            }
            sendLocalAwarenessNow({ force: true });
            if (
                followedCollaboratorId
                && remoteCollaboratorsRef.current.has(followedCollaboratorId)
            ) {
                mountedEditor.zoomToUser(followedCollaboratorId, { animation: { duration: 220 } });
                mountedEditor.startFollowingUser(followedCollaboratorId);
            }
        }
    }, [clientId, collab, collabEnabled, followedCollaboratorId, restoreEditorFromState, sendLocalAwarenessNow]);

    // Reset local state when switching canvases/modes.
    // Persist current state before clearing to prevent data loss.
    useEffect(() => {
        // Save current state before reset (beacon survives teardown).
        void persistSnapshotNow({ transport: "beacon", finalizeEditing: true, publish: false });

        didSyncRef.current = false;
        sawRemoteDataDuringSyncRef.current = false;
        didHydrateLocalRef.current = false;
        localSnapshotVersionRef.current = null;
        backendSnapshotVersionRef.current = null;
        localSeedSnapshotRef.current = null;
        lastAwarenessSignatureRef.current = null;
        restoredStateVectorRef.current = null;
        setIsSynced(false);
        mirroredFieldsRef.current = new Map();
        pendingSendOpsRef.current = [];
        pendingRemoteOpsRef.current = [];
        clearRemotePresenceRecords();
        stateRef.current = {
            manager: createDocManager(),
            clock: createClock({ clientId }),
        };

        if (flushSendTimerRef.current !== null) {
            clearTimeout(flushSendTimerRef.current);
            flushSendTimerRef.current = null;
        }
        if (flushRemoteTimerRef.current !== null) {
            cancelNextFrame(flushRemoteTimerRef.current);
            flushRemoteTimerRef.current = null;
        }
        if (localSaveTimerRef.current !== null) {
            clearTimeout(localSaveTimerRef.current);
            localSaveTimerRef.current = null;
        }
        if (awarenessFlushTimerRef.current !== null) {
            clearTimeout(awarenessFlushTimerRef.current);
            awarenessFlushTimerRef.current = null;
        }
        if (awarenessHeartbeatTimerRef.current !== null) {
            clearInterval(awarenessHeartbeatTimerRef.current);
            awarenessHeartbeatTimerRef.current = null;
        }
        if (awarenessStaleSweepTimerRef.current !== null) {
            clearInterval(awarenessStaleSweepTimerRef.current);
            awarenessStaleSweepTimerRef.current = null;
        }
    }, [canvasId, cancelNextFrame, clearRemotePresenceRecords, clientId, persistSnapshotNow]);

    // Subscribe to team-mode collab document.
    useEffect(() => {
        if (!collabEnabled || !collab?.subscribeDoc) return undefined;
        const unsubscribe = collab.subscribeDoc({
            docId,
            onOps: handleRemoteOps,
            onSnapshot: ({ docId: incomingDocId, snapshot, version }) => {
                handleRemoteSnapshot({
                    docId: incomingDocId,
                    snapshot,
                    version,
                });
            },
            initialStateVector: restoredStateVectorRef.current ?? undefined,
            onSyncComplete: () => handleSyncComplete(),
        });
        return () => {
            unsubscribe();
        };
    }, [collab, collabEnabled, docId, handleRemoteOps, handleRemoteSnapshot, handleSyncComplete]);

    // Subscribe to presence awareness updates for remote collaborators.
    useEffect(() => {
        if (!collabEnabled || !collab?.subscribeAwareness) return undefined;

        const unsubscribe = collab.subscribeAwareness({
            docId,
            onAwareness: ({ clientId: remoteClientId, state: awarenessState }) => {
                if (remoteClientId === clientId) return;
                applyRemotePresenceFromAwareness({
                    remoteClientId,
                    state: awarenessState,
                });
            },
        });

        return () => {
            unsubscribe();
        };
    }, [applyRemotePresenceFromAwareness, clientId, collab, collabEnabled, docId]);

    // Broadcast local awareness and periodically prune stale remote presence records.
    useEffect(() => {
        if (!editor || !collabEnabled) return undefined;

        sendLocalAwarenessNow({ force: true });
        awarenessHeartbeatTimerRef.current = setInterval(() => {
            sendLocalAwarenessNow({ force: true });
        }, AWARENESS_HEARTBEAT_MS) as unknown as number;
        awarenessStaleSweepTimerRef.current = setInterval(() => {
            pruneStaleRemotePresence();
        }, 1000) as unknown as number;

        return () => {
            if (awarenessHeartbeatTimerRef.current !== null) {
                clearInterval(awarenessHeartbeatTimerRef.current);
                awarenessHeartbeatTimerRef.current = null;
            }
            if (awarenessStaleSweepTimerRef.current !== null) {
                clearInterval(awarenessStaleSweepTimerRef.current);
                awarenessStaleSweepTimerRef.current = null;
            }
        };
    }, [collabEnabled, editor, pruneStaleRemotePresence, sendLocalAwarenessNow]);

    // Hydrate local CRDT snapshot cache.
    useEffect(() => {
        if (!editor) return;
        if (didHydrateLocalRef.current) return;

        let cancelled = false;
        didHydrateLocalRef.current = true;
        void (async () => {
            try {
                const response = await fetch("/api/crdt/canvas-snapshot/get", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ docId }),
                });
                if (!response.ok) {
                    throw new Error(`status ${response.status}`);
                }
                const snapshotResult = await response.json() as {
                    snapshot: string | null;
                    meta: CanvasSnapshotMeta | null;
                };
                if (cancelled) return;

                if (snapshotResult.snapshot) {
                    const snapshotBytes = decodeBase64Bytes(snapshotResult.snapshot);
                    const decoded = decodeRecordSnapshot({ data: snapshotBytes });
                    const manager = applySnapshotToDoc({
                        manager: stateRef.current.manager,
                        docId,
                        snapshot: decoded,
                        mode: "replace",
                    });
                    stateRef.current = { ...stateRef.current, manager };
                    restoreEditorFromState(manager);

                    const version = snapshotResult.meta?.snapshotVersion
                        ?? getRecordSnapshotVersion({ data: snapshotBytes });
                    const parsedStateVector = objectToStateVector(snapshotResult.meta?.stateVector);
                    const snapshotStateVector = parsedStateVector
                        ? new Map(parsedStateVector)
                        : new Map(getRecordSnapshotStateVector({ data: snapshotBytes }));
                    localSnapshotVersionRef.current = version;
                    backendSnapshotVersionRef.current = snapshotResult.meta?.lastKnownBackendVersion ?? null;
                    restoredStateVectorRef.current = snapshotStateVector;
                    localSeedSnapshotRef.current = {
                        bytes: snapshotBytes,
                        version,
                        stateVector: snapshotStateVector,
                    };

                    crdtDebugLog({
                        event: "canvas_snapshot_load_hit",
                        data: {
                            canvasId,
                            docId,
                            bytes: snapshotBytes.byteLength,
                            version,
                            hasStateVector: snapshotStateVector.size > 0,
                        },
                    });
                } else {
                    crdtDebugLog({
                        event: "canvas_snapshot_load_miss",
                        data: {
                            canvasId,
                            docId,
                            collabEnabled,
                        },
                    });
                    await persistSnapshotNow({ source: "local", publish: false });
                }
            } catch (error) {
                crdtDebugLog({
                    event: "canvas_snapshot_load_error",
                    data: {
                        canvasId,
                        docId,
                        message: error instanceof Error ? error.message : String(error),
                    },
                });
            } finally {
                mirroredFieldsRef.current = buildFieldMapFromEditor(editor);
                if (!collabEnabled) {
                    setIsSynced(true);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [buildFieldMapFromEditor, canvasId, collabEnabled, docId, editor, persistSnapshotNow, restoreEditorFromState]);

    // Flush latest snapshot when the page is backgrounded/closed.
    useEffect(() => {
        const handlePageHide = () => {
            void persistSnapshotNow({ transport: "beacon", finalizeEditing: true, publish: false });
        };
        const handleVisibilityChange = () => {
            if (typeof document === "undefined") return;
            if (document.visibilityState !== "hidden") return;
            void persistSnapshotNow({ transport: "beacon", finalizeEditing: true, publish: false });
        };

        if (typeof window !== "undefined") {
            window.addEventListener("pagehide", handlePageHide);
            window.addEventListener("beforeunload", handlePageHide);
        }
        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", handleVisibilityChange);
        }

        return () => {
            if (typeof window !== "undefined") {
                window.removeEventListener("pagehide", handlePageHide);
                window.removeEventListener("beforeunload", handlePageHide);
            }
            if (typeof document !== "undefined") {
                document.removeEventListener("visibilitychange", handleVisibilityChange);
            }
        };
    }, [persistSnapshotNow]);

    // Register store listener.
    useEffect(() => {
        if (!editor) return undefined;

        const removeDocumentListener = editor.store.listen((entry) => {
            if (isApplyingRemoteRef.current) return;
            if (entry.source === "remote") return;

            const ops: FieldOp[] = [];
            const mirrored = mirroredFieldsRef.current;
            const { added, updated, removed } = entry.changes;

            for (const addedRecord of Object.values(added)) {
                const record = addedRecord as unknown as SerializableRecord;
                if (typeof record.id !== "string") continue;
                let value: string;
                try {
                    value = JSON.stringify(record);
                } catch {
                    continue;
                }
                const fieldName = `${TL_FIELD_PREFIX}${record.id}`;
                if (mirrored.get(fieldName) === value) continue;

                const { clock: nextClock, timestamp } = incrementClock(stateRef.current.clock);
                stateRef.current = { ...stateRef.current, clock: nextClock };
                ops.push({
                    type: "field",
                    id: createFieldOpId({ clientId, clock: timestamp.clock }),
                    fieldName,
                    value,
                    timestamp,
                });
                mirrored.set(fieldName, value);
            }

            for (const pair of Object.values(updated)) {
                const toRecord = pair[1] as unknown as SerializableRecord;
                if (typeof toRecord.id !== "string") continue;
                let value: string;
                try {
                    value = JSON.stringify(toRecord);
                } catch {
                    continue;
                }
                const fieldName = `${TL_FIELD_PREFIX}${toRecord.id}`;
                if (mirrored.get(fieldName) === value) continue;

                const { clock: nextClock, timestamp } = incrementClock(stateRef.current.clock);
                stateRef.current = { ...stateRef.current, clock: nextClock };
                ops.push({
                    type: "field",
                    id: createFieldOpId({ clientId, clock: timestamp.clock }),
                    fieldName,
                    value,
                    timestamp,
                });
                mirrored.set(fieldName, value);
            }

            for (const removedRecord of Object.values(removed)) {
                const record = removedRecord as { id?: unknown };
                if (typeof record.id !== "string") continue;
                const fieldName = `${TL_FIELD_PREFIX}${record.id}`;
                if (!mirrored.has(fieldName)) continue;

                const { clock: nextClock, timestamp } = incrementClock(stateRef.current.clock);
                stateRef.current = { ...stateRef.current, clock: nextClock };
                ops.push({
                    type: "field",
                    id: createFieldOpId({ clientId, clock: timestamp.clock }),
                    fieldName,
                    value: DELETED_SENTINEL,
                    timestamp,
                });
                mirrored.delete(fieldName);
            }

            const compactedOps = compactFieldOps({ ops });
            if (compactedOps.length === 0) return;

            let { manager } = stateRef.current;
            for (const op of compactedOps) {
                manager = applyDocOperation({ manager, docId, op });
            }
            stateRef.current = { ...stateRef.current, manager };
            if (collabEnabled) {
                queueSendOps(compactedOps);
            }
            queueLocalSnapshotPersist();
        }, { source: "all", scope: "document" });
        const removeSessionListener = collabEnabled
            ? editor.store.listen(() => {
                if (isApplyingRemoteRef.current) return;
                queueLocalAwarenessSend();
            }, { source: "all", scope: "session" })
            : null;

        // Seed CRDT record from current editor state if we haven't mirrored anything yet.
        const current = buildFieldMapFromEditor(editor);
        const previous = mirroredFieldsRef.current;
        if (current.size > 0 && previous.size === 0) {
            const seedOps: FieldOp[] = [];
            for (const [fieldName, value] of current) {
                const { clock: nextClock, timestamp } = incrementClock(stateRef.current.clock);
                stateRef.current = { ...stateRef.current, clock: nextClock };
                seedOps.push({
                    type: "field",
                    id: createFieldOpId({ clientId, clock: timestamp.clock }),
                    fieldName,
                    value,
                    timestamp,
                });
            }

            mirroredFieldsRef.current = current;
            if (seedOps.length > 0) {
                let { manager } = stateRef.current;
                for (const op of seedOps) {
                    manager = applyDocOperation({ manager, docId, op });
                }
                stateRef.current = { ...stateRef.current, manager };
                if (collabEnabled) {
                    queueSendOps(seedOps);
                }
            }
        } else {
            mirroredFieldsRef.current = current;
        }

        return () => {
            removeDocumentListener();
            removeSessionListener?.();
            if (collabEnabled) {
                flushSendOpsNow();
                sendLocalAwarenessNow({ force: true });
            }
            void persistSnapshotNow({ transport: "beacon", finalizeEditing: true, publish: false }).catch((error) => {
                crdtDebugLog({
                    event: "canvas_snapshot_save_error",
                    data: {
                        canvasId,
                        message: error instanceof Error ? error.message : String(error),
                    },
                });
            });
        };
    }, [
        buildFieldMapFromEditor,
        canvasId,
        clientId,
        collabEnabled,
        docId,
        editor,
        flushSendOpsNow,
        queueLocalAwarenessSend,
        queueLocalSnapshotPersist,
        queueSendOps,
        persistSnapshotNow,
        sendLocalAwarenessNow,
    ]);

    useEffect(() => {
        return () => {
            if (flushSendTimerRef.current !== null) {
                clearTimeout(flushSendTimerRef.current);
            }
            if (flushRemoteTimerRef.current !== null) {
                cancelNextFrame(flushRemoteTimerRef.current);
            }
            if (localSaveTimerRef.current !== null) {
                clearTimeout(localSaveTimerRef.current);
            }
            if (awarenessFlushTimerRef.current !== null) {
                clearTimeout(awarenessFlushTimerRef.current);
            }
            if (awarenessHeartbeatTimerRef.current !== null) {
                clearInterval(awarenessHeartbeatTimerRef.current);
            }
            if (awarenessStaleSweepTimerRef.current !== null) {
                clearInterval(awarenessStaleSweepTimerRef.current);
            }
            clearRemotePresenceRecords({ resetState: false });
        };
    }, [cancelNextFrame, clearRemotePresenceRecords]);

    const hardResetCrdtPreserveContent = useCallback(async () => {
        const ed = editorRef.current;
        if (!ed) {
            throw new Error("Canvas editor is not ready");
        }
        if (!collabEnabled || !collab?.sendOps) {
            throw new Error("CRDT hard reset is only available in team mode");
        }

        const preservedFields = buildFieldMapFromEditor(ed);
        const preservedRecords: Array<Record<string, unknown>> = [];
        for (const value of preservedFields.values()) {
            try {
                preservedRecords.push(JSON.parse(value) as Record<string, unknown>);
            } catch {
                // Ignore malformed serialized records.
            }
        }

        const response = await fetch("/api/crdt/canvas-snapshot/hard-reset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ docId }),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null) as { error?: string; details?: string | null } | null;
            throw new Error(payload?.error || payload?.details || `HTTP ${response.status}`);
        }

        if (flushSendTimerRef.current !== null) {
            clearTimeout(flushSendTimerRef.current);
            flushSendTimerRef.current = null;
        }
        if (flushRemoteTimerRef.current !== null) {
            cancelNextFrame(flushRemoteTimerRef.current);
            flushRemoteTimerRef.current = null;
        }
        if (localSaveTimerRef.current !== null) {
            clearTimeout(localSaveTimerRef.current);
            localSaveTimerRef.current = null;
        }
        pendingSendOpsRef.current = [];
        pendingRemoteOpsRef.current = [];

        let manager = createDocManager();
        let clock = createClock({ clientId });
        const seedOps: FieldOp[] = [];
        for (const [fieldName, value] of preservedFields) {
            const next = incrementClock(clock);
            clock = next.clock;
            const op: FieldOp = {
                type: "field",
                id: createFieldOpId({ clientId, clock: next.timestamp.clock }),
                fieldName,
                value,
                timestamp: next.timestamp,
            };
            seedOps.push(op);
            manager = applyDocOperation({ manager, docId, op });
        }

        stateRef.current = { manager, clock };
        mirroredFieldsRef.current = new Map(preservedFields);
        localSnapshotVersionRef.current = null;
        backendSnapshotVersionRef.current = null;
        localSeedSnapshotRef.current = null;
        restoredStateVectorRef.current = null;

        const currentFields = buildFieldMapFromEditor(ed);
        const toRemoveIds: string[] = [];
        for (const fieldName of currentFields.keys()) {
            if (preservedFields.has(fieldName)) continue;
            const recordId = fieldNameToRecordId(fieldName);
            if (recordId) toRemoveIds.push(recordId);
        }

        isApplyingRemoteRef.current = true;
        try {
            ed.store.mergeRemoteChanges(() => {
                if (toRemoveIds.length > 0) {
                    ed.store.remove(toRemoveIds as Parameters<typeof ed.store.remove>[0]);
                }
                if (preservedRecords.length > 0) {
                    ed.store.put(preservedRecords as unknown as Parameters<typeof ed.store.put>[0]);
                }
            });
        } finally {
            isApplyingRemoteRef.current = false;
        }

        if (seedOps.length > 0) {
            collab.sendOps({ docId, ops: seedOps });
        }

        await persistSnapshotNow({
            source: "local",
            publish: true,
            finalizeEditing: true,
        });

        didSyncRef.current = true;
        setIsSynced(true);

        crdtDebugLog({
            event: "canvas_hard_reset_reseeded",
            data: {
                canvasId,
                docId,
                seedOpCount: seedOps.length,
                preservedRecordCount: preservedRecords.length,
            },
        });
    }, [
        buildFieldMapFromEditor,
        canvasId,
        cancelNextFrame,
        clientId,
        collab,
        collabEnabled,
        docId,
        persistSnapshotNow,
    ]);

    return {
        docId,
        collabEnabled,
        isConnected: collabEnabled ? (collab?.isConnected ?? false) : true,
        isSynced,
        remoteCollaborators,
        followedCollaboratorId,
        followCollaborator,
        handleMount,
        hardResetCrdtPreserveContent,
    };
}
