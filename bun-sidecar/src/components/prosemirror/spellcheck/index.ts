import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { SpellcheckEngine } from "@/lib/spellcheck";
import { toast } from "sonner";

export interface SpellcheckPluginState {
    decorations: DecorationSet;
    dictionary: SpellcheckEngine | null;
    isLoading: boolean;
}

export const spellcheckPluginKey = new PluginKey<SpellcheckPluginState>("spellcheck");

function asDecorationSet(value: unknown): DecorationSet {
    return value instanceof DecorationSet ? value : DecorationSet.empty;
}

// Singleton dictionary instance
let dictionaryInstance: SpellcheckEngine | null = null;
let dictionaryLoading: Promise<SpellcheckEngine | null> | null = null;

// Function to get or load the dictionary
async function getDictionary(): Promise<SpellcheckEngine | null> {
    if (dictionaryInstance) return dictionaryInstance;

    if (dictionaryLoading) return dictionaryLoading;

    dictionaryLoading = (async () => {
        try {
            const engine = new SpellcheckEngine();
            await engine.load("/api/dictionaries/en_US.json");
            dictionaryInstance = engine;
            return engine;
        } catch (error) {
            console.error("Error loading dictionary:", error);
            return null;
        }
    })();

    return dictionaryLoading;
}

// Extract words from text
function extractWords(text: string): { word: string; start: number; end: number }[] {
    const words: { word: string; start: number; end: number }[] = [];
    const wordRegex = /\b[a-zA-Z]+(?:'[a-zA-Z]+)?\b/g;
    let match;

    while ((match = wordRegex.exec(text)) !== null) {
        words.push({
            word: match[0],
            start: match.index,
            end: match.index + match[0].length,
        });
    }

    return words;
}

// Check if a word is misspelled
function isWordMisspelled(word: string, dictionary: SpellcheckEngine | null): boolean {
    if (!dictionary) return false;
    if (word.length <= 1 || /^\d+$/.test(word)) return false;
    return !dictionary.check(word);
}

function isValidInlineRange(
    doc: Parameters<typeof DecorationSet.create>[0],
    from: number,
    to: number
): { from: number; to: number } | null {
    const maxPos = doc.content.size;
    const safeFrom = Math.max(1, Math.floor(from));
    const safeTo = Math.max(1, Math.floor(to));

    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
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

// Get suggestions for a misspelled word
export function getSuggestions(word: string, dictionary: SpellcheckEngine | null): string[] {
    if (!dictionary) return [];
    return dictionary.suggest(word) || [];
}

// Create decorations for misspelled words
function createDecorations(
    doc: Parameters<typeof DecorationSet.create>[0],
    dictionary: SpellcheckEngine | null
): DecorationSet {
    if (!dictionary) {
        return DecorationSet.empty;
    }

    const decorations: Decoration[] = [];

    doc.descendants((node, pos) => {
        if (!node.isText) return;

        const text = node.text;
        if (!text) return;

        const words = extractWords(text);

        for (const { word, start, end } of words) {
            if (!isWordMisspelled(word, dictionary)) continue;

            const from = pos + start;
            const to = pos + end;
            const safeRange = isValidInlineRange(doc, from, to);
            if (!safeRange) {
                continue;
            }

            decorations.push(
                Decoration.inline(safeRange.from, safeRange.to, {
                    class: "misspelled-word",
                    "data-word": word,
                })
            );
        }
    });

    return DecorationSet.create(doc, decorations);
}

// Run spellcheck command - loads dictionary and applies decorations
export async function runSpellcheck(view: EditorView): Promise<{ misspelledCount: number }> {
    // Show loading toast
    const loadingToast = toast.loading("Running spellcheck...");

    try {
        const dictionary = await getDictionary();

        if (!dictionary) {
            toast.dismiss(loadingToast);
            toast.error("Failed to load dictionary");
            return { misspelledCount: 0 };
        }

        // Dispatch to update plugin state with dictionary and decorations
        const tr = view.state.tr;
        tr.setMeta(spellcheckPluginKey, {
            type: "runSpellcheck",
            dictionary,
        });
        view.dispatch(tr);

        // Count misspelled words
        const pluginState = spellcheckPluginKey.getState(view.state);
        const misspelledCount = asDecorationSet(pluginState?.decorations).find().length;

        toast.dismiss(loadingToast);

        if (misspelledCount === 0) {
            toast.success("No spelling errors found");
        } else {
            toast.success(`Found ${misspelledCount} misspelled word${misspelledCount === 1 ? "" : "s"}`);
        }

        return { misspelledCount };
    } catch (error) {
        toast.dismiss(loadingToast);
        toast.error("Spellcheck failed");
        console.error("Spellcheck error:", error);
        return { misspelledCount: 0 };
    }
}

// Clear spellcheck decorations
export function clearSpellcheck(view: EditorView): void {
    const tr = view.state.tr;
    tr.setMeta(spellcheckPluginKey, {
        type: "clear",
    });
    view.dispatch(tr);
}

// Create the spellcheck plugin
export function createSpellcheckPlugin(): Plugin<SpellcheckPluginState> {
    return new Plugin<SpellcheckPluginState>({
        key: spellcheckPluginKey,
        state: {
            init() {
                return {
                    decorations: DecorationSet.empty,
                    dictionary: null,
                    isLoading: false,
                };
            },
            apply(tr, value, _oldState, newState) {
                const currentState = value ?? {
                    decorations: DecorationSet.empty,
                    dictionary: null,
                    isLoading: false,
                };
                const safeCurrentState = {
                    ...currentState,
                    decorations: asDecorationSet(currentState.decorations),
                };

                const meta = tr.getMeta(spellcheckPluginKey) as
                    | { type: "runSpellcheck"; dictionary: SpellcheckEngine }
                    | { type: "clear" }
                    | { type: "removeAt"; from: number; to: number }
                    | undefined;

                if (meta) {
                    if (meta.type === "runSpellcheck") {
                        return {
                            ...safeCurrentState,
                            dictionary: meta.dictionary,
                            decorations: createDecorations(newState.doc, meta.dictionary),
                        };
                    }
                    if (meta.type === "clear") {
                        return {
                            ...safeCurrentState,
                            decorations: DecorationSet.empty,
                        };
                    }
                    if (meta.type === "removeAt") {
                        // Remove decorations that overlap with the specified range
                        const filtered = safeCurrentState.decorations.find(meta.from, meta.to);
                        let newDecorations = safeCurrentState.decorations;
                        for (const deco of filtered) {
                            newDecorations = newDecorations.remove([deco]);
                        }
                        return {
                            ...safeCurrentState,
                            decorations: newDecorations.map(tr.mapping, tr.doc),
                        };
                    }
                }

                // Map decorations through the transaction - this preserves decorations
                // and automatically removes/adjusts ones in the edited region
                return {
                    ...safeCurrentState,
                    decorations: safeCurrentState.decorations.map(tr.mapping, tr.doc),
                };
            },
        },
        props: {
            decorations(state) {
                const pluginState = this.getState(state);
                return asDecorationSet(pluginState?.decorations);
            },
        },
    });
}
