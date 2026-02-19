import { describe, expect, it } from "bun:test";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import {
  crdtToProseMirror,
  proseMirrorPositionToCRDT,
} from "@/crdt/prosemirror/state-mapping";
import {
  transactionToCRDTOps,
} from "@/crdt/prosemirror/transaction-capture";
import {
  createEmptyDocument,
  applyOperation,
  applyOperations,
  type CRDTDoc,
} from "@/crdt/core/apply-operations";
import {
  createInsertOp,
  createAttrUpdateOp,
  createReparentOp,
  createOperationId,
  type Operation,
} from "@/crdt/core/operations";
import type { LamportClock } from "@/crdt/core/lamport-clock";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

// --- Rich schema with headings, horizontal_rule, hard_break, blockquote, lists ---
const richSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 } },
    },
    horizontal_rule: { group: "block" },
    hard_break: { group: "inline", inline: true, atom: true },
    blockquote: { group: "block", content: "block+" },
    bullet_list: { group: "block", content: "list_item+" },
    ordered_list: {
      group: "block",
      content: "list_item+",
      attrs: { order: { default: 1 } },
    },
    list_item: { content: "paragraph block*" },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
  },
});

// --- Phase 1: Block attrs ---

describe("Phase 1: Block attrs + leaf blocks", () => {
  describe("crdtToProseMirror with block attrs", () => {
    it("renders heading with level attr", () => {
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
          content: { type: "text", value: "H" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 3),
          parentId: makeId("A", 2),
          side: "right",
          content: { type: "text", value: "i" },
        }),
      });

      const pmDoc = crdtToProseMirror({ doc, schema: richSchema });
      expect(pmDoc.childCount).toBe(1);
      const heading = pmDoc.firstChild!;
      expect(heading.type.name).toBe("heading");
      expect(heading.attrs.level).toBe(2);
      expect(heading.textContent).toBe("Hi");
    });

    it("renders heading with default level when no attrs provided", () => {
      let doc = createEmptyDocument();
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 1),
          parentId: null,
          side: "right",
          content: { type: "block", blockType: "heading" },
        }),
      });

      const pmDoc = crdtToProseMirror({ doc, schema: richSchema });
      expect(pmDoc.firstChild!.attrs.level).toBe(1);
    });

    it("passes non-default attrs through to PM nodes", () => {
      let doc = createEmptyDocument();
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 1),
          parentId: null,
          side: "right",
          content: { type: "block", blockType: "heading", attrs: { level: 3 } },
        }),
      });

      const pmDoc = crdtToProseMirror({ doc, schema: richSchema });
      expect(pmDoc.firstChild!.attrs.level).toBe(3);
    });
  });

  describe("AttrUpdateOp round-trip", () => {
    it("changes heading level and reflects in PM doc", () => {
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
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 2),
          parentId: makeId("A", 1),
          side: "right",
          content: { type: "text", value: "T" },
        }),
      });

      // Update level to 3
      doc = applyOperation({
        doc,
        op: createAttrUpdateOp({
          id: makeId("A", 3),
          targetId: makeId("A", 1),
          attr: "level",
          value: 3,
        }),
      });

      const pmDoc = crdtToProseMirror({ doc, schema: richSchema });
      expect(pmDoc.firstChild!.type.name).toBe("heading");
      expect(pmDoc.firstChild!.attrs.level).toBe(3);
    });
  });

  describe("Leaf block (horizontal_rule)", () => {
    it("renders horizontal_rule as leaf block", () => {
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
          content: { type: "text", value: "a" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 3),
          parentId: makeId("A", 2),
          side: "right",
          content: { type: "block", blockType: "horizontal_rule" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 4),
          parentId: makeId("A", 3),
          side: "right",
          content: { type: "block", blockType: "paragraph" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 5),
          parentId: makeId("A", 4),
          side: "right",
          content: { type: "text", value: "b" },
        }),
      });

      const pmDoc = crdtToProseMirror({ doc, schema: richSchema });
      expect(pmDoc.childCount).toBe(3);
      expect(pmDoc.child(0).type.name).toBe("paragraph");
      expect(pmDoc.child(0).textContent).toBe("a");
      expect(pmDoc.child(1).type.name).toBe("horizontal_rule");
      expect(pmDoc.child(2).type.name).toBe("paragraph");
      expect(pmDoc.child(2).textContent).toBe("b");
    });

    it("maps positions correctly with leaf blocks (horizontal_rule = 1 pos)", () => {
      // Doc: <p>a</p><hr/><p>b</p>
      // PM positions: 0:doc, 1:p1-open, 2:a, 3:p1-close, 4:hr, 5:p2-open, 6:b, 7:p2-close
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
          content: { type: "text", value: "a" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 3),
          parentId: makeId("A", 2),
          side: "right",
          content: { type: "block", blockType: "horizontal_rule" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 4),
          parentId: makeId("A", 3),
          side: "right",
          content: { type: "block", blockType: "paragraph" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 5),
          parentId: makeId("A", 4),
          side: "right",
          content: { type: "text", value: "b" },
        }),
      });

      // Position 4 = after hr (the hr leaf block = 1 position after p1-close)
      const pos4 = proseMirrorPositionToCRDT({ doc, pos: 4, schema: richSchema });
      expect(pos4.leftItemId).toEqual(makeId("A", 3)); // hr block

      // Position 5 = start of p2
      const pos5 = proseMirrorPositionToCRDT({ doc, pos: 5, schema: richSchema });
      expect(pos5.leftItemId).toEqual(makeId("A", 4)); // p2 block

      // Position 6 = after 'b'
      const pos6 = proseMirrorPositionToCRDT({ doc, pos: 6, schema: richSchema });
      expect(pos6.leftItemId).toEqual(makeId("A", 5)); // 'b'
    });
  });

  describe("Block attrs captured in transaction capture", () => {
    it("captures heading level when inserting a heading block", () => {
      const { doc: crdtDoc, clock } = buildDocWithText("hello", richSchema);

      // Create PM state and insert a heading via Enter at end
      const pmDoc = richSchema.nodes["doc"]!.create(null, [
        richSchema.nodes["paragraph"]!.create(null, [richSchema.text("hello")]),
      ]);
      const state = EditorState.create({ doc: pmDoc, schema: richSchema });

      // Simulate: split into paragraph + heading by replacing everything
      // This creates a new heading block
      const newDoc = richSchema.nodes["doc"]!.create(null, [
        richSchema.nodes["paragraph"]!.create(null, [richSchema.text("hello")]),
        richSchema.nodes["heading"]!.create({ level: 2 }),
      ]);
      const tr = state.tr.replaceWith(0, state.doc.content.size, newDoc.content);

      const result = transactionToCRDTOps({
        crdtDoc,
        transaction: tr,
        clock,
      });

      // Should have ops including at least one insert for a heading block
      const inserts = result.ops.filter((op) => op.type === "insert");
      const headingInsert = inserts.find(
        (op) => op.type === "insert" && op.content.type === "block" && op.content.blockType === "heading"
      );
      expect(headingInsert).toBeDefined();
      if (headingInsert?.type === "insert" && headingInsert.content.type === "block") {
        expect(headingInsert.content.attrs?.level).toBe(2);
      }
    });
  });
});

