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
} from "@crdt/lib";
import type { Editor } from "tldraw";
import {
    getDefaultUserPresence,
    InstancePresenceRecordType,
    type TLPageId,
    type TLShapeId,
    type TLStore,
} from "@tldraw/tlschema";
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

interface RemotePresenceEntry {
    recordId: string;
    lastUpdated: number;
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

export function useCanvasCRDT(params: { canvasId: string; forceLocal?: boolean }) {
    const { canvasId, forceLocal = false } = params;
    const collab = useCollab();
    const { activeWorkspace } = useWorkspaceSwitcher();
    const collabScope = useMemo(
        () => getWorkspaceCollabScope({ activeWorkspace }),
        [activeWorkspace]
    );
    const docId = useMemo(
        () => buildCanvasDocId({ scope: collabScope, canvasId }),
        [collabScope, canvasId]
    );

    const collabEnabled = !forceLocal
        && activeWorkspace?.teamMode === "team"
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
    const didSyncRef = useRef(false);
    const isApplyingRemoteRef = useRef(false);
    const didHydrateLocalRef = useRef(false);
    const lastPersistedSnapshotRef = useRef<string | null>(null);
    const localSaveTimerRef = useRef<number | null>(null);

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

    const clearRemotePresenceRecords = useCallback(() => {
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
    }, []);

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
    }, []);

    const pruneStaleRemotePresence = useCallback(() => {
        const ed = editorRef.current;
        if (!ed) return;
        if (remotePresenceRef.current.size === 0) return;

        const now = Date.now();
        const staleRecordIds: string[] = [];
        for (const [remoteClientId, entry] of remotePresenceRef.current) {
            if (now - entry.lastUpdated <= AWARENESS_STALE_MS) continue;
            staleRecordIds.push(entry.recordId);
            remotePresenceRef.current.delete(remoteClientId);
        }

        if (staleRecordIds.length === 0) return;
        ed.store.mergeRemoteChanges(() => {
            ed.store.remove(staleRecordIds as Parameters<typeof ed.store.remove>[0]);
        });
    }, []);

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

    const queueLocalSnapshotPersist = useCallback(() => {
        if (localSaveTimerRef.current !== null) {
            clearTimeout(localSaveTimerRef.current);
        }
        localSaveTimerRef.current = setTimeout(async () => {
            localSaveTimerRef.current = null;
            const ed = editorRef.current;
            if (!ed || collabEnabled) return;
            try {
                const snapshotObject = ed.store.serialize("document");
                const snapshot = JSON.stringify(snapshotObject);
                if (lastPersistedSnapshotRef.current === snapshot) return;
                await canvasAPI.saveSnapshot({ canvasId, snapshot });
                lastPersistedSnapshotRef.current = snapshot;
            } catch (error) {
                crdtDebugLog({
                    event: "canvas_local_snapshot_save_error",
                    data: {
                        canvasId,
                        message: error instanceof Error ? error.message : String(error),
                    },
                });
            }
        }, LOCAL_SAVE_DEBOUNCE_MS) as unknown as number;
    }, [canvasId, collabEnabled]);

    const handleRemoteOps = useCallback((incoming: {
        docId: string;
        ops: ReadonlyArray<RecordOp>;
    }) => {
        queueRemoteOps(incoming.ops);
    }, [queueRemoteOps]);

    const handleSyncComplete = useCallback(() => {
        flushRemoteOpsNow();
        didSyncRef.current = true;
        restoreEditorFromState();
        sendLocalAwarenessNow({ force: true });
        setIsSynced(true);
    }, [flushRemoteOpsNow, restoreEditorFromState, sendLocalAwarenessNow]);

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
        }
    }, [clientId, collab, collabEnabled, restoreEditorFromState, sendLocalAwarenessNow]);

    // Reset local state when switching canvases/modes.
    useEffect(() => {
        didSyncRef.current = false;
        didHydrateLocalRef.current = false;
        lastPersistedSnapshotRef.current = null;
        lastAwarenessSignatureRef.current = null;
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
    }, [canvasId, cancelNextFrame, clearRemotePresenceRecords, clientId, collabEnabled]);

    // Subscribe to team-mode collab document.
    useEffect(() => {
        if (!collabEnabled || !collab?.subscribeDoc) return undefined;
        const unsubscribe = collab.subscribeDoc({
            docId,
            onOps: handleRemoteOps,
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

    // Hydrate local snapshot in solo mode.
    useEffect(() => {
        if (!editor) return;
        if (collabEnabled) return;
        if (didHydrateLocalRef.current) return;

        let cancelled = false;
        didHydrateLocalRef.current = true;
        void (async () => {
            try {
                const result = await canvasAPI.getSnapshot({ canvasId });
                if (cancelled) return;

                if (result.snapshot) {
                    const parsed = JSON.parse(result.snapshot) as unknown;
                    const records = recordsFromSerializedSnapshot(parsed);
                    if (records.length > 0) {
                        isApplyingRemoteRef.current = true;
                        try {
                            editor.store.mergeRemoteChanges(() => {
                                editor.store.put(records as unknown as Parameters<typeof editor.store.put>[0]);
                            });
                        } finally {
                            isApplyingRemoteRef.current = false;
                        }
                    }
                    lastPersistedSnapshotRef.current = result.snapshot;
                } else {
                    const initialSnapshot = JSON.stringify(editor.store.serialize("document"));
                    lastPersistedSnapshotRef.current = initialSnapshot;
                    await canvasAPI.saveSnapshot({ canvasId, snapshot: initialSnapshot });
                }
            } catch (error) {
                crdtDebugLog({
                    event: "canvas_local_snapshot_load_error",
                    data: {
                        canvasId,
                        message: error instanceof Error ? error.message : String(error),
                    },
                });
            } finally {
                mirroredFieldsRef.current = buildFieldMapFromEditor(editor);
                setIsSynced(true);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [buildFieldMapFromEditor, canvasId, collabEnabled, editor]);

    // Register store listener.
    useEffect(() => {
        if (!editor) return undefined;

        const removeDocumentListener = editor.store.listen((entry) => {
            if (isApplyingRemoteRef.current) return;
            if (entry.source === "remote") return;

            if (!collabEnabled) {
                queueLocalSnapshotPersist();
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
            } else {
                queueLocalSnapshotPersist();
            }
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
            clearRemotePresenceRecords();
        };
    }, [cancelNextFrame, clearRemotePresenceRecords]);

    return {
        docId,
        collabEnabled,
        isConnected: collabEnabled ? (collab?.isConnected ?? false) : true,
        isSynced,
        handleMount,
    };
}
