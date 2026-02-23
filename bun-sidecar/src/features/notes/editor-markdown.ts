import type { Node as PMNode } from "prosemirror-model";
import { tableMarkdownParser, tableMarkdownSerializer, tableSchema } from "@/components/prosemirror/tables";

export function parseNotesMarkdown(markdown: string) {
    return tableMarkdownParser.parse(markdown || "") || tableSchema.nodes.doc.createAndFill();
}

export function serializeNotesMarkdown(doc: PMNode): string {
    return tableMarkdownSerializer.serialize(doc);
}

