import { describe, expect, it } from "bun:test";
import { Schema } from "prosemirror-model";
import {
  crdtToProseMirror,
} from "@/crdt/prosemirror/state-mapping";
import {
  createEmptyDocument,
  applyOperation,
  type CRDTDoc,
} from "@/crdt/core/apply-operations";
import {
  createInsertOp,
  createAttrUpdateOp,
  createOperationId,
} from "@/crdt/core/operations";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

// Table schema
const tableSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    table: { group: "block", content: "table_row+" },
    table_row: { content: "table_cell+" },
    table_cell: {
      content: "block+",
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        colwidth: { default: null },
      },
    },
    text: { group: "inline" },
  },
  marks: {},
});

describe("Phase 4: Tables", () => {
  it("renders table > table_row > table_cell > paragraph hierarchy", () => {
    let doc = createEmptyDocument();
    let clock = 0;

    // table
    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "table" },
      }),
    });
    const tableId = makeId("A", clock);

    // table_row
    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: makeId("A", clock - 1),
        side: "right",
        content: { type: "block", blockType: "table_row", parentBlockId: tableId },
      }),
    });
    const rowId = makeId("A", clock);

    // table_cell
    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: makeId("A", clock - 1),
        side: "right",
        content: { type: "block", blockType: "table_cell", parentBlockId: rowId },
      }),
    });
    const cellId = makeId("A", clock);

    // paragraph inside cell
    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: makeId("A", clock - 1),
        side: "right",
        content: { type: "block", blockType: "paragraph", parentBlockId: cellId },
      }),
    });

    // text in paragraph
    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: makeId("A", clock - 1),
        side: "right",
        content: { type: "text", value: "X" },
      }),
    });

    const pmDoc = crdtToProseMirror({ doc, schema: tableSchema });
    expect(pmDoc.childCount).toBe(1);
    const table = pmDoc.firstChild!;
    expect(table.type.name).toBe("table");
    expect(table.childCount).toBe(1);
    const row = table.firstChild!;
    expect(row.type.name).toBe("table_row");
    expect(row.childCount).toBe(1);
    const cell = row.firstChild!;
    expect(cell.type.name).toBe("table_cell");
    expect(cell.childCount).toBe(1);
    const para = cell.firstChild!;
    expect(para.type.name).toBe("paragraph");
    expect(para.textContent).toBe("X");
  });

  it("cell attrs round-trip (colspan, rowspan)", () => {
    let doc = createEmptyDocument();
    let clock = 0;

    // table
    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "table" },
      }),
    });
    const tableId = makeId("A", clock);

    // table_row
    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: makeId("A", clock - 1),
        side: "right",
        content: { type: "block", blockType: "table_row", parentBlockId: tableId },
      }),
    });
    const rowId = makeId("A", clock);

    // table_cell with colspan=2, rowspan=3
    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: makeId("A", clock - 1),
        side: "right",
        content: {
          type: "block",
          blockType: "table_cell",
          parentBlockId: rowId,
          attrs: { colspan: 2, rowspan: 3 },
        },
      }),
    });
    const cellId = makeId("A", clock);

    // paragraph inside cell (required by schema)
    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: makeId("A", clock - 1),
        side: "right",
        content: { type: "block", blockType: "paragraph", parentBlockId: cellId },
      }),
    });

    const pmDoc = crdtToProseMirror({ doc, schema: tableSchema });
    const cell = pmDoc.firstChild!.firstChild!.firstChild!;
    expect(cell.type.name).toBe("table_cell");
    expect(cell.attrs.colspan).toBe(2);
    expect(cell.attrs.rowspan).toBe(3);
  });

  it("colwidth serialized as JSON string round-trips", () => {
    let doc = createEmptyDocument();
    let clock = 0;

    // table > row > cell with colwidth as JSON string
    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "table" },
      }),
    });
    const tableId = makeId("A", clock);

    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: makeId("A", clock - 1),
        side: "right",
        content: { type: "block", blockType: "table_row", parentBlockId: tableId },
      }),
    });
    const rowId = makeId("A", clock);

    // Store colwidth as JSON string in CRDT attrs
    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: makeId("A", clock - 1),
        side: "right",
        content: {
          type: "block",
          blockType: "table_cell",
          parentBlockId: rowId,
          attrs: { colwidth: "[100,200]" },
        },
      }),
    });
    const cellId = makeId("A", clock);

    // paragraph inside cell
    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: makeId("A", clock - 1),
        side: "right",
        content: { type: "block", blockType: "paragraph", parentBlockId: cellId },
      }),
    });

    // The CRDT stores colwidth as a string "[100,200]"
    // The PM bridge should deserialize it when building the PM node
    // For now, we verify the CRDT stores it correctly
    const item = doc.store.map.get("A:3");
    expect(item).toBeDefined();
    if (item!.content.type === "block") {
      expect(item!.content.attrs?.colwidth).toBe("[100,200]");
    }
  });

  it("AttrUpdate changes cell colspan", () => {
    let doc = createEmptyDocument();
    let clock = 0;

    // Build minimal table
    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "table" },
      }),
    });
    const tableId = makeId("A", clock);

    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: makeId("A", clock - 1),
        side: "right",
        content: { type: "block", blockType: "table_row", parentBlockId: tableId },
      }),
    });
    const rowId = makeId("A", clock);

    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: makeId("A", clock - 1),
        side: "right",
        content: {
          type: "block",
          blockType: "table_cell",
          parentBlockId: rowId,
          attrs: { colspan: 1 },
        },
      }),
    });
    const cellId = makeId("A", clock);

    // Paragraph inside cell
    clock++;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: makeId("A", clock - 1),
        side: "right",
        content: { type: "block", blockType: "paragraph", parentBlockId: cellId },
      }),
    });

    // Change colspan to 3
    clock++;
    doc = applyOperation({
      doc,
      op: createAttrUpdateOp({
        id: makeId("A", clock),
        targetId: cellId,
        attr: "colspan",
        value: 3,
      }),
    });

    const pmDoc = crdtToProseMirror({ doc, schema: tableSchema });
    const cell = pmDoc.firstChild!.firstChild!.firstChild!;
    expect(cell.attrs.colspan).toBe(3);
  });

  it("2x2 table with all cells populated", () => {
    let doc = createEmptyDocument();
    let clock = 0;

    // table
    clock++;
    const tableClk = clock;
    doc = applyOperation({
      doc,
      op: createInsertOp({
        id: makeId("A", clock),
        parentId: null,
        side: "right",
        content: { type: "block", blockType: "table" },
      }),
    });

    // Helper to create a row with cells
    function addRow(parentClk: number, cellTexts: string[]): number {
      clock++;
      const rowClk = clock;
      doc = applyOperation({
        doc,
        op: createInsertOp({
          id: makeId("A", clock),
          parentId: makeId("A", clock - 1),
          side: "right",
          content: { type: "block", blockType: "table_row", parentBlockId: makeId("A", tableClk) },
        }),
      });

      for (const text of cellTexts) {
        clock++;
        const cellClk = clock;
        doc = applyOperation({
          doc,
          op: createInsertOp({
            id: makeId("A", clock),
            parentId: makeId("A", clock - 1),
            side: "right",
            content: { type: "block", blockType: "table_cell", parentBlockId: makeId("A", rowClk) },
          }),
        });

        clock++;
        doc = applyOperation({
          doc,
          op: createInsertOp({
            id: makeId("A", clock),
            parentId: makeId("A", clock - 1),
            side: "right",
            content: { type: "block", blockType: "paragraph", parentBlockId: makeId("A", cellClk) },
          }),
        });

        for (const ch of text) {
          clock++;
          doc = applyOperation({
            doc,
            op: createInsertOp({
              id: makeId("A", clock),
              parentId: makeId("A", clock - 1),
              side: "right",
              content: { type: "text", value: ch },
            }),
          });
        }
      }
      return rowClk;
    }

    addRow(tableClk, ["A1", "B1"]);
    addRow(tableClk, ["A2", "B2"]);

    const pmDoc = crdtToProseMirror({ doc, schema: tableSchema });
    const table = pmDoc.firstChild!;
    expect(table.type.name).toBe("table");
    expect(table.childCount).toBe(2); // 2 rows

    const row1 = table.child(0);
    expect(row1.childCount).toBe(2); // 2 cells
    expect(row1.child(0).firstChild!.textContent).toBe("A1");
    expect(row1.child(1).firstChild!.textContent).toBe("B1");

    const row2 = table.child(1);
    expect(row2.childCount).toBe(2);
    expect(row2.child(0).firstChild!.textContent).toBe("A2");
    expect(row2.child(1).firstChild!.textContent).toBe("B2");
  });
});
