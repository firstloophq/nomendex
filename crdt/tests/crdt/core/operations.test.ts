import { describe, expect, it } from "bun:test";
import type {
  OperationId,
  InsertOp,
  DeleteOp,
  FormatOp,
  Operation,
} from "@/crdt/core/operations";
import {
  createOperationId,
  createInsertOp,
  createDeleteOp,
  createFormatOp,
  operationIdEquals,
} from "@/crdt/core/operations";

describe("OperationId", () => {
  it("creates an operation ID from clientId and clock", () => {
    const id = createOperationId({ clientId: "A", clock: 1 });
    expect(id.clientId).toBe("A");
    expect(id.clock).toBe(1);
  });

  it("equality check works for matching IDs", () => {
    const a = createOperationId({ clientId: "A", clock: 1 });
    const b = createOperationId({ clientId: "A", clock: 1 });
    expect(operationIdEquals({ a, b })).toBe(true);
  });

  it("equality check fails for different IDs", () => {
    const a = createOperationId({ clientId: "A", clock: 1 });
    const b = createOperationId({ clientId: "A", clock: 2 });
    expect(operationIdEquals({ a, b })).toBe(false);
  });

  it("equality check fails for different clients", () => {
    const a = createOperationId({ clientId: "A", clock: 1 });
    const b = createOperationId({ clientId: "B", clock: 1 });
    expect(operationIdEquals({ a, b })).toBe(false);
  });
});

describe("InsertOp", () => {
  it("creates an insert operation", () => {
    const op = createInsertOp({
      id: createOperationId({ clientId: "A", clock: 1 }),
      parentId: null,
      side: "right",
      content: { type: "text", value: "h" },
    });
    expect(op.type).toBe("insert");
    expect(op.content.type === "text" && op.content.value).toBe("h");
    expect(op.parentId).toBeNull();
    expect(op.side).toBe("right");
  });

  it("supports marks", () => {
    const op = createInsertOp({
      id: createOperationId({ clientId: "A", clock: 1 }),
      parentId: createOperationId({ clientId: "A", clock: 0 }),
      side: "right",
      content: { type: "text", value: "b" },
      marks: [{ type: "bold" }],
    });
    expect(op.marks).toEqual([{ type: "bold" }]);
  });

  it("has no marks by default", () => {
    const op = createInsertOp({
      id: createOperationId({ clientId: "A", clock: 1 }),
      parentId: null,
      side: "right",
      content: { type: "text", value: "x" },
    });
    expect(op.marks).toBeUndefined();
  });
});

describe("DeleteOp", () => {
  it("creates a delete operation", () => {
    const targetId = createOperationId({ clientId: "A", clock: 1 });
    const op = createDeleteOp({
      id: createOperationId({ clientId: "B", clock: 2 }),
      targetId,
    });
    expect(op.type).toBe("delete");
    expect(op.targetId).toEqual(targetId);
  });
});

describe("FormatOp", () => {
  it("creates an add-mark format operation", () => {
    const targetId = createOperationId({ clientId: "A", clock: 1 });
    const op = createFormatOp({
      id: createOperationId({ clientId: "B", clock: 2 }),
      targetId,
      mark: { type: "bold" },
      action: "add",
    });
    expect(op.type).toBe("format");
    expect(op.mark).toEqual({ type: "bold" });
    expect(op.action).toBe("add");
  });

  it("creates a remove-mark format operation", () => {
    const targetId = createOperationId({ clientId: "A", clock: 1 });
    const op = createFormatOp({
      id: createOperationId({ clientId: "B", clock: 3 }),
      targetId,
      mark: { type: "italic" },
      action: "remove",
    });
    expect(op.action).toBe("remove");
  });
});

describe("Operation discriminated union", () => {
  it("narrows insert operations", () => {
    const op: Operation = createInsertOp({
      id: createOperationId({ clientId: "A", clock: 1 }),
      parentId: null,
      side: "right",
      content: { type: "text", value: "x" },
    });
    if (op.type === "insert") {
      expect(op.content.type === "text" && op.content.value).toBe("x");
    } else {
      throw new Error("should be insert");
    }
  });

  it("narrows delete operations", () => {
    const op: Operation = createDeleteOp({
      id: createOperationId({ clientId: "A", clock: 1 }),
      targetId: createOperationId({ clientId: "B", clock: 1 }),
    });
    if (op.type === "delete") {
      expect(op.targetId.clientId).toBe("B");
    } else {
      throw new Error("should be delete");
    }
  });

  it("narrows format operations", () => {
    const op: Operation = createFormatOp({
      id: createOperationId({ clientId: "A", clock: 1 }),
      targetId: createOperationId({ clientId: "B", clock: 1 }),
      mark: { type: "bold" },
      action: "add",
    });
    if (op.type === "format") {
      expect(op.mark.type).toBe("bold");
    } else {
      throw new Error("should be format");
    }
  });
});

describe("serialization", () => {
  it("insert op round-trips through JSON", () => {
    const op = createInsertOp({
      id: createOperationId({ clientId: "A", clock: 1 }),
      parentId: createOperationId({ clientId: "A", clock: 0 }),
      side: "right",
      content: { type: "text", value: "h" },
      marks: [{ type: "bold" }],
    });
    const json = JSON.stringify(op);
    const parsed = JSON.parse(json) as InsertOp;
    expect(parsed).toEqual(op);
  });

  it("delete op round-trips through JSON", () => {
    const op = createDeleteOp({
      id: createOperationId({ clientId: "A", clock: 2 }),
      targetId: createOperationId({ clientId: "A", clock: 1 }),
    });
    const json = JSON.stringify(op);
    const parsed = JSON.parse(json) as DeleteOp;
    expect(parsed).toEqual(op);
  });

  it("format op round-trips through JSON", () => {
    const op = createFormatOp({
      id: createOperationId({ clientId: "A", clock: 3 }),
      targetId: createOperationId({ clientId: "A", clock: 1 }),
      mark: { type: "italic" },
      action: "add",
    });
    const json = JSON.stringify(op);
    const parsed = JSON.parse(json) as FormatOp;
    expect(parsed).toEqual(op);
  });
});
