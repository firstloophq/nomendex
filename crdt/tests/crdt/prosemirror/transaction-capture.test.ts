import { describe, expect, it } from "bun:test";
import { Schema } from "prosemirror-model";
import { schema as markdownSchema } from "prosemirror-markdown";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import { ReplaceStep, AddMarkStep, RemoveMarkStep } from "prosemirror-transform";
import { wrapInList } from "prosemirror-schema-list";
import {
  transactionToCRDTOps,
} from "@/crdt/prosemirror/transaction-capture";
import {
  createEmptyDocument,
  applyOperation,
  applyOperations,
  getDocumentText,
  type CRDTDoc,
} from "@/crdt/core/apply-operations";
import {
  createInsertOp,
  createOperationId,
} from "@/crdt/core/operations";
import { createClock, type LamportClock } from "@/crdt/core/lamport-clock";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

function asTransaction(params: {
  doc: Transaction["doc"];
  steps: Transaction["steps"];
}): Transaction {
  return {
    doc: params.doc,
    steps: params.steps,
  } as unknown as Transaction;
}

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
  },
});

function buildDocWithText(text: string): {
  doc: CRDTDoc;
  clock: LamportClock;
} {
  let doc = createEmptyDocument();
  let clockVal = 0;
  const clientId = "A";

  // Insert paragraph
  clockVal++;
  doc = applyOperation({
    doc,
    op: createInsertOp({
      id: makeId(clientId, clockVal),
      parentId: null,
      side: "right",
      content: { type: "block", blockType: "paragraph" },
    }),
  });

  // Insert characters
  for (let i = 0; i < text.length; i++) {
    clockVal++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId(clientId, clockVal),
        parentId: makeId(clientId, clockVal - 1),
        side: "right",
        content: { type: "text", value: text[i]! },
      }),
    });
  }

  return { doc, clock: { clientId, counter: clockVal } };
}

