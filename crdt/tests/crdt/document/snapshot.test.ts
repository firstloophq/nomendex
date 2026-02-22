import { describe, expect, it } from "bun:test";
import {
  encodeSnapshot,
  decodeSnapshot,
  encodeRecordSnapshot,
  decodeRecordSnapshot,
  mergeRecordSnapshots,
  getRecordSnapshotVersion,
  isRecordSnapshotVersion,
  getRecordSnapshotStateVector,
  missingFromRecordSnapshot,
} from "@/crdt/document/snapshot";
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
import {
  createRecord,
  applyRecordOp,
  applyRecordOps,
  getField,
  getSetField,
  getBodyText,
  type FieldOp,
  type SetOp,
} from "@/crdt/document/record";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

describe("Snapshot", () => {
  it("encodes and decodes an empty document", () => {
    const doc = createEmptyDocument();
    const snapshot = encodeSnapshot({ doc });
    const restored = decodeSnapshot({ data: snapshot });
    expect(getDocumentText({ doc: restored })).toBe("");
  });

  it("round-trips a document with text", () => {
    let doc = createEmptyDocument();
    const ops = [
      createInsertOp({ id: makeId("A", 1), parentId: null, side: "right" as const, content: { type: "text" as const, value: "h" } }),
      createInsertOp({ id: makeId("A", 2), parentId: makeId("A", 1), side: "right" as const, content: { type: "text" as const, value: "e" } }),
      createInsertOp({ id: makeId("A", 3), parentId: makeId("A", 2), side: "right" as const, content: { type: "text" as const, value: "l" } }),
      createInsertOp({ id: makeId("A", 4), parentId: makeId("A", 3), side: "right" as const, content: { type: "text" as const, value: "l" } }),
      createInsertOp({ id: makeId("A", 5), parentId: makeId("A", 4), side: "right" as const, content: { type: "text" as const, value: "o" } }),
    ];
    doc = applyOperations({ doc, ops });
    expect(getDocumentText({ doc })).toBe("hello");

    const snapshot = encodeSnapshot({ doc });
    const restored = decodeSnapshot({ data: snapshot });
    expect(getDocumentText({ doc: restored })).toBe("hello");
  });

  it("preserves tombstones (deleted items)", () => {
    let doc = createEmptyDocument();
    doc = applyOperation({
      doc,
      op: createInsertOp({ id: makeId("A", 1), parentId: null, side: "right", content: { type: "text", value: "a" } }),
    });
    doc = applyOperation({
      doc,
      op: createInsertOp({ id: makeId("A", 2), parentId: makeId("A", 1), side: "right", content: { type: "text", value: "b" } }),
    });
    doc = applyOperation({
      doc,
      op: createDeleteOp({ id: makeId("A", 3), targetId: makeId("A", 1) }),
    });
    expect(getDocumentText({ doc })).toBe("b");

    const snapshot = encodeSnapshot({ doc });
    const restored = decodeSnapshot({ data: snapshot });
    expect(getDocumentText({ doc: restored })).toBe("b");
    // Tombstone should still exist
    expect(restored.store.length).toBe(2);
  });

  it("preserves state vector", () => {
    let doc = createEmptyDocument();
    doc = applyOperation({
      doc,
      op: createInsertOp({ id: makeId("A", 1), parentId: null, side: "right", content: { type: "text", value: "a" } }),
    });
    doc = applyOperation({
      doc,
      op: createInsertOp({ id: makeId("B", 1), parentId: null, side: "right", content: { type: "text", value: "b" } }),
    });

    const snapshot = encodeSnapshot({ doc });
    const restored = decodeSnapshot({ data: snapshot });
    expect(restored.stateVector.get("A")).toBe(1);
    expect(restored.stateVector.get("B")).toBe(1);
  });

  it("restored document can accept new operations", () => {
    let doc = createEmptyDocument();
    doc = applyOperation({
      doc,
      op: createInsertOp({ id: makeId("A", 1), parentId: null, side: "right", content: { type: "text", value: "h" } }),
    });

    const snapshot = encodeSnapshot({ doc });
    let restored = decodeSnapshot({ data: snapshot });

    // Continue editing
    restored = applyOperation({
      doc: restored,
      op: createInsertOp({ id: makeId("A", 2), parentId: makeId("A", 1), side: "right", content: { type: "text", value: "i" } }),
    });
    expect(getDocumentText({ doc: restored })).toBe("hi");
  });

  it("handles large document (10k items)", () => {
    let doc = createEmptyDocument();
    const ops = [];
    for (let i = 1; i <= 10000; i++) {
      ops.push(
        createInsertOp({
          id: makeId("A", i),
          parentId: i > 1 ? makeId("A", i - 1) : null,
          side: "right" as const,
          content: { type: "text" as const, value: String.fromCharCode(97 + (i % 26)) },
        })
      );
    }
    doc = applyOperations({ doc, ops });

    const snapshot = encodeSnapshot({ doc });
    const restored = decodeSnapshot({ data: snapshot });
    expect(getDocumentText({ doc: restored })).toBe(getDocumentText({ doc }));
  });
});

