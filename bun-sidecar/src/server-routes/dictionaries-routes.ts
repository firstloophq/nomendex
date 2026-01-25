/**
 * Routes for serving spellcheck dictionary files
 */

import { resolve } from "node:path";

export const dictionariesRoutes = {
    "/dictionaries/en_US.aff": {
        async GET() {
            try {
                const filePath = resolve(import.meta.dir, "../dictionaries/en_US.aff");
                const file = Bun.file(filePath);
                const exists = await file.exists();

                if (!exists) {
                    return new Response(
                        "Dictionary file not found. Run 'bun run scripts/download-dictionaries.ts' to download.",
                        { status: 404 }
                    );
                }

                return new Response(file, {
                    headers: {
                        "Content-Type": "text/plain",
                    },
                });
            } catch (error) {
                console.error("Error serving .aff file:", error);
                return new Response("Internal server error", { status: 500 });
            }
        },
    },
    "/dictionaries/en_US.dic": {
        async GET() {
            try {
                const filePath = resolve(import.meta.dir, "../dictionaries/en_US.dic");
                const file = Bun.file(filePath);
                const exists = await file.exists();

                if (!exists) {
                    return new Response(
                        "Dictionary file not found. Run 'bun run scripts/download-dictionaries.ts' to download.",
                        { status: 404 }
                    );
                }

                return new Response(file, {
                    headers: {
                        "Content-Type": "text/plain",
                    },
                });
            } catch (error) {
                console.error("Error serving .dic file:", error);
                return new Response("Internal server error", { status: 500 });
            }
        },
    },
};
