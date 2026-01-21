import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export interface SearchState {
    query: string;
    caseSensitive: boolean;
    currentIndex: number;
    results: Array<{ from: number; to: number }>;
}

export const searchPluginKey = new PluginKey<SearchState>("search");

export function createSearchPlugin() {
    return new Plugin<SearchState>({
        key: searchPluginKey,
        state: {
            init() {
                return {
                    query: "",
                    caseSensitive: false,
                    currentIndex: 0,
                    results: [],
                };
            },
            apply(tr, value) {
                const meta = tr.getMeta(searchPluginKey);
                if (meta) {
                    return { ...value, ...meta };
                }
                return value;
            },
        },
        props: {
            decorations(state) {
                const searchState = searchPluginKey.getState(state);
                if (!searchState || !searchState.query || searchState.results.length === 0) {
                    return DecorationSet.empty;
                }

                const decorations = searchState.results.map((result, index) => {
                    const isCurrent = index === searchState.currentIndex;
                    return Decoration.inline(result.from, result.to, {
                        class: isCurrent ? "search-highlight-current" : "search-highlight",
                    });
                });

                return DecorationSet.create(state.doc, decorations);
            },
        },
    });
}

export function performSearch(
    query: string,
    caseSensitive: boolean,
    doc: any
): Array<{ from: number; to: number }> {
    if (!query) return [];

    const results: Array<{ from: number; to: number }> = [];
    const searchText = caseSensitive ? query : query.toLowerCase();

    doc.descendants((node: any, pos: number) => {
        if (node.isText && node.text) {
            const text = caseSensitive ? node.text : node.text.toLowerCase();
            let index = 0;

            while (index < text.length) {
                const foundIndex = text.indexOf(searchText, index);
                if (foundIndex === -1) break;

                results.push({
                    from: pos + foundIndex,
                    to: pos + foundIndex + query.length,
                });

                index = foundIndex + 1;
            }
        }
    });

    return results;
}
