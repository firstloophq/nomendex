import { MarkdownSerializer, MarkdownSerializerState } from "prosemirror-markdown";
import { Node } from "prosemirror-model";
import type { CellAlignment } from "./schema";

/**
 * Get text content from a ProseMirror node (inline content only)
 */
function getCellText(node: Node): string {
    let text = "";
    node.forEach((child) => {
        if (child.isText) {
            text += child.text || "";
        } else if (child.type.name === "hard_break") {
            text += " ";
        } else {
            text += getCellText(child);
        }
    });
    return text.trim();
}

/**
 * Get alignment marker for delimiter row
 */
function getDelimiter(alignment: CellAlignment): string {
    switch (alignment) {
        case "center":
            return ":---:";
        case "right":
            return "---:";
        case "left":
            return ":---";
        default:
            return "---";
    }
}

/**
 * Serialize a table node to markdown (simple format, no padding)
 */
function serializeTable(state: MarkdownSerializerState, node: Node): void {
    const rows: { cells: string[]; alignments: CellAlignment[] }[] = [];

    // Collect all rows and cells
    node.forEach((row) => {
        const cells: string[] = [];
        const alignments: CellAlignment[] = [];

        row.forEach((cell) => {
            cells.push(getCellText(cell));
            alignments.push(cell.attrs.alignment as CellAlignment);
        });

        rows.push({ cells, alignments });
    });

    if (rows.length === 0) return;

    // Write header row
    const headerRow = rows[0];
    if (headerRow) {
        state.write("| " + headerRow.cells.join(" | ") + " |\n");

        // Write delimiter row
        const delimiters = headerRow.alignments.map(getDelimiter);
        state.write("| " + delimiters.join(" | ") + " |\n");
    }

    // Write body rows
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row) {
            state.write("| " + row.cells.join(" | ") + " |\n");
        }
    }

    // End table with blank line
    state.write("\n");
}

/**
 * Node serializers for markdown output
 */
const nodeSerializers = {
    // Standard markdown nodes
    blockquote(state: MarkdownSerializerState, node: Node) {
        state.wrapBlock("> ", null, node, () => state.renderContent(node));
    },
    code_block(state: MarkdownSerializerState, node: Node) {
        const info = node.attrs.params || "";
        state.write("```" + info + "\n");
        state.text(node.textContent, false);
        state.ensureNewLine();
        state.write("```");
        state.closeBlock(node);
    },
    heading(state: MarkdownSerializerState, node: Node) {
        state.write("#".repeat(node.attrs.level) + " ");
        state.renderInline(node);
        state.closeBlock(node);
    },
    horizontal_rule(state: MarkdownSerializerState, node: Node) {
        state.write("---");
        state.closeBlock(node);
    },
    bullet_list(state: MarkdownSerializerState, node: Node) {
        state.renderList(node, "  ", () => "- ");
    },
    ordered_list(state: MarkdownSerializerState, node: Node) {
        const start = node.attrs.order || 1;
        state.renderList(node, "   ", (i: number) => `${start + i}. `);
    },
    list_item(state: MarkdownSerializerState, node: Node) {
        state.renderContent(node);
    },
    paragraph(state: MarkdownSerializerState, node: Node) {
        // Check if this paragraph starts with a todo pattern
        // We need to handle this specially to avoid escaping the brackets
        const textContent = node.textContent;
        const todoMatch = textContent.match(/^(\s*)- \[([ xX])\] /);

        if (todoMatch) {
            // For todo paragraphs, write the todo prefix without escaping,
            // then render the rest of the content
            const prefix = todoMatch[0];
            state.write(prefix);

            // Render remaining content after the prefix
            // We need to track position in the text content, not child nodes
            let textOffset = 0;
            const prefixLength = prefix.length;

            node.forEach((child) => {
                if (child.isText && child.text) {
                    const childTextLength = child.text.length;
                    const childTextEnd = textOffset + childTextLength;

                    // Check if this text node extends beyond the prefix
                    if (childTextEnd > prefixLength) {
                        // Calculate how much of this text node is part of the prefix
                        const skipInThisNode = Math.max(0, prefixLength - textOffset);
                        const remaining = child.text.slice(skipInThisNode);
                        if (remaining) {
                            state.text(remaining);
                        }
                    }

                    textOffset = childTextEnd;
                } else if (textOffset >= prefixLength) {
                    // We've passed the prefix, render non-text nodes normally
                    if (child.type.name === "wiki_link") {
                        const href = child.attrs.href || "";
                        const title = child.attrs.title || "";
                        if (title && title !== href) {
                            state.write(`[[${href}|${title}]]`);
                        } else {
                            state.write(`[[${href}]]`);
                        }
                    } else if (child.type.name === "hard_break") {
                        state.write("\\\n");
                    }
                }
            });
            state.closeBlock(node);
        } else {
            state.renderInline(node);
            state.closeBlock(node);
        }
    },
    image(state: MarkdownSerializerState, node: Node) {
        const alt = state.esc(node.attrs.alt || "");
        const src = node.attrs.src;
        const title = node.attrs.title ? ` "${state.esc(node.attrs.title)}"` : "";
        state.write(`![${alt}](${src}${title})`);
    },
    hard_break(state: MarkdownSerializerState) {
        state.write("\\\n");
    },
    text(state: MarkdownSerializerState, node: Node) {
        state.text(node.text || "");
    },

    // Table nodes - table handles everything, others are no-ops
    table: serializeTable,
    table_row() {
        // Handled by table serializer
    },
    table_cell() {
        // Handled by table serializer
    },
    table_header() {
        // Handled by table serializer
    },

    // Wiki link node
    wiki_link(state: MarkdownSerializerState, node: Node) {
        const href = node.attrs.href || "";
        const title = node.attrs.title || "";

        // Use [[target|display]] format if title differs from href
        if (title && title !== href) {
            state.write(`[[${href}|${title}]]`);
        } else {
            state.write(`[[${href}]]`);
        }
    },
};

/**
 * Mark serializers for markdown output
 */
const markSerializers = {
    em: {
        open: "*",
        close: "*",
        mixable: true,
        expelEnclosingWhitespace: true,
    },
    strong: {
        open: "**",
        close: "**",
        mixable: true,
        expelEnclosingWhitespace: true,
    },
    link: {
        open: () => "[",
        close: (_state: MarkdownSerializerState, mark: Node["marks"][number]) => {
            const title = mark.attrs.title ? ` "${mark.attrs.title}"` : "";
            return `](${mark.attrs.href}${title})`;
        },
    },
    code: {
        open: "`",
        close: "`",
        escape: false,
    },
};

/**
 * Markdown serializer with table support
 */
export const tableMarkdownSerializer = new MarkdownSerializer(
    nodeSerializers,
    markSerializers
);

/**
 * Serialize ProseMirror document to markdown string
 */
export function serializeMarkdown(doc: Node): string {
    return tableMarkdownSerializer.serialize(doc);
}
