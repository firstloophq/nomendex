import { describe, expect, it } from "bun:test";
import {
  createUndoManager,
  trackOperation,
  trackOperations,
  undo,
  redo,
  canUndo,
  canRedo,
} from "@/crdt/core/undo-manager";
import {
  createEmptyDocument,
  applyOperation,
  getDocumentText,
} from "@/crdt/core/apply-operations";
import {
  createInsertOp,
  createDeleteOp,
  createDeleteBatchOp,
  createFormatOp,
  createOperationId,
} from "@/crdt/core/operations";
import { getItemById } from "@/crdt/core/item";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

describe("UndoManager", () => {
  describe("basic undo/redo", () => {
    it("undoes an insert (produces a delete)", () => {
      const clientId = "A";
      let um = createUndoManager({ clientId, captureTimeoutMs: 0 });
      let doc = createEmptyDocument();

      const insertOp = createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "text", value: "h" },
      });
      doc = applyOperation({ doc, op: insertOp });
      um = trackOperation({ um, op: insertOp, timestamp: 0 });

      expect(getDocumentText({ doc })).toBe("h");
      expect(canUndo({ um })).toBe(true);

      const undoResult = undo({ um, doc, nextClock: 2 });
      if (!undoResult) throw new Error("undo returned null");
      um = undoResult.um;

      // Apply the inverse ops
      for (const op of undoResult.ops) {
        doc = applyOperation({ doc, op });
      }
      expect(getDocumentText({ doc })).toBe("");
    });

    it("redoes an undone insert", () => {
      const clientId = "A";
      let um = createUndoManager({ clientId, captureTimeoutMs: 0 });
      let doc = createEmptyDocument();

      const insertOp = createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "text", value: "h" },
      });
      doc = applyOperation({ doc, op: insertOp });
      um = trackOperation({ um, op: insertOp, timestamp: 0 });

      // Undo
      const undoResult = undo({ um, doc, nextClock: 2 });
      if (!undoResult) throw new Error("undo returned null");
      um = undoResult.um;
      for (const op of undoResult.ops) {
        doc = applyOperation({ doc, op });
      }
      expect(getDocumentText({ doc })).toBe("");

      // Redo
      expect(canRedo({ um })).toBe(true);
      const redoResult = redo({ um, doc, nextClock: 3 });
      if (!redoResult) throw new Error("redo returned null");
      um = redoResult.um;
      for (const op of redoResult.ops) {
        doc = applyOperation({ doc, op });
      }
      expect(getDocumentText({ doc })).toBe("h");
    });

    it("undoes a delete (re-inserts the item)", () => {
      const clientId = "A";
      let um = createUndoManager({ clientId, captureTimeoutMs: 0 });
      let doc = createEmptyDocument();

      // Insert "h"
      const insertOp = createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "text", value: "h" },
      });
      doc = applyOperation({ doc, op: insertOp });
      // Don't track the insert — simulate it being a pre-existing character

      // Delete "h"
      const deleteOp = createDeleteOp({
        id: makeId("A", 2),
        targetId: makeId("A", 1),
      });
      doc = applyOperation({ doc, op: deleteOp });
      um = trackOperation({ um, op: deleteOp, timestamp: 100 });
      expect(getDocumentText({ doc })).toBe("");

      // Undo the delete → "h" should reappear
      const undoResult = undo({ um, doc, nextClock: 3 });
      if (!undoResult) throw new Error("undo returned null");
      um = undoResult.um;
      for (const op of undoResult.ops) {
        doc = applyOperation({ doc, op });
      }
      expect(getDocumentText({ doc })).toBe("h");
    });

    it("undoes a delete_batch by reinserting deleted content", () => {
      const clientId = "A";
      let um = createUndoManager({ clientId, captureTimeoutMs: 0 });
      let doc = createEmptyDocument();

      const insertA = createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "text", value: "a" },
      });
      const insertB = createInsertOp({
        id: makeId("A", 2),
        parentId: makeId("A", 1),
        side: "right",
        content: { type: "text", value: "b" },
      });
      doc = applyOperation({ doc, op: insertA });
      doc = applyOperation({ doc, op: insertB });
      expect(getDocumentText({ doc })).toBe("ab");

      const deleteBatchOp = createDeleteBatchOp({
        id: makeId("A", 3),
        targetIds: [makeId("A", 1), makeId("A", 2)],
      });
      doc = applyOperation({ doc, op: deleteBatchOp });
      um = trackOperation({ um, op: deleteBatchOp, timestamp: 100 });
      expect(getDocumentText({ doc })).toBe("");

      const undoResult = undo({ um, doc, nextClock: 4 });
      if (!undoResult) throw new Error("undo returned null");
      for (const op of undoResult.ops) {
        doc = applyOperation({ doc, op });
      }
      expect(getDocumentText({ doc })).toBe("ab");
    });
  });

  describe("only tracks local client", () => {
    it("only undoes local operations, not remote", () => {
      const clientId = "A";
      let um = createUndoManager({ clientId, captureTimeoutMs: 0 });
      let doc = createEmptyDocument();

      // Local insert
      const localOp = createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "text", value: "a" },
      });
      doc = applyOperation({ doc, op: localOp });
      um = trackOperation({ um, op: localOp, timestamp: 0 });

      // Remote insert (from client B — should not be tracked)
      const remoteOp = createInsertOp({
        id: makeId("B", 1),
        parentId: null,
        side: "right",
        content: { type: "text", value: "b" },
      });
      doc = applyOperation({ doc, op: remoteOp });
      // Not tracked in undo manager

      // Undo should only undo A's insert, leaving B's
      const undoResult = undo({ um, doc, nextClock: 2 });
      if (!undoResult) throw new Error("undo returned null");
      for (const op of undoResult.ops) {
        doc = applyOperation({ doc, op });
      }

      expect(getDocumentText({ doc })).toBe("b");
    });
  });

  describe("batching", () => {
    it("groups rapid operations into one undo batch", () => {
      const clientId = "A";
      let um = createUndoManager({ clientId, captureTimeoutMs: 500 });
      let doc = createEmptyDocument();

      // Type "hi" rapidly (within 500ms)
      const op1 = createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "text", value: "h" },
      });
      const op2 = createInsertOp({
        id: makeId("A", 2),
        parentId: makeId("A", 1),
        side: "right",
        content: { type: "text", value: "i" },
      });
      doc = applyOperation({ doc, op: op1 });
      um = trackOperation({ um, op: op1, timestamp: 100 });
      doc = applyOperation({ doc, op: op2 });
      um = trackOperation({ um, op: op2, timestamp: 200 });

      expect(getDocumentText({ doc })).toBe("hi");

      // Single undo should remove both
      const undoResult = undo({ um, doc, nextClock: 3 });
      if (!undoResult) throw new Error("undo returned null");
      for (const op of undoResult.ops) {
        doc = applyOperation({ doc, op });
      }
      expect(getDocumentText({ doc })).toBe("");
    });

    it("separates operations with time gap into different batches", () => {
      const clientId = "A";
      let um = createUndoManager({ clientId, captureTimeoutMs: 500 });
      let doc = createEmptyDocument();

      const op1 = createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "text", value: "a" },
      });
      doc = applyOperation({ doc, op: op1 });
      um = trackOperation({ um, op: op1, timestamp: 100 });

      // 1 second later
      const op2 = createInsertOp({
        id: makeId("A", 2),
        parentId: makeId("A", 1),
        side: "right",
        content: { type: "text", value: "b" },
      });
      doc = applyOperation({ doc, op: op2 });
      um = trackOperation({ um, op: op2, timestamp: 1100 });

      expect(getDocumentText({ doc })).toBe("ab");

      // First undo: removes "b"
      const r1 = undo({ um, doc, nextClock: 3 });
      if (!r1) throw new Error("undo returned null");
      um = r1.um;
      for (const op of r1.ops) {
        doc = applyOperation({ doc, op });
      }
      expect(getDocumentText({ doc })).toBe("a");

      // Second undo: removes "a"
      const r2 = undo({ um, doc, nextClock: 4 });
      if (!r2) throw new Error("undo returned null");
      for (const op of r2.ops) {
        doc = applyOperation({ doc, op });
      }
      expect(getDocumentText({ doc })).toBe("");
    });

    it("tracks large local op arrays in one batch", () => {
      const clientId = "A";
      let um = createUndoManager({ clientId, captureTimeoutMs: 500 });

      const ops = Array.from({ length: 500 }, (_, index) =>
        createInsertOp({
          id: makeId("A", index + 1),
          parentId: null,
          side: "right",
          content: { type: "text", value: "x" },
        })
      );

      um = trackOperations({
        um,
        ops,
        timestamp: 100,
      });

      expect(um.undoStack.length).toBe(1);
      expect(um.undoStack[0]?.ops.length).toBe(500);
    });

    it("ignores remote ops when tracking bulk arrays", () => {
      const clientId = "A";
      let um = createUndoManager({ clientId, captureTimeoutMs: 500 });
      const localOp = createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "text", value: "a" },
      });
      const remoteOp = createInsertOp({
        id: makeId("B", 1),
        parentId: null,
        side: "right",
        content: { type: "text", value: "b" },
      });

      um = trackOperations({
        um,
        ops: [localOp, remoteOp],
        timestamp: 100,
      });

      expect(um.undoStack.length).toBe(1);
      expect(um.undoStack[0]?.ops.length).toBe(1);
      expect(um.undoStack[0]?.ops[0]?.id.clientId).toBe("A");
    });
  });

  describe("stack bounds", () => {
    it("respects max depth", () => {
      const clientId = "A";
      let um = createUndoManager({
        clientId,
        captureTimeoutMs: 0,
        maxStackDepth: 3,
      });
      let doc = createEmptyDocument();

      // Create 5 batches
      for (let i = 1; i <= 5; i++) {
        const op = createInsertOp({
          id: makeId("A", i),
          parentId: i > 1 ? makeId("A", i - 1) : null,
          side: "right",
          content: { type: "text", value: String(i) },
        });
        doc = applyOperation({ doc, op });
        um = trackOperation({ um, op, timestamp: i * 1000 });
      }

      // Should only be able to undo 3 times (oldest 2 batches dropped)
      let undoCount = 0;
      let result = undo({ um, doc, nextClock: 10 });
      while (result) {
        undoCount++;
        um = result.um;
        for (const op of result.ops) {
          doc = applyOperation({ doc, op });
        }
        result = undo({ um, doc, nextClock: 10 + undoCount });
      }
      expect(undoCount).toBe(3);
    });
  });

  describe("format undo/redo", () => {
    it("undoes a format add (produces a format remove)", () => {
      const clientId = "A";
      let um = createUndoManager({ clientId, captureTimeoutMs: 0 });
      let doc = createEmptyDocument();

      // Insert a character
      const insertOp = createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "text", value: "x" },
      });
      doc = applyOperation({ doc, op: insertOp });

      // Format it bold
      const formatOp = createFormatOp({
        id: makeId("A", 2),
        targetId: makeId("A", 1),
        mark: { type: "bold" },
        action: "add",
      });
      doc = applyOperation({ doc, op: formatOp });
      um = trackOperation({ um, op: formatOp, timestamp: 100 });

      // Item should have bold mark
      const itemBefore = getItemById({ store: doc.store, id: makeId("A", 1) });
      expect(itemBefore?.marks?.some((m) => m.type === "bold")).toBe(true);

      // Undo the format
      const undoResult = undo({ um, doc, nextClock: 3 });
      if (!undoResult) throw new Error("undo returned null");
      um = undoResult.um;
      for (const op of undoResult.ops) {
        doc = applyOperation({ doc, op });
      }

      // Bold mark should be removed
      const itemAfter = getItemById({ store: doc.store, id: makeId("A", 1) });
      expect(itemAfter?.marks?.some((m) => m.type === "bold")).toBeFalsy();

      // Redo the format
      const redoResult = redo({ um, doc, nextClock: 4 });
      if (!redoResult) throw new Error("redo returned null");
      for (const op of redoResult.ops) {
        doc = applyOperation({ doc, op });
      }

      // Bold mark should be back
      const itemRedone = getItemById({ store: doc.store, id: makeId("A", 1) });
      expect(itemRedone?.marks?.some((m) => m.type === "bold")).toBe(true);
    });
  });

  describe("canUndo / canRedo", () => {
    it("returns false on empty manager", () => {
      const um = createUndoManager({ clientId: "A", captureTimeoutMs: 0 });
      expect(canUndo({ um })).toBe(false);
      expect(canRedo({ um })).toBe(false);
    });
  });
});
