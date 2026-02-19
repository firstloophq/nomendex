import { describe, it, expect } from "bun:test";
import {
  createRecord,
  applyRecordOp,
  applyRecordOps,
  getField,
  getFields,
  getSetField,
  getBodyText,
  type FieldOp,
  type SetOp,
  type RecordOp,
} from "@/crdt/document/record";
import { createOperationId, createInsertOp } from "@/crdt/core/operations";

function makeId(clientId: string, clock: number) {
  return createOperationId({ clientId, clock });
}

function fieldOp(params: {
  clientId: string;
  clock: number;
  fieldName: string;
  value: string;
}): FieldOp {
  return {
    type: "field",
    id: makeId(params.clientId, params.clock),
    fieldName: params.fieldName,
    value: params.value,
    timestamp: { clientId: params.clientId, clock: params.clock },
  };
}

function setAddOp(params: {
  clientId: string;
  clock: number;
  fieldName: string;
  value: string;
}): SetOp {
  return {
    type: "set",
    id: makeId(params.clientId, params.clock),
    fieldName: params.fieldName,
    action: "add",
    value: params.value,
  };
}

function setRemoveOp(params: {
  clientId: string;
  clock: number;
  fieldName: string;
  value: string;
  removeIds: ReadonlyArray<{ clientId: string; clock: number }>;
}): SetOp {
  return {
    type: "set",
    id: makeId(params.clientId, params.clock),
    fieldName: params.fieldName,
    action: "remove",
    value: params.value,
    removeIds: params.removeIds.map((r) => makeId(r.clientId, r.clock)),
  };
}

