/**
 * Routes for serving spellcheck dictionary files
 */

import { homedir } from "node:os";
import { join } from "node:path";

// Import the dictionary directly so Bun bundles it
import dictionaryData from "../dictionaries/en_US.json";

// Cache the stringified version
const dictionaryJSON = JSON.stringify(dictionaryData);

// Path to user dictionary
const USER_DICTIONARY_PATH = join(
    homedir(),
    "Library/Application Support/com.firstloop.nomendex/user-dictionary.json"
);

interface UserDictionary {
    words: string[];
}

async function loadUserDictionary(): Promise<UserDictionary> {
    try {
        const file = Bun.file(USER_DICTIONARY_PATH);
        if (await file.exists()) {
            return await file.json();
        }
    } catch (error) {
        console.error("Error loading user dictionary:", error);
    }
    return { words: [] };
}

async function saveUserDictionary(dict: UserDictionary): Promise<void> {
    await Bun.write(USER_DICTIONARY_PATH, JSON.stringify(dict, null, 2));
}

export const dictionariesRoutes = {
    "/api/dictionaries/en_US.json": {
        GET() {
            return new Response(dictionaryJSON, {
                headers: {
                    "Content-Type": "application/json",
                    // Cache for 1 day - dictionary doesn't change often
                    "Cache-Control": "public, max-age=86400",
                },
            });
        },
    },

    "/api/dictionaries/user": {
        async GET() {
            const dict = await loadUserDictionary();
            return Response.json(dict);
        },
    },

    "/api/dictionaries/user/add": {
        async POST(req: Request) {
            try {
                const { word } = await req.json() as { word: string };
                if (!word || typeof word !== "string") {
                    return Response.json({ error: "Invalid word" }, { status: 400 });
                }

                const lowerWord = word.toLowerCase().trim();
                if (!lowerWord) {
                    return Response.json({ error: "Invalid word" }, { status: 400 });
                }

                const dict = await loadUserDictionary();
                if (!dict.words.includes(lowerWord)) {
                    dict.words.push(lowerWord);
                    dict.words.sort();
                    await saveUserDictionary(dict);
                }

                return Response.json({ success: true, word: lowerWord });
            } catch (error) {
                console.error("Error adding word to user dictionary:", error);
                return Response.json({ error: "Failed to add word" }, { status: 500 });
            }
        },
    },

    "/api/dictionaries/user/remove": {
        async POST(req: Request) {
            try {
                const { word } = await req.json() as { word: string };
                if (!word || typeof word !== "string") {
                    return Response.json({ error: "Invalid word" }, { status: 400 });
                }

                const lowerWord = word.toLowerCase().trim();
                const dict = await loadUserDictionary();
                const index = dict.words.indexOf(lowerWord);
                if (index !== -1) {
                    dict.words.splice(index, 1);
                    await saveUserDictionary(dict);
                }

                return Response.json({ success: true, word: lowerWord });
            } catch (error) {
                console.error("Error removing word from user dictionary:", error);
                return Response.json({ error: "Failed to remove word" }, { status: 500 });
            }
        },
    },
};
