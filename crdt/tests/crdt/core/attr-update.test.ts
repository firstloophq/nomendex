import { describe, expect, it } from "bun:test";
import {
  applyOperation,
  createEmptyDocument,
  type CRDTDoc,
} from "@/crdt/core/apply-operations";
import {
  createInsertOp,
  createAttrUpdateOp,
  createOperationId,
} from "@/crdt/core/operations";
import { getItemById } from "@/crdt/core/item";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

describe("AttrUpdateOp", () => {
  function buildDocWithBlock(): CRDTDoc {
    let doc = createEmptyDocument();
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "heading", attrs: { level: 1 } },
      }),
    });
    return doc;
  }

  it("changes block attrs", () => {
    let doc = buildDocWithBlock();
    doc = applyOperation({
      doc,
      op: createAttrUpdateOp({
        id: makeId("A", 2),
        targetId: makeId("A", 1),
        attr: "level",
        value: 3,
      }),
    });

    const item = getItemById({ store: doc.store, id: makeId("A", 1) });
    expect(item).toBeDefined();
    expect(item!.content.type).toBe("block");
    if (item!.content.type === "block") {
      expect(item!.content.attrs?.level).toBe(3);
    }
  });

  it("is idempotent", () => {
    let doc = buildDocWithBlock();
    const op = createAttrUpdateOp({
      id: makeId("A", 2),
      targetId: makeId("A", 1),
      attr: "level",
      value: 3,
    });
    doc = applyOperation({ doc, op });
    doc = applyOperation({ doc, op });

    const item = getItemById({ store: doc.store, id: makeId("A", 1) });
    expect(item!.content.type).toBe("block");
    if (item!.content.type === "block") {
      expect(item!.content.attrs?.level).toBe(3);
    }
  });

  it("handles pending attr update (target not yet inserted)", () => {
    let doc = createEmptyDocument();

    // Apply attr update before the block exists
    doc = applyOperation({
      doc,
      op: createAttrUpdateOp({
        id: makeId("A", 2),
        targetId: makeId("A", 1),
        attr: "level",
        value: 3,
      }),
    });

    // Now insert the block
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "heading", attrs: { level: 1 } },
      }),
    });

    const item = getItemById({ store: doc.store, id: makeId("A", 1) });
    expect(item!.content.type).toBe("block");
    if (item!.content.type === "block") {
      expect(item!.content.attrs?.level).toBe(3);
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
      op: createAttrUpdateOp({
        id: makeId("A", 2),
        targetId: makeId("A", 1),
        attr: "level",
        value: 3,
      }),
    });

    // Text item should remain unchanged
    const item = getItemById({ store: doc.store, id: makeId("A", 1) });
    expect(item!.content.type).toBe("text");
  });

  it("can set attr to null", () => {
    let doc = buildDocWithBlock();
    doc = applyOperation({
      doc,
      op: createAttrUpdateOp({
        id: makeId("A", 2),
        targetId: makeId("A", 1),
        attr: "level",
        value: null,
      }),
    });

    const item = getItemById({ store: doc.store, id: makeId("A", 1) });
    if (item!.content.type === "block") {
      expect(item!.content.attrs?.level).toBe(null);
    }
  });

  it("adds new attr to block without existing attrs", () => {
    let doc = createEmptyDocument();
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "paragraph" },
      }),
    });
    doc = applyOperation({
      doc,
      op: createAttrUpdateOp({
        id: makeId("A", 2),
        targetId: makeId("A", 1),
        attr: "alignment",
        value: "center",
      }),
    });

    const item = getItemById({ store: doc.store, id: makeId("A", 1) });
    if (item!.content.type === "block") {
      expect(item!.content.attrs?.alignment).toBe("center");
    }
  });

  it("works on inline_atom content", () => {
    let doc = createEmptyDocument();
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "inline_atom", nodeType: "image", attrs: { src: "old.png" } },
      }),
    });
    doc = applyOperation({
      doc,
      op: createAttrUpdateOp({
        id: makeId("A", 2),
        targetId: makeId("A", 1),
        attr: "src",
        value: "new.png",
      }),
    });

    const item = getItemById({ store: doc.store, id: makeId("A", 1) });
    if (item!.content.type === "inline_atom") {
      expect(item!.content.attrs?.src).toBe("new.png");
    }
  });

  it("updates state vector", () => {
    let doc = buildDocWithBlock();
    doc = applyOperation({
      doc,
      op: createAttrUpdateOp({
        id: makeId("A", 2),
        targetId: makeId("A", 1),
        attr: "level",
        value: 3,
      }),
    });

    expect(doc.stateVector.get("A")).toBe(2);
  });
});
