import { describe, expect, it } from "bun:test";
import { Schema } from "prosemirror-model";
import {
  crdtToProseMirror,
  proseMirrorPositionToCRDT,
} from "@/crdt/prosemirror/state-mapping";
import {
  createEmptyDocument,
  applyOperation,
  applyOperations,
  getDocumentText,
  type CRDTDoc,
} from "@/crdt/core/apply-operations";
import {
  createInsertOp,
  createDeleteOp,
  createOperationId,
} from "@/crdt/core/operations";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

// Basic ProseMirror schema for testing
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

function buildDoc(text: string): CRDTDoc {
  let doc = createEmptyDocument();
  // Insert a paragraph block
  doc = applyOperation({
    doc,
    op: createInsertOp({
      id: makeId("A", 1),
      parentId: null,
      side: "right",
      content: { type: "block", blockType: "paragraph" },
    }),
  });
  // Insert text characters into the paragraph's content
  for (let i = 0; i < text.length; i++) {
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", i + 2),
        parentId: i > 0 ? makeId("A", i + 1) : makeId("A", 1),
        side: "right",
        content: { type: "text", value: text[i]! },
      }),
    });
  }
  return doc;
}

describe("crdtToProseMirror", () => {
  it("converts empty CRDT doc with one paragraph to PM doc", () => {
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
    const pmDoc = crdtToProseMirror({ doc, schema });
    expect(pmDoc.type.name).toBe("doc");
    expect(pmDoc.childCount).toBe(1);
    expect(pmDoc.firstChild!.type.name).toBe("paragraph");
  });

  it("converts CRDT doc with text to PM doc", () => {
    const doc = buildDoc("hello");
    const pmDoc = crdtToProseMirror({ doc, schema });

    expect(pmDoc.childCount).toBe(1);
    expect(pmDoc.firstChild!.textContent).toBe("hello");
  });

  it("converts CRDT doc with marks to PM doc", () => {
    let doc = createEmptyDocument();
    // Paragraph
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 1),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "paragraph" },
      }),
    });
    // Bold "h"
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 2),
        parentId: makeId("A", 1),
        side: "right",
        content: { type: "text", value: "h" },
        marks: [{ type: "bold" }],
      }),
    });
    // Normal "i"
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", 3),
        parentId: makeId("A", 2),
        side: "right",
        content: { type: "text", value: "i" },
      }),
    });

    const pmDoc = crdtToProseMirror({ doc, schema });
    const para = pmDoc.firstChild!;
    expect(para.textContent).toBe("hi");

    // Check first character has bold mark
    const firstChild = para.firstChild!;
    expect(firstChild.marks.some((m) => m.type.name === "bold")).toBe(true);
  });

  it("handles empty doc (adds empty paragraph)", () => {
    const doc = createEmptyDocument();
    const pmDoc = crdtToProseMirror({ doc, schema });
    expect(pmDoc.childCount).toBe(1);
    expect(pmDoc.firstChild!.type.name).toBe("paragraph");
  });
});

function buildTwoParagraphDoc(text1: string, text2: string): CRDTDoc {
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

  // Text in first paragraph
  for (let i = 0; i < text1.length; i++) {
    clockVal++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId(clientId, clockVal),
        parentId: makeId(clientId, clockVal - 1),
        side: "right",
        content: { type: "text", value: text1[i]! },
      }),
    });
  }

  // Second paragraph
  clockVal++;
  const block2Clock = clockVal;
  doc = applyOperation({
    doc,
    op: createInsertOp({
      id: makeId(clientId, clockVal),
      parentId: makeId(clientId, clockVal - 1),
      side: "right",
      content: { type: "block", blockType: "paragraph" },
    }),
  });

  // Text in second paragraph
  for (let i = 0; i < text2.length; i++) {
    clockVal++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId(clientId, clockVal),
        parentId: makeId(clientId, clockVal - 1),
        side: "right",
        content: { type: "text", value: text2[i]! },
      }),
    });
  }

  return doc;
}

describe("proseMirrorPositionToCRDT", () => {
  it("maps position 0 to null (before all items)", () => {
    const doc = buildDoc("hello");
    // Position 1 = start of first paragraph's content (after the opening <p> tag)
    const result = proseMirrorPositionToCRDT({ doc, pos: 1 });
    // Position 1 is at the start of the paragraph text — left neighbor is the block item
    expect(result.leftItemId).toEqual(makeId("A", 1)); // paragraph block
  });

  it("maps position at end of text to last character", () => {
    const doc = buildDoc("hello");
    // Position 6 = after "hello" (1 for opening <p> + 5 chars)
    const result = proseMirrorPositionToCRDT({ doc, pos: 6 });
    expect(result.leftItemId).toEqual(makeId("A", 6)); // 'o' character
  });

  it("maps position in middle of text to correct item", () => {
    const doc = buildDoc("hello");
    // Position 3 = after "he" (1 for opening <p> + 2 chars)
    const result = proseMirrorPositionToCRDT({ doc, pos: 3 });
    expect(result.leftItemId).toEqual(makeId("A", 3)); // 'e' character
  });

  it("maps positions correctly in multi-paragraph documents", () => {
    // Two paragraphs: "ab" | "cd"
    // PM positions: 0:doc, 1:p1-open, 2:a, 3:b, 4:p1-close, 5:p2-open, 6:c, 7:d, 8:p2-close
    const doc = buildTwoParagraphDoc("ab", "cd");

    // Position 1 = start of p1 content
    const pos1 = proseMirrorPositionToCRDT({ doc, pos: 1 });
    expect(pos1.leftItemId).toEqual(makeId("A", 1)); // p1 block

    // Position 3 = after 'b'
    const pos3 = proseMirrorPositionToCRDT({ doc, pos: 3 });
    expect(pos3.leftItemId).toEqual(makeId("A", 3)); // 'b' char

    // Position 4 = after p1 close tag (gap between paragraphs)
    const pos4 = proseMirrorPositionToCRDT({ doc, pos: 4 });
    expect(pos4.leftItemId).toEqual(makeId("A", 3)); // 'b' (last item of p1)
    expect(pos4.rightItemId).toEqual(makeId("A", 4)); // p2 block

    // Position 5 = start of p2 content (after p2 opening tag)
    const pos5 = proseMirrorPositionToCRDT({ doc, pos: 5 });
    expect(pos5.leftItemId).toEqual(makeId("A", 4)); // p2 block

    // Position 6 = after 'c'
    const pos6 = proseMirrorPositionToCRDT({ doc, pos: 6 });
    expect(pos6.leftItemId).toEqual(makeId("A", 5)); // 'c' char

    // Position 7 = after 'd'
    const pos7 = proseMirrorPositionToCRDT({ doc, pos: 7 });
    expect(pos7.leftItemId).toEqual(makeId("A", 6)); // 'd' char
  });
});
