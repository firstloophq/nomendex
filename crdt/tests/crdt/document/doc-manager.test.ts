import { describe, it, expect } from "bun:test";
import {
  createDocManager,
  getOrCreateDoc,
  applyDocOperation,
  applySnapshotToDoc,
  getDoc,
  listDocIds,
  deleteDoc,
  BOARD_DOC_ID,
} from "@/crdt/document/doc-manager";
import {
  createRecord,
  applyRecordOp,
  getField,
  getSetField,
  type FieldOp,
  type SetOp,
} from "@/crdt/document/record";
import { getColumns, getCardPosition } from "@/crdt/document/board-document";
import { createOperationId } from "@/crdt/core/operations";
import { encodeRecordSnapshot } from "@/crdt/document/snapshot";

function makeId(clientId: string, clock: number) {
  return createOperationId({ clientId, clock });
}

describe("Doc Manager", () => {
  describe("createDocManager", () => {
    it("creates an empty manager", () => {
      const mgr = createDocManager();
      expect(listDocIds({ manager: mgr })).toEqual([]);
    });
  });

  describe("getOrCreateDoc", () => {
    it("creates a new doc if not exists", () => {
      const mgr = createDocManager();
      const { manager, doc } = getOrCreateDoc({ manager: mgr, docId: "card-1" });
      expect(doc).toBeDefined();
      expect(listDocIds({ manager })).toEqual(["card-1"]);
    });

    it("returns existing doc if already exists", () => {
      const mgr = createDocManager();
      const { manager: m1, doc: doc1 } = getOrCreateDoc({ manager: mgr, docId: "card-1" });
      const { manager: m2, doc: doc2 } = getOrCreateDoc({ manager: m1, docId: "card-1" });
      expect(m2).toBe(m1); // unchanged
      expect(doc2).toBe(doc1);
    });
  });

  describe("applyDocOperation (card ops)", () => {
    it("applies a field op to the correct doc", () => {
      let mgr = createDocManager();
      const fieldOp: FieldOp = {
        type: "field",
        id: makeId("A", 1),
        fieldName: "title",
        value: "My Card",
        timestamp: { clientId: "A", clock: 1 },
      };
      mgr = applyDocOperation({ manager: mgr, docId: "card-1", op: fieldOp });

      const doc = getDoc({ manager: mgr, docId: "card-1" });
      expect(doc).toBeDefined();
      expect(getField({ record: doc!, fieldName: "title" })).toBe("My Card");
    });

    it("applies set ops to the correct doc", () => {
      let mgr = createDocManager();
      const setOp: SetOp = {
        type: "set",
        id: makeId("A", 1),
        fieldName: "tags",
        action: "add",
        value: "urgent",
      };
      mgr = applyDocOperation({ manager: mgr, docId: "card-1", op: setOp });

      const doc = getDoc({ manager: mgr, docId: "card-1" });
      expect(getSetField({ record: doc!, fieldName: "tags" })).toEqual(["urgent"]);
    });

    it("keeps docs isolated from each other", () => {
      let mgr = createDocManager();

      const op1: FieldOp = {
        type: "field",
        id: makeId("A", 1),
        fieldName: "title",
        value: "Card 1",
        timestamp: { clientId: "A", clock: 1 },
      };
      const op2: FieldOp = {
        type: "field",
        id: makeId("A", 2),
        fieldName: "title",
        value: "Card 2",
        timestamp: { clientId: "A", clock: 2 },
      };

      mgr = applyDocOperation({ manager: mgr, docId: "card-1", op: op1 });
      mgr = applyDocOperation({ manager: mgr, docId: "card-2", op: op2 });

      const d1 = getDoc({ manager: mgr, docId: "card-1" });
      const d2 = getDoc({ manager: mgr, docId: "card-2" });
      expect(getField({ record: d1!, fieldName: "title" })).toBe("Card 1");
      expect(getField({ record: d2!, fieldName: "title" })).toBe("Card 2");
    });
  });

  describe("applyDocOperation (board ops)", () => {
    it("routes board ops to the board doc", () => {
      let mgr = createDocManager();
      const op: SetOp = {
        type: "set",
        id: makeId("A", 1),
        fieldName: "columns",
        action: "add",
        value: "Todo",
      };
      mgr = applyDocOperation({ manager: mgr, docId: BOARD_DOC_ID, op });

      const boardRecord = getDoc({ manager: mgr, docId: BOARD_DOC_ID });
      expect(boardRecord).toBeDefined();
      expect(getColumns({ record: boardRecord! })).toEqual(["Todo"]);
    });

    it("handles move-card board ops", () => {
      let mgr = createDocManager();
      const op: FieldOp = {
        type: "field",
        id: makeId("A", 1),
        fieldName: "card:card-1",
        value: JSON.stringify({ column: "Todo", order: "V" }),
        timestamp: { clientId: "A", clock: 1 },
      };
      mgr = applyDocOperation({ manager: mgr, docId: BOARD_DOC_ID, op });

      const boardRecord = getDoc({ manager: mgr, docId: BOARD_DOC_ID });
      expect(getCardPosition({ record: boardRecord!, cardId: "card-1" })).toEqual({
        column: "Todo",
        order: "V",
      });
    });
  });

  describe("deleteDoc", () => {
    it("removes a doc from the manager", () => {
      let mgr = createDocManager();
      const { manager } = getOrCreateDoc({ manager: mgr, docId: "card-1" });
      mgr = deleteDoc({ manager, docId: "card-1" });
      expect(getDoc({ manager: mgr, docId: "card-1" })).toBeUndefined();
      expect(listDocIds({ manager: mgr })).toEqual([]);
    });
  });

  describe("listDocIds", () => {
    it("lists all doc ids", () => {
      let mgr = createDocManager();
      mgr = getOrCreateDoc({ manager: mgr, docId: "card-1" }).manager;
      mgr = getOrCreateDoc({ manager: mgr, docId: "card-2" }).manager;
      mgr = getOrCreateDoc({ manager: mgr, docId: "card-3" }).manager;
      const ids = listDocIds({ manager: mgr });
      expect(ids).toContain("card-1");
      expect(ids).toContain("card-2");
      expect(ids).toContain("card-3");
      expect(ids.length).toBe(3);
    });
  });

  describe("applySnapshotToDoc", () => {
    it("replaces an existing doc from snapshot bytes", () => {
      let mgr = createDocManager();
      mgr = applyDocOperation({
        manager: mgr,
        docId: "card-1",
        op: {
          type: "field",
          id: makeId("A", 1),
          fieldName: "title",
          value: "Old title",
          timestamp: { clientId: "A", clock: 1 },
        },
      });

      let snapshotRecord = createRecord();
      snapshotRecord = applyRecordOp({
        record: snapshotRecord,
        op: {
          type: "field",
          id: makeId("B", 1),
          fieldName: "title",
          value: "Snapshot title",
          timestamp: { clientId: "B", clock: 1 },
        },
      });

      mgr = applySnapshotToDoc({
        manager: mgr,
        docId: "card-1",
        snapshot: encodeRecordSnapshot({ record: snapshotRecord }),
        mode: "replace",
      });

      const doc = getDoc({ manager: mgr, docId: "card-1" });
      expect(getField({ record: doc!, fieldName: "title" })).toBe("Snapshot title");
    });

    it("merges snapshot into existing doc by defaulting conflicts to remote", () => {
      let mgr = createDocManager();
      mgr = applyDocOperation({
        manager: mgr,
        docId: "card-1",
        op: {
          type: "field",
          id: makeId("A", 1),
          fieldName: "title",
          value: "Local title",
          timestamp: { clientId: "A", clock: 1 },
        },
      });
      mgr = applyDocOperation({
        manager: mgr,
        docId: "card-1",
        op: {
          type: "field",
          id: makeId("A", 2),
          fieldName: "localOnly",
          value: "keep me",
          timestamp: { clientId: "A", clock: 2 },
        },
      });

      let remote = createRecord();
      remote = applyRecordOp({
        record: remote,
        op: {
          type: "field",
          id: makeId("B", 5),
          fieldName: "title",
          value: "Remote title",
          timestamp: { clientId: "B", clock: 5 },
        },
      });
      remote = applyRecordOp({
        record: remote,
        op: {
          type: "field",
          id: makeId("B", 6),
          fieldName: "remoteOnly",
          value: "from remote",
          timestamp: { clientId: "B", clock: 6 },
        },
      });

      mgr = applySnapshotToDoc({
        manager: mgr,
        docId: "card-1",
        snapshot: encodeRecordSnapshot({ record: remote }),
        mode: "merge",
      });

      const doc = getDoc({ manager: mgr, docId: "card-1" });
      expect(getField({ record: doc!, fieldName: "title" })).toBe("Remote title");
      expect(getField({ record: doc!, fieldName: "localOnly" })).toBe("keep me");
      expect(getField({ record: doc!, fieldName: "remoteOnly" })).toBe("from remote");
    });
  });
});
