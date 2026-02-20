import { test, expect, describe } from "bun:test";
import { tableSchema } from "./schema";
import { tableMarkdownParser } from "./parser";
import { tableMarkdownSerializer } from "./serializer";

describe("Markdown Table Parser", () => {
    test("parses simple table", () => {
        const markdown = `| Day | Session |
|-----|---------|
| Mon | Run |
| Tue | Hike |`;

        const doc = tableMarkdownParser.parse(markdown);

        expect(doc).toBeTruthy();
        expect(doc.firstChild?.type.name).toBe("table");

        const table = doc.firstChild!;
        expect(table.childCount).toBe(3); // header + 2 body rows

        // Check first row (header)
        const headerRow = table.child(0);
        expect(headerRow.type.name).toBe("table_row");
        expect(headerRow.childCount).toBe(2);
        expect(headerRow.child(0).type.name).toBe("table_header");
        expect(headerRow.child(0).textContent).toBe("Day");
        expect(headerRow.child(1).textContent).toBe("Session");

        // Check body rows
        const bodyRow1 = table.child(1);
        expect(bodyRow1.child(0).type.name).toBe("table_cell");
        expect(bodyRow1.child(0).textContent).toBe("Mon");
        expect(bodyRow1.child(1).textContent).toBe("Run");
    });

    test("parses table with alignment", () => {
        const markdown = `| Left | Center | Right |
|:-----|:------:|------:|
| A | B | C |`;

        const doc = tableMarkdownParser.parse(markdown);
        const table = doc.firstChild!;
        const headerRow = table.child(0);

        // Check alignments are captured
        expect(headerRow.child(0).attrs.alignment).toBe("left");
        expect(headerRow.child(1).attrs.alignment).toBe("center");
        expect(headerRow.child(2).attrs.alignment).toBe("right");
    });

    test("parses table with surrounding content", () => {
        const markdown = `# Title

Some paragraph before.

| Col1 | Col2 |
|------|------|
| A | B |

Some paragraph after.`;

        const doc = tableMarkdownParser.parse(markdown);

        expect(doc.childCount).toBe(4);
        expect(doc.child(0).type.name).toBe("heading");
        expect(doc.child(1).type.name).toBe("paragraph");
        expect(doc.child(2).type.name).toBe("table");
        expect(doc.child(3).type.name).toBe("paragraph");
    });

    test("parses serialized suggestion marks", () => {
        const markdown = `Before [[[+suggest-1]]]added[[[/+]]] and [[[-suggest-1]]]removed[[[/-]]] text.`;
        const doc = tableMarkdownParser.parse(markdown);
        const paragraph = doc.firstChild;
        expect(paragraph?.type.name).toBe("paragraph");

        const textNodes: Array<{ text: string; marks: Array<{ type: string; attrs?: Record<string, unknown> }> }> = [];
        paragraph?.forEach((node) => {
            if (!node.isText) return;
            textNodes.push({
                text: node.text || "",
                marks: node.marks.map((mark) => ({ type: mark.type.name, attrs: mark.attrs as Record<string, unknown> })),
            });
        });

        const insertNode = textNodes.find((node) => node.text.includes("added"));
        const deleteNode = textNodes.find((node) => node.text.includes("removed"));
        expect(insertNode).toBeTruthy();
        expect(deleteNode).toBeTruthy();
        expect(insertNode?.marks.some((mark) => mark.type === "suggestion" && mark.attrs?.action === "insert")).toBe(true);
        expect(deleteNode?.marks.some((mark) => mark.type === "suggestion" && mark.attrs?.action === "delete")).toBe(true);
    });
});

