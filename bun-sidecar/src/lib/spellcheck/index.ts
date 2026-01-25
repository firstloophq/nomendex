/**
 * Spellcheck module - browser-compatible spellcheck engine
 */

export { SpellcheckEngine } from "./spellcheck-engine";
export type { DictionaryData } from "./spellcheck-engine";
export { damerauLevenshteinDistance, generateEdits, generateEdits2 } from "./levenshtein";