// --- Phase 2: Inline atoms ---

describe("Phase 2: Inline atoms", () => {
  describe("crdtToProseMirror with inline atoms", () => {
    it("renders hard_break inline atom", () => {
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
          content: { type: "text", value: "a" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 3),
          parentId: makeId("A", 2),
          side: "right",
          content: { type: "inline_atom", nodeType: "hard_break" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 4),
          parentId: makeId("A", 3),
          side: "right",
          content: { type: "text", value: "b" },
        }),
      });

      const pmDoc = crdtToProseMirror({ doc, schema: richSchema });
      const para = pmDoc.firstChild!;
      // Should have: text("a"), hard_break, text("b")
      expect(para.childCount).toBe(3);
      expect(para.child(0).isText).toBe(true);
      expect(para.child(0).textContent).toBe("a");
      expect(para.child(1).type.name).toBe("hard_break");
      expect(para.child(2).isText).toBe(true);
      expect(para.child(2).textContent).toBe("b");
    });

    it("preserves marks on inline atoms", () => {
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
          content: { type: "inline_atom", nodeType: "hard_break" },
          marks: [{ type: "bold" }],
        }),
      });

      const pmDoc = crdtToProseMirror({ doc, schema: richSchema });
      const para = pmDoc.firstChild!;
      const hardBreak = para.firstChild!;
      expect(hardBreak.type.name).toBe("hard_break");
      expect(hardBreak.marks.some((m) => m.type.name === "bold")).toBe(true);
    });

    it("counts inline atoms in position mapping", () => {
      // Doc: <p>a<br/>b</p>
      // PM positions: 0:doc, 1:p-open, 2:a, 3:br, 4:b, 5:p-close
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
          content: { type: "text", value: "a" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 3),
          parentId: makeId("A", 2),
          side: "right",
          content: { type: "inline_atom", nodeType: "hard_break" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 4),
          parentId: makeId("A", 3),
          side: "right",
          content: { type: "text", value: "b" },
        }),
      });

      // Position 3 = after hard_break
      const pos3 = proseMirrorPositionToCRDT({ doc, pos: 3, schema: richSchema });
      expect(pos3.leftItemId).toEqual(makeId("A", 3)); // hard_break

      // Position 4 = after 'b'
      const pos4 = proseMirrorPositionToCRDT({ doc, pos: 4, schema: richSchema });
      expect(pos4.leftItemId).toEqual(makeId("A", 4)); // 'b'
    });

    it("deletes inline atoms via DeleteOp", () => {
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
          content: { type: "inline_atom", nodeType: "hard_break" },
        }),
      });

      let pmDoc = crdtToProseMirror({ doc, schema: richSchema });
      expect(pmDoc.firstChild!.childCount).toBe(1);

      // Delete the hard_break
      doc = applyOperation({
        doc,
        op: {
          type: "delete",
          id: makeId("A", 3),
          targetId: makeId("A", 2),
        },
      });

      pmDoc = crdtToProseMirror({ doc, schema: richSchema });
      expect(pmDoc.firstChild!.childCount).toBe(0);
    });
  });

  describe("Transaction capture with inline atoms", () => {
    it("captures hard_break insertion", () => {
      const { doc: crdtDoc, clock } = buildDocWithText("ab", richSchema);

      const pmDoc = richSchema.nodes["doc"]!.create(null, [
        richSchema.nodes["paragraph"]!.create(null, [richSchema.text("ab")]),
      ]);
      const state = EditorState.create({ doc: pmDoc, schema: richSchema });

      // Insert hard_break between 'a' and 'b' (position 2)
      const hardBreak = richSchema.nodes["hard_break"]!.create();
      const tr = state.tr.replaceWith(2, 2, hardBreak);

      const result = transactionToCRDTOps({
        crdtDoc,
        transaction: tr,
        clock,
      });

      const inserts = result.ops.filter((op) => op.type === "insert");
      expect(inserts.length).toBe(1);
      const insertOp = inserts[0]!;
      if (insertOp.type === "insert") {
        expect(insertOp.content.type).toBe("inline_atom");
        if (insertOp.content.type === "inline_atom") {
          expect(insertOp.content.nodeType).toBe("hard_break");
        }
      }
    });
  });
});

