import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactsRoot = path.resolve(
    __dirname,
    "../docs/specs/team/issues/artifacts/crdt-playwright"
);
const e2ePort = process.env.E2E_PORT ?? "1234";
const baseURL = process.env.BASE_URL ?? `http://localhost:${e2ePort}`;

export default defineConfig({
    testDir: "./tests",
    timeout: 120000,
    expect: {
        timeout: 10000,
    },
    webServer: {
        command: `PORT=${e2ePort} bun run dev`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120000,
    },
    use: {
        baseURL,
        headless: true,
        viewport: {
            width: 1440,
            height: 1024,
        },
        ignoreHTTPSErrors: true,
    },
    outputDir: path.join(artifactsRoot, "playwright-output"),
    projects: [
        {
            name: "chromium",
            use: {
                browserName: "chromium",
            },
        },
    ],
});
