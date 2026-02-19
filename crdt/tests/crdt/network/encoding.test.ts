import { describe, expect, it } from "bun:test";
import {
  encodeOperations,
  decodeOperations,
} from "@/crdt/network/encoding";
import {
  createInsertOp,
  createDeleteOp,
  createFormatOp,
  createOperationId,
  type Operation,
} from "@/crdt/core/operations";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

describe("encoding", () => {
  it("encodes and decodes an insert op", () => {
    const op = createInsertOp({
      id: makeId("A", 1),
      parentId: null,
      side: "right",
      content: { type: "text", value: "h" },
    });
    const encoded = encodeOperations({ ops: [op] });
    const decoded = decodeOperations({ data: encoded });
    expect(decoded).toEqual([op]);
  });

  it("encodes and decodes a delete op", () => {
    const op = createDeleteOp({
      id: makeId("A", 2),
      targetId: makeId("A", 1),
    });
    const encoded = encodeOperations({ ops: [op] });
    const decoded = decodeOperations({ data: encoded });
    expect(decoded).toEqual([op]);
  });

  it("encodes and decodes a format op", () => {
    const op = createFormatOp({
      id: makeId("A", 3),
      targetId: makeId("A", 1),
      mark: { type: "bold" },
      action: "add",
    });
    const encoded = encodeOperations({ ops: [op] });
    const decoded = decodeOperations({ data: encoded });
    expect(decoded).toEqual([op]);
  });

  it("encodes and decodes an insert with marks", () => {
    const op = createInsertOp({
      id: makeId("A", 1),
      parentId: makeId("A", 0),
      side: "right",
      content: { type: "text", value: "b" },
      marks: [{ type: "bold" }, { type: "italic" }],
    });
    const encoded = encodeOperations({ ops: [op] });
    const decoded = decodeOperations({ data: encoded });
    expect(decoded).toEqual([op]);
  });

  it("encodes and decodes a batch of 100 mixed operations", () => {
    const ops: Array<Operation> = [];
    for (let i = 1; i <= 50; i++) {
      ops.push(
        createInsertOp({
          id: makeId("A", i),
          parentId: i > 1 ? makeId("A", i - 1) : null,
          side: "right",
          content: { type: "text", value: String.fromCharCode(97 + (i % 26)) },
        })
      );
    }
    for (let i = 1; i <= 30; i++) {
      ops.push(
        createDeleteOp({
          id: makeId("B", i),
          targetId: makeId("A", i),
        })
      );
    }
    for (let i = 1; i <= 20; i++) {
      ops.push(
        createFormatOp({
          id: makeId("C", i),
          targetId: makeId("A", i + 30),
          mark: { type: "bold" },
          action: "add",
        })
      );
    }

    const encoded = encodeOperations({ ops });
    const decoded = decodeOperations({ data: encoded });
    expect(decoded).toEqual(ops);
  });

  it("handles empty operation list", () => {
    const encoded = encodeOperations({ ops: [] });
    const decoded = decodeOperations({ data: encoded });
    expect(decoded).toEqual([]);
  });

  it("throws on invalid data", () => {
    expect(() => decodeOperations({ data: new Uint8Array([0, 1, 2]) })).toThrow();
  });

  it("encodes to Uint8Array", () => {
    const op = createInsertOp({
      id: makeId("A", 1),
      parentId: null,
      side: "right",
      content: { type: "text", value: "x" },
    });
    const encoded = encodeOperations({ ops: [op] });
    expect(encoded).toBeInstanceOf(Uint8Array);
  });
});
