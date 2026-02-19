import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import type { Schema } from "prosemirror-model";
import type { LamportClock } from "../core/lamport-clock";
import { createClock, increment } from "../core/lamport-clock";
import { createOperationId, createInsertOp, type Operation } from "../core/operations";
import {
  createEmptyDocument,
  applyOperation,
  type CRDTDoc,
} from "../core/apply-operations";
import { transactionToCRDTOps } from "./transaction-capture";
import { crdtToProseMirror } from "./state-mapping";
import {
  createUndoManager,
  trackOperation,
  undo,
  redo,
  canUndo,
  canRedo,
  type UndoManager,
} from "../core/undo-manager";

// --- Plugin State ---

export interface CRDTPluginState {
  readonly clientId: string;
  readonly doc: CRDTDoc;
  readonly clock: LamportClock;
  readonly undoManager: UndoManager;
  readonly allOps: ReadonlyArray<Operation>;
  readonly isRemoteUpdate: boolean;
}

const CRDT_PLUGIN_KEY = new PluginKey<CRDTPluginState>("crdt");

// Meta key to mark transactions as remote updates
const REMOTE_UPDATE_META = "crdt-remote-update";
const SHARED_INITIAL_BLOCK_ID = createOperationId({
  clientId: "__crdt_init__",
  clock: 0,
});

// Store onLocalOps callbacks keyed by plugin instance
const pluginCallbacks = new WeakMap<
  Plugin<CRDTPluginState>,
  (ops: ReadonlyArray<Operation>) => void
>();

// --- Plugin Creation ---

export function createCRDTPlugin(params: {
  clientId: string;
  schema: Schema;
  onLocalOps?: (ops: ReadonlyArray<Operation>) => void;
  initialDoc?: CRDTDoc;
  captureTimeoutMs?: number;
}): Plugin<CRDTPluginState> {
  const { clientId, onLocalOps } = params;

  const plugin = new Plugin<CRDTPluginState>({
    key: CRDT_PLUGIN_KEY,

    state: {
      init(): CRDTPluginState {
        let doc = params.initialDoc ?? createEmptyDocument();
        let clock = createClock({ clientId });
        const initialOps: Array<Operation> = [];

        // Only create an initial paragraph if starting fresh (no pre-existing doc)
        if (!params.initialDoc) {
          const paragraphOp = createInsertOp({
            id: SHARED_INITIAL_BLOCK_ID,
            parentId: null,
            side: "right",
            content: { type: "block", blockType: "paragraph" },
          });
          doc = applyOperation({ doc, op: paragraphOp });
          initialOps.push(paragraphOp);
        }

        const um = createUndoManager({
          clientId,
          captureTimeoutMs: params.captureTimeoutMs ?? 500,
        });

        return {
          clientId,
          doc,
          clock,
          undoManager: um,
          allOps: initialOps,
          isRemoteUpdate: false,
        };
      },

      apply(tr: Transaction, pluginState: CRDTPluginState): CRDTPluginState {
        // If this is a remote update, the state was already set via meta
        const remoteState = tr.getMeta(REMOTE_UPDATE_META) as CRDTPluginState | undefined;
        if (remoteState) {
          return remoteState;
        }

        // If the document didn't change, no CRDT ops needed
        if (!tr.docChanged) return pluginState;

        // Convert PM transaction to CRDT operations
        const result = transactionToCRDTOps({
          crdtDoc: pluginState.doc,
          transaction: tr,
          clock: pluginState.clock,
        });

        if (result.ops.length === 0) return pluginState;

        // Apply the ops to the CRDT doc
        let newDoc = pluginState.doc;
        for (const op of result.ops) {
          newDoc = applyOperation({ doc: newDoc, op });
        }

        // Track in undo manager
        const now = Date.now();
        let um = pluginState.undoManager;
        for (const op of result.ops) {
          um = trackOperation({ um, op, timestamp: now });
        }

        // Emit local ops
        onLocalOps?.(result.ops);

        return {
          ...pluginState,
          doc: newDoc,
          clock: result.clock,
          undoManager: um,
          allOps: [...pluginState.allOps, ...result.ops],
          isRemoteUpdate: false,
        };
      },
    },
  });

  if (onLocalOps) {
    pluginCallbacks.set(plugin, onLocalOps);
  }

  return plugin;
}

