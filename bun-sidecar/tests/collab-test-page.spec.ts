import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, Page, test } from "@playwright/test";

const EDITOR_SELECTOR = ".editor-content .ProseMirror";
const DEFAULT_BASE_URL = "http://localhost:1234";
const SCROLL_WAIT_MS = 100;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_ROOT = path.resolve(
    __dirname,
    "../docs/specs/team/issues/artifacts/crdt-playwright"
);

function normalizeText(value: string | null): string {
    return (value ?? "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

async function getEditorText(page: Page): Promise<string> {
    const text = await page.locator(EDITOR_SELECTOR).innerText();
    return normalizeText(text);
}

async function openCollabTestPage(params: {
    page: Page;
    docId: string;
    userId: string;
}) {
    const query = new URLSearchParams({
        doc: params.docId,
        userId: params.userId,
    });

    await params.page.goto(`/collab-test?${query.toString()}`);
    await params.page.waitForSelector(EDITOR_SELECTOR, { timeout: 20_000 });
    await params.page.locator(EDITOR_SELECTOR).click();
}

async function postJSON<T>(baseUrl: string, endpoint: string, body: unknown = {}): Promise<T> {
    const response = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(`POST ${endpoint} failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
}

async function getJSON<T>(baseUrl: string, endpoint: string): Promise<T> {
    const response = await fetch(`${baseUrl}${endpoint}`);

    if (!response.ok) {
        throw new Error(`GET ${endpoint} failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
}

async function resetLogs(baseUrl: string) {
    await postJSON(baseUrl, "/api/logs/reset", {});
}

async function recentLogs(baseUrl: string): Promise<string[]> {
    const payload = await getJSON<{ lines?: string[] }>(
        baseUrl,
        "/api/logs/recent?limit=500&contains=CRDT:"
    );
    return payload.lines ?? [];
}

function extractSyncCompleteUserForDoc(line: string, docId: string): string | null {
    try {
        const parsed = JSON.parse(line) as {
            event?: string;
            data?: {
                docId?: string;
                href?: string;
            };
        };
        if (parsed.event !== "CRDT:sync_complete") return null;
        if (parsed.data?.docId !== docId) return null;

        const href = parsed.data?.href;
        if (!href) return null;

        try {
            return new URL(href).searchParams.get("userId");
        } catch {
            const match = href.match(/[?&]userId=([^&]+)/);
            return match?.[1] ?? null;
        }
    } catch {
        return null;
    }
}

async function waitForSyncCompleteForUsers(
    baseUrl: string,
    noteFileName: string,
    userIds: string[],
    timeoutMs = 20_000
): Promise<void> {
    const startedAt = Date.now();
    const docId = `note:${noteFileName}`;

    while (Date.now() - startedAt < timeoutMs) {
        const lines = await recentLogs(baseUrl);
        const syncedUsers = new Set<string>();

        for (const line of lines) {
            const userId = extractSyncCompleteUserForDoc(line, docId);
            if (userId) {
                syncedUsers.add(userId);
            }
        }

        if (userIds.every((userId) => syncedUsers.has(userId))) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, SCROLL_WAIT_MS));
    }

    throw new Error(
        `Timed out waiting for CRDT sync_complete for doc '${docId}' and users: ${userIds.join(", ")}`
    );
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
    await fs.mkdir(ARTIFACTS_ROOT, { recursive: true });
});

test("collab test page syncs and clear-all propagates", async ({ browser }, testInfo) => {
    const baseUrl = testInfo.project.use.baseURL || DEFAULT_BASE_URL;
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const docId = `collab-test-smoke-${runId}`;
    const noteFileName = `collab-test/${docId}.md`;
    const typedText = "Collab test page smoke text.";

    const screenshotAPath = path.join(
        ARTIFACTS_ROOT,
        `collab-test-page-user-a-${runId}.png`
    );
    const screenshotBPath = path.join(
        ARTIFACTS_ROOT,
        `collab-test-page-user-b-${runId}.png`
    );

    const context = await browser.newContext({ baseURL: baseUrl });
    await context.addInitScript(() => {
        window.localStorage.setItem("nomendex:crdt-debug", "1");
    });

    const userAPage = await context.newPage();
    const userBPage = await context.newPage();

    try {
        await resetLogs(baseUrl);

        await Promise.all([
            openCollabTestPage({ page: userAPage, docId, userId: "user-a" }),
            openCollabTestPage({ page: userBPage, docId, userId: "user-b" }),
        ]);

        await waitForSyncCompleteForUsers(baseUrl, noteFileName, ["user-a", "user-b"]);

        await userAPage.keyboard.type(typedText);

        await expect.poll(async () => getEditorText(userBPage), { timeout: 20_000 }).toContain(typedText);

        await userBPage.getByTestId("collab-clear-all").click();

        await expect.poll(async () => getEditorText(userAPage), { timeout: 20_000 }).toBe("");
        await expect.poll(async () => getEditorText(userBPage), { timeout: 20_000 }).toBe("");

        await Promise.all([
            userAPage.screenshot({ path: screenshotAPath, fullPage: true }),
            userBPage.screenshot({ path: screenshotBPath, fullPage: true }),
        ]);
    } finally {
        await context.close();
    }
});