// --- Record Snapshot Tests ---

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
    removeIds: params.removeIds,
  };
}

describe("Record Snapshot", () => {
  it("round-trips an empty record", () => {
    const record = createRecord();
    const data = encodeRecordSnapshot({ record });
    const restored = decodeRecordSnapshot({ data });

    expect(restored.fields.size).toBe(0);
    expect(restored.sets.size).toBe(0);
    expect(getBodyText({ record: restored })).toBe("");
    expect(restored.stateVector.size).toBe(0);
  });

  it("round-trips fields (LWW registers)", () => {
    let record = createRecord();
    record = applyRecordOp({
      record,
      op: fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "Hello" }),
    });
    record = applyRecordOp({
      record,
      op: fieldOp({ clientId: "A", clock: 2, fieldName: "description", value: "World" }),
    });

    const data = encodeRecordSnapshot({ record });
    const restored = decodeRecordSnapshot({ data });

    expect(getField({ record: restored, fieldName: "title" })).toBe("Hello");
    expect(getField({ record: restored, fieldName: "description" })).toBe("World");
    // Verify timestamp is preserved
    const titleReg = restored.fields.get("title");
    expect(titleReg?.timestamp.clientId).toBe("A");
    expect(titleReg?.timestamp.clock).toBe(1);
  });

  it("round-trips LWW last-writer-wins semantics", () => {
    let record = createRecord();
    record = applyRecordOp({
      record,
      op: fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "First" }),
    });
    record = applyRecordOp({
      record,
      op: fieldOp({ clientId: "A", clock: 3, fieldName: "title", value: "Third" }),
    });

    const data = encodeRecordSnapshot({ record });
    const restored = decodeRecordSnapshot({ data });

    expect(getField({ record: restored, fieldName: "title" })).toBe("Third");
    expect(restored.fields.get("title")?.timestamp.clock).toBe(3);
  });

  it("round-trips sets (OR-Set)", () => {
    let record = createRecord();
    record = applyRecordOp({
      record,
      op: setAddOp({ clientId: "A", clock: 1, fieldName: "tags", value: "urgent" }),
    });
    record = applyRecordOp({
      record,
      op: setAddOp({ clientId: "A", clock: 2, fieldName: "tags", value: "bug" }),
    });

    const data = encodeRecordSnapshot({ record });
    const restored = decodeRecordSnapshot({ data });

    const tags = getSetField({ record: restored, fieldName: "tags" });
    expect(tags).toContain("urgent");
    expect(tags).toContain("bug");
    expect(tags.length).toBe(2);
  });

  it("round-trips sets with removed entries", () => {
    let record = createRecord();
    record = applyRecordOp({
      record,
      op: setAddOp({ clientId: "A", clock: 1, fieldName: "tags", value: "urgent" }),
    });
    record = applyRecordOp({
      record,
      op: setAddOp({ clientId: "A", clock: 2, fieldName: "tags", value: "bug" }),
    });
    record = applyRecordOp({
      record,
      op: setRemoveOp({
        clientId: "A",
        clock: 3,
        fieldName: "tags",
        value: "urgent",
        removeIds: [makeId("A", 1)],
      }),
    });

    const data = encodeRecordSnapshot({ record });
    const restored = decodeRecordSnapshot({ data });

    const tags = getSetField({ record: restored, fieldName: "tags" });
    expect(tags).toContain("bug");
    expect(tags).not.toContain("urgent");
  });

  it("round-trips body (rich text CRDTDoc)", () => {
    let record = createRecord();
    const bodyOps = [
      createInsertOp({ id: makeId("A", 1), parentId: null, side: "right", content: { type: "text", value: "H" } }),
      createInsertOp({ id: makeId("A", 2), parentId: makeId("A", 1), side: "right", content: { type: "text", value: "i" } }),
    ];
    record = applyRecordOps({ record, ops: bodyOps });

    const data = encodeRecordSnapshot({ record });
    const restored = decodeRecordSnapshot({ data });

    expect(getBodyText({ record: restored })).toBe("Hi");
  });

  it("round-trips stateVector", () => {
    let record = createRecord();
    record = applyRecordOp({
      record,
      op: fieldOp({ clientId: "A", clock: 5, fieldName: "title", value: "x" }),
    });
    record = applyRecordOp({
      record,
      op: setAddOp({ clientId: "B", clock: 3, fieldName: "tags", value: "y" }),
    });

    const data = encodeRecordSnapshot({ record });
    const restored = decodeRecordSnapshot({ data });

    expect(restored.stateVector.get("A")).toBe(5);
    expect(restored.stateVector.get("B")).toBe(3);
  });

  it("round-trips appliedOps (idempotency set)", () => {
    let record = createRecord();
    const op1 = fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "x" });
    const op2 = setAddOp({ clientId: "B", clock: 1, fieldName: "tags", value: "y" });
    record = applyRecordOps({ record, ops: [op1, op2] });

    const data = encodeRecordSnapshot({ record });
    const restored = decodeRecordSnapshot({ data });

    expect(restored.appliedOps.size).toBe(2);
    // Re-applying the same ops should be no-ops (idempotent)
    const reApplied = applyRecordOps({ record: restored, ops: [op1, op2] });
    expect(getField({ record: reApplied, fieldName: "title" })).toBe("x");
  });

  it("round-trips a complete record with fields, sets, and body", () => {
    let record = createRecord();
    record = applyRecordOps({
      record,
      ops: [
        fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "My Card" }),
        fieldOp({ clientId: "A", clock: 2, fieldName: "description", value: "A description" }),
        fieldOp({ clientId: "A", clock: 3, fieldName: "due_date", value: "2026-03-01" }),
        setAddOp({ clientId: "A", clock: 4, fieldName: "tags", value: "important" }),
        setAddOp({ clientId: "A", clock: 5, fieldName: "tags", value: "feature" }),
        createInsertOp({ id: makeId("A", 6), parentId: null, side: "right", content: { type: "text", value: "B" } }),
        createInsertOp({ id: makeId("A", 7), parentId: makeId("A", 6), side: "right", content: { type: "text", value: "o" } }),
        createInsertOp({ id: makeId("A", 8), parentId: makeId("A", 7), side: "right", content: { type: "text", value: "d" } }),
        createInsertOp({ id: makeId("A", 9), parentId: makeId("A", 8), side: "right", content: { type: "text", value: "y" } }),
      ],
    });

    const data = encodeRecordSnapshot({ record });
    const restored = decodeRecordSnapshot({ data });

    expect(getField({ record: restored, fieldName: "title" })).toBe("My Card");
    expect(getField({ record: restored, fieldName: "description" })).toBe("A description");
    expect(getField({ record: restored, fieldName: "due_date" })).toBe("2026-03-01");
    expect(getSetField({ record: restored, fieldName: "tags" })).toContain("important");
    expect(getSetField({ record: restored, fieldName: "tags" })).toContain("feature");
    expect(getBodyText({ record: restored })).toBe("Body");
  });

  it("restored record can accept new operations", () => {
    let record = createRecord();
    record = applyRecordOp({
      record,
      op: fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "Original" }),
    });

    const data = encodeRecordSnapshot({ record });
    let restored = decodeRecordSnapshot({ data });

    // Apply new op to restored record
    restored = applyRecordOp({
      record: restored,
      op: fieldOp({ clientId: "A", clock: 2, fieldName: "title", value: "Updated" }),
    });
    expect(getField({ record: restored, fieldName: "title" })).toBe("Updated");
  });

  it("round-trips multiple sets (columns + tags)", () => {
    let record = createRecord();
    record = applyRecordOps({
      record,
      ops: [
        setAddOp({ clientId: "A", clock: 1, fieldName: "columns", value: "Todo" }),
        setAddOp({ clientId: "A", clock: 2, fieldName: "columns", value: "Done" }),
        setAddOp({ clientId: "A", clock: 3, fieldName: "tags", value: "urgent" }),
      ],
    });

    const data = encodeRecordSnapshot({ record });
    const restored = decodeRecordSnapshot({ data });

    const columns = getSetField({ record: restored, fieldName: "columns" });
    expect(columns).toContain("Todo");
    expect(columns).toContain("Done");
    const tags = getSetField({ record: restored, fieldName: "tags" });
    expect(tags).toContain("urgent");
  });

  it("handles concurrent operations from multiple clients", () => {
    let record = createRecord();
    record = applyRecordOps({
      record,
      ops: [
        fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "A's title" }),
        fieldOp({ clientId: "B", clock: 2, fieldName: "title", value: "B's title" }),
        setAddOp({ clientId: "A", clock: 2, fieldName: "tags", value: "from-A" }),
        setAddOp({ clientId: "B", clock: 1, fieldName: "tags", value: "from-B" }),
      ],
    });

    const data = encodeRecordSnapshot({ record });
    const restored = decodeRecordSnapshot({ data });

    // B's title wins (higher clock)
    expect(getField({ record: restored, fieldName: "title" })).toBe("B's title");
    const tags = getSetField({ record: restored, fieldName: "tags" });
    expect(tags).toContain("from-A");
    expect(tags).toContain("from-B");
    expect(restored.stateVector.get("A")).toBe(2);
    expect(restored.stateVector.get("B")).toBe(2);
  });
});

