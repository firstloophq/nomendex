import { describe, expect, it } from "bun:test";
import { collectGarbage } from "@/crdt/core/gc";
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
import { updateStateVector, createStateVector } from "@/crdt/network/state-vector";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

describe("Garbage Collection", () => {
  it("removes tombstones when all peers have seen the delete", () => {
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
    expect(doc.store.length).toBe(2); // 'a' tombstoned + 'b'

    // All peers have seen up to A:3
    let peerVectors = [
      updateStateVector({ sv: createStateVector(), clientId: "A", clock: 3 }),
    ];

    const result = collectGarbage({ doc, peerStateVectors: peerVectors });
    expect(getDocumentText({ doc: result })).toBe("b");
    expect(result.store.length).toBe(1); // tombstone removed
  });

  it("preserves tombstones when some peers haven't seen the delete", () => {
    let doc = createEmptyDocument();
    doc = applyOperation({
      doc,
      op: createInsertOp({ id: makeId("A", 1), parentId: null, side: "right", content: { type: "text", value: "a" } }),
    });
    doc = applyOperation({
      doc,
      op: createDeleteOp({ id: makeId("A", 2), targetId: makeId("A", 1) }),
    });

    // Peer B has only seen up to A:1 (hasn't seen the delete at A:2)
    let peerVectors = [
      updateStateVector({ sv: createStateVector(), clientId: "A", clock: 1 }),
    ];

    const result = collectGarbage({ doc, peerStateVectors: peerVectors });
    expect(result.store.length).toBe(1); // tombstone preserved
  });

  it("content is unchanged after GC", () => {
    let doc = createEmptyDocument();
    const ops = [
      createInsertOp({ id: makeId("A", 1), parentId: null, side: "right", content: { type: "text", value: "h" } }),
      createInsertOp({ id: makeId("A", 2), parentId: makeId("A", 1), side: "right", content: { type: "text", value: "e" } }),
      createInsertOp({ id: makeId("A", 3), parentId: makeId("A", 2), side: "right", content: { type: "text", value: "l" } }),
      createInsertOp({ id: makeId("A", 4), parentId: makeId("A", 3), side: "right", content: { type: "text", value: "l" } }),
      createInsertOp({ id: makeId("A", 5), parentId: makeId("A", 4), side: "right", content: { type: "text", value: "o" } }),
      createDeleteOp({ id: makeId("A", 6), targetId: makeId("A", 2) }), // delete 'e'
      createDeleteOp({ id: makeId("A", 7), targetId: makeId("A", 4) }), // delete second 'l'
    ];
    doc = applyOperations({ doc, ops });
    expect(getDocumentText({ doc })).toBe("hlo");

    const peerVectors = [
      updateStateVector({ sv: createStateVector(), clientId: "A", clock: 7 }),
    ];

    const result = collectGarbage({ doc, peerStateVectors: peerVectors });
    expect(getDocumentText({ doc: result })).toBe("hlo");
    expect(result.store.length).toBe(3); // only non-deleted items
  });

  it("GC is optional — correctness unaffected if skipped", () => {
    let doc = createEmptyDocument();
    doc = applyOperation({
      doc,
      op: createInsertOp({ id: makeId("A", 1), parentId: null, side: "right", content: { type: "text", value: "x" } }),
    });
    doc = applyOperation({
      doc,
      op: createDeleteOp({ id: makeId("A", 2), targetId: makeId("A", 1) }),
    });

    // No GC — document still works correctly
    doc = applyOperation({
      doc,
      op: createInsertOp({ id: makeId("A", 3), parentId: null, side: "right", content: { type: "text", value: "y" } }),
    });
    expect(getDocumentText({ doc })).toBe("y");
  });
});