describe("Markdown Table Serializer", () => {
    test("serializes simple table", () => {
        const markdown = `| Day | Session |
|-----|---------|
| Mon | Run |
| Tue | Hike |`;

        const doc = tableMarkdownParser.parse(markdown);
        const output = tableMarkdownSerializer.serialize(doc);

        // Should contain the table structure
        expect(output).toContain("| Day | Session |");
        expect(output).toContain("| --- | --- |");
        expect(output).toContain("| Mon | Run |");
        expect(output).toContain("| Tue | Hike |");
    });

    test("roundtrip: parse then serialize maintains structure", () => {
        const original = `| Date | Day | Session |
|------|-----|---------|
| Dec 29 | Mon | Easy run |
| Dec 30 | Tue | Hike |`;

        const doc = tableMarkdownParser.parse(original);
        const output = tableMarkdownSerializer.serialize(doc);

        // Re-parse the output
        const doc2 = tableMarkdownParser.parse(output);

        // Should have same structure
        expect(doc2.firstChild?.type.name).toBe("table");
        expect(doc2.firstChild?.childCount).toBe(doc.firstChild?.childCount);

        const table1 = doc.firstChild!;
        const table2 = doc2.firstChild!;

        // Check each row has same number of cells
        for (let i = 0; i < table1.childCount; i++) {
            expect(table2.child(i).childCount).toBe(table1.child(i).childCount);
        }

        // Check content is preserved
        expect(table2.child(1).child(0).textContent).toBe("Dec 29");
        expect(table2.child(1).child(2).textContent).toBe("Easy run");
    });

    test("serializes table with surrounding content correctly", () => {
        const markdown = `# Week 1

| Day | Task |
|-----|------|
| Mon | Run |

Walking pad: daily.`;

        const doc = tableMarkdownParser.parse(markdown);
        const output = tableMarkdownSerializer.serialize(doc);

        // Table should be separate from surrounding content
        expect(output).toContain("# Week 1");
        expect(output).toContain("| Day | Task |");
        expect(output).toContain("| Mon | Run |");
        expect(output).toContain("Walking pad: daily.");

        // The "Walking pad" text should NOT be inside the table
        const lines = output.split("\n");
        const walkingPadLine = lines.find((l) => l.includes("Walking pad"));
        expect(walkingPadLine).not.toContain("|");
    });

    test("user's exact table format", () => {
        const markdown = `| Date | Day | Session | Duration | Notes |
|------|-----|---------|----------|-------|
| Dec 29 | Mon | Easy run | 30 min (~2.5 mi) | Start easy |
| Dec 30 | Tue | Mt Morrison | 2-2.5 hrs | Big vert day |`;

        const doc = tableMarkdownParser.parse(markdown);
        const output = tableMarkdownSerializer.serialize(doc);

        // Check that all columns are preserved
        expect(output).toContain("Date");
        expect(output).toContain("Day");
        expect(output).toContain("Session");
        expect(output).toContain("Duration");
        expect(output).toContain("Notes");

        // Check content is preserved
        expect(output).toContain("Dec 29");
        expect(output).toContain("Easy run");
        expect(output).toContain("30 min (~2.5 mi)");
        expect(output).toContain("Big vert day");

        // Parse again to verify roundtrip
        const doc2 = tableMarkdownParser.parse(output);
        expect(doc2.firstChild?.type.name).toBe("table");
        expect(doc2.firstChild?.childCount).toBe(3); // header + 2 rows
    });

    test("roundtrip preserves suggestion marks", () => {
        const original = `Alpha [[[+s-42]]]beta[[[/+]]] [[[-s-42]]]gamma[[[/-]]]`;

        const doc = tableMarkdownParser.parse(original);
        const output = tableMarkdownSerializer.serialize(doc);
        const reparsed = tableMarkdownParser.parse(output);
        const reparsedOutput = tableMarkdownSerializer.serialize(reparsed);

        expect(output).toContain("[[[+s-42]]]");
        expect(output).toContain("[[[/+]]]");
        expect(output).toContain("[[[-s-42]]]");
        expect(output).toContain("[[[/-]]]");
        expect(reparsedOutput).toContain("[[[+s-42]]]");
        expect(reparsedOutput).toContain("[[[-s-42]]]");
    });
});

describe("Table Schema", () => {
    test("has required node types", () => {
        expect(tableSchema.nodes.table).toBeTruthy();
        expect(tableSchema.nodes.table_row).toBeTruthy();
        expect(tableSchema.nodes.table_cell).toBeTruthy();
        expect(tableSchema.nodes.table_header).toBeTruthy();
    });

    test("table is in block group", () => {
        expect(tableSchema.nodes.table.spec.group).toBe("block");
    });

    test("cells have alignment attribute", () => {
        const cellSpec = tableSchema.nodes.table_cell.spec;
        expect(cellSpec.attrs?.alignment).toBeTruthy();
        expect(cellSpec.attrs?.alignment?.default).toBe(null);
    });

    test("supports suggestion mark", () => {
        expect(tableSchema.marks.suggestion).toBeTruthy();
    });
});
