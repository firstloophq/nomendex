import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import { MarkdownParser } from "prosemirror-markdown";
import { tableSchema, type CellAlignment } from "./schema";

/**
 * Markdown-it plugin to parse [[wiki links]]
 */
function wikiLinkPlugin(md: MarkdownIt): void {
    // Add wiki_link token type
    md.inline.ruler.before("link", "wiki_link", (state: StateInline, silent: boolean) => {
        const start = state.pos;
        const max = state.posMax;

        // Check for [[
        if (state.src.charCodeAt(start) !== 0x5B /* [ */) return false;
        if (state.src.charCodeAt(start + 1) !== 0x5B /* [ */) return false;

        // Find closing ]]
        let pos = start + 2;
        let found = false;

        while (pos < max - 1) {
            if (
                state.src.charCodeAt(pos) === 0x5D /* ] */ &&
                state.src.charCodeAt(pos + 1) === 0x5D /* ] */
            ) {
                found = true;
                break;
            }
            pos++;
        }

        if (!found) return false;

        // Extract the link content
        const content = state.src.slice(start + 2, pos);

        // Don't allow empty links or links with newlines
        if (!content || content.includes("\n")) return false;

        // Parse for alias: [[target|display]]
        const pipeIndex = content.indexOf("|");
        let href: string;
        let title: string;

        if (pipeIndex !== -1) {
            href = content.slice(0, pipeIndex).trim();
            title = content.slice(pipeIndex + 1).trim();
        } else {
            href = content.trim();
            title = content.trim();
        }

        if (!silent) {
            const token = state.push("wiki_link", "a", 0);
            token.attrs = [
                ["href", href],
                ["title", title],
            ];
            token.content = title;
        }

        state.pos = pos + 2;
        return true;
    });
}

/**
 * Markdown-it plugin for serialized suggestion marks.
 *
 * Syntax:
 * - insert open: `[[[+<suggestion-id>]]]`
 * - insert close: `[[[/+]]]`
 * - delete open: `[[[-<suggestion-id>]]]`
 * - delete close: `[[[/-]]]`
 */
function suggestionMarkPlugin(md: MarkdownIt): void {
    md.inline.ruler.before("wiki_link", "suggestion_mark", (state: StateInline, silent: boolean) => {
        const start = state.pos;

        if (!state.src.startsWith("[[[", start)) return false;

        const closeIdx = state.src.indexOf("]]]", start + 3);
        if (closeIdx === -1) return false;

        const marker = state.src.slice(start + 3, closeIdx).trim();
        let tokenType: "suggestion_insert_open" | "suggestion_insert_close" | "suggestion_delete_open" | "suggestion_delete_close" | null = null;
        let id = "";

        if (marker.startsWith("+")) {
            id = marker.slice(1).trim();
            if (!id) return false;
            tokenType = "suggestion_insert_open";
        } else if (marker === "/+") {
            tokenType = "suggestion_insert_close";
        } else if (marker.startsWith("-")) {
            id = marker.slice(1).trim();
            if (!id) return false;
            tokenType = "suggestion_delete_open";
        } else if (marker === "/-") {
            tokenType = "suggestion_delete_close";
        } else {
            return false;
        }

        if (!silent && tokenType) {
            const isOpen = tokenType.endsWith("_open");
            const isInsert = tokenType.startsWith("suggestion_insert");
            const token = state.push(tokenType, "span", isOpen ? 1 : -1);
            if (isOpen) {
                token.attrs = [
                    ["data-suggestion-id", id],
                    ["data-suggestion-action", isInsert ? "insert" : "delete"],
                ];
            }
        }

        state.pos = closeIdx + 3;
        return true;
    });
}

/**
 * Create a markdown-it instance with GFM table support and wiki links
 * Note: Default preset includes table support, commonmark does not
 */
function createMarkdownIt(): MarkdownIt {
    const md = new MarkdownIt({ html: false });
    md.use(wikiLinkPlugin);
    md.use(suggestionMarkPlugin);
    return md;
}

/**
 * Extract alignment from token style attribute
 */
function getAlignmentFromToken(token: Token): CellAlignment {
    const style = token.attrGet("style");
    if (!style) return null;

    const match = style.match(/text-align:\s*(left|center|right)/);
    return match ? (match[1] as CellAlignment) : null;
}

/**
 * Token specifications for parsing markdown tables
 */
const tableTokens = {
    // Standard markdown tokens (from prosemirror-markdown defaults)
    paragraph: { block: "paragraph" },
    blockquote: { block: "blockquote" },
    horizontal_rule: { node: "horizontal_rule" },
    heading: {
        block: "heading",
        getAttrs: (token: Token) => ({ level: +token.tag.slice(1) }),
    },
    code_block: { block: "code_block", noCloseToken: true },
    fence: {
        block: "code_block",
        getAttrs: (token: Token) => ({ params: token.info || "" }),
        noCloseToken: true,
    },
    hr: { node: "horizontal_rule" },
    image: {
        node: "image",
        getAttrs: (token: Token) => ({
            src: token.attrGet("src"),
            title: token.attrGet("title") || null,
            alt: token.children?.[0]?.content || null,
        }),
    },
    hardbreak: { node: "hard_break" },
    ordered_list: {
        block: "ordered_list",
        getAttrs: (token: Token) => ({ order: +(token.attrGet("start") || 1) }),
    },
    bullet_list: { block: "bullet_list" },
    list_item: { block: "list_item" },
    em: { mark: "em" },
    strong: { mark: "strong" },
    link: {
        mark: "link",
        getAttrs: (token: Token) => ({
            href: token.attrGet("href"),
            title: token.attrGet("title") || null,
        }),
    },
    code_inline: { mark: "code" },
    softbreak: { node: "hard_break" },
    suggestion_insert: {
        mark: "suggestion",
        getAttrs: (token: Token) => ({
            id: token.attrGet("data-suggestion-id") || "",
            action: "insert",
        }),
    },
    suggestion_delete: {
        mark: "suggestion",
        getAttrs: (token: Token) => ({
            id: token.attrGet("data-suggestion-id") || "",
            action: "delete",
        }),
    },

    // Table tokens
    table: { block: "table" },
    thead: { ignore: true },
    tbody: { ignore: true },
    tr: { block: "table_row" },
    th: {
        block: "table_header",
        getAttrs: (token: Token) => ({
            alignment: getAlignmentFromToken(token),
            colspan: 1,
            rowspan: 1,
            colwidth: null,
        }),
    },
    td: {
        block: "table_cell",
        getAttrs: (token: Token) => ({
            alignment: getAlignmentFromToken(token),
            colspan: 1,
            rowspan: 1,
            colwidth: null,
        }),
    },

    // Wiki link token
    wiki_link: {
        node: "wiki_link",
        getAttrs: (token: Token) => ({
            href: token.attrGet("href") || "",
            title: token.attrGet("title") || token.content || "",
        }),
    },
};

/**
 * Markdown parser with table support
 */
export const tableMarkdownParser = new MarkdownParser(
    tableSchema,
    createMarkdownIt(),
    tableTokens as Record<string, MarkdownParser["tokens"][string]>
);

/**
 * Parse markdown string to ProseMirror document
 */
export function parseMarkdown(markdown: string) {
    return tableMarkdownParser.parse(markdown);
}
