/**
 * Levenshtein distance utilities for spellcheck suggestions
 */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

/**
 * Calculate the Damerau-Levenshtein edit distance between two strings
 * Unlike standard Levenshtein, this counts transposition as 1 edit (not 2)
 */
export function damerauLevenshteinDistance(a: string, b: string): number {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    if (aLower === bLower) return 0;
    if (aLower.length === 0) return bLower.length;
    if (bLower.length === 0) return aLower.length;

    const lenA = aLower.length;
    const lenB = bLower.length;

    // Create distance matrix
    const matrix: number[][] = [];

    for (let i = 0; i <= lenA; i++) {
        matrix[i] = [];
        for (let j = 0; j <= lenB; j++) {
            if (i === 0) {
                matrix[i][j] = j;
            } else if (j === 0) {
                matrix[i][j] = i;
            } else {
                matrix[i][j] = 0;
            }
        }
    }

    for (let i = 1; i <= lenA; i++) {
        for (let j = 1; j <= lenB; j++) {
            const cost = aLower[i - 1] === bLower[j - 1] ? 0 : 1;

            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1, // deletion
                matrix[i][j - 1] + 1, // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );

            // Transposition
            if (
                i > 1 &&
                j > 1 &&
                aLower[i - 1] === bLower[j - 2] &&
                aLower[i - 2] === bLower[j - 1]
            ) {
                matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
            }
        }
    }

    return matrix[lenA][lenB];
}

/**
 * Generate all 1-edit distance variants of a word
 * Includes: deletions, insertions, substitutions, transpositions
 */
export function generateEdits(word: string): Set<string> {
    const edits = new Set<string>();
    const lowerWord = word.toLowerCase();

    // Deletions (remove one character)
    for (let i = 0; i < lowerWord.length; i++) {
        edits.add(lowerWord.slice(0, i) + lowerWord.slice(i + 1));
    }

    // Insertions (add one character at each position)
    for (let i = 0; i <= lowerWord.length; i++) {
        for (const char of ALPHABET) {
            edits.add(lowerWord.slice(0, i) + char + lowerWord.slice(i));
        }
    }

    // Substitutions (replace one character)
    for (let i = 0; i < lowerWord.length; i++) {
        for (const char of ALPHABET) {
            if (char !== lowerWord[i]) {
                edits.add(lowerWord.slice(0, i) + char + lowerWord.slice(i + 1));
            }
        }
    }

    // Transpositions (swap adjacent characters)
    for (let i = 0; i < lowerWord.length - 1; i++) {
        edits.add(
            lowerWord.slice(0, i) +
                lowerWord[i + 1] +
                lowerWord[i] +
                lowerWord.slice(i + 2)
        );
    }

    return edits;
}

/**
 * Generate all 2-edit distance variants by applying edits twice
 */
export function generateEdits2(word: string): Set<string> {
    const edits2 = new Set<string>();
    const edits1 = generateEdits(word);

    for (const edit of edits1) {
        for (const edit2 of generateEdits(edit)) {
            edits2.add(edit2);
        }
    }

    return edits2;
}
