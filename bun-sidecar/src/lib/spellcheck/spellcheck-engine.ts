/**
 * Browser-compatible spellcheck engine
 * Replaces typo-js which requires Node.js fs module
 */

import { generateEdits, generateEdits2, damerauLevenshteinDistance } from "./levenshtein";

export interface DictionaryData {
    words: string[];
    // Optional frequency data - words listed in order of frequency
    frequencies?: string[];
}

// Top 1000 most common English words for frequency ranking
// Source: Various frequency lists (Google, COCA, etc.)
const COMMON_WORDS = new Set([
    "the", "be", "to", "of", "and", "a", "in", "that", "have", "i",
    "it", "for", "not", "on", "with", "he", "as", "you", "do", "at",
    "this", "but", "his", "by", "from", "they", "we", "say", "her", "she",
    "or", "an", "will", "my", "one", "all", "would", "there", "their", "what",
    "so", "up", "out", "if", "about", "who", "get", "which", "go", "me",
    "when", "make", "can", "like", "time", "no", "just", "him", "know", "take",
    "people", "into", "year", "your", "good", "some", "could", "them", "see", "other",
    "than", "then", "now", "look", "only", "come", "its", "over", "think", "also",
    "back", "after", "use", "two", "how", "our", "work", "first", "well", "way",
    "even", "new", "want", "because", "any", "these", "give", "day", "most", "us",
    "is", "are", "was", "were", "been", "being", "has", "had", "did", "does",
    "doing", "made", "said", "went", "got", "came", "took", "seen", "known", "thought",
    "very", "more", "much", "before", "too", "same", "right", "still", "own", "such",
    "here", "thing", "things", "man", "men", "woman", "women", "child", "children", "world",
    "life", "hand", "part", "place", "case", "week", "company", "system", "program", "question",
    "government", "number", "night", "point", "home", "water", "room", "mother", "area", "money",
    "story", "fact", "month", "lot", "study", "book", "eye", "job", "word", "business",
    "issue", "side", "kind", "head", "house", "service", "friend", "father", "power", "hour",
    "game", "line", "end", "member", "law", "car", "city", "community", "name", "president",
    "team", "minute", "idea", "body", "information", "nothing", "ago", "lead", "social", "understand",
    "whether", "watch", "together", "follow", "around", "parent", "stop", "face", "anything", "create",
    "public", "already", "speak", "others", "read", "level", "allow", "add", "office", "spend",
    "door", "health", "person", "art", "sure", "war", "history", "party", "within", "grow",
    "result", "open", "morning", "walk", "reason", "low", "win", "research", "girl", "guy",
    "food", "moment", "air", "teacher", "force", "education", "today", "voice", "ago", "second",
]);

export class SpellcheckEngine {
    private words: Set<string> | null = null;
    private userWords: Set<string> = new Set();

    /**
     * Load dictionary from a URL (JSON format)
     */
    async load(url: string): Promise<void> {
        // Load main dictionary
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load dictionary: ${response.statusText}`);
        }

        const data: DictionaryData = await response.json();
        this.words = new Set(data.words.map((w) => w.toLowerCase()));

        // Load user dictionary
        await this.loadUserDictionary();
    }

    /**
     * Load user's custom dictionary
     */
    async loadUserDictionary(): Promise<void> {
        try {
            const response = await fetch("/api/dictionaries/user");
            if (response.ok) {
                const data = await response.json() as { words: string[] };
                this.userWords = new Set(data.words.map((w: string) => w.toLowerCase()));
            }
        } catch (error) {
            console.error("Error loading user dictionary:", error);
        }
    }

    /**
     * Add a word to the user dictionary
     */
    async addToUserDictionary(word: string): Promise<boolean> {
        try {
            const response = await fetch("/api/dictionaries/user/add", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ word }),
            });
            if (response.ok) {
                this.userWords.add(word.toLowerCase());
                return true;
            }
        } catch (error) {
            console.error("Error adding word to user dictionary:", error);
        }
        return false;
    }

    /**
     * Check if the engine is ready (dictionary loaded)
     */
    isReady(): boolean {
        return this.words !== null;
    }

    /**
     * Check if a word is spelled correctly
     * Returns true if the word is in the dictionary or user dictionary
     */
    check(word: string): boolean {
        if (!this.words) return true; // If no dictionary, assume correct

        const lowerWord = word.toLowerCase();

        // Check user dictionary first
        if (this.userWords.has(lowerWord)) return true;

        // Check main dictionary
        if (this.words.has(lowerWord)) return true;

        // Check with common suffixes removed (simple stemming)
        // This helps with words like "word's" -> "word"
        if (lowerWord.endsWith("'s")) {
            const base = lowerWord.slice(0, -2);
            if (this.userWords.has(base)) return true;
            if (this.words.has(base)) return true;
        }

        return false;
    }

    /**
     * Get spelling suggestions for a misspelled word
     * Uses edit-distance algorithm with frequency ranking
     */
    suggest(word: string, limit: number = 5): string[] {
        if (!this.words) return [];

        const lowerWord = word.toLowerCase();

        // First try 1-edit distance matches
        const edits1 = generateEdits(lowerWord);
        const suggestions1: string[] = [];

        for (const edit of edits1) {
            if (this.words.has(edit)) {
                suggestions1.push(edit);
            }
        }

        // If we have enough suggestions from 1-edit, return them
        if (suggestions1.length >= limit) {
            return this.sortAndLimitSuggestions(suggestions1, lowerWord, limit);
        }

        // Try 2-edit distance matches
        const edits2 = generateEdits2(lowerWord);
        const suggestions2: string[] = [...suggestions1];

        for (const edit of edits2) {
            if (this.words.has(edit) && !suggestions1.includes(edit)) {
                suggestions2.push(edit);
            }
        }

        return this.sortAndLimitSuggestions(suggestions2, lowerWord, limit);
    }

    /**
     * Sort suggestions by: frequency > edit distance > length > alphabetical
     */
    private sortAndLimitSuggestions(
        suggestions: string[],
        originalWord: string,
        limit: number
    ): string[] {
        // Sort with multiple criteria
        const sorted = suggestions.sort((a, b) => {
            // 1. Prefer common words (frequency)
            const aCommon = COMMON_WORDS.has(a) ? 0 : 1;
            const bCommon = COMMON_WORDS.has(b) ? 0 : 1;
            if (aCommon !== bCommon) return aCommon - bCommon;

            // 2. Prefer lower edit distance (using Damerau-Levenshtein)
            const distA = damerauLevenshteinDistance(originalWord, a);
            const distB = damerauLevenshteinDistance(originalWord, b);
            if (distA !== distB) return distA - distB;

            // 3. Prefer shorter words
            if (a.length !== b.length) return a.length - b.length;

            // 4. Alphabetical as final tiebreaker
            return a.localeCompare(b);
        });

        // Preserve original capitalization style
        const result = sorted.slice(0, limit).map((suggestion) => {
            if (originalWord[0] === originalWord[0].toUpperCase()) {
                return suggestion[0].toUpperCase() + suggestion.slice(1);
            }
            return suggestion;
        });

        return result;
    }
}
