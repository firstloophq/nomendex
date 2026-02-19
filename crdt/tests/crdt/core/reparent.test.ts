import { describe, expect, it } from "bun:test";
import {
  applyOperation,
  createEmptyDocument,
  type CRDTDoc,
} from "@/crdt/core/apply-operations";
import {
  createInsertOp,
  createReparentOp,
  createOperationId,
} from "@/crdt/core/operations";
import { getItemById } from "@/crdt/core/item";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

describe("ReparentOp", () => {
  function buildDocWithBlocks(): CRDTDoc {
    let doc = createEmptyDocument();
    // Container block (blockquote)
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "blockquote" },
      }),
    });
    // Paragraph (initially root-level)
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 2),
        parentId: makeId("A", 1),
        side: "right",
        content: { type: "block", blockType: "paragraph" },
      }),
    });
    return doc;
  }

  it("reparents a block to a new parent", () => {
    let doc = buildDocWithBlocks();
    doc = applyOperation({
      doc,
      op: createReparentOp({
        id: makeId("A", 3),
        targetId: makeId("A", 2),
        newParentBlockId: makeId("A", 1),
      }),
    });

    const item = getItemById({ store: doc.store, id: makeId("A", 2) });
    expect(item!.content.type).toBe("block");
    if (item!.content.type === "block") {
      expect(item!.content.parentBlockId).toEqual(makeId("A", 1));
    }
  });

  it("reparents a block to root (null parent)", () => {
    let doc = createEmptyDocument();
    // Paragraph inside a blockquote
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: {
          type: "block",
          blockType: "paragraph",
          parentBlockId: makeId("A", 99),
        },
      }),
    });
    doc = applyOperation({
      doc,
      op: createReparentOp({
        id: makeId("A", 2),
        targetId: makeId("A", 1),
        newParentBlockId: null,
      }),
    });

    const item = getItemById({ store: doc.store, id: makeId("A", 1) });
    if (item!.content.type === "block") {
      expect(item!.content.parentBlockId).toBeUndefined();
    }
  });

  it("is idempotent", () => {
    let doc = buildDocWithBlocks();
    const op = createReparentOp({
      id: makeId("A", 3),
      targetId: makeId("A", 2),
      newParentBlockId: makeId("A", 1),
    });
    doc = applyOperation({ doc, op });
    doc = applyOperation({ doc, op });

    const item = getItemById({ store: doc.store, id: makeId("A", 2) });
    if (item!.content.type === "block") {
      expect(item!.content.parentBlockId).toEqual(makeId("A", 1));
    }
  });

  it("handles pending reparent (target not yet inserted)", () => {
    let doc = createEmptyDocument();

    // Insert container first
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "blockquote" },
      }),
    });

    // Reparent before paragraph exists
    doc = applyOperation({
      doc,
      op: createReparentOp({
        id: makeId("A", 3),
        targetId: makeId("A", 2),
        newParentBlockId: makeId("A", 1),
      }),
    });

    // Now insert the paragraph
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 2),
        parentId: makeId("A", 1),
        side: "right",
        content: { type: "block", blockType: "paragraph" },
      }),
    });

    const item = getItemById({ store: doc.store, id: makeId("A", 2) });
    if (item!.content.type === "block") {
      expect(item!.content.parentBlockId).toEqual(makeId("A", 1));
    }
  });

  it("does not affect text items", () => {
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
      op: createReparentOp({
        id: makeId("A", 2),
        targetId: makeId("A", 1),
        newParentBlockId: makeId("A", 99),
      }),
    });

    const item = getItemById({ store: doc.store, id: makeId("A", 1) });
    expect(item!.content.type).toBe("text");
  });

  it("updates state vector", () => {
    let doc = buildDocWithBlocks();
    doc = applyOperation({
      doc,
      op: createReparentOp({
        id: makeId("A", 3),
        targetId: makeId("A", 2),
        newParentBlockId: makeId("A", 1),
      }),
    });

    expect(doc.stateVector.get("A")).toBe(3);
  });
});
