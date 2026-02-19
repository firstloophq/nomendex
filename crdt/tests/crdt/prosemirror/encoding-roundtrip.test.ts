import { describe, expect, it } from "bun:test";
import {
  createInsertOp,
  createAttrUpdateOp,
  createReparentOp,
  createOperationId,
  type Operation,
} from "@/crdt/core/operations";
import { encodeOperations, decodeOperations } from "@/crdt/network/encoding";
import { encodeSnapshot, decodeSnapshot, encodeRecordSnapshot, decodeRecordSnapshot } from "@/crdt/document/snapshot";
import {
  createEmptyDocument,
  applyOperation,
} from "@/crdt/core/apply-operations";
import { createRecord, applyRecordOp } from "@/crdt/document/record";
import { crdtToProseMirror } from "@/crdt/prosemirror/state-mapping";
import { Schema } from "prosemirror-model";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

describe("Encoding round-trips for new op types", () => {
  it("AttrUpdateOp round-trips through JSON encoding", () => {
    const ops: ReadonlyArray<Operation> = [
      createAttrUpdateOp({
        id: makeId("A", 1),
        targetId: makeId("A", 0),
        attr: "level",
        value: 3,
        oldValue: 1,
      }),
    ];

    const encoded = encodeOperations({ ops });
    const decoded = decodeOperations({ data: encoded });
    expect(decoded.length).toBe(1);
    const op = decoded[0]!;
    expect(op.type).toBe("attr_update");
    if (op.type === "attr_update") {
      expect(op.attr).toBe("level");
      expect(op.value).toBe(3);
      expect(op.oldValue).toBe(1);
      expect(op.targetId).toEqual(makeId("A", 0));
    }
  });

  it("ReparentOp round-trips through JSON encoding", () => {
    const ops: ReadonlyArray<Operation> = [
      createReparentOp({
        id: makeId("A", 1),
        targetId: makeId("A", 0),
        newParentBlockId: makeId("B", 5),
      }),
    ];

    const encoded = encodeOperations({ ops });
    const decoded = decodeOperations({ data: encoded });
    expect(decoded.length).toBe(1);
    const op = decoded[0]!;
    expect(op.type).toBe("reparent");
    if (op.type === "reparent") {
      expect(op.newParentBlockId).toEqual(makeId("B", 5));
      expect(op.targetId).toEqual(makeId("A", 0));
    }
  });

  it("InlineAtomContent round-trips through JSON encoding", () => {
    const ops: ReadonlyArray<Operation> = [
      createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "inline_atom", nodeType: "hard_break" },
      }),
      createInsertOp({
        id: makeId("A", 2),
        parentId: makeId("A", 1),
        side: "right",
        content: { type: "inline_atom", nodeType: "wiki_link", attrs: { href: "page", title: "My Page" } },
      }),
    ];

    const encoded = encodeOperations({ ops });
    const decoded = decodeOperations({ data: encoded });
    expect(decoded.length).toBe(2);

    const op1 = decoded[0]!;
    if (op1.type === "insert") {
      expect(op1.content.type).toBe("inline_atom");
      if (op1.content.type === "inline_atom") {
        expect(op1.content.nodeType).toBe("hard_break");
      }
    }

    const op2 = decoded[1]!;
    if (op2.type === "insert") {
      expect(op2.content.type).toBe("inline_atom");
      if (op2.content.type === "inline_atom") {
        expect(op2.content.nodeType).toBe("wiki_link");
        expect(op2.content.attrs?.href).toBe("page");
      }
    }
  });

  it("BlockContent with attrs and parentBlockId round-trips", () => {
    const ops: ReadonlyArray<Operation> = [
      createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: {
          type: "block",
          blockType: "heading",
          attrs: { level: 3 },
          parentBlockId: makeId("B", 1),
        },
      }),
    ];

    const encoded = encodeOperations({ ops });
    const decoded = decodeOperations({ data: encoded });
    const op = decoded[0]!;
    if (op.type === "insert" && op.content.type === "block") {
      expect(op.content.attrs?.level).toBe(3);
      expect(op.content.parentBlockId).toEqual(makeId("B", 1));
    }
  });

  it("null attrs round-trip", () => {
    const ops: ReadonlyArray<Operation> = [
      createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: {
          type: "block",
          blockType: "table_cell",
          attrs: { colwidth: null, colspan: 2 },
        },
      }),
    ];

    const encoded = encodeOperations({ ops });
    const decoded = decodeOperations({ data: encoded });
    const op = decoded[0]!;
    if (op.type === "insert" && op.content.type === "block") {
      expect(op.content.attrs?.colwidth).toBe(null);
      expect(op.content.attrs?.colspan).toBe(2);
    }
  });
});

