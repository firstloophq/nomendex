import { describe, expect, it } from "bun:test";
import {
  applyOperation,
  applyOperations,
  getDocumentText,
  createEmptyDocument,
  getDocumentStateVector,
  type CRDTDoc,
} from "@/crdt/core/apply-operations";
import {
  createInsertOp,
  createDeleteOp,
  createDeleteBatchOp,
  createFormatOp,
  createOperationId,
  type Operation,
} from "@/crdt/core/operations";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

describe("applyOperation", () => {
  describe("insert operations", () => {
    it("inserts a single character into empty doc", () => {
      let doc = createEmptyDocument();
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 1),
          parentId: null,
          side: "right",
          content: { type: "text", value: "h" },
        }),
      });
      expect(getDocumentText({ doc })).toBe("h");
    });

    it("inserts sequential characters", () => {
      let doc = createEmptyDocument();
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 1),
          parentId: null,
          side: "right",
          content: { type: "text", value: "h" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 2),
          parentId: makeId("A", 1),
          side: "right",
          content: { type: "text", value: "i" },
        }),
      });
      expect(getDocumentText({ doc })).toBe("hi");
    });

    it("inserts at the beginning", () => {
      let doc = createEmptyDocument();
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 1),
          parentId: null,
          side: "right",
          content: { type: "text", value: "b" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 2),
          parentId: makeId("A", 1),
          side: "left",
          content: { type: "text", value: "a" },
        }),
      });
      expect(getDocumentText({ doc })).toBe("ab");
    });
  });

  describe("delete operations", () => {
    it("deletes a character", () => {
      let doc = createEmptyDocument();
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 1),
          parentId: null,
          side: "right",
          content: { type: "text", value: "a" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 2),
          parentId: makeId("A", 1),
          side: "right",
          content: { type: "text", value: "b" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 3),
          parentId: makeId("A", 2),
          side: "right",
          content: { type: "text", value: "c" },
        }),
      });
      // Delete 'b'
      doc = applyOperation({
        doc,
        op: createDeleteOp({
          id: makeId("A", 4),
          targetId: makeId("A", 2),
        }),
      });
      expect(getDocumentText({ doc })).toBe("ac");
    });
  });

  describe("format operations", () => {
    it("adds a mark to an item", () => {
      let doc = createEmptyDocument();
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 1),
          parentId: null,
          side: "right",
          content: { type: "text", value: "h" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createFormatOp({
          id: makeId("A", 2),
          targetId: makeId("A", 1),
          mark: { type: "bold" },
          action: "add",
        }),
      });
      const item = doc.store.map.get("A:1");
      expect(item).toBeDefined();
      expect(item!.marks).toContainEqual({ type: "bold" });
    });

    it("removes a mark from an item", () => {
      let doc = createEmptyDocument();
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 1),
          parentId: null,
          side: "right",
          content: { type: "text", value: "h" },
          marks: [{ type: "bold" }],
        }),
      });
      doc = applyOperation({
        doc,
        op: createFormatOp({
          id: makeId("A", 2),
          targetId: makeId("A", 1),
          mark: { type: "bold" },
          action: "remove",
        }),
      });
      const item = doc.store.map.get("A:1");
      expect(item!.marks ?? []).not.toContainEqual({ type: "bold" });
    });
  });

  describe("idempotency", () => {
    it("applying the same insert twice has no effect", () => {
      let doc = createEmptyDocument();
      const op = createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "text", value: "x" },
      });
      doc = applyOperation({ doc, op });
      doc = applyOperation({ doc, op });
      expect(getDocumentText({ doc })).toBe("x");
      expect(doc.store.length).toBe(1);
    });

    it("applying the same delete twice has no effect", () => {
      let doc = createEmptyDocument();
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 1),
          parentId: null,
          side: "right",
          content: { type: "text", value: "x" },
        }),
      });
      const delOp = createDeleteOp({
        id: makeId("A", 2),
        targetId: makeId("A", 1),
      });
      doc = applyOperation({ doc, op: delOp });
      doc = applyOperation({ doc, op: delOp });
      expect(getDocumentText({ doc })).toBe("");
    });
  });

  describe("commutativity", () => {
    it("same inserts applied in different order produce same result", () => {
      const ops: Array<Operation> = [
        createInsertOp({
          id: makeId("A", 1),
          parentId: null,
          side: "right",
          content: { type: "text", value: "a" },
        }),
        createInsertOp({
          id: makeId("B", 1),
          parentId: null,
          side: "right",
          content: { type: "text", value: "b" },
        }),
        createInsertOp({
          id: makeId("A", 2),
          parentId: makeId("A", 1),
          side: "right",
          content: { type: "text", value: "c" },
        }),
      ];

      // Apply in order
      const doc1 = applyOperations({ doc: createEmptyDocument(), ops });

      // Apply in reverse
      const doc2 = applyOperations({
        doc: createEmptyDocument(),
        ops: [...ops].reverse(),
      });

      expect(getDocumentText({ doc: doc1 })).toBe(getDocumentText({ doc: doc2 }));
    });

    it("insert then delete vs delete then insert produce same result", () => {
      const insertA = createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "text", value: "a" },
      });
      const insertB = createInsertOp({
        id: makeId("B", 1),
        parentId: null,
        side: "right",
        content: { type: "text", value: "b" },
      });
      const deleteA = createDeleteOp({
        id: makeId("B", 2),
        targetId: makeId("A", 1),
      });

      // Insert A, Insert B, Delete A
      const doc1 = applyOperations({
        doc: createEmptyDocument(),
        ops: [insertA, insertB, deleteA],
      });

      // Insert B, Delete A (before A exists), Insert A
      const doc2 = applyOperations({
        doc: createEmptyDocument(),
        ops: [insertB, deleteA, insertA],
      });

      expect(getDocumentText({ doc: doc1 })).toBe(getDocumentText({ doc: doc2 }));
    });

    it("three clients concurrent edits at same position converge", () => {
      const ops: Array<Operation> = [
        createInsertOp({
          id: makeId("A", 1),
          parentId: null,
          side: "right",
          content: { type: "text", value: "a" },
        }),
        createInsertOp({
          id: makeId("B", 1),
          parentId: null,
          side: "right",
          content: { type: "text", value: "b" },
        }),
        createInsertOp({
          id: makeId("C", 1),
          parentId: null,
          side: "right",
          content: { type: "text", value: "c" },
        }),
      ];

      // All 6 permutations should produce the same result
      const permutations = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
      ];

      const results = permutations.map((perm) =>
        getDocumentText({
          doc: applyOperations({
            doc: createEmptyDocument(),
            ops: perm.map((i) => ops[i]!),
          }),
        })
      );

      for (const result of results) {
        expect(result).toBe(results[0]!);
      }
    });
  });

  describe("batch fast paths", () => {
    it("bulk delete batch removes large content and updates state vector", () => {
      let doc = createEmptyDocument();
      const inserts: Array<Operation> = [];
      let prev: ReturnType<typeof makeId> | null = null;
      for (let i = 1; i <= 180; i++) {
        const id = makeId("A", i);
        inserts.push(createInsertOp({
          id,
          parentId: prev,
          side: "right",
          content: { type: "text", value: "x" },
        }));
        prev = id;
      }
      doc = applyOperations({ doc, ops: inserts });
      expect(getDocumentText({ doc }).length).toBe(180);

      const deletes: Array<Operation> = [];
      for (let i = 1; i <= 180; i++) {
        deletes.push(createDeleteOp({
          id: makeId("B", i),
          targetId: makeId("A", i),
        }));
      }
      doc = applyOperations({ doc, ops: deletes });

      expect(getDocumentText({ doc })).toBe("");
      expect(doc.pendingDeletes.size).toBe(0);
      expect(getDocumentStateVector({ doc }).get("B")).toBe(180);
    });

    it("bulk delete batch tracks pending deletes for missing targets", () => {
      let doc = createEmptyDocument();

      const missingDeletes: Array<Operation> = [];
      for (let i = 1; i <= 160; i++) {
        missingDeletes.push(createDeleteOp({
          id: makeId("B", i),
          targetId: makeId("Z", i),
        }));
      }

      doc = applyOperations({ doc, ops: missingDeletes });
      expect(doc.pendingDeletes.size).toBe(160);
      expect(getDocumentStateVector({ doc }).get("B")).toBe(160);

      // idempotent on replay
      const replayed = applyOperations({ doc, ops: missingDeletes });
      expect(replayed.pendingDeletes.size).toBe(160);
      expect(getDocumentStateVector({ doc: replayed }).get("B")).toBe(160);
    });

    it("single delete_batch op removes large content and updates state vector", () => {
      let doc = createEmptyDocument();
      const inserts: Array<Operation> = [];
      let prev: ReturnType<typeof makeId> | null = null;
      for (let i = 1; i <= 2200; i++) {
        const id = makeId("A", i);
        inserts.push(createInsertOp({
          id,
          parentId: prev,
          side: "right",
          content: { type: "text", value: "x" },
        }));
        prev = id;
      }
      doc = applyOperations({ doc, ops: inserts });
      expect(getDocumentText({ doc }).length).toBe(2200);

      doc = applyOperations({
        doc,
        ops: [createDeleteBatchOp({
          id: makeId("B", 1),
          targetIds: inserts.map((op) =>
            op.type === "insert" ? op.id : makeId("A", 1)
          ),
        })],
      });

      expect(getDocumentText({ doc })).toBe("");
      expect(doc.pendingDeletes.size).toBe(0);
      expect(getDocumentStateVector({ doc }).get("B")).toBe(1);
    });
  });

  describe("state vector", () => {
    it("tracks applied operations", () => {
      let doc = createEmptyDocument();
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 1),
          parentId: null,
          side: "right",
          content: { type: "text", value: "h" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 2),
          parentId: makeId("A", 1),
          side: "right",
          content: { type: "text", value: "i" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("B", 1),
          parentId: null,
          side: "right",
          content: { type: "text", value: "!" },
        }),
      });

      const sv = getDocumentStateVector({ doc });
      expect(sv.get("A")).toBe(2);
      expect(sv.get("B")).toBe(1);
    });
  });
});
