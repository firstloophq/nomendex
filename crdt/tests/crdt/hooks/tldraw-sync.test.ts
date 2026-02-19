import { describe, test, expect } from "bun:test";
import {
  tldrawRecordToFieldOp,
  tldrawDeleteToFieldOp,
  extractTldrawRecords,
} from "../../../src/hooks/useTldrawCRDT";
import {
  createRecord,
  applyRecordOp,
  getField,
  type CRDTRecord,
  type FieldOp,
} from "../../../src/crdt/document/record";

describe("tldraw CRDT sync", () => {
  describe("tldrawRecordToFieldOp", () => {
    test("converts a tldraw record to a FieldOp with tl: prefix", () => {
      const record = { id: "shape:abc123", typeName: "shape", x: 100, y: 200 };
      const op = tldrawRecordToFieldOp({ record, clientId: "clientA", clock: 1 });

      expect(op.type).toBe("field");
      expect(op.fieldName).toBe("tl:shape:abc123");
      expect(op.value).toBe(JSON.stringify(record));
      expect(op.id.clientId).toBe("clientA");
      expect(op.id.clock).toBe(1);
      expect(op.timestamp.clientId).toBe("clientA");
      expect(op.timestamp.clock).toBe(1);
    });

    test("serializes complex tldraw records with nested props", () => {
      const record = {
        id: "shape:rect1",
        typeName: "shape",
        props: { w: 100, h: 50, fill: "solid", color: "blue" },
        meta: {},
      };
      const op = tldrawRecordToFieldOp({ record, clientId: "c1", clock: 5 });

      expect(JSON.parse(op.value)).toEqual(record);
    });
  });

  describe("tldrawDeleteToFieldOp", () => {
    test("creates a FieldOp with empty sentinel for deletion", () => {
      const op = tldrawDeleteToFieldOp({
        recordId: "shape:abc123",
        clientId: "clientA",
        clock: 2,
      });

      expect(op.type).toBe("field");
      expect(op.fieldName).toBe("tl:shape:abc123");
      expect(op.value).toBe("");
      expect(op.id.clock).toBe(2);
    });
  });

  describe("extractTldrawRecords", () => {
    test("extracts live tldraw records from fields", () => {
      const fields = new Map([
        ["tl:shape:a", { value: JSON.stringify({ id: "shape:a", x: 10 }) }],
        ["tl:shape:b", { value: JSON.stringify({ id: "shape:b", x: 20 }) }],
        ["title", { value: "not a tldraw record" }],
      ]);

      const records = extractTldrawRecords({ fields });
      expect(records).toHaveLength(2);
      expect(records[0]!.id).toBe("shape:a");
      expect(records[1]!.id).toBe("shape:b");
    });

    test("skips deleted records (empty sentinel)", () => {
      const fields = new Map([
        ["tl:shape:a", { value: JSON.stringify({ id: "shape:a", x: 10 }) }],
        ["tl:shape:b", { value: "" }],
      ]);

      const records = extractTldrawRecords({ fields });
      expect(records).toHaveLength(1);
      expect(records[0]!.id).toBe("shape:a");
    });

    test("skips invalid JSON", () => {
      const fields = new Map([
        ["tl:shape:a", { value: "{invalid json" }],
        ["tl:shape:b", { value: JSON.stringify({ id: "shape:b" }) }],
      ]);

      const records = extractTldrawRecords({ fields });
      expect(records).toHaveLength(1);
      expect(records[0]!.id).toBe("shape:b");
    });

    test("returns empty array when no tl: fields exist", () => {
      const fields = new Map([
        ["title", { value: "hello" }],
        ["description", { value: "world" }],
      ]);

      const records = extractTldrawRecords({ fields });
      expect(records).toHaveLength(0);
    });
  });

  describe("LWW conflict resolution via CRDTRecord", () => {
    test("higher clock wins regardless of apply order", () => {
      let record = createRecord();

      const opA: FieldOp = {
        type: "field",
        id: { clientId: "clientA", clock: 1 },
        fieldName: "tl:shape:s1",
        value: JSON.stringify({ id: "shape:s1", x: 100 }),
        timestamp: { clientId: "clientA", clock: 1 },
      };

      const opB: FieldOp = {
        type: "field",
        id: { clientId: "clientB", clock: 2 },
        fieldName: "tl:shape:s1",
        value: JSON.stringify({ id: "shape:s1", x: 200 }),
        timestamp: { clientId: "clientB", clock: 2 },
      };

      // Apply A then B
      let record1 = applyRecordOp({ record, op: opA });
      record1 = applyRecordOp({ record: record1, op: opB });

      // Apply B then A
      let record2 = applyRecordOp({ record, op: opB });
      record2 = applyRecordOp({ record: record2, op: opA });

      // Both should converge to B's value (higher clock)
      const val1 = getField({ record: record1, fieldName: "tl:shape:s1" });
      const val2 = getField({ record: record2, fieldName: "tl:shape:s1" });
      expect(val1).toBe(val2);
      expect(JSON.parse(val1!).x).toBe(200);
    });

    test("same clock — higher clientId wins (tiebreaker)", () => {
      let record = createRecord();

      const opA: FieldOp = {
        type: "field",
        id: { clientId: "aaa", clock: 5 },
        fieldName: "tl:shape:s1",
        value: JSON.stringify({ id: "shape:s1", x: 10 }),
        timestamp: { clientId: "aaa", clock: 5 },
      };

      const opB: FieldOp = {
        type: "field",
        id: { clientId: "zzz", clock: 5 },
        fieldName: "tl:shape:s1",
        value: JSON.stringify({ id: "shape:s1", x: 20 }),
        timestamp: { clientId: "zzz", clock: 5 },
      };

      // Apply A then B
      let r1 = applyRecordOp({ record, op: opA });
      r1 = applyRecordOp({ record: r1, op: opB });

      // Apply B then A
      let r2 = applyRecordOp({ record, op: opB });
      r2 = applyRecordOp({ record: r2, op: opA });

      const v1 = getField({ record: r1, fieldName: "tl:shape:s1" });
      const v2 = getField({ record: r2, fieldName: "tl:shape:s1" });
      expect(v1).toBe(v2);
    });
  });

  describe("deletion semantics", () => {
    test("deletion via empty sentinel is stored as LWW value", () => {
      let record = createRecord();

      // First, create the shape
      const createOp: FieldOp = {
        type: "field",
        id: { clientId: "c1", clock: 1 },
        fieldName: "tl:shape:s1",
        value: JSON.stringify({ id: "shape:s1", x: 100 }),
        timestamp: { clientId: "c1", clock: 1 },
      };
      record = applyRecordOp({ record, op: createOp });

      // Then delete it
      const deleteOp: FieldOp = {
        type: "field",
        id: { clientId: "c1", clock: 2 },
        fieldName: "tl:shape:s1",
        value: "",
        timestamp: { clientId: "c1", clock: 2 },
      };
      record = applyRecordOp({ record, op: deleteOp });

      expect(getField({ record, fieldName: "tl:shape:s1" })).toBe("");
    });

    test("concurrent edit with higher clock overwrites deletion", () => {
      let record = createRecord();

      // Create shape
      const createOp: FieldOp = {
        type: "field",
        id: { clientId: "c1", clock: 1 },
        fieldName: "tl:shape:s1",
        value: JSON.stringify({ id: "shape:s1", x: 100 }),
        timestamp: { clientId: "c1", clock: 1 },
      };
      record = applyRecordOp({ record, op: createOp });

      // Client A deletes at clock 2
      const deleteOp: FieldOp = {
        type: "field",
        id: { clientId: "clientA", clock: 2 },
        fieldName: "tl:shape:s1",
        value: "",
        timestamp: { clientId: "clientA", clock: 2 },
      };

      // Client B edits at clock 3 (higher — wins)
      const editOp: FieldOp = {
        type: "field",
        id: { clientId: "clientB", clock: 3 },
        fieldName: "tl:shape:s1",
        value: JSON.stringify({ id: "shape:s1", x: 999 }),
        timestamp: { clientId: "clientB", clock: 3 },
      };

      // Apply delete then edit — edit wins
      let r1 = applyRecordOp({ record, op: deleteOp });
      r1 = applyRecordOp({ record: r1, op: editOp });
      expect(JSON.parse(getField({ record: r1, fieldName: "tl:shape:s1" })!).x).toBe(999);

      // Apply edit then delete — edit still wins (LWW)
      let r2 = applyRecordOp({ record, op: editOp });
      r2 = applyRecordOp({ record: r2, op: deleteOp });
      expect(JSON.parse(getField({ record: r2, fieldName: "tl:shape:s1" })!).x).toBe(999);
    });
  });

  describe("idempotency", () => {
    test("applying the same FieldOp twice has no effect", () => {
      let record = createRecord();

      const op: FieldOp = {
        type: "field",
        id: { clientId: "c1", clock: 1 },
        fieldName: "tl:shape:s1",
        value: JSON.stringify({ id: "shape:s1", x: 42 }),
        timestamp: { clientId: "c1", clock: 1 },
      };

      record = applyRecordOp({ record, op });
      const after1 = record;

      record = applyRecordOp({ record, op });
      const after2 = record;

      // Same reference — op was deduped
      expect(after1).toBe(after2);
    });
  });

  describe("round-trip: record → FieldOp → CRDTRecord → extract", () => {
    test("stores and retrieves tldraw records through the CRDT", () => {
      let record = createRecord();

      const shapes = [
        { id: "shape:rect1", typeName: "shape", x: 0, y: 0, props: { w: 100, h: 50 } },
        { id: "shape:arrow1", typeName: "shape", x: 50, y: 50, props: { start: {}, end: {} } },
        { id: "page:page1", typeName: "page", name: "Page 1" },
      ];

      for (let i = 0; i < shapes.length; i++) {
        const op = tldrawRecordToFieldOp({
          record: shapes[i]!,
          clientId: "c1",
          clock: i + 1,
        });
        record = applyRecordOp({ record, op });
      }

      const extracted = extractTldrawRecords({ fields: record.fields });
      expect(extracted).toHaveLength(3);

      const ids = extracted.map((r) => r.id).sort();
      expect(ids).toEqual(["page:page1", "shape:arrow1", "shape:rect1"]);
    });
  });
});