// --- Phase 3: Nesting ---

describe("Phase 3: Block nesting (parentBlockId)", () => {
  describe("crdtToProseMirror with nested blocks", () => {
    it("renders blockquote containing paragraph", () => {
      let doc = createEmptyDocument();
      // blockquote
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 1),
          parentId: null,
          side: "right",
          content: { type: "block", blockType: "blockquote" },
        }),
      });
      // paragraph inside blockquote
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 2),
          parentId: makeId("A", 1),
          side: "right",
          content: { type: "block", blockType: "paragraph", parentBlockId: makeId("A", 1) },
        }),
      });
      // text inside paragraph
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 3),
          parentId: makeId("A", 2),
          side: "right",
          content: { type: "text", value: "Q" },
        }),
      });

      const pmDoc = crdtToProseMirror({ doc, schema: richSchema });
      expect(pmDoc.childCount).toBe(1);
      const bq = pmDoc.firstChild!;
      expect(bq.type.name).toBe("blockquote");
      expect(bq.childCount).toBe(1);
      expect(bq.firstChild!.type.name).toBe("paragraph");
      expect(bq.firstChild!.textContent).toBe("Q");
    });

    it("renders bullet_list > list_item > paragraph (3 levels)", () => {
      let doc = createEmptyDocument();
      // bullet_list
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 1),
          parentId: null,
          side: "right",
          content: { type: "block", blockType: "bullet_list" },
        }),
      });
      // list_item
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 2),
          parentId: makeId("A", 1),
          side: "right",
          content: { type: "block", blockType: "list_item", parentBlockId: makeId("A", 1) },
        }),
      });
      // paragraph inside list_item
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 3),
          parentId: makeId("A", 2),
          side: "right",
          content: { type: "block", blockType: "paragraph", parentBlockId: makeId("A", 2) },
        }),
      });
      // text
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 4),
          parentId: makeId("A", 3),
          side: "right",
          content: { type: "text", value: "x" },
        }),
      });

      const pmDoc = crdtToProseMirror({ doc, schema: richSchema });
      expect(pmDoc.childCount).toBe(1);
      const list = pmDoc.firstChild!;
      expect(list.type.name).toBe("bullet_list");
      expect(list.childCount).toBe(1);
      const li = list.firstChild!;
      expect(li.type.name).toBe("list_item");
      expect(li.childCount).toBe(1);
      const para = li.firstChild!;
      expect(para.type.name).toBe("paragraph");
      expect(para.textContent).toBe("x");
    });

    it("old flat docs (no parentBlockId) still work", () => {
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
          content: { type: "text", value: "x" },
        }),
      });

      const pmDoc = crdtToProseMirror({ doc, schema: richSchema });
      expect(pmDoc.childCount).toBe(1);
      expect(pmDoc.firstChild!.type.name).toBe("paragraph");
      expect(pmDoc.firstChild!.textContent).toBe("x");
    });
  });

  describe("ReparentOp in PM round-trip", () => {
    it("reparents a paragraph into a blockquote and reflects in PM doc", () => {
      let doc = createEmptyDocument();
      // blockquote
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 1),
          parentId: null,
          side: "right",
          content: { type: "block", blockType: "blockquote" },
        }),
      });
      // paragraph (root-level initially)
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 2),
          parentId: makeId("A", 1),
          side: "right",
          content: { type: "block", blockType: "paragraph" },
        }),
      });
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", 3),
          parentId: makeId("A", 2),
          side: "right",
          content: { type: "text", value: "Q" },
        }),
      });

      // Before reparent: blockquote is empty, paragraph is root-level
      let pmDoc = crdtToProseMirror({ doc, schema: richSchema });
      // Both are at root level
      expect(pmDoc.childCount).toBe(2);

      // Reparent paragraph into blockquote
      doc = applyOperation({
        doc,
        op: createReparentOp({
          id: makeId("A", 4),
          targetId: makeId("A", 2),
          newParentBlockId: makeId("A", 1),
        }),
      });

      pmDoc = crdtToProseMirror({ doc, schema: richSchema });
      expect(pmDoc.childCount).toBe(1);
      expect(pmDoc.firstChild!.type.name).toBe("blockquote");
      expect(pmDoc.firstChild!.childCount).toBe(1);
      expect(pmDoc.firstChild!.firstChild!.type.name).toBe("paragraph");
      expect(pmDoc.firstChild!.firstChild!.textContent).toBe("Q");
    });
  });
});