// --- Public API ---

export function getCRDTState(params: {
  state: EditorState;
  plugin: Plugin<CRDTPluginState>;
}): CRDTPluginState {
  return CRDT_PLUGIN_KEY.getState(params.state)!;
}

export function applyRemoteOps(params: {
  state: EditorState;
  plugin: Plugin<CRDTPluginState>;
  ops: ReadonlyArray<Operation>;
}): { state: EditorState } {
  const { state, plugin, ops } = params;
  const currentState = getCRDTState({ state, plugin });

  // Apply remote ops to the CRDT doc
  let newDoc = currentState.doc;
  for (const op of ops) {
    newDoc = applyOperation({ doc: newDoc, op });
  }

  // Rebuild PM doc from CRDT state
  const pmDoc = crdtToProseMirror({ doc: newDoc, schema: state.schema });

  const newPluginState: CRDTPluginState = {
    ...currentState,
    doc: newDoc,
    allOps: [...currentState.allOps, ...ops],
    isRemoteUpdate: true,
  };

  const tr = state.tr.replaceWith(0, state.doc.content.size, pmDoc.content);
  tr.setMeta(REMOTE_UPDATE_META, newPluginState);

  const newState = state.apply(tr);

  return { state: newState };
}

// --- Undo/Redo Commands ---

function applyUndoRedoOps(params: {
  state: EditorState;
  plugin: Plugin<CRDTPluginState>;
  ops: ReadonlyArray<Operation>;
  newUndoManager: UndoManager;
}): { state: EditorState; ops: ReadonlyArray<Operation> } {
  const { state, plugin, ops, newUndoManager } = params;
  const pluginState = getCRDTState({ state, plugin });

  // Apply ops to the CRDT doc
  let newDoc = pluginState.doc;
  for (const op of ops) {
    newDoc = applyOperation({ doc: newDoc, op });
  }

  // Rebuild PM doc from updated CRDT state
  const pmDoc = crdtToProseMirror({ doc: newDoc, schema: state.schema });

  // Update clock counter past the new ops
  const maxClock = ops.reduce(
    (max, op) => Math.max(max, op.id.clock),
    pluginState.clock.counter,
  );

  const newPluginState: CRDTPluginState = {
    ...pluginState,
    doc: newDoc,
    clock: { ...pluginState.clock, counter: maxClock },
    undoManager: newUndoManager,
    allOps: [...pluginState.allOps, ...ops],
    isRemoteUpdate: true,
  };

  const tr = state.tr.replaceWith(0, state.doc.content.size, pmDoc.content);
  tr.setMeta(REMOTE_UPDATE_META, newPluginState);

  // Emit ops through the callback
  const callback = pluginCallbacks.get(plugin);
  callback?.(ops);

  const newState = state.apply(tr);
  return { state: newState, ops };
}

export function undoCommand(params: {
  state: EditorState;
  plugin: Plugin<CRDTPluginState>;
}): { state: EditorState; ops: ReadonlyArray<Operation> } | null {
  const { state, plugin } = params;
  const pluginState = getCRDTState({ state, plugin });

  if (!canUndo({ um: pluginState.undoManager })) return null;

  const result = undo({
    um: pluginState.undoManager,
    doc: pluginState.doc,
    nextClock: pluginState.clock.counter + 1,
  });
  if (!result) return null;

  return applyUndoRedoOps({
    state,
    plugin,
    ops: result.ops,
    newUndoManager: result.um,
  });
}

export function redoCommand(params: {
  state: EditorState;
  plugin: Plugin<CRDTPluginState>;
}): { state: EditorState; ops: ReadonlyArray<Operation> } | null {
  const { state, plugin } = params;
  const pluginState = getCRDTState({ state, plugin });

  if (!canRedo({ um: pluginState.undoManager })) return null;

  const result = redo({
    um: pluginState.undoManager,
    doc: pluginState.doc,
    nextClock: pluginState.clock.counter + 1,
  });
  if (!result) return null;

  return applyUndoRedoOps({
    state,
    plugin,
    ops: result.ops,
    newUndoManager: result.um,
  });
}