describe("Record Snapshot Merge", () => {
  it("merges local and remote snapshots (LWW fields, OR-Set removals, body union)", () => {
    let local = createRecord();
    local = applyRecordOps({
      record: local,
      ops: [
        fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "Local title" }),
        setAddOp({ clientId: "A", clock: 2, fieldName: "tags", value: "shared-tag" }),
        createInsertOp({
          id: makeId("A", 4),
          parentId: null,
          side: "right",
          content: { type: "text", value: "L" },
        }),
      ],
    });

    let remote = createRecord();
    remote = applyRecordOps({
      record: remote,
      ops: [
        fieldOp({ clientId: "B", clock: 5, fieldName: "title", value: "Remote title" }),
        // Same add op id + later remove so merged set should stay removed.
        setAddOp({ clientId: "A", clock: 2, fieldName: "tags", value: "shared-tag" }),
        setRemoveOp({
          clientId: "B",
          clock: 6,
          fieldName: "tags",
          value: "shared-tag",
          removeIds: [makeId("A", 2)],
        }),
        createInsertOp({
          id: makeId("B", 2),
          parentId: null,
          side: "right",
          content: { type: "text", value: "R" },
        }),
      ],
    });

    const merged = mergeRecordSnapshots({
      local: encodeRecordSnapshot({ record: local }),
      remote: encodeRecordSnapshot({ record: remote }),
    });

    expect(getField({ record: merged, fieldName: "title" })).toBe("Remote title");
    expect(getSetField({ record: merged, fieldName: "tags" })).not.toContain("shared-tag");
    expect(getBodyText({ record: merged })).toBe("RL");
    expect(merged.stateVector.get("A")).toBe(4);
    expect(merged.stateVector.get("B")).toBe(6);
  });
});