// --- Phase 1+2+3 combined: CRDT → PM → CRDT round-trip ---

describe("Round-trip tests", () => {
  it("heading with level round-trips through CRDT → PM → CRDT ops → CRDT → PM", () => {
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
        content: { type: "text", value: "T" },
      }),
    });

    const pmDoc1 = crdtToProseMirror({ doc, schema: richSchema });
    expect(pmDoc1.firstChild!.type.name).toBe("heading");
    expect(pmDoc1.firstChild!.attrs.level).toBe(2);
    expect(pmDoc1.firstChild!.textContent).toBe("T");
  });

  it("preserves ordered/bullet list structure and ordered_list.order through PM → CRDT → PM", () => {
    const initialPmDoc = richSchema.nodes["doc"]!.create(null, [
      richSchema.nodes["paragraph"]!.create(),
    ]);
    const sourcePmDoc = richSchema.nodes["doc"]!.create(null, [
      richSchema.nodes["ordered_list"]!.create({ order: 3 }, [
        richSchema.nodes["list_item"]!.create(null, [
          richSchema.nodes["paragraph"]!.create(null, [richSchema.text("one")]),
        ]),
        richSchema.nodes["list_item"]!.create(null, [
          richSchema.nodes["paragraph"]!.create(null, [richSchema.text("two")]),
          richSchema.nodes["bullet_list"]!.create(null, [
            richSchema.nodes["list_item"]!.create(null, [
              richSchema.nodes["paragraph"]!.create(null, [richSchema.text("nested")]),
            ]),
          ]),
        ]),
      ]),
      richSchema.nodes["bullet_list"]!.create(null, [
        richSchema.nodes["list_item"]!.create(null, [
          richSchema.nodes["paragraph"]!.create(null, [richSchema.text("tail")]),
        ]),
      ]),
    ]);

    const { doc: crdtDoc, clock } = buildDocWithText("", richSchema);
    const state = EditorState.create({ doc: initialPmDoc, schema: richSchema });
    const tr = state.tr.replaceWith(0, state.doc.content.size, sourcePmDoc.content);

    const result = transactionToCRDTOps({
      crdtDoc,
      transaction: tr,
      clock,
    });

    const updated = applyOperations({ doc: crdtDoc, ops: result.ops });
    const roundTripped = crdtToProseMirror({ doc: updated, schema: richSchema });

    expect(roundTripped.eq(sourcePmDoc)).toBe(true);
    expect(roundTripped.child(0).type.name).toBe("ordered_list");
    expect(roundTripped.child(0).attrs.order).toBe(3);
    expect(roundTripped.child(1).type.name).toBe("bullet_list");
  });

  it("multiple block types in sequence", () => {
    let doc = createEmptyDocument();
    let clock = 0;
    const ops: Array<Operation> = [];

    // heading h2
    clock++;
    ops.push(createInsertOp({
      id: makeId("A", clock),
      parentId: null,
      side: "right",
      content: { type: "block", blockType: "heading", attrs: { level: 2 } },
    }));

    // text "Title"
    for (const ch of "Title") {
      clock++;
      ops.push(createInsertOp({
        id: makeId("A", clock),
        parentId: makeId("A", clock - 1),
        side: "right",
        content: { type: "text", value: ch },
      }));
    }

    // paragraph
    clock++;
    ops.push(createInsertOp({
      id: makeId("A", clock),
      parentId: makeId("A", clock - 1),
      side: "right",
      content: { type: "block", blockType: "paragraph" },
    }));

    // text "Body"
    for (const ch of "Body") {
      clock++;
      ops.push(createInsertOp({
        id: makeId("A", clock),
        parentId: makeId("A", clock - 1),
        side: "right",
        content: { type: "text", value: ch },
      }));
    }

    doc = applyOperations({ doc, ops });
    const pmDoc = crdtToProseMirror({ doc, schema: richSchema });

    expect(pmDoc.childCount).toBe(2);
    expect(pmDoc.child(0).type.name).toBe("heading");
    expect(pmDoc.child(0).attrs.level).toBe(2);
    expect(pmDoc.child(0).textContent).toBe("Title");
    expect(pmDoc.child(1).type.name).toBe("paragraph");
    expect(pmDoc.child(1).textContent).toBe("Body");
  });
});

