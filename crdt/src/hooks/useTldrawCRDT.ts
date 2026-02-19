import { useState, useEffect, useRef, useCallback } from "react";
import { createClock, increment, receive } from "../crdt/core/lamport-clock";
import type { LamportClock } from "../crdt/core/lamport-clock";
import { createOperationId } from "../crdt/core/operations";
import type { FieldOp, RecordOp } from "../crdt/document/record";
import { getField } from "../crdt/document/record";
import {
  createDocManager,
  applyDocOperation,
  getDoc,
} from "../crdt/document/doc-manager";
import type { DocManager } from "../crdt/document/doc-manager";
import { useCRDT } from "./useCRDT";
import type { Editor } from "tldraw";

export const TLDRAW_DOC_ID = "__tldraw__";

const TL_FIELD_PREFIX = "tl:";
const DELETED_SENTINEL = "";
const OUTBOUND_FLUSH_MS = 32;

const DEBUG = false;
function log(...args: ReadonlyArray<unknown>) {
  if (DEBUG) console.log("[tldraw-crdt]", ...args);
}

interface TldrawCRDTState {
  manager: DocManager;
  clock: LamportClock;
}

interface SerializableRecord {
  id?: unknown;
  [key: string]: unknown;
}

function compactFieldOps(params: {
  ops: ReadonlyArray<FieldOp>;
}): FieldOp[] {
  const { ops } = params;
  if (ops.length <= 1) return [...ops];
  const seen = new Set<string>();
  const result: FieldOp[] = [];
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i]!;
    if (seen.has(op.fieldName)) continue;
    seen.add(op.fieldName);
    result.push(op);
  }
  result.reverse();
  return result;
}

/** Convert a tldraw record to a FieldOp for the CRDT store. */
export function tldrawRecordToFieldOp(params: {
  record: { id: string; [key: string]: unknown };
  clientId: string;
  clock: number;
}): FieldOp {
  const { record, clientId, clock } = params;
  return {
    type: "field",
    id: createOperationId({ clientId, clock }),
    fieldName: `${TL_FIELD_PREFIX}${record.id}`,
    value: JSON.stringify(record),
    timestamp: { clientId, clock },
  };
}

/** Convert a tldraw record deletion to a FieldOp with empty sentinel. */
export function tldrawDeleteToFieldOp(params: {
  recordId: string;
  clientId: string;
  clock: number;
}): FieldOp {
  const { recordId, clientId, clock } = params;
  return {
    type: "field",
    id: createOperationId({ clientId, clock }),
    fieldName: `${TL_FIELD_PREFIX}${recordId}`,
    value: DELETED_SENTINEL,
    timestamp: { clientId, clock },
  };
}

/** Extract all live tldraw records from a CRDTRecord's fields. */
export function extractTldrawRecords(params: {
  fields: ReadonlyMap<string, { value: string }>;
}): Array<{ id: string; [key: string]: unknown }> {
  const records: Array<{ id: string; [key: string]: unknown }> = [];
  for (const [fieldName, reg] of params.fields) {
    if (fieldName.startsWith(TL_FIELD_PREFIX) && reg.value !== DELETED_SENTINEL) {
      try {
        records.push(JSON.parse(reg.value) as { id: string; [key: string]: unknown });
      } catch {
        // Skip invalid JSON
      }
    }
  }
  return records;
}

