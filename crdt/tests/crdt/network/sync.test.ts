import { describe, expect, it } from "bun:test";
import {
  createSyncEngine,
  generateSyncStep1,
  receiveSyncStep1,
  receiveSyncStep2,
  fullSync,
  type SyncEngine,
} from "@/crdt/network/sync";
import {
  createEmptyDocument,
  applyOperation,
  applyOperations,
  getDocumentText,
} from "@/crdt/core/apply-operations";
import {
  createInsertOp,
  createDeleteOp,
  createOperationId,
} from "@/crdt/core/operations";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

describe("Sync Protocol", () => {
  describe("generateSyncStep1", () => {
    it("generates a message with the state vector", () => {
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

      const engine = createSyncEngine({ doc });
      const msg = generateSyncStep1({ engine });
      expect(msg.type).toBe("sync-step-1");
      expect(msg.stateVector).toBeDefined();
    });
  });

  describe("two docs sync to identical state", () => {
    it("syncs divergent edits", () => {
      // Doc A has "hello"
      let docA = createEmptyDocument();
      const opsA = [
        createInsertOp({ id: makeId("A", 1), parentId: null, side: "right", content: { type: "text", value: "h" } }),
        createInsertOp({ id: makeId("A", 2), parentId: makeId("A", 1), side: "right", content: { type: "text", value: "e" } }),
        createInsertOp({ id: makeId("A", 3), parentId: makeId("A", 2), side: "right", content: { type: "text", value: "l" } }),
        createInsertOp({ id: makeId("A", 4), parentId: makeId("A", 3), side: "right", content: { type: "text", value: "l" } }),
        createInsertOp({ id: makeId("A", 5), parentId: makeId("A", 4), side: "right", content: { type: "text", value: "o" } }),
      ];
      docA = applyOperations({ doc: docA, ops: opsA });

      // Doc B has "world"
      let docB = createEmptyDocument();
      const opsB = [
        createInsertOp({ id: makeId("B", 1), parentId: null, side: "right", content: { type: "text", value: "w" } }),
        createInsertOp({ id: makeId("B", 2), parentId: makeId("B", 1), side: "right", content: { type: "text", value: "o" } }),
        createInsertOp({ id: makeId("B", 3), parentId: makeId("B", 2), side: "right", content: { type: "text", value: "r" } }),
        createInsertOp({ id: makeId("B", 4), parentId: makeId("B", 3), side: "right", content: { type: "text", value: "l" } }),
        createInsertOp({ id: makeId("B", 5), parentId: makeId("B", 4), side: "right", content: { type: "text", value: "d" } }),
      ];
      docB = applyOperations({ doc: docB, ops: opsB });

      expect(getDocumentText({ doc: docA })).toBe("hello");
      expect(getDocumentText({ doc: docB })).toBe("world");

      // Full bidirectional sync
      const result = fullSync({
        docA,
        opsA,
        docB,
        opsB,
      });

      expect(getDocumentText({ doc: result.docA })).toBe(
        getDocumentText({ doc: result.docB })
      );
    });
  });

  describe("sync is idempotent", () => {
    it("syncing again produces no new changes", () => {
      let docA = createEmptyDocument();
      const opsA = [
        createInsertOp({ id: makeId("A", 1), parentId: null, side: "right", content: { type: "text", value: "x" } }),
      ];
      docA = applyOperations({ doc: docA, ops: opsA });

      let docB = createEmptyDocument();
      const opsB = [
        createInsertOp({ id: makeId("B", 1), parentId: null, side: "right", content: { type: "text", value: "y" } }),
      ];
      docB = applyOperations({ doc: docB, ops: opsB });

      // First sync
      const r1 = fullSync({ docA, opsA, docB, opsB });

      // Second sync — should produce same state
      const r2 = fullSync({
        docA: r1.docA,
        opsA: [...opsA, ...opsB],
        docB: r1.docB,
        opsB: [...opsB, ...opsA],
      });

      expect(getDocumentText({ doc: r2.docA })).toBe(
        getDocumentText({ doc: r1.docA })
      );
      expect(getDocumentText({ doc: r2.docB })).toBe(
        getDocumentText({ doc: r1.docB })
      );
    });
  });

  describe("one-way sync", () => {
    it("syncing A → B gives B all of A's changes", () => {
      let docA = createEmptyDocument();
      const opsA = [
        createInsertOp({ id: makeId("A", 1), parentId: null, side: "right", content: { type: "text", value: "a" } }),
        createInsertOp({ id: makeId("A", 2), parentId: makeId("A", 1), side: "right", content: { type: "text", value: "b" } }),
      ];
      docA = applyOperations({ doc: docA, ops: opsA });

      const docB = createEmptyDocument();

      const engineA = createSyncEngine({ doc: docA });
      const engineB = createSyncEngine({ doc: docB });

      // B asks A what it has
      const step1 = generateSyncStep1({ engine: engineB });

      // A computes what B is missing
      const step2 = receiveSyncStep1({
        engine: engineA,
        message: step1,
        allOps: opsA,
      });

      // B applies the missing ops
      const result = receiveSyncStep2({
        doc: docB,
        message: step2,
      });

      expect(getDocumentText({ doc: result.doc })).toBe("ab");
    });
  });

  describe("large document sync", () => {
    it("syncs 1000+ ops correctly", () => {
      let docA = createEmptyDocument();
      const opsA = [];
      for (let i = 1; i <= 500; i++) {
        const op = createInsertOp({
          id: makeId("A", i),
          parentId: i > 1 ? makeId("A", i - 1) : null,
          side: "right",
          content: { type: "text", value: String.fromCharCode(97 + (i % 26)) },
        });
        opsA.push(op);
      }
      docA = applyOperations({ doc: docA, ops: opsA });

      let docB = createEmptyDocument();
      const opsB = [];
      for (let i = 1; i <= 500; i++) {
        const op = createInsertOp({
          id: makeId("B", i),
          parentId: i > 1 ? makeId("B", i - 1) : null,
          side: "right",
          content: { type: "text", value: String.fromCharCode(65 + (i % 26)) },
        });
        opsB.push(op);
      }
      docB = applyOperations({ doc: docB, ops: opsB });

      const result = fullSync({ docA, opsA, docB, opsB });

      expect(getDocumentText({ doc: result.docA })).toBe(
        getDocumentText({ doc: result.docB })
      );
      // Should have all 1000 characters
      expect(getDocumentText({ doc: result.docA }).length).toBe(1000);
    });
  });
});