describe("Record Snapshot Version + State Vector Helpers", () => {
  it("computes stable deterministic snapshot versions", () => {
    let record = createRecord();
    record = applyRecordOp({
      record,
      op: fieldOp({ clientId: "A", clock: 1, fieldName: "title", value: "Version 1" }),
    });

    const data1 = encodeRecordSnapshot({ record });
    const version1 = getRecordSnapshotVersion({ data: data1 });
    expect(isRecordSnapshotVersion({ data: data1, expectedVersion: version1 })).toBe(true);

    record = applyRecordOp({
      record,
      op: fieldOp({ clientId: "A", clock: 2, fieldName: "title", value: "Version 2" }),
    });
    const data2 = encodeRecordSnapshot({ record });
    const version2 = getRecordSnapshotVersion({ data: data2 });

    expect(version1).not.toBe(version2);
    expect(version1.startsWith("fnv1a64:")).toBe(true);
  });

  it("extracts state vector and computes missing ranges from a record snapshot", () => {
    let record = createRecord();
    record = applyRecordOps({
      record,
      ops: [
        fieldOp({ clientId: "A", clock: 5, fieldName: "title", value: "x" }),
        fieldOp({ clientId: "B", clock: 2, fieldName: "title", value: "y" }),
      ],
    });

    const data = encodeRecordSnapshot({ record });
    const sv = getRecordSnapshotStateVector({ data });
    expect(sv.get("A")).toBe(5);
    expect(sv.get("B")).toBe(2);

    const missing = missingFromRecordSnapshot({
      data,
      remoteStateVector: new Map([
        ["A", 2],
        ["B", 2],
      ]),
    });

    expect(missing).toEqual([
      { clientId: "A", from: 3, to: 5 },
    ]);
  });
});
