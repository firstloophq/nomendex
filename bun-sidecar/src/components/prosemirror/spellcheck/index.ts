import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import Typo from "typo-js";

export interface SpellcheckPluginState {
    decorations: DecorationSet;
    enabled: boolean;
    dictionary: Typo | null;
}

export const spellcheckPluginKey = new PluginKey<SpellcheckPluginState>("spellcheck");

// Function to create and initialize the dictionary
async function loadDictionary(): Promise<Typo | null> {
    try {
        // Load dictionary files from public directory
        const affPath = "/dictionaries/en_US.aff";
        const dicPath = "/dictionaries/en_US.dic";

        const [affResponse, dicResponse] = await Promise.all([
            fetch(affPath),
            fetch(dicPath)
        ]);

        if (!affResponse.ok || !dicResponse.ok) {
            console.error("Failed to load dictionary files");
            return null;
        }

        const affData = await affResponse.text();
        const dicData = await dicResponse.text();

        // Create Typo instance with loaded data
        return new Typo("en_US", affData, dicData);
    } catch (error) {
        console.error("Error loading dictionary:", error);
        return null;
    }
}

// Extract words from text
function extractWords(text: string): { word: string; start: number; end: number }[] {
    const words: { word: string; start: number; end: number }[] = [];
    // Match word characters (letters, numbers, apostrophes within words)
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
function isWordMisspelled(word: string, dictionary: Typo | null): boolean {
    if (!dictionary) return false;

    // Skip single letters and numbers
    if (word.length <= 1 || /^\d+$/.test(word)) return false;

    // Check if word is in dictionary
    return !dictionary.check(word);
}

// Get suggestions for a misspelled word
export function getSuggestions(word: string, dictionary: Typo | null): string[] {
    if (!dictionary) return [];
    return dictionary.suggest(word) || [];
}

// Create decorations for misspelled words
function createDecorations(doc: any, dictionary: Typo | null, enabled: boolean): DecorationSet {
    if (!enabled || !dictionary) {
        return DecorationSet.empty;
    }

    const decorations: Decoration[] = [];

    doc.descendants((node: any, pos: number) => {
        if (!node.isText) return;

        const text = node.text;
        const words = extractWords(text);

        words.forEach(({ word, start, end }) => {
            if (isWordMisspelled(word, dictionary)) {
                const from = pos + start;
                const to = pos + end;

                decorations.push(
                    Decoration.inline(from, to, {
                        class: "misspelled-word",
                        "data-word": word,
                    })
                );
            }
        });
    });

    return DecorationSet.create(doc, decorations);
}

// Toggle spellcheck command
export function toggleSpellcheck(view: any): boolean {
    const pluginState = spellcheckPluginKey.getState(view.state);
    if (!pluginState) return false;

    const { enabled, dictionary } = pluginState;
    const newEnabled = !enabled;

    // If enabling and dictionary not loaded yet, load it
    if (newEnabled && !dictionary) {
        loadDictionary().then((dict) => {
            const tr = view.state.tr;
            tr.setMeta(spellcheckPluginKey, {
                type: "setDictionary",
                dictionary: dict,
                enabled: newEnabled,
            });
            view.dispatch(tr);
        });
        return true;
    }

    // Toggle enabled state
    const tr = view.state.tr;
    tr.setMeta(spellcheckPluginKey, {
        type: "toggle",
        enabled: newEnabled,
    });
    view.dispatch(tr);
    return true;
}

// Create the spellcheck plugin
export function createSpellcheckPlugin(): Plugin<SpellcheckPluginState> {
    return new Plugin<SpellcheckPluginState>({
        key: spellcheckPluginKey,
        state: {
            init() {
                return {
                    decorations: DecorationSet.empty,
                    enabled: false, // Disabled by default
                    dictionary: null,
                };
            },
            apply(tr, value, _oldState, newState) {
                const meta = tr.getMeta(spellcheckPluginKey);

                if (meta) {
                    if (meta.type === "toggle") {
                        return {
                            ...value,
                            enabled: meta.enabled,
                            decorations: createDecorations(newState.doc, value.dictionary, meta.enabled),
                        };
                    }
                    if (meta.type === "setDictionary") {
                        return {
                            ...value,
                            dictionary: meta.dictionary,
                            enabled: meta.enabled,
                            decorations: createDecorations(newState.doc, meta.dictionary, meta.enabled),
                        };
                    }
                }

                // Update decorations on document change if enabled
                if (tr.docChanged && value.enabled) {
                    return {
                        ...value,
                        decorations: createDecorations(newState.doc, value.dictionary, value.enabled),
                    };
                }

                // Map decorations through the transaction
                return {
                    ...value,
                    decorations: value.decorations.map(tr.mapping, tr.doc),
                };
            },
        },
        props: {
            decorations(state) {
                const pluginState = this.getState(state);
                return pluginState?.decorations;
            },
        },
    });
}
