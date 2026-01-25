/**
 * Build script to generate pre-expanded dictionary JSON from Hunspell files
 *
 * This downloads the Hunspell en_US dictionary files and expands all affix rules
 * to create a flat list of valid words for browser-based spellchecking.
 */

import { resolve } from "node:path";

const AFF_URL =
    "https://raw.githubusercontent.com/cfinke/Typo.js/master/typo/dictionaries/en_US/en_US.aff";
const DIC_URL =
    "https://raw.githubusercontent.com/cfinke/Typo.js/master/typo/dictionaries/en_US/en_US.dic";

interface AffixRule {
    type: "PFX" | "SFX";
    flag: string;
    crossProduct: boolean;
    rules: Array<{
        strip: string;
        add: string;
        condition: string;
    }>;
}

interface ParsedAffix {
    prefixes: Map<string, AffixRule>;
    suffixes: Map<string, AffixRule>;
}

/**
 * Parse the .aff file to extract affix rules
 */
function parseAffFile(content: string): ParsedAffix {
    const lines = content.split("\n");
    const prefixes = new Map<string, AffixRule>();
    const suffixes = new Map<string, AffixRule>();

    let currentRule: AffixRule | null = null;
    let expectedCount = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const parts = trimmed.split(/\s+/);
        const command = parts[0];

        if (command === "PFX" || command === "SFX") {
            if (parts.length === 4) {
                // Rule header: PFX/SFX flag crossProduct count
                const flag = parts[1];
                const crossProduct = parts[2] === "Y";
                expectedCount = parseInt(parts[3], 10);

                currentRule = {
                    type: command,
                    flag,
                    crossProduct,
                    rules: [],
                };

                if (command === "PFX") {
                    prefixes.set(flag, currentRule);
                } else {
                    suffixes.set(flag, currentRule);
                }
            } else if (parts.length >= 4 && currentRule && currentRule.flag === parts[1]) {
                // Rule entry: PFX/SFX flag strip add [condition]
                const strip = parts[2] === "0" ? "" : parts[2];
                const add = parts[3] === "0" ? "" : parts[3].split("/")[0]; // Remove any flags from add
                const condition = parts[4] || ".";

                currentRule.rules.push({ strip, add, condition });
            }
        }
    }

    return { prefixes, suffixes };
}

/**
 * Check if a word matches a condition pattern
 */
function matchesCondition(word: string, condition: string, isSuffix: boolean): boolean {
    if (condition === ".") return true;

    try {
        // Convert Hunspell condition to regex
        // For suffix: match at end, for prefix: match at start
        const regexPattern = isSuffix ? `${condition}$` : `^${condition}`;
        const regex = new RegExp(regexPattern, "i");
        return regex.test(word);
    } catch {
        // If regex fails, just return true
        return true;
    }
}

/**
 * Apply a single affix rule to a word
 */
function applyAffixRule(word: string, rule: AffixRule): string[] {
    const results: string[] = [];
    const isSuffix = rule.type === "SFX";

    for (const { strip, add, condition } of rule.rules) {
        if (!matchesCondition(word, condition, isSuffix)) continue;

        let newWord: string;

        if (isSuffix) {
            // Suffix: remove from end, add to end
            if (strip && word.endsWith(strip)) {
                newWord = word.slice(0, -strip.length) + add;
            } else if (!strip) {
                newWord = word + add;
            } else {
                continue;
            }
        } else {
            // Prefix: remove from start, add to start
            if (strip && word.startsWith(strip)) {
                newWord = add + word.slice(strip.length);
            } else if (!strip) {
                newWord = add + word;
            } else {
                continue;
            }
        }

        results.push(newWord);
    }

    return results;
}

/**
 * Expand a word with all its affix flags
 */
function expandWord(baseWord: string, flags: string, affixes: ParsedAffix): string[] {
    const words = new Set<string>();
    words.add(baseWord);

    // Process each flag character
    for (const flag of flags) {
        const prefix = affixes.prefixes.get(flag);
        const suffix = affixes.suffixes.get(flag);

        if (prefix) {
            // Apply prefix to base word and any suffixed forms
            const currentWords = [...words];
            for (const word of currentWords) {
                for (const expanded of applyAffixRule(word, prefix)) {
                    words.add(expanded);
                }
            }
        }

        if (suffix) {
            // Apply suffix to base word
            for (const expanded of applyAffixRule(baseWord, suffix)) {
                words.add(expanded);

                // If cross-product, also apply any applicable prefixes
                if (suffix.crossProduct) {
                    for (const pfxFlag of flags) {
                        const pfx = affixes.prefixes.get(pfxFlag);
                        if (pfx && pfx.crossProduct) {
                            for (const prefixed of applyAffixRule(expanded, pfx)) {
                                words.add(prefixed);
                            }
                        }
                    }
                }
            }
        }
    }

    return [...words];
}

/**
 * Parse the .dic file and expand all words
 */
function parseDicFile(content: string, affixes: ParsedAffix): Set<string> {
    const lines = content.split("\n");
    const allWords = new Set<string>();

    // Skip first line (word count)
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Parse word/flags format
        const slashIndex = line.indexOf("/");
        let baseWord: string;
        let flags: string;

        if (slashIndex !== -1) {
            baseWord = line.slice(0, slashIndex);
            flags = line.slice(slashIndex + 1);
        } else {
            baseWord = line;
            flags = "";
        }

        // Expand word with affixes
        const expanded = expandWord(baseWord, flags, affixes);
        for (const word of expanded) {
            // Only add words that are primarily alphabetic
            if (/^[a-zA-Z]+('[a-zA-Z]+)?$/.test(word)) {
                allWords.add(word.toLowerCase());
            }
        }
    }

    return allWords;
}

async function main() {
    console.log("Downloading Hunspell dictionary files...");

    // Download both files
    const [affResponse, dicResponse] = await Promise.all([fetch(AFF_URL), fetch(DIC_URL)]);

    if (!affResponse.ok || !dicResponse.ok) {
        console.error("Failed to download dictionary files");
        process.exit(1);
    }

    const affContent = await affResponse.text();
    const dicContent = await dicResponse.text();

    console.log("Parsing affix rules...");
    const affixes = parseAffFile(affContent);
    console.log(`  Found ${affixes.prefixes.size} prefix rules`);
    console.log(`  Found ${affixes.suffixes.size} suffix rules`);

    console.log("Expanding dictionary...");
    const words = parseDicFile(dicContent, affixes);
    console.log(`  Generated ${words.size} unique words`);

    // Sort words for consistent output
    const sortedWords = [...words].sort();

    // Write JSON output
    const outputPath = resolve(import.meta.dir, "../src/dictionaries/en_US.json");
    const outputData = { words: sortedWords };

    await Bun.write(outputPath, JSON.stringify(outputData));

    console.log(`Dictionary written to: ${outputPath}`);
    console.log(`File size: ${(JSON.stringify(outputData).length / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((error) => {
    console.error("Error building dictionary:", error);
    process.exit(1);
});