export function useTldrawCRDT(params?: { docId?: string }) {
  const docId = params?.docId ?? TLDRAW_DOC_ID;
  const { clientId, sendOps, subscribeDoc, isConnected } = useCRDT();

  const stateRef = useRef<TldrawCRDTState>({
    manager: createDocManager(),
    clock: createClock({ clientId }),
  });

  // Store editor in state so useEffect can react to it
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const isApplyingRemoteRef = useRef(false);
  const [isSynced, setIsSynced] = useState(false);
  const didSyncRef = useRef(false);
  // Last document snapshot mirrored to CRDT, keyed by tl:<recordId> -> JSON value.
  const mirroredFieldsRef = useRef<Map<string, string>>(new Map());
  const pendingSendOpsRef = useRef<FieldOp[]>([]);
  const flushSendTimerRef = useRef<number | null>(null);
  const pendingRemoteOpsRef = useRef<RecordOp[]>([]);
  const flushRemoteTimerRef = useRef<number | null>(null);

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

  // Reset sync status when switching docs.
  useEffect(() => {
    didSyncRef.current = false;
    setIsSynced(false);
    mirroredFieldsRef.current = new Map();
    pendingSendOpsRef.current = [];
    pendingRemoteOpsRef.current = [];
    if (flushSendTimerRef.current !== null) {
      clearTimeout(flushSendTimerRef.current);
      flushSendTimerRef.current = null;
    }
    if (flushRemoteTimerRef.current !== null) {
      cancelNextFrame(flushRemoteTimerRef.current);
      flushRemoteTimerRef.current = null;
    }
  }, [docId, cancelNextFrame]);

  const flushSendOpsNow = useCallback(() => {
    if (flushSendTimerRef.current !== null) {
      clearTimeout(flushSendTimerRef.current);
      flushSendTimerRef.current = null;
    }
    if (pendingSendOpsRef.current.length === 0) return;
    const compacted = compactFieldOps({ ops: pendingSendOpsRef.current });
    pendingSendOpsRef.current = [];
    sendOps({ docId, ops: compacted });
  }, [docId, sendOps]);

  const queueSendOps = useCallback((ops: ReadonlyArray<FieldOp>) => {
    if (ops.length === 0) return;
    pendingSendOpsRef.current.push(...ops);
    if (flushSendTimerRef.current !== null) return;
    flushSendTimerRef.current = setTimeout(() => {
      flushSendTimerRef.current = null;
      flushSendOpsNow();
    }, OUTBOUND_FLUSH_MS) as unknown as number;
  }, [flushSendOpsNow]);

  useEffect(() => {
    return () => {
      if (flushSendTimerRef.current !== null) {
        clearTimeout(flushSendTimerRef.current);
        flushSendTimerRef.current = null;
      }
      if (flushRemoteTimerRef.current !== null) {
        cancelNextFrame(flushRemoteTimerRef.current);
        flushRemoteTimerRef.current = null;
      }
    };
  }, [docId]);

  /** Build tl:<id> -> JSON map from the current editor's document-scoped records. */
  const buildFieldMapFromEditor = useCallback((ed: Editor): Map<string, string> => {
    const next = new Map<string, string>();
    const snapshot = ed.store.serialize("document") as unknown as Record<string, SerializableRecord>;
    for (const record of Object.values(snapshot)) {
      const recordId = record.id;
      if (typeof recordId !== "string") continue;
      try {
        next.set(`${TL_FIELD_PREFIX}${recordId}`, JSON.stringify(record));
      } catch {
        // Skip non-serializable records
      }
    }
    return next;
  }, []);

  /** Build tl:<id> -> JSON map from the CRDT manager state. */
  const buildFieldMapFromManager = useCallback((manager: DocManager): Map<string, string> => {
    const next = new Map<string, string>();
    const record = getDoc({ manager, docId });
    if (!record) return next;
    for (const [fieldName, reg] of record.fields) {
      if (!fieldName.startsWith(TL_FIELD_PREFIX)) continue;
      if (reg.value === DELETED_SENTINEL) continue;
      next.set(fieldName, reg.value);
    }
    return next;
  }, [docId]);

  const refreshMirroredFieldsFromManager = useCallback((manager: DocManager) => {
    mirroredFieldsRef.current = buildFieldMapFromManager(manager);
  }, [buildFieldMapFromManager]);

  /** Restore the full tldraw document snapshot from CRDT state into the editor. */
  const restoreEditorFromState = useCallback(
    (manager?: DocManager) => {
      const ed = editorRef.current;
      if (!ed) {
        log("restoreEditorFromState: no editor ref yet");
        return;
      }

      const currentManager = manager ?? stateRef.current.manager;
      const record = getDoc({ manager: currentManager, docId });
      if (!record) {
        log("restoreEditorFromState: no record for docId", docId);
        mirroredFieldsRef.current = new Map();
        return;
      }

      const records = extractTldrawRecords({ fields: record.fields });
      log("restoreEditorFromState:", records.length, "records");

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
    },
    [docId, refreshMirroredFieldsFromManager],
  );

  // handleMount just stores the editor — listener setup is in useEffect
  const handleMount = useCallback((ed: Editor) => {
    log("handleMount: editor ready, clientId =", clientId);
    editorRef.current = ed;
    setEditor(ed);
    // If sync/ops arrived before mount, replay full CRDT state now.
    restoreEditorFromState();
    if (didSyncRef.current) {
      setIsSynced(true);
    }
  }, [clientId, restoreEditorFromState]);

  /** Apply ops to local CRDT state synchronously and update stateRef + setState. */
  const applyOpsToState = useCallback(
    (ops: ReadonlyArray<RecordOp>): DocManager => {
      let { manager, clock } = stateRef.current;

      for (const op of ops) {
        manager = applyDocOperation({ manager, docId, op });
        if ("id" in op && op.id && typeof op.id.clock === "number") {
          clock = receive({ clock, remoteCounter: op.id.clock });
        }
      }

      stateRef.current = { manager, clock };
      return manager;
    },
    [docId],
  );

  /** Push resolved tldraw field changes to the editor store. */
  const pushToEditor = useCallback(
    (manager: DocManager, ops: ReadonlyArray<RecordOp>) => {
      const ed = editorRef.current;
      if (!ed) {
        log("pushToEditor: no editor ref yet, skipping");
        return;
      }

      const record = getDoc({ manager, docId });
      if (!record) {
        log("pushToEditor: no record for docId", docId);
        return;
      }

      const toPut: Array<Record<string, unknown>> = [];
      const toRemove: string[] = [];

      for (const op of ops) {
        if (op.type !== "field") continue;
        const fieldOp = op as FieldOp;
        if (!fieldOp.fieldName.startsWith(TL_FIELD_PREFIX)) continue;

        const resolvedValue = getField({ record, fieldName: fieldOp.fieldName });
        if (resolvedValue === undefined || resolvedValue === DELETED_SENTINEL) {
          const recordId = fieldOp.fieldName.slice(TL_FIELD_PREFIX.length);
          toRemove.push(recordId);
          mirroredFieldsRef.current.delete(fieldOp.fieldName);
        } else {
          mirroredFieldsRef.current.set(fieldOp.fieldName, resolvedValue);
          try {
            toPut.push(JSON.parse(resolvedValue) as Record<string, unknown>);
          } catch {
            // Skip invalid JSON
          }
        }
      }

      log("pushToEditor:", { toPut: toPut.length, toRemove: toRemove.length });

      if (toPut.length > 0 || toRemove.length > 0) {
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
          log("pushToEditor: done");
        } catch (err) {
          log("pushToEditor: ERROR", err);
        } finally {
          isApplyingRemoteRef.current = false;
        }
      }
    },
    [docId],
  );

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
  }, [applyOpsToState, pushToEditor, cancelNextFrame]);

  const queueRemoteOps = useCallback((ops: ReadonlyArray<RecordOp>) => {
    if (ops.length === 0) return;
    pendingRemoteOpsRef.current.push(...ops);
    if (flushRemoteTimerRef.current !== null) return;
    flushRemoteTimerRef.current = scheduleNextFrame(() => {
      flushRemoteTimerRef.current = null;
      flushRemoteOpsNow();
    });
  }, [flushRemoteOpsNow, scheduleNextFrame]);

  // Handle remote ops
  const handleOps = useCallback(
    ({ ops }: { docId: string; ops: ReadonlyArray<RecordOp> }) => {
      log("handleOps: received", ops.length, "ops");
      queueRemoteOps(ops);
    },
    [queueRemoteOps],
  );

  // Handle sync completion
  const handleSyncComplete = useCallback(
    () => {
      log("handleSyncComplete called");
      flushRemoteOpsNow();
      didSyncRef.current = true;
      restoreEditorFromState();

      setIsSynced(true);
    },
    [flushRemoteOpsNow, restoreEditorFromState],
  );

  // Subscribe to the tldraw doc on the server
  useEffect(() => {
    log("useEffect[subscribe]: subscribing to", docId);
    const unsub = subscribeDoc({
      docId,
      onOps: handleOps,
      onSyncComplete: handleSyncComplete,
    });
    return () => {
      log("useEffect[subscribe]: unsubscribing from", docId);
      unsub();
    };
  }, [subscribeDoc, docId, handleOps, handleSyncComplete]);

  // Set up the store listener in a useEffect so it survives React lifecycle
  useEffect(() => {
    if (!editor) {
      log("useEffect[listener]: no editor yet, waiting...");
      return;
    }

    log("useEffect[listener]: setting up store listener, clientId =", clientId);

    const removeListener = editor.store.listen(
      (entry) => {
        log("store.listen FIRED:", {
          source: entry.source,
          added: Object.keys(entry.changes.added).length,
          updated: Object.keys(entry.changes.updated).length,
          removed: Object.keys(entry.changes.removed).length,
          isApplyingRemote: isApplyingRemoteRef.current,
        });

        if (isApplyingRemoteRef.current) {
          log("store.listen: skipping (isApplyingRemote)");
          return;
        }
        // Ignore explicit remote-origin store events.
        if (entry.source === "remote") {
          log("store.listen: skipping (remote source)");
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
          const { clock: nextClock, timestamp } = increment({ clock: stateRef.current.clock });
          stateRef.current = { ...stateRef.current, clock: nextClock };
          ops.push({
            type: "field",
            id: createOperationId({ clientId, clock: timestamp.clock }),
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
          const { clock: nextClock, timestamp } = increment({ clock: stateRef.current.clock });
          stateRef.current = { ...stateRef.current, clock: nextClock };
          ops.push({
            type: "field",
            id: createOperationId({ clientId, clock: timestamp.clock }),
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
          const { clock: nextClock, timestamp } = increment({ clock: stateRef.current.clock });
          stateRef.current = { ...stateRef.current, clock: nextClock };
          ops.push({
            type: "field",
            id: createOperationId({ clientId, clock: timestamp.clock }),
            fieldName,
            value: DELETED_SENTINEL,
            timestamp,
          });
          mirrored.delete(fieldName);
        }

        const compactedOps = compactFieldOps({ ops });
        if (compactedOps.length === 0) {
          log("store.listen: 0 ops generated");
          return;
        }

        log("store.listen: generated", compactedOps.length, "ops, sending...");

        // Apply locally
        let { manager } = stateRef.current;
        for (const op of compactedOps) {
          manager = applyDocOperation({ manager, docId, op });
        }
        stateRef.current = { ...stateRef.current, manager };

        // Send over WebSocket (batched to next frame)
        queueSendOps(compactedOps);
      },
      { source: "all", scope: "document" },
    );

    // Seed CRDT with current document snapshot if it's currently empty for this doc.
    // This captures base document/page records that may exist before listener registration.
    const seedCurrent = () => {
      const current = buildFieldMapFromEditor(editor);
      const previous = mirroredFieldsRef.current;
      if (current.size === 0 || previous.size > 0) {
        mirroredFieldsRef.current = current;
        return;
      }

      const seedOps: FieldOp[] = [];
      for (const [fieldName, value] of current) {
        const { clock: nextClock, timestamp } = increment({ clock: stateRef.current.clock });
        stateRef.current = { ...stateRef.current, clock: nextClock };
        seedOps.push({
          type: "field",
          id: createOperationId({ clientId, clock: timestamp.clock }),
          fieldName,
          value,
          timestamp,
        });
      }

      if (seedOps.length === 0) {
        mirroredFieldsRef.current = current;
        return;
      }

      log("useEffect[listener]: seeding", seedOps.length, "base records");
      mirroredFieldsRef.current = current;

      let { manager } = stateRef.current;
      for (const op of seedOps) {
        manager = applyDocOperation({ manager, docId, op });
      }
      stateRef.current = { ...stateRef.current, manager };
      queueSendOps(seedOps);
    };
    seedCurrent();

    log("useEffect[listener]: listener registered");

    return () => {
      log("useEffect[listener]: removing listener");
      flushSendOpsNow();
      removeListener();
    };
  }, [editor, clientId, docId, sendOps, buildFieldMapFromEditor, queueSendOps, flushSendOpsNow]);

  return {
    handleMount,
    isConnected,
    isSynced,
  };
}