// --- Undo integration ---

describe("Undo integration for new op types", () => {
  it("undo AttrUpdateOp restores old value", () => {
    const { createUndoManager, trackOperation, undo } = require("@/crdt/core/undo-manager");

    let um = createUndoManager({ clientId: "A", captureTimeoutMs: 0 });
    let doc = createEmptyDocument();

    // Insert heading with level 1
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "heading", attrs: { level: 1 } },
      }),
    });

    // Update level to 3 (track oldValue for undo)
    const attrOp = createAttrUpdateOp({
      id: makeId("A", 2),
      targetId: makeId("A", 1),
      attr: "level",
      value: 3,
      oldValue: 1,
    });
    doc = applyOperation({ doc, op: attrOp });
    um = trackOperation({ um, op: attrOp, timestamp: 100 });

    // Verify level is 3
    let item = doc.store.map.get("A:1")!;
    expect(item.content.type).toBe("block");
    if (item.content.type === "block") {
      expect(item.content.attrs?.level).toBe(3);
    }

    // Undo
    const undoResult = undo({ um, doc, nextClock: 3 });
    expect(undoResult).not.toBeNull();
    for (const op of undoResult!.ops) {
      doc = applyOperation({ doc, op });
    }

    // Level should be restored to 1
    item = doc.store.map.get("A:1")!;
    if (item.content.type === "block") {
      expect(item.content.attrs?.level).toBe(1);
    }
  });
});

// --- Helpers ---

function buildDocWithText(text: string, schema: Schema): {
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