describe("CRDT Record", () => {
  describe("createRecord", () => {
    it("creates an empty record", () => {
      const record = createRecord();
      expect(getFields({ record }).size).toBe(0);
      expect(getBodyText({ record })).toBe("");
    });
  });

  describe("scalar fields (LWW Register)", () => {
    it("sets a field value", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "My Card" }),
      });
      expect(getField({ record, fieldName: "title" })).toBe("My Card");
    });

    it("updates a field with higher timestamp", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "Old Title" }),
      });
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "A", clock: 2, fieldName: "title", value: "New Title" }),
      });
      expect(getField({ record, fieldName: "title" })).toBe("New Title");
    });

    it("concurrent writes: higher clock wins", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "A's title" }),
      });
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "B", clock: 3, fieldName: "title", value: "B's title" }),
      });
      expect(getField({ record, fieldName: "title" })).toBe("B's title");
    });

    it("concurrent writes: tie-breaking by clientId", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "A's" }),
      });
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "B", clock: 1, fieldName: "title", value: "B's" }),
      });
      // "B" > "A" → B wins
      expect(getField({ record, fieldName: "title" })).toBe("B's");
    });

    it("supports multiple fields", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "Card Title" }),
      });
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "A", clock: 2, fieldName: "description", value: "Card Desc" }),
      });
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "A", clock: 3, fieldName: "due_date", value: "2026-03-01" }),
      });

      const fields = getFields({ record });
      expect(fields.get("title")).toBe("Card Title");
      expect(fields.get("description")).toBe("Card Desc");
      expect(fields.get("due_date")).toBe("2026-03-01");
    });

    it("is idempotent", () => {
      let record = createRecord();
      const op = fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "Test" });
      record = applyRecordOp({ record, op });
      const before = record;
      record = applyRecordOp({ record, op });
      expect(record).toBe(before);
    });

    it("supports custom user-defined fields", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "A", clock: 1, fieldName: "priority", value: "high" }),
      });
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "A", clock: 2, fieldName: "assignee", value: "alice" }),
      });
      expect(getField({ record, fieldName: "priority" })).toBe("high");
      expect(getField({ record, fieldName: "assignee" })).toBe("alice");
    });
  });

  describe("set fields (OR-Set)", () => {
    it("adds a tag", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: setAddOp({ clientId: "A", clock: 1, fieldName: "tags", value: "urgent" }),
      });
      expect(getSetField({ record, fieldName: "tags" })).toEqual(["urgent"]);
    });

    it("adds multiple tags", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: setAddOp({ clientId: "A", clock: 1, fieldName: "tags", value: "urgent" }),
      });
      record = applyRecordOp({
        record,
        op: setAddOp({ clientId: "A", clock: 2, fieldName: "tags", value: "bug" }),
      });
      const tags = getSetField({ record, fieldName: "tags" });
      expect(tags).toContain("urgent");
      expect(tags).toContain("bug");
    });

    it("removes a tag", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: setAddOp({ clientId: "A", clock: 1, fieldName: "tags", value: "urgent" }),
      });
      record = applyRecordOp({
        record,
        op: setRemoveOp({
          clientId: "A",
          clock: 2,
          fieldName: "tags",
          value: "urgent",
          removeIds: [{ clientId: "A", clock: 1 }],
        }),
      });
      expect(getSetField({ record, fieldName: "tags" })).toEqual([]);
    });

    it("concurrent add wins (add-wins semantics)", () => {
      let record = createRecord();
      // A adds "urgent" with id A:1
      record = applyRecordOp({
        record,
        op: setAddOp({ clientId: "A", clock: 1, fieldName: "tags", value: "urgent" }),
      });
      // B concurrently adds "urgent" with id B:1
      record = applyRecordOp({
        record,
        op: setAddOp({ clientId: "B", clock: 1, fieldName: "tags", value: "urgent" }),
      });
      // A removes only their own add (A:1)
      record = applyRecordOp({
        record,
        op: setRemoveOp({
          clientId: "A",
          clock: 2,
          fieldName: "tags",
          value: "urgent",
          removeIds: [{ clientId: "A", clock: 1 }],
        }),
      });
      // B's add still active — "urgent" persists
      expect(getSetField({ record, fieldName: "tags" })).toEqual(["urgent"]);
    });

    it("returns empty array for non-existent field", () => {
      const record = createRecord();
      expect(getSetField({ record, fieldName: "tags" })).toEqual([]);
    });

    it("is idempotent", () => {
      let record = createRecord();
      const op = setAddOp({ clientId: "A", clock: 1, fieldName: "tags", value: "test" });
      record = applyRecordOp({ record, op });
      const before = record;
      record = applyRecordOp({ record, op });
      // OR-Set addToSet is idempotent by opId check
      expect(record.sets).toBe(before.sets);
    });
  });

  describe("body (CRDTDoc rich text)", () => {
    it("applies insert operations to the body", () => {
      let record = createRecord();
      const insertOp = createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "text", value: "h" },
      });
      record = applyRecordOp({ record, op: insertOp });

      const insertOp2 = createInsertOp({
        id: makeId("A", 2),
        parentId: makeId("A", 1),
        side: "right",
        content: { type: "text", value: "i" },
      });
      record = applyRecordOp({ record, op: insertOp2 });

      expect(getBodyText({ record })).toBe("hi");
    });
  });

  describe("mixed operations", () => {
    it("handles fields, sets, and body together", () => {
      let record = createRecord();

      // Set title
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "Task 1" }),
      });

      // Add tags
      record = applyRecordOp({
        record,
        op: setAddOp({ clientId: "A", clock: 2, fieldName: "tags", value: "feature" }),
      });

      // Add body text
      record = applyRecordOp({
        record,
        op: createInsertOp({
          id: makeId("A", 3),
          parentId: null,
          side: "right",
          content: { type: "text", value: "D" },
        }),
      });

      expect(getField({ record, fieldName: "title" })).toBe("Task 1");
      expect(getSetField({ record, fieldName: "tags" })).toEqual(["feature"]);
      expect(getBodyText({ record })).toBe("D");
    });
  });

  describe("applyRecordOps (batch)", () => {
    it("applies multiple operations in sequence", () => {
      const ops: RecordOp[] = [
        fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "Card" }),
        fieldOp({ clientId: "A", clock: 2, fieldName: "description", value: "Desc" }),
        setAddOp({ clientId: "A", clock: 3, fieldName: "tags", value: "v1" }),
      ];

      const record = applyRecordOps({ record: createRecord(), ops });
      expect(getField({ record, fieldName: "title" })).toBe("Card");
      expect(getField({ record, fieldName: "description" })).toBe("Desc");
      expect(getSetField({ record, fieldName: "tags" })).toEqual(["v1"]);
    });
  });

  describe("stateVector tracking", () => {
    it("starts with an empty state vector", () => {
      const record = createRecord();
      expect(record.stateVector.size).toBe(0);
    });

    it("tracks field ops in the state vector", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "Test" }),
      });
      expect(record.stateVector.get("A")).toBe(1);
    });

    it("tracks set ops in the state vector", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: setAddOp({ clientId: "B", clock: 5, fieldName: "tags", value: "urgent" }),
      });
      expect(record.stateVector.get("B")).toBe(5);
    });

    it("tracks body (insert) ops in the state vector", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: createInsertOp({
          id: makeId("C", 3),
          parentId: null,
          side: "right",
          content: { type: "text", value: "x" },
        }),
      });
      expect(record.stateVector.get("C")).toBe(3);
    });

    it("tracks max clock across multiple ops from same client", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "v1" }),
      });
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "A", clock: 3, fieldName: "title", value: "v2" }),
      });
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "A", clock: 2, fieldName: "desc", value: "v3" }),
      });
      expect(record.stateVector.get("A")).toBe(3);
    });

    it("tracks multiple clients independently", () => {
      let record = createRecord();
      record = applyRecordOp({
        record,
        op: fieldOp({ clientId: "A", clock: 2, fieldName: "title", value: "a" }),
      });
      record = applyRecordOp({
        record,
        op: setAddOp({ clientId: "B", clock: 7, fieldName: "tags", value: "bug" }),
      });
      record = applyRecordOp({
        record,
        op: createInsertOp({
          id: makeId("C", 1),
          parentId: null,
          side: "right",
          content: { type: "text", value: "z" },
        }),
      });
      expect(record.stateVector.get("A")).toBe(2);
      expect(record.stateVector.get("B")).toBe(7);
      expect(record.stateVector.get("C")).toBe(1);
    });

    it("idempotent field ops still return same record (SV unchanged)", () => {
      let record = createRecord();
      const op = fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "Test" });
      record = applyRecordOp({ record, op });
      const before = record;
      record = applyRecordOp({ record, op });
      expect(record).toBe(before);
    });
  });
});
