import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { Node as PMNode } from "prosemirror-model";

export interface SearchState {
    query: string;
    caseSensitive: boolean;
    currentIndex: number;
    results: Array<{ from: number; to: number }>;
}

export const searchPluginKey = new PluginKey<SearchState>("search");

const EMPTY_SEARCH_STATE: SearchState = {
    query: "",
    caseSensitive: false,
    currentIndex: 0,
    results: [],
};

function clampRange(doc: PMNode, from: number, to: number) {
    const maxPos = doc.content.size;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    const safeFrom = Math.max(1, Math.floor(from));
    const safeTo = Math.max(1, Math.floor(to));

    if (safeFrom > maxPos || safeTo > maxPos) return null;
    if (safeFrom >= safeTo) return null;

    try {
        const fromPos = doc.resolve(safeFrom);
        const toPos = doc.resolve(safeTo);
        if (
            fromPos.depth === 0 ||
            toPos.depth === 0 ||
            !fromPos.parent.isTextblock ||
            !toPos.parent.isTextblock ||
            fromPos.depth !== toPos.depth ||
            fromPos.parent !== toPos.parent ||
            fromPos.parentOffset >= toPos.parentOffset
        ) {
            return null;
        }
    } catch {
        return null;
    }

    return { from: safeFrom, to: safeTo };
}

function sanitizeResults(doc: PMNode, results: SearchState["results"]) {
    return results
        .map(({ from, to }) => clampRange(doc, from, to))
        .filter((range): range is { from: number; to: number } => Boolean(range));
}

export function createSearchPlugin() {
    return new Plugin<SearchState>({
        key: searchPluginKey,
        state: {
            init() {
                return EMPTY_SEARCH_STATE;
            },
            apply(tr, value, _oldState, newState) {
                const current = value ?? EMPTY_SEARCH_STATE;
                const meta = tr.getMeta(searchPluginKey);

                const nextState: SearchState = {
                    query: current.query,
                    caseSensitive: current.caseSensitive,
                    currentIndex: current.currentIndex,
                    results: current.results,
                };

                if (meta) {
                    const queryFromMeta = typeof meta.query === "string" ? meta.query : nextState.query;
                    const caseSensitiveFromMeta =
                        typeof meta.caseSensitive === "boolean"
                            ? meta.caseSensitive
                            : nextState.caseSensitive;

                    const safeCurrentIndex =
                        typeof meta.currentIndex === "number" && Number.isFinite(meta.currentIndex)
                            ? Math.max(0, Math.floor(meta.currentIndex))
                            : 0;

                    const recalculated = queryFromMeta
                        ? performSearch(queryFromMeta, caseSensitiveFromMeta, newState.doc)
                        : [];

                    return {
                        query: queryFromMeta,
                        caseSensitive: caseSensitiveFromMeta,
                        currentIndex: recalculated.length > 0 ? safeCurrentIndex % recalculated.length : 0,
                        results: sanitizeResults(newState.doc, recalculated),
                    };
                }

                if (tr.docChanged && nextState.query) {
                    const recalculated = performSearch(nextState.query, nextState.caseSensitive, newState.doc);

                    return {
                        ...nextState,
                        currentIndex: Math.min(nextState.currentIndex, Math.max(0, recalculated.length - 1)),
                        results: sanitizeResults(newState.doc, recalculated),
                    };
                }

                return {
                    ...nextState,
                    results: sanitizeResults(newState.doc, nextState.results),
                };
            },
        },
        props: {
            decorations(state) {
                const searchState = searchPluginKey.getState(state);
                if (!searchState || !searchState.query || searchState.results.length === 0) {
                    return DecorationSet.empty;
                }

                const decorations = searchState.results.map((result, index) => {
                    const sanitized = clampRange(state.doc, result.from, result.to);
                    if (!sanitized) return null;

                    const isCurrent = index === searchState.currentIndex;
                    return Decoration.inline(sanitized.from, sanitized.to, {
                        class: isCurrent ? "search-highlight-current" : "search-highlight",
                    });
                });

                return DecorationSet.create(
                    state.doc,
                    decorations.filter(Boolean) as ReturnType<typeof Decoration.inline>[],
                );
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
