import type { Operation, OperationId } from "./operations";
import { createInsertOp, createDeleteOp, createFormatOp, createAttrUpdateOp, createReparentOp, createOperationId } from "./operations";
import type { CRDTDoc } from "./apply-operations";
import { getItemById } from "./item";

// --- Types ---

interface UndoBatch {
  readonly ops: ReadonlyArray<Operation>;
  readonly timestamp: number;
}

export interface UndoManager {
  readonly clientId: string;
  readonly undoStack: ReadonlyArray<UndoBatch>;
  readonly redoStack: ReadonlyArray<UndoBatch>;
  readonly captureTimeoutMs: number;
  readonly maxStackDepth: number;
}

// --- Create ---

export function createUndoManager(params: {
  clientId: string;
  captureTimeoutMs: number;
  maxStackDepth?: number;
}): UndoManager {
  return {
    clientId: params.clientId,
    undoStack: [],
    redoStack: [],
    captureTimeoutMs: params.captureTimeoutMs,
    maxStackDepth: params.maxStackDepth ?? 100,
  };
}

// --- Track ---

export function trackOperation(params: {
  um: UndoManager;
  op: Operation;
  timestamp: number;
}): UndoManager {
  const { um, op, timestamp } = params;

  if (op.id.clientId !== um.clientId) return um;

  const stack = [...um.undoStack];
  const lastBatch = stack[stack.length - 1];

  if (
    lastBatch &&
    timestamp - lastBatch.timestamp <= um.captureTimeoutMs
  ) {
    stack[stack.length - 1] = {
      ops: [...lastBatch.ops, op],
      timestamp,
    };
  } else {
    stack.push({ ops: [op], timestamp });
  }

  const trimmed =
    stack.length > um.maxStackDepth
      ? stack.slice(stack.length - um.maxStackDepth)
      : stack;

  return {
    ...um,
    undoStack: trimmed,
    redoStack: [],
  };
}

// --- Shared inverse computation ---

function computeInverse(params: {
  ops: ReadonlyArray<Operation>;
  doc: CRDTDoc;
  clientId: string;
  nextClock: number;
}): { inverseOps: Array<Operation>; clockAfter: number } {
  const inverseOps: Array<Operation> = [];
  let clock = params.nextClock;

  // Process in reverse order for correct undo semantics
  for (let i = params.ops.length - 1; i >= 0; i--) {
    const op = params.ops[i]!;
    switch (op.type) {
      case "insert": {
        inverseOps.push(
          createDeleteOp({
            id: createOperationId({ clientId: params.clientId, clock: clock++ }),
            targetId: op.id,
          })
        );
        break;
      }
      case "delete": {
        const item = getItemById({ store: params.doc.store, id: op.targetId });
        if (item) {
          inverseOps.push(
            createInsertOp({
              id: createOperationId({ clientId: params.clientId, clock: clock++ }),
              parentId: item.leftOrigin,
              side: "right",
              content: item.content,
              marks: item.marks,
            })
          );
        }
        break;
      }
      case "format": {
        inverseOps.push(
          createFormatOp({
            id: createOperationId({ clientId: params.clientId, clock: clock++ }),
            targetId: op.targetId,
            mark: op.mark,
            action: op.action === "add" ? "remove" : "add",
          })
        );
        break;
      }
      case "attr_update": {
        // Use oldValue if stored on the op, otherwise look up from current doc
        let restoreValue: string | number | boolean | null;
        if (op.oldValue !== undefined) {
          restoreValue = op.oldValue;
        } else {
          // Fallback: look up current value (may not be pre-batch value, but best effort)
          const item = getItemById({ store: params.doc.store, id: op.targetId });
          restoreValue = (item && (item.content.type === "block" || item.content.type === "inline_atom"))
            ? (item.content.attrs?.[op.attr] ?? null)
            : null;
        }

        inverseOps.push(
          createAttrUpdateOp({
            id: createOperationId({ clientId: params.clientId, clock: clock++ }),
            targetId: op.targetId,
            attr: op.attr,
            value: restoreValue,
            oldValue: op.value, // the op's value becomes the "old value" for the inverse
          })
        );
        break;
      }
      case "reparent": {
        let restoreParent: OperationId | null;
        if (op.oldParentBlockId !== undefined) {
          restoreParent = op.oldParentBlockId;
        } else {
          const item = getItemById({ store: params.doc.store, id: op.targetId });
          restoreParent = (item && item.content.type === "block")
            ? (item.content.parentBlockId ?? null)
            : null;
        }

        inverseOps.push(
          createReparentOp({
            id: createOperationId({ clientId: params.clientId, clock: clock++ }),
            targetId: op.targetId,
            newParentBlockId: restoreParent,
            oldParentBlockId: op.newParentBlockId,
          })
        );
        break;
      }
    }
  }

  return { inverseOps, clockAfter: clock };
}

// --- Undo ---

export function canUndo(params: { um: UndoManager }): boolean {
  return params.um.undoStack.length > 0;
}

export function undo(params: {
  um: UndoManager;
  doc: CRDTDoc;
  nextClock: number;
}): { um: UndoManager; ops: ReadonlyArray<Operation> } | null {
  const { um, doc } = params;
  if (um.undoStack.length === 0) return null;

  const stack = [...um.undoStack];
  const batch = stack.pop()!;

  const { inverseOps } = computeInverse({
    ops: batch.ops,
    doc,
    clientId: um.clientId,
    nextClock: params.nextClock,
  });

  // Push the INVERSE ops to the redo stack. When redoing, we compute
  // the inverse of the inverse (e.g., inverse of a delete is a re-insert).
  return {
    um: {
      ...um,
      undoStack: stack,
      redoStack: [...um.redoStack, { ops: inverseOps, timestamp: Date.now() }],
    },
    ops: inverseOps,
  };
}

// --- Redo ---

export function canRedo(params: { um: UndoManager }): boolean {
  return params.um.redoStack.length > 0;
}

export function redo(params: {
  um: UndoManager;
  doc: CRDTDoc;
  nextClock: number;
}): { um: UndoManager; ops: ReadonlyArray<Operation> } | null {
  const { um, doc } = params;
  if (um.redoStack.length === 0) return null;

  const redoStack = [...um.redoStack];
  const batch = redoStack.pop()!;

  // The redo stack stores the INVERSE ops that undo applied.
  // We compute the inverse of those to produce the redo operations.
  // E.g., undo applied "delete A:1" → redo computes inverse = "insert at A:1's position"
  const { inverseOps } = computeInverse({
    ops: batch.ops,
    doc,
    clientId: um.clientId,
    nextClock: params.nextClock,
  });

  // Push the redo inverse ops to undo stack so undo can reverse the redo
  return {
    um: {
      ...um,
      undoStack: [...um.undoStack, { ops: inverseOps, timestamp: Date.now() }],
      redoStack,
    },
    ops: inverseOps,
  };
}
