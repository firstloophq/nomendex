import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
    applyDocOperation,
    createClock,
    createDocManager,
    getDoc,
    receive,
    type AwarenessState,
    type FieldOp,
    type LamportClock,
    type RecordOp,
    type DocManager,
    type LWWRegister,
    type StateVector,
    type Timestamp,
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
import { canvasAPI } from "@/hooks/useCanvasAPI";
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

interface PersistedCRDTField {
    fieldName: string;
    value: string;
    timestamp: { clientId: string; clock: number };
}

interface PersistedCanvasCRDTState {
    version: 1;
    clockCounter: number;
    clientId: string;
    wasSynced: boolean;
    stateVector: Record<string, number>;
    fields: PersistedCRDTField[];
}

interface RemotePresenceEntry {
    recordId: string;
    lastUpdated: number;
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

function recordsFromSerializedSnapshot(snapshot: unknown): Array<{ id: string; [key: string]: unknown }> {
    if (!snapshot || typeof snapshot !== "object") return [];
    const values = Object.values(snapshot as Record<string, SerializableRecord>);
    const records: Array<{ id: string; [key: string]: unknown }> = [];
    for (const record of values) {
        if (!record || typeof record !== "object") continue;
        if (typeof record.id !== "string") continue;
        records.push(record as { id: string; [key: string]: unknown });
    }
    return records;
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
        && !!collab?.sendOps;
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
    const isApplyingRemoteRef = useRef(false);
    const didHydrateLocalRef = useRef(false);
    const lastPersistedSnapshotRef = useRef<string | null>(null);
    const persistAttemptCounterRef = useRef(0);
    const localSaveTimerRef = useRef<number | null>(null);
    const persistedSnapshotRecordsRef = useRef<Array<{ id: string; [key: string]: unknown }> | null>(null);
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
    }) => {
        const ed = editorRef.current;
        if (!ed) return;
        const transport = params?.transport ?? "fetch";
        const attemptId = `${canvasId}-${persistAttemptCounterRef.current + 1}`;
        persistAttemptCounterRef.current += 1;

        // Local snapshot is always saved as a safety net, even before sync completes.
        // The CRDT state (with wasSynced flag) is used at load time to judge data quality.

        if (params?.finalizeEditing && ed.getEditingShapeId()) {
            try {
                // Commit active rich-text edits into the document before serializing.
                ed.complete();
            } catch {
                // Ignore completion errors and continue best-effort snapshotting.
            }
        }

        let snapshot: string;
        try {
            snapshot = JSON.stringify(ed.store.serialize("document"));
        } catch (error) {
            crdtDebugLog({
                event: "canvas_snapshot_serialize_error",
                data: {
                    canvasId,
                    docId,
                    clientId,
                    attemptId,
                    message: error instanceof Error ? error.message : String(error),
                },
            });
            return;
        }

        const snapshotBytes = snapshot.length;
        if (lastPersistedSnapshotRef.current === snapshot) {
            crdtDebugLog({
                event: "canvas_snapshot_save_skipped",
                data: {
                    canvasId,
                    docId,
                    clientId,
                    attemptId,
                    reason: "unchanged_snapshot",
                    transport,
                    bytes: snapshotBytes,
                },
            });
            return;
        }
        const startedAt = Date.now();
        crdtDebugLog({
            event: "canvas_snapshot_save_start",
            data: {
                canvasId,
                docId,
                clientId,
                attemptId,
                transport,
                bytes: snapshotBytes,
                finalizeEditing: !!params?.finalizeEditing,
            },
        });

        if (params?.transport === "beacon") {
            const payload = JSON.stringify({ canvasId, snapshot });
            if (canUseBeaconTransport()) {
                const queued = navigator.sendBeacon(
                    "/api/canvas/snapshot/save",
                    new Blob([payload], { type: "application/json" })
                );
                if (queued) {
                    lastPersistedSnapshotRef.current = snapshot;
                    crdtDebugLog({
                        event: "canvas_snapshot_save_enqueued",
                        data: {
                            canvasId,
                            docId,
                            clientId,
                            attemptId,
                            transport: "beacon",
                            bytes: snapshotBytes,
                            durationMs: Date.now() - startedAt,
                        },
                    });
                    return;
                }
            }
            crdtDebugLog({
                event: "canvas_snapshot_save_beacon_fallback",
                data: {
                    canvasId,
                    docId,
                    clientId,
                    attemptId,
                    bytes: snapshotBytes,
                },
            });

            // Fallback for environments where sendBeacon is unavailable or failed.
            fetch("/api/canvas/snapshot/save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: payload,
                keepalive: true,
            }).then((response) => {
                if (!response.ok) {
                    throw new Error(`status ${response.status}`);
                }
                lastPersistedSnapshotRef.current = snapshot;
                crdtDebugLog({
                    event: "canvas_snapshot_save_success",
                    data: {
                        canvasId,
                        docId,
                        clientId,
                        attemptId,
                        transport: "beacon_fetch_keepalive",
                        bytes: snapshotBytes,
                        durationMs: Date.now() - startedAt,
                    },
                });
            }).catch((error) => {
                crdtDebugLog({
                    event: "canvas_snapshot_save_error",
                    data: {
                        canvasId,
                        docId,
                        clientId,
                        attemptId,
                        transport: "beacon_fetch_keepalive",
                        bytes: snapshotBytes,
                        message: error instanceof Error ? error.message : String(error),
                        durationMs: Date.now() - startedAt,
                    },
                });
            });
            return;
        }

        await canvasAPI.saveSnapshot({ canvasId, snapshot });
        lastPersistedSnapshotRef.current = snapshot;
        crdtDebugLog({
            event: "canvas_snapshot_save_success",
            data: {
                canvasId,
                docId,
                clientId,
                attemptId,
                transport: "fetch",
                bytes: snapshotBytes,
                durationMs: Date.now() - startedAt,
            },
        });
    }, [canvasId, clientId, docId]);

    const persistCRDTStateNow = useCallback((persistParams?: {
        transport?: "fetch" | "beacon";
    }) => {
        const { manager, clock } = stateRef.current;
        const record = getDoc({ manager, docId });
        if (!record) return;

        const fields: PersistedCRDTField[] = [];
        const recordFields = record.fields as ReadonlyMap<string, LWWRegister<string>>;
        for (const [fieldName, register] of recordFields) {
            if (!fieldName.startsWith(TL_FIELD_PREFIX)) continue;
            fields.push({
                fieldName,
                value: register.value,
                timestamp: {
                    clientId: register.timestamp.clientId,
                    clock: register.timestamp.clock,
                },
            });
        }

        if (fields.length === 0) return;

        const svObj: Record<string, number> = {};
        const sv = record.stateVector as ReadonlyMap<string, number>;
        for (const [svClientId, svClock] of sv) {
            svObj[svClientId] = svClock;
        }

        const state: PersistedCanvasCRDTState = {
            version: 1,
            clockCounter: clock.counter,
            clientId: clock.clientId,
            wasSynced: didSyncRef.current,
            stateVector: svObj,
            fields,
        };

        const payload = JSON.stringify({ canvasId, crdtState: JSON.stringify(state) });
        const transport = persistParams?.transport ?? "fetch";

        if (transport === "beacon") {
            if (canUseBeaconTransport()) {
                navigator.sendBeacon(
                    "/api/canvas/crdt-state/save",
                    new Blob([payload], { type: "application/json" })
                );
                return;
            }
            fetch("/api/canvas/crdt-state/save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: payload,
                keepalive: true,
            }).catch(() => {
                // Best-effort; ignore errors on unload path.
            });
            return;
        }

        canvasAPI.saveCRDTState({ canvasId, crdtState: JSON.stringify(state) }).catch((error) => {
            crdtDebugLog({
                event: "canvas_crdt_state_save_error",
                data: {
                    canvasId,
                    message: error instanceof Error ? error.message : String(error),
                },
            });
        });
    }, [canvasId, docId]);

    const queueLocalSnapshotPersist = useCallback(() => {
        if (localSaveTimerRef.current !== null) {
            clearTimeout(localSaveTimerRef.current);
        }
        localSaveTimerRef.current = setTimeout(() => {
            localSaveTimerRef.current = null;
            void persistSnapshotNow().catch((error) => {
                crdtDebugLog({
                    event: "canvas_snapshot_save_error",
                    data: {
                        canvasId,
                        message: error instanceof Error ? error.message : String(error),
                    },
                });
            });
            persistCRDTStateNow();
        }, LOCAL_SAVE_DEBOUNCE_MS) as unknown as number;
    }, [canvasId, persistCRDTStateNow, persistSnapshotNow]);

    const handleRemoteOps = useCallback((incoming: {
        docId: string;
        ops: ReadonlyArray<RecordOp>;
    }) => {
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

    const bootstrapCollabDocFromPersistedSnapshot = useCallback(() => {
        if (!collabEnabled) return;
        const editorInstance = editorRef.current;
        if (!editorInstance) return;

        const snapshotRecords = persistedSnapshotRecordsRef.current;
        if (!snapshotRecords || snapshotRecords.length === 0) {
            crdtDebugLog({
                event: "canvas_collab_bootstrap_skipped",
                data: {
                    canvasId,
                    docId,
                    reason: "no_snapshot_records",
                },
            });
            return;
        }
        // Per-record bootstrap: only seed records that are NOT already in the manager.
        // This handles partial sync scenarios where remote has some but not all records.
        const existingFields = new Set<string>();
        const docRecord = getDoc({ manager: stateRef.current.manager, docId });
        if (docRecord) {
            const fields = docRecord.fields as ReadonlyMap<string, { value: string }>;
            for (const [fieldName, register] of fields) {
                if (!fieldName.startsWith(TL_FIELD_PREFIX)) continue;
                if (register.value === DELETED_SENTINEL) continue;
                existingFields.add(fieldName);
            }
        }

        let manager = stateRef.current.manager;
        let clock = stateRef.current.clock;
        const seedOps: FieldOp[] = [];
        const putRecords: Array<{ id: string; [key: string]: unknown }> = [];

        for (const record of snapshotRecords) {
            if (!record || typeof record.id !== "string") continue;
            const fieldName = `${TL_FIELD_PREFIX}${record.id}`;

            // Skip records that already exist in the manager (remote version is authoritative via LWW).
            if (existingFields.has(fieldName)) continue;

            let value: string;
            try {
                value = JSON.stringify(record);
            } catch {
                continue;
            }

            if (mirroredFieldsRef.current.get(fieldName) === value) continue;

            const { clock: nextClock, timestamp } = incrementClock(clock);
            clock = nextClock;
            const op: FieldOp = {
                type: "field",
                id: createFieldOpId({ clientId, clock: timestamp.clock }),
                fieldName,
                value,
                timestamp,
            };
            seedOps.push(op);
            putRecords.push(record);
            manager = applyDocOperation({ manager, docId, op });
            mirroredFieldsRef.current.set(fieldName, value);
        }

        if (putRecords.length > 0) {
            isApplyingRemoteRef.current = true;
            try {
                editorInstance.store.mergeRemoteChanges(() => {
                    editorInstance.store.put(putRecords as unknown as Parameters<typeof editorInstance.store.put>[0]);
                });
            } finally {
                isApplyingRemoteRef.current = false;
            }
        }

        stateRef.current = { manager, clock };
        persistedSnapshotRecordsRef.current = null;

        if (seedOps.length > 0) {
            queueSendOps(seedOps);
            crdtDebugLog({
                event: "canvas_collab_bootstrap_from_snapshot",
                data: {
                    canvasId,
                    docId,
                    count: seedOps.length,
                },
            });
        }
    }, [canvasId, clientId, collabEnabled, docId, queueSendOps]);

    const handleSyncComplete = useCallback(() => {
        crdtDebugLog({
            event: "canvas_sync_complete",
            data: {
                canvasId,
                docId,
                pendingRemoteOps: pendingRemoteOpsRef.current.length,
                remoteCollaborators: remoteCollaboratorsRef.current.size,
            },
        });
        flushRemoteOpsNow();
        didSyncRef.current = true;
        restoreEditorFromState();
        bootstrapCollabDocFromPersistedSnapshot();
        sendLocalAwarenessNow({ force: true });
        setIsSynced(true);
    }, [bootstrapCollabDocFromPersistedSnapshot, canvasId, docId, flushRemoteOpsNow, restoreEditorFromState, sendLocalAwarenessNow]);

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
        void persistSnapshotNow({ transport: "beacon", finalizeEditing: true });
        persistCRDTStateNow({ transport: "beacon" });

        didSyncRef.current = false;
        didHydrateLocalRef.current = false;
        lastPersistedSnapshotRef.current = null;
        persistedSnapshotRecordsRef.current = null;
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
    }, [canvasId, cancelNextFrame, clearRemotePresenceRecords, clientId, collabEnabled, persistCRDTStateNow, persistSnapshotNow]);

    // Subscribe to team-mode collab document.
    useEffect(() => {
        if (!collabEnabled || !collab?.subscribeDoc) return undefined;
        const unsubscribe = collab.subscribeDoc({
            docId,
            onOps: handleRemoteOps,
            initialStateVector: restoredStateVectorRef.current ?? undefined,
            onSyncComplete: () => handleSyncComplete(),
        });
        return () => {
            unsubscribe();
        };
    }, [collab, collabEnabled, docId, handleRemoteOps, handleSyncComplete]);

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

    // Hydrate persisted snapshot and CRDT state. In team mode we defer applying the
    // snapshot until sync completes and only bootstrap when the shared CRDT doc is empty.
    useEffect(() => {
        if (!editor) return;
        if (didHydrateLocalRef.current) return;

        let cancelled = false;
        didHydrateLocalRef.current = true;
        void (async () => {
            try {
                const [snapshotResult, crdtStateResult] = await Promise.all([
                    canvasAPI.getSnapshot({ canvasId }),
                    canvasAPI.getCRDTState({ canvasId }),
                ]);
                if (cancelled) return;

                // Restore CRDT manager from persisted state if available.
                if (crdtStateResult.crdtState) {
                    try {
                        const persisted = JSON.parse(crdtStateResult.crdtState) as PersistedCanvasCRDTState;
                        if (persisted.version === 1 && persisted.fields.length > 0) {
                            let manager = stateRef.current.manager;
                            let clock = stateRef.current.clock;

                            // Restore the clock counter to at least the persisted value.
                            if (persisted.clockCounter > clock.counter) {
                                clock = { ...clock, counter: persisted.clockCounter };
                            }

                            // Replay persisted fields as FieldOps with original timestamps.
                            for (const field of persisted.fields) {
                                const op: FieldOp = {
                                    type: "field",
                                    id: createFieldOpId({
                                        clientId: field.timestamp.clientId,
                                        clock: field.timestamp.clock,
                                    }),
                                    fieldName: field.fieldName,
                                    value: field.value,
                                    timestamp: field.timestamp as Timestamp,
                                };
                                manager = applyDocOperation({ manager, docId, op });
                                mirroredFieldsRef.current.set(field.fieldName, field.value);
                            }

                            stateRef.current = { manager, clock };

                            // Restore state vector for delta sync.
                            const sv = new Map<string, number>();
                            for (const [svClientId, svClock] of Object.entries(persisted.stateVector)) {
                                sv.set(svClientId, svClock);
                            }
                            restoredStateVectorRef.current = sv;

                            crdtDebugLog({
                                event: "canvas_crdt_state_restore",
                                data: {
                                    canvasId,
                                    docId,
                                    fieldCount: persisted.fields.length,
                                    clockCounter: persisted.clockCounter,
                                    wasSynced: persisted.wasSynced,
                                    stateVectorSize: sv.size,
                                },
                            });
                        }
                    } catch (parseError) {
                        crdtDebugLog({
                            event: "canvas_crdt_state_restore_error",
                            data: {
                                canvasId,
                                docId,
                                message: parseError instanceof Error ? parseError.message : String(parseError),
                            },
                        });
                    }
                }

                if (snapshotResult.snapshot) {
                    crdtDebugLog({
                        event: "canvas_snapshot_load_hit",
                        data: {
                            canvasId,
                            docId,
                            bytes: snapshotResult.snapshot.length,
                            collabEnabled,
                            synced: didSyncRef.current,
                        },
                    });
                    const parsed = JSON.parse(snapshotResult.snapshot) as unknown;
                    const records = recordsFromSerializedSnapshot(parsed);
                    persistedSnapshotRecordsRef.current = records;
                    crdtDebugLog({
                        event: "canvas_snapshot_load_records",
                        data: {
                            canvasId,
                            docId,
                            count: records.length,
                            collabEnabled,
                            synced: didSyncRef.current,
                        },
                    });

                    if (collabEnabled) {
                        // Sync may complete before snapshot fetch resolves; bootstrap again once
                        // snapshot data is available so an empty shared doc gets seeded reliably.
                        if (didSyncRef.current && records.length > 0) {
                            bootstrapCollabDocFromPersistedSnapshot();
                        }
                    } else if (records.length > 0) {
                        isApplyingRemoteRef.current = true;
                        try {
                            editor.store.mergeRemoteChanges(() => {
                                editor.store.put(records as unknown as Parameters<typeof editor.store.put>[0]);
                            });
                        } finally {
                            isApplyingRemoteRef.current = false;
                        }
                    }
                    lastPersistedSnapshotRef.current = snapshotResult.snapshot;
                } else {
                    crdtDebugLog({
                        event: "canvas_snapshot_load_miss",
                        data: {
                            canvasId,
                            docId,
                            collabEnabled,
                        },
                    });
                    const initialSnapshot = JSON.stringify(editor.store.serialize("document"));
                    lastPersistedSnapshotRef.current = initialSnapshot;
                    await canvasAPI.saveSnapshot({ canvasId, snapshot: initialSnapshot });
                    persistedSnapshotRecordsRef.current = null;
                    crdtDebugLog({
                        event: "canvas_snapshot_seed_initial",
                        data: {
                            canvasId,
                            docId,
                            bytes: initialSnapshot.length,
                        },
                    });
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
    }, [bootstrapCollabDocFromPersistedSnapshot, buildFieldMapFromEditor, canvasId, collabEnabled, docId, editor]);

    // Flush latest snapshot when the page is backgrounded/closed.
    useEffect(() => {
        const handlePageHide = () => {
            void persistSnapshotNow({ transport: "beacon", finalizeEditing: true });
            persistCRDTStateNow({ transport: "beacon" });
        };
        const handleVisibilityChange = () => {
            if (typeof document === "undefined") return;
            if (document.visibilityState !== "hidden") return;
            void persistSnapshotNow({ transport: "beacon", finalizeEditing: true });
            persistCRDTStateNow({ transport: "beacon" });
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
    }, [persistCRDTStateNow, persistSnapshotNow]);

    // Register store listener.
    useEffect(() => {
        if (!editor) return undefined;

        const removeDocumentListener = editor.store.listen((entry) => {
            queueLocalSnapshotPersist();

            if (isApplyingRemoteRef.current) return;
            if (entry.source === "remote") return;

            if (!collabEnabled) {
                return;
            }

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
            queueSendOps(compactedOps);
        }, { source: "all", scope: "document" });
        const removeSessionListener = collabEnabled
            ? editor.store.listen(() => {
                if (isApplyingRemoteRef.current) return;
                queueLocalAwarenessSend();
            }, { source: "all", scope: "session" })
            : null;

        // Seed CRDT record from current editor state if we haven't mirrored anything yet.
        if (collabEnabled) {
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
                    queueSendOps(seedOps);
                }
            } else {
                mirroredFieldsRef.current = current;
            }
        }

        return () => {
            removeDocumentListener();
            removeSessionListener?.();
            if (collabEnabled) {
                flushSendOpsNow();
                sendLocalAwarenessNow({ force: true });
            }
            void persistSnapshotNow({ transport: "beacon", finalizeEditing: true }).catch((error) => {
                crdtDebugLog({
                    event: "canvas_snapshot_save_error",
                    data: {
                        canvasId,
                        message: error instanceof Error ? error.message : String(error),
                    },
                });
            });
            persistCRDTStateNow({ transport: "beacon" });
        };
    }, [
        buildFieldMapFromEditor,
        canvasId,
        clientId,
        collabEnabled,
        docId,
        editor,
        flushSendOpsNow,
        persistCRDTStateNow,
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

    return {
        docId,
        collabEnabled,
        isConnected: collabEnabled ? (collab?.isConnected ?? false) : true,
        isSynced,
        remoteCollaborators,
        followedCollaboratorId,
        followCollaborator,
        handleMount,
    };
}