describe("Snapshot round-trips for new content types", () => {
  it("CRDTDoc snapshot with block attrs and inline atoms", () => {
    let doc = createEmptyDocument();
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "heading", attrs: { level: 2 } },
      }),
    });
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 2),
        parentId: makeId("A", 1),
        side: "right",
        content: { type: "inline_atom", nodeType: "hard_break" },
      }),
    });

    const encoded = encodeSnapshot({ doc });
    const decoded = decodeSnapshot({ data: encoded });

    expect(decoded.store.items.length).toBe(2);
    const block = decoded.store.items[0]!;
    expect(block.content.type).toBe("block");
    if (block.content.type === "block") {
      expect(block.content.attrs?.level).toBe(2);
    }

    const atom = decoded.store.items[1]!;
    expect(atom.content.type).toBe("inline_atom");
    if (atom.content.type === "inline_atom") {
      expect(atom.content.nodeType).toBe("hard_break");
    }
  });

  it("CRDTDoc snapshot with parentBlockId", () => {
    let doc = createEmptyDocument();
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "blockquote" },
      }),
    });
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 2),
        parentId: makeId("A", 1),
        side: "right",
        content: { type: "block", blockType: "paragraph", parentBlockId: makeId("A", 1) },
      }),
    });

    const encoded = encodeSnapshot({ doc });
    const decoded = decodeSnapshot({ data: encoded });

    const para = decoded.store.items[1]!;
    if (para.content.type === "block") {
      expect(para.content.parentBlockId).toEqual(makeId("A", 1));
    }

    // Verify the decoded doc can accept new operations
    const newDoc = applyOperation({
      doc: decoded,
      op: createInsertOp({
        id: makeId("A", 3),
        parentId: makeId("A", 2),
        side: "right",
        content: { type: "text", value: "x" },
      }),
    });
    expect(newDoc.store.items.length).toBe(3);
  });

  it("CRDTRecord snapshot with blocks containing attrs", () => {
    let record = createRecord();
    record = applyRecordOp({
      record,
      op: createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "heading", attrs: { level: 3 } },
      }),
    });

    const encoded = encodeRecordSnapshot({ record });
    const decoded = decodeRecordSnapshot({ data: encoded });

    const block = decoded.body.store.items[0]!;
    if (block.content.type === "block") {
      expect(block.content.attrs?.level).toBe(3);
    }
  });
});

describe("RecordOp with new op types", () => {
  it("applyRecordOp handles attr_update", () => {
    let record = createRecord();
    record = applyRecordOp({
      record,
      op: createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "heading", attrs: { level: 1 } },
      }),
    });
    record = applyRecordOp({
      record,
      op: createAttrUpdateOp({
        id: makeId("A", 2),
        targetId: makeId("A", 1),
        attr: "level",
        value: 3,
      }),
    });

    const item = record.body.store.map.get("A:1")!;
    if (item.content.type === "block") {
      expect(item.content.attrs?.level).toBe(3);
    }
  });

  it("applyRecordOp handles reparent", () => {
    let record = createRecord();
    record = applyRecordOp({
      record,
      op: createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "blockquote" },
      }),
    });
    record = applyRecordOp({
      record,
      op: createInsertOp({
        id: makeId("A", 2),
        parentId: makeId("A", 1),
        side: "right",
        content: { type: "block", blockType: "paragraph" },
      }),
    });
    record = applyRecordOp({
      record,
      op: createReparentOp({
        id: makeId("A", 3),
        targetId: makeId("A", 2),
        newParentBlockId: makeId("A", 1),
      }),
    });

    const item = record.body.store.map.get("A:2")!;
    if (item.content.type === "block") {
      expect(item.content.parentBlockId).toEqual(makeId("A", 1));
    }
  });
});