describe("transactionToCRDTOps", () => {
  it("converts a single character insert", () => {
    const { doc: crdtDoc, clock } = buildDocWithText("hllo");

    // Create a PM state matching "hllo" and insert "e" at position 2
    const pmDoc = schema.nodes["doc"]!.create(null, [
      schema.nodes["paragraph"]!.create(null, [schema.text("hllo")]),
    ]);
    const state = EditorState.create({ doc: pmDoc, schema });

    // Create a transaction that inserts "e" at position 2
    const tr = state.tr.insertText("e", 2, 2);

    const result = transactionToCRDTOps({
      crdtDoc,
      transaction: tr,
      clock,
    });

    expect(result.ops.length).toBe(1);
    expect(result.ops[0]!.type).toBe("insert");
    if (result.ops[0]!.type === "insert") {
      expect(result.ops[0]!.content).toEqual({ type: "text", value: "e" });
    }
  });

  it("captures insert ops when ReplaceStep comes from a different runtime copy", () => {
    const { doc: crdtDoc, clock } = buildDocWithText("hllo");
    const pmDoc = schema.nodes["doc"]!.create(null, [
      schema.nodes["paragraph"]!.create(null, [schema.text("hllo")]),
    ]);
    const state = EditorState.create({ doc: pmDoc, schema });
    const tr = state.tr.insertText("e", 2, 2);

    const replaceStep = tr.steps[0] as ReplaceStep;
    const foreignStep = {
      from: replaceStep.from,
      to: replaceStep.to,
      slice: replaceStep.slice,
      toJSON: () => replaceStep.toJSON(),
      constructor: { name: "ReplaceStep" },
    };

    const result = transactionToCRDTOps({
      crdtDoc,
      transaction: asTransaction({ doc: tr.doc, steps: [foreignStep as unknown as Transaction["steps"][number]] }),
      clock,
    });

    expect(result.ops.length).toBe(1);
    expect(result.ops[0]!.type).toBe("insert");
  });

  it("converts a single character delete", () => {
    const { doc: crdtDoc, clock } = buildDocWithText("hello");

    const pmDoc = schema.nodes["doc"]!.create(null, [
      schema.nodes["paragraph"]!.create(null, [schema.text("hello")]),
    ]);
    const state = EditorState.create({ doc: pmDoc, schema });

    // Delete "e" (position 2 to 3)
    const tr = state.tr.delete(2, 3);

    const result = transactionToCRDTOps({
      crdtDoc,
      transaction: tr,
      clock,
    });

    expect(result.ops.length).toBe(1);
    expect(result.ops[0]!.type).toBe("delete");
  });

  it("converts replacing selected text", () => {
    const { doc: crdtDoc, clock } = buildDocWithText("hello");

    const pmDoc = schema.nodes["doc"]!.create(null, [
      schema.nodes["paragraph"]!.create(null, [schema.text("hello")]),
    ]);
    const state = EditorState.create({ doc: pmDoc, schema });

    // Replace "ell" (pos 2-5) with "a"
    const tr = state.tr.insertText("a", 2, 5);

    const result = transactionToCRDTOps({
      crdtDoc,
      transaction: tr,
      clock,
    });

    // Should have 3 deletes + 1 insert
    const deletes = result.ops.filter((op) => op.type === "delete");
    const inserts = result.ops.filter((op) => op.type === "insert");
    expect(deletes.length).toBe(3);
    expect(inserts.length).toBe(1);
  });

  it("converts full-document deletion to delete ops for all visible items", () => {
    const text = "x".repeat(400);
    const { doc: crdtDoc, clock } = buildDocWithText(text);

    const pmDoc = schema.nodes["doc"]!.create(null, [
      schema.nodes["paragraph"]!.create(null, [schema.text(text)]),
    ]);
    const state = EditorState.create({ doc: pmDoc, schema });

    const tr = state.tr.delete(0, state.doc.content.size);

    const result = transactionToCRDTOps({
      crdtDoc,
      transaction: tr,
      clock,
    });

    const visibleItems = crdtDoc.store.items.filter((item) => !item.deleted);
    const deletes = result.ops.filter((op) => op.type === "delete");
    const inserts = result.ops.filter((op) => op.type === "insert");
    expect(deletes.length).toBe(visibleItems.length);
    // PM keeps the document valid by inserting an empty paragraph after full delete.
    expect(inserts.length).toBe(1);
  });

  it("converts very large full-document deletion to a single delete_batch op", () => {
    const text = "x".repeat(5000);
    const { doc: crdtDoc, clock } = buildDocWithText(text);

    const pmDoc = schema.nodes["doc"]!.create(null, [
      schema.nodes["paragraph"]!.create(null, [schema.text(text)]),
    ]);
    const state = EditorState.create({ doc: pmDoc, schema });

    const tr = state.tr.delete(0, state.doc.content.size);

    const result = transactionToCRDTOps({
      crdtDoc,
      transaction: tr,
      clock,
    });

    const deleteBatches = result.ops.filter((op) => op.type === "delete_batch");
    expect(deleteBatches.length).toBe(1);
    if (deleteBatches[0]?.type === "delete_batch") {
      const visibleItems = crdtDoc.store.items.filter((item) => !item.deleted);
      expect(deleteBatches[0].targetIds.length).toBe(visibleItems.length);
    }
  });

  it("converts adding a bold mark", () => {
    const { doc: crdtDoc, clock } = buildDocWithText("hello");

    const pmDoc = schema.nodes["doc"]!.create(null, [
      schema.nodes["paragraph"]!.create(null, [schema.text("hello")]),
    ]);
    const state = EditorState.create({ doc: pmDoc, schema });

    // Bold "ell" (positions 2-5)
    const tr = state.tr.addMark(2, 5, schema.marks["bold"]!.create());

    const result = transactionToCRDTOps({
      crdtDoc,
      transaction: tr,
      clock,
    });

    const formats = result.ops.filter((op) => op.type === "format");
    expect(formats.length).toBe(3);
    for (const op of formats) {
      if (op.type === "format") {
        expect(op.mark.type).toBe("bold");
        expect(op.action).toBe("add");
      }
    }
  });

  it("captures mark ops when AddMarkStep is not an instanceof match", () => {
    const { doc: crdtDoc, clock } = buildDocWithText("hello");

    const pmDoc = schema.nodes["doc"]!.create(null, [
      schema.nodes["paragraph"]!.create(null, [schema.text("hello")]),
    ]);
    const state = EditorState.create({ doc: pmDoc, schema });
    const tr = state.tr.addMark(2, 5, schema.marks["bold"]!.create());

    const addMarkStep = tr.steps[0] as AddMarkStep;
    const foreignStep = {
      from: addMarkStep.from,
      to: addMarkStep.to,
      mark: addMarkStep.mark,
      toJSON: () => addMarkStep.toJSON(),
      constructor: { name: "AddMarkStep" },
    };

    const result = transactionToCRDTOps({
      crdtDoc,
      transaction: asTransaction({ doc: tr.doc, steps: [foreignStep as unknown as Transaction["steps"][number]] }),
      clock,
    });

    const formats = result.ops.filter((op) => op.type === "format");
    expect(formats.length).toBe(3);
    for (const op of formats) {
      if (op.type === "format") {
        expect(op.action).toBe("add");
        expect(op.mark.type).toBe("bold");
      }
    }
  });

  it("converts a delete in the second paragraph correctly", () => {
    // Build a two-paragraph doc: "abcdef" | "This is a test"
    let doc = createEmptyDocument();
    let clockVal = 0;
    const clientId = "A";

    // First paragraph
    clockVal++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId(clientId, clockVal),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "paragraph" },
      }),
    });

    const p1Text = "abcdef";
    for (let i = 0; i < p1Text.length; i++) {
      clockVal++;
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId(clientId, clockVal),
          parentId: makeId(clientId, clockVal - 1),
          side: "right",
          content: { type: "text", value: p1Text[i]! },
        }),
      });
    }

    // Second paragraph
    clockVal++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId(clientId, clockVal),
        parentId: makeId(clientId, clockVal - 1),
        side: "right",
        content: { type: "block", blockType: "paragraph" },
      }),
    });

    const p2Text = "This is a test";
    for (let i = 0; i < p2Text.length; i++) {
      clockVal++;
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId(clientId, clockVal),
          parentId: makeId(clientId, clockVal - 1),
          side: "right",
          content: { type: "text", value: p2Text[i]! },
        }),
      });
    }

    const clock: LamportClock = { clientId, counter: clockVal };

    // PM doc: <doc><p>abcdef</p><p>This is a test</p></doc>
    // PM positions: 1:p1-open, 2-7:abcdef, 8:p1-close, 9:p2-open, 10-23:This is a test
    // "is a" in "This is a test" = positions 15-19 (T:10, h:11, i:12, s:13, ' ':14, i:15, s:16, ' ':17, a:18, ' ':19)
    // Delete from=14 to=18 → deletes 'i','s',' ','a'
    const pmDoc = schema.nodes["doc"]!.create(null, [
      schema.nodes["paragraph"]!.create(null, [schema.text("abcdef")]),
      schema.nodes["paragraph"]!.create(null, [schema.text("This is a test")]),
    ]);
    const state = EditorState.create({ doc: pmDoc, schema });

    // Delete "is a" from second paragraph: from=14, to=18
    // Position 14 = after ' ' (space after "This"), position 18 = after 'a' (in "is a")
    const tr = state.tr.delete(14, 18);

    const result = transactionToCRDTOps({
      crdtDoc: doc,
      transaction: tr,
      clock,
    });

    const deletes = result.ops.filter((op) => op.type === "delete");
    expect(deletes.length).toBe(4);

    // Verify the correct CRDT items are targeted
    // "is a" = 'i','s',' ','a' in second paragraph
    // In our CRDT, p2 text starts at clock 9 (p2 block is clock 8)
    // T:9, h:10, i:11, s:12, ' ':13, i:14, s:15, ' ':16, a:17, ' ':18, t:19, e:20, s:21, t:22
    // "is a" = items at clock 14, 15, 16, 17
    for (const op of deletes) {
      if (op.type === "delete") {
        expect(op.targetId.clientId).toBe(clientId);
        expect(op.targetId.clock).toBeGreaterThanOrEqual(14);
        expect(op.targetId.clock).toBeLessThanOrEqual(17);
      }
    }
  });

  it("converts removing a mark", () => {
    // Build a doc where "ell" is bold
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
      op: createInsertOp({
        id: makeId("A", 2),
        parentId: makeId("A", 1),
        side: "right",
        content: { type: "text", value: "h" },
      }),
    });
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 3),
        parentId: makeId("A", 2),
        side: "right",
        content: { type: "text", value: "e" },
        marks: [{ type: "bold" }],
      }),
    });
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 4),
        parentId: makeId("A", 3),
        side: "right",
        content: { type: "text", value: "l" },
        marks: [{ type: "bold" }],
      }),
    });
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 5),
        parentId: makeId("A", 4),
        side: "right",
        content: { type: "text", value: "l" },
        marks: [{ type: "bold" }],
      }),
    });
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 6),
        parentId: makeId("A", 5),
        side: "right",
        content: { type: "text", value: "o" },
      }),
    });

    const clock: LamportClock = { clientId: "A", counter: 6 };

    const pmDoc = schema.nodes["doc"]!.create(null, [
      schema.nodes["paragraph"]!.create(null, [
        schema.text("h"),
        schema.text("ell", [schema.marks["bold"]!.create()]),
        schema.text("o"),
      ]),
    ]);
    const state = EditorState.create({ doc: pmDoc, schema });

    // Remove bold from "ell" (positions 2-5)
    const tr = state.tr.removeMark(2, 5, schema.marks["bold"]!.create());

    const result = transactionToCRDTOps({
      crdtDoc: doc,
      transaction: tr,
      clock,
    });

    const formats = result.ops.filter((op) => op.type === "format");
    expect(formats.length).toBe(3);
    for (const op of formats) {
      if (op.type === "format") {
        expect(op.action).toBe("remove");
      }
    }
  });

  it("captures full wrapper chain for list ReplaceAroundStep", () => {
    // CRDT state: doc with a single paragraph containing "-"
    let crdtDoc = createEmptyDocument();
    crdtDoc = applyOperation({
      doc: crdtDoc,
      op: createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "paragraph" },
      }),
    });
    crdtDoc = applyOperation({
      doc: crdtDoc,
      op: createInsertOp({
        id: makeId("A", 2),
        parentId: makeId("A", 1),
        side: "right",
        content: { type: "text", value: "-" },
      }),
    });

    const clock: LamportClock = { clientId: "A", counter: 2 };
    const pmDoc = markdownSchema.nodes["doc"]!.create(null, [
      markdownSchema.nodes["paragraph"]!.create(null, [markdownSchema.text("-")]),
    ]);
    let state = EditorState.create({ doc: pmDoc, schema: markdownSchema });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));

    let wrapTr: Transaction | null = null;
    const wrapped = wrapInList(markdownSchema.nodes["bullet_list"]!)(
      state,
      (tr) => {
        wrapTr = tr;
      }
    );

    expect(wrapped).toBe(true);
    expect(wrapTr).not.toBeNull();

    const result = transactionToCRDTOps({
      crdtDoc,
      transaction: wrapTr!,
      clock,
    });

    const insertedBlocks = result.ops.filter(
      (op): op is Extract<typeof op, { type: "insert" }> =>
        op.type === "insert" && op.content.type === "block"
    );
    const insertedBlockContents = insertedBlocks.map((op) => op.content).filter(
      (content): content is Extract<typeof content, { type: "block" }> => content.type === "block"
    );
    expect(insertedBlockContents.some((content) => content.blockType === "bullet_list")).toBe(true);
    expect(insertedBlockContents.some((content) => content.blockType === "list_item")).toBe(true);

    const listItemInsert = insertedBlocks.find(
      (op): op is (typeof insertedBlocks)[number] =>
        op.content.type === "block" && op.content.blockType === "list_item"
    );
    expect(listItemInsert).toBeDefined();

    const reparentParagraph = result.ops.find(
      (op): op is Extract<typeof op, { type: "reparent" }> =>
        op.type === "reparent" && op.targetId.clientId === "A" && op.targetId.clock === 1
    );
    expect(reparentParagraph).toBeDefined();
    expect(reparentParagraph!.newParentBlockId).toEqual(listItemInsert!.id);
  });
});
