import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Browser, Page, expect, test } from "@playwright/test";

type KeyStep =
    | {
          text: string;
      }
    | {
          key: string;
      };

type Snapshot =
    | {
          nodeType: "element";
          tag: string;
          classes?: string[];
          attrs?: Record<string, string>;
          children: Snapshot[];
      }
    | {
          nodeType: "text";
          text: string;
      };

interface Scenario {
    id: string;
    name: string;
    initialContent?: string;
    steps: KeyStep[];
    expectedText: string;
    validate: (snapshot: Snapshot) => boolean;
    postTypeCheck?: (page: Page) => Promise<void>;
    preTypeDelayMs?: number;
    requireSyncParity?: boolean;
}

interface Direction {
    id: string;
    label: string;
    sourceUser: string;
    targetUser: string;
}

interface RunResult {
    scenario: string;
    direction: string;
    noteFileName: string;
    sourceUser: string;
    targetUser: string;
    pass: boolean;
    keySequence: string[];
    screenshots: {
        source: string;
        target: string;
    };
    elapsedMs: number;
    sourceSnapshot: Snapshot | null;
    targetSnapshot: Snapshot | null;
    error?: string;
    logs: string[];
}

const EDITOR_SELECTOR = ".editor-content .ProseMirror";
const DEFAULT_BASE_URL = "http://localhost:1234";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_ROOT = path.resolve(
    __dirname,
    "../docs/specs/team/issues/artifacts/crdt-playwright"
);
const REPORT_PATH = path.join(ARTIFACTS_ROOT, "crdt-collab-scenarios.json");
const SCROLL_WAIT_MS = 100;
const FILE_NAME_SANITIZER = /[^a-zA-Z0-9._-]+/g;

const results: RunResult[] = [];

test.describe.configure({ mode: "serial" });

const directions: Direction[] = [
    {
        id: "a-to-b",
        label: "A to B",
        sourceUser: "user-a",
        targetUser: "user-b",
    },
    {
        id: "b-to-a",
        label: "B to A",
        sourceUser: "user-b",
        targetUser: "user-a",
    },
];

const scenarios: Scenario[] = [
    {
        id: "plain-paragraph",
        name: "plain paragraph typing",
        steps: [
            {
                text: "The quick brown fox jumps over the lazy dog.",
            },
        ],
        expectedText: "The quick brown fox jumps over the lazy dog.",
        validate: (snapshot) => snapshotContainsText(snapshot, "The quick brown fox jumps over the lazy dog."),
    },
    {
        id: "bullet-list",
        name: "bullet list creation",
        steps: [
            { text: "- Bullet one" },
            { key: "Enter" },
            { text: "Bullet two" },
        ],
        expectedText: "Bullet one Bullet two",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "Bullet one") &&
            snapshotContainsText(snapshot, "Bullet two") &&
            hasTag(snapshot, "ul") &&
            !hasTag(snapshot, "ol"),
    },
    {
        id: "bullet-enter-continue",
        name: "bullet Enter continues as bullet",
        steps: [
            { text: "- First bullet" },
            { key: "Enter" },
            { text: "Second bullet" },
        ],
        expectedText: "First bullet Second bullet",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "First bullet") &&
            snapshotContainsText(snapshot, "Second bullet") &&
            hasTag(snapshot, "ul") &&
            !hasTag(snapshot, "ol"),
    },
    {
        id: "bullet-inputrule-marker",
        name: "bullet marker input rule conversion",
        steps: [
            { text: "-" },
            { key: "Space" },
        ],
        expectedText: "",
        validate: (snapshot) =>
            hasTag(snapshot, "ul") &&
            hasTag(snapshot, "li"),
    },
    {
        id: "heading-hash-focus-retained",
        name: "heading hash marker keeps editor focus",
        preTypeDelayMs: 1200,
        requireSyncParity: false,
        steps: [
            { text: "#" },
        ],
        expectedText: "#",
        validate: (snapshot) => snapshotContainsText(snapshot, "#"),
        postTypeCheck: async (page) => {
            const hasFocus = await editorHasFocus(page);
            expect(hasFocus).toBeTruthy();
        },
    },
    {
        id: "heading-inputrule-marker",
        name: "heading marker input rule conversion",
        preTypeDelayMs: 4000,
        steps: [
            { text: "#" },
            { key: "Space" },
            { text: "header" },
        ],
        expectedText: "header",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "header") &&
            hasTag(snapshot, "h1"),
    },
    {
        id: "heading-level-2-marker",
        name: "heading level 2 marker input rule conversion",
        steps: [
            { text: "##" },
            { key: "Space" },
            { text: "subheader" },
        ],
        expectedText: "subheader",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "subheader") &&
            hasTag(snapshot, "h2"),
    },
    {
        id: "heading-level-3-marker",
        name: "heading level 3 marker input rule conversion",
        steps: [
            { text: "###" },
            { key: "Space" },
            { text: "section" },
        ],
        expectedText: "section",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "section") &&
            hasTag(snapshot, "h3"),
    },
    {
        id: "numbered-list",
        name: "numbered list creation",
        steps: [
            { text: "1. First numbered item" },
            { key: "Enter" },
            { text: "2. Second numbered item" },
        ],
        expectedText: "First numbered item Second numbered item",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "First numbered item") &&
            snapshotContainsText(snapshot, "Second numbered item") &&
            hasTag(snapshot, "ol"),
    },
    {
        id: "numbered-list-inputrule-marker",
        name: "numbered list marker input rule conversion",
        steps: [
            { text: "1" },
            { text: "." },
            { key: "Space" },
            { text: "First item" },
            { key: "Enter" },
            { text: "2" },
            { text: "." },
            { key: "Space" },
            { text: "Second item" },
        ],
        expectedText: "First item Second item",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "First item") &&
            snapshotContainsText(snapshot, "Second item") &&
            hasTag(snapshot, "ol"),
    },
    {
        id: "nested-list",
        name: "nested list indentation and outdent",
        steps: [
            { text: "- Parent item" },
            { key: "Enter" },
            { text: "  - Child item" },
            { key: "Enter" },
            { text: "    - Grandchild item" },
            { key: "Enter" },
            { text: "  - Sibling item" },
        ],
        expectedText: "Parent item Child item Grandchild item Sibling item",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "Parent item") &&
            hasNestedUnorderedList(snapshot),
    },
    {
        id: "nested-list-command-indent",
        name: "nested list indentation via Tab",
        steps: [
            { text: "- Parent item" },
            { key: "Enter" },
            { text: "- Child item" },
            { key: "Tab" },
            { key: "Enter" },
            { text: "- Grandchild item" },
        ],
        expectedText: "Parent item Child item Grandchild item",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "Parent item") &&
            snapshotContainsText(snapshot, "Child item") &&
            snapshotContainsText(snapshot, "Grandchild item") &&
            hasNestedUnorderedList(snapshot),
    },
    {
        id: "nested-list-command-outdent",
        name: "nested list outdent via Shift+Tab",
        steps: [
            { text: "- Parent item" },
            { key: "Enter" },
            { text: "- Child item" },
            { key: "Tab" },
            { key: "Shift+Tab" },
            { key: "Enter" },
            { text: "- Back to parent" },
        ],
        expectedText: "Parent item Child item Back to parent",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "Parent item") &&
            snapshotContainsText(snapshot, "Child item") &&
            snapshotContainsText(snapshot, "Back to parent") &&
            hasTag(snapshot, "ul"),
    },
    {
        id: "blockquote-inputrule-marker",
        name: "blockquote marker input rule conversion",
        steps: [
            { text: "> " },
            { text: "quote line one" },
        ],
        expectedText: "quote line one",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "quote line one") &&
            hasTag(snapshot, "blockquote"),
    },
    {
        id: "headings",
        name: "headings",
        steps: [
            { text: "# Heading level 1" },
            { key: "Enter" },
            { text: "Some intro paragraph" },
            { key: "Enter" },
            { text: "## Heading level 2" },
        ],
        expectedText: "Heading level 1 Some intro paragraph Heading level 2",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "Heading level 1") &&
            snapshotContainsText(snapshot, "Heading level 2") &&
            hasTag(snapshot, "h1") &&
            hasTag(snapshot, "h2"),
    },
    {
        id: "formatting",
        name: "bold, italic, and code formatting",
        steps: [
            { text: "This line has " },
            { text: "**bold**" },
            { text: " and " },
            { text: "*italic*" },
            { text: " and " },
            { text: "`code`" },
        ],
        expectedText: "This line has bold and italic and code",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "This line has bold and italic and code") &&
            hasTag(snapshot, "strong") &&
            hasTag(snapshot, "em") &&
            hasTag(snapshot, "code"),
    },
    {
        id: "blockquote",
        name: "blockquote",
        steps: [
            { text: "> Quote line one" },
            { key: "Enter" },
            { text: "> Quote line two" },
        ],
        expectedText: "Quote line one Quote line two",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "Quote line one") &&
            snapshotContainsText(snapshot, "Quote line two") &&
            hasTag(snapshot, "blockquote"),
    },
    {
        id: "links-wikilinks",
        name: "links and wiki links",
        initialContent: "See [[wiki-note]] and [External](https://example.com)",
        steps: [],
        expectedText: "See wiki-note and External",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "wiki-note") &&
            snapshotContainsText(snapshot, "External") &&
            hasTag(snapshot, "a") &&
            hasClass(snapshot, "wiki-link"),
    },
    {
        id: "wikilink-trigger-presync-stability",
        name: "wiki link trigger stable before sync completion",
        requireSyncParity: false,
        steps: [
            { text: "See [[wiki-note" },
        ],
        expectedText: "See [[wiki-note",
        validate: (snapshot) => snapshotContainsText(snapshot, "See [[wiki-note"),
        postTypeCheck: async (page) => {
            const hasFocus = await editorHasFocus(page);
            expect(hasFocus).toBeTruthy();
        },
    },
    {
        id: "todo-patterns",
        name: "todo patterns",
        steps: [
            { text: "- [ ] Open task" },
            { key: "Enter" },
            { text: "- [x] Completed task" },
        ],
        expectedText: "Open task Completed task",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "Open task") &&
            snapshotContainsText(snapshot, "Completed task") &&
            hasTodoCheckbox(snapshot),
    },
    {
        id: "mixed-edits",
        name: "mixed content edits in formatted block",
        steps: [
            { text: "# Mixed edit block" },
            { key: "Enter" },
            { text: "Start block with formatting." },
            { key: "Home" },
            ...repeat(6, { key: "ArrowRight" }),
            ...repeat(5, { key: "Shift+ArrowRight" }),
            { key: "Backspace" },
            { text: "segment" },
        ],
        expectedText: "Mixed edit block Start segment with formatting.",
        validate: (snapshot) =>
            snapshotContainsText(snapshot, "Mixed edit block") &&
            snapshotContainsText(snapshot, "Start segment with formatting.") &&
            hasTag(snapshot, "h1"),
    },
];

function repeat(count: number, step: KeyStep): KeyStep[] {
    return Array.from({ length: count }, () => step);
}

function isTextNode(node: Snapshot | null): node is { nodeType: "text"; text: string } {
    return !!node && node.nodeType === "text";
}

function snapshotPlainText(snapshot: Snapshot | null): string {
    if (!snapshot) {
        return "";
    }

    if (isTextNode(snapshot)) {
        return snapshot.text;
    }

    return snapshot.children.map((child) => snapshotPlainText(child)).join(" ").replace(/\s+/g, " ").trim();
}

function snapshotContainsText(snapshot: Snapshot | null, needle: string): boolean {
    return snapshotPlainText(snapshot).includes(needle);
}

function hasTag(snapshot: Snapshot | null, tag: string): boolean {
    if (!snapshot || isTextNode(snapshot)) {
        return false;
    }

    if (snapshot.tag === tag) {
        return true;
    }

    return snapshot.children.some((child) => hasTag(child, tag));
}

function hasClass(snapshot: Snapshot | null, className: string): boolean {
    if (!snapshot || isTextNode(snapshot)) {
        return false;
    }

    if (snapshot.classes?.includes(className)) {
        return true;
    }

    return snapshot.children.some((child) => hasClass(child, className));
}

function hasTodoCheckbox(snapshot: Snapshot | null): boolean {
    if (!snapshot || isTextNode(snapshot)) {
        return false;
    }

    if (
        snapshot.tag === "input" &&
        snapshot.attrs?.type === "checkbox"
    ) {
        return true;
    }

    return snapshot.children.some((child) => hasTodoCheckbox(child));
}

function hasNestedUnorderedList(snapshot: Snapshot | null, depth = 0): boolean {
    if (!snapshot || isTextNode(snapshot)) {
        return false;
    }

    const currentDepth = snapshot.tag === "ul" ? depth + 1 : depth;
    if (snapshot.tag === "ul" && currentDepth >= 2) {
        return true;
    }

    return snapshot.children.some((child) => hasNestedUnorderedList(child, currentDepth));
}

function equalSnapshots(first: Snapshot | null, second: Snapshot | null): boolean {
    return JSON.stringify(first) === JSON.stringify(second);
}

function serializeSteps(steps: KeyStep[]): string[] {
    return steps.map((step) =>
        "text" in step ? `type:${step.text}` : `press:${step.key}`
    );
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

function buildWorkspaceState(noteFileName: string) {
    const tabId = `tab-${Date.now()}`;
    return {
        tabs: [
            {
                id: tabId,
                title: "Notes",
                pluginInstance: {
                    instanceId: `notes-${tabId}`,
                    plugin: {
                        id: "notes",
                        name: "Notes",
                        icon: "file",
                    },
                    viewId: "editor",
                    instanceProps: {
                        noteFileName,
                    },
                },
            },
        ],
        activeTabId: tabId,
        sidebarOpen: false,
        sidebarTabId: null,
        panes: [],
        activePaneId: null,
        splitRatio: 0.5,
        layoutMode: "single",
        mcpServerConfigs: [],
        projectPreferences: {},
        gitAuthMode: "local",
        notesLocation: "root",
        autoSync: {
            enabled: true,
            syncOnChanges: true,
            intervalSeconds: 60,
            paused: false,
        },
        chatInputEnterToSend: true,
        showHiddenFiles: false,
    };
}

async function seedNote(baseUrl: string, noteFileName: string, content = "") {
    await postJSON(baseUrl, "/api/notes/create", {
        fileName: noteFileName,
        content,
    });

    await postJSON(baseUrl, "/api/workspace", buildWorkspaceState(noteFileName));
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
    timeoutMs = 15_000
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

function sanitizeFileSegment(value: string) {
    const sanitized = value
        .replace(FILE_NAME_SANITIZER, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "");
    return sanitized || "segment";
}

function collectRuntimeErrors(logs: string[]) {
    const markers = [
        "Cannot read properties of undefined (reading 'eq')",
        "Cannot read properties of undefined (reading 'localsInner')",
        "TypeError: Cannot read properties of undefined",
    ];

    return logs.filter((line) => markers.some((marker) => line.includes(marker)));
}

async function openEditorForUser(
    page: Page,
    baseUrl: string,
    userId: string
) {
    const params = new URLSearchParams({
        userId,
        forceCollab: "1",
        crdtClientId: `${userId}-e2e`,
    });

    await page.goto(`/?${params.toString()}`);
    await page.waitForSelector(EDITOR_SELECTOR, { timeout: 20000 });
    await page.locator(EDITOR_SELECTOR).click();
}

async function typeSteps(page: Page, steps: KeyStep[]) {
    for (const step of steps) {
        if ("text" in step) {
            await page.keyboard.type(step.text);
            continue;
        }

        await page.keyboard.press(step.key);
    }
}

async function getEditorSnapshot(page: Page): Promise<Snapshot | null> {
    return page.evaluate((selector) => {
        const root = document.querySelector(selector);
        if (!root) return null;

        const shouldIgnoreClass = (value: string) =>
            value === "ProseMirror" ||
            value === "ProseMirror-widget" ||
            value === "ProseMirror-separator" ||
            value === "ProseMirror-trailingBreak" ||
            value === "crdt-remote-cursor" ||
            value === "crdt-remote-cursor-label" ||
            value.startsWith("yRemoteSelection") ||
            value === "yRemoteSelection" ||
            value.includes("yRemoteSelectionHead") ||
            value.includes("yRemoteSelection") ||
            value.includes("yjs");

        const isRemoteCursorClass = (value: string) =>
            value === "ProseMirror-widget" ||
            value === "ProseMirror-separator" ||
            value === "ProseMirror-trailingBreak" ||
            value === "crdt-remote-cursor" ||
            value === "crdt-remote-cursor-label" ||
            value.startsWith("yRemoteSelection") ||
            value === "yRemoteSelection" ||
            value.includes("yRemoteSelectionHead") ||
            value.includes("yRemoteSelection");

        const normalize = (node: ChildNode): Snapshot | null => {
            if (node.nodeType === Node.TEXT_NODE) {
                const raw = node.textContent ?? "";
                const text = raw.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
                if (!text) return null;
                return { nodeType: "text", text };
            }

            if (node.nodeType !== Node.ELEMENT_NODE) return null;

            const element = node as Element;
            const tag = element.tagName.toLowerCase();
            const rawClasses = Array.from(element.classList || []);
            if (rawClasses.some((value) => isRemoteCursorClass(value))) {
                // Drop remote cursor/head/label subtrees from parity snapshots.
                return null;
            }

            const classes = rawClasses.filter(
                (value) => !shouldIgnoreClass(value)
            );

            const attrs: Record<string, string> = {};

            if (tag === "a") {
                const href = element.getAttribute("href");
                if (href) {
                    attrs.href = href;
                }
            }

            if (tag === "input") {
                const input = element as HTMLInputElement;
                if (input.type === "checkbox") {
                    attrs.type = "checkbox";
                    attrs.checked = input.checked ? "true" : "false";
                }
            }

            const children = Array.from(element.childNodes)
                .map((child) => normalize(child))
                .filter((child): child is Snapshot => child !== null);

            return {
                nodeType: "element",
                tag,
                ...(classes.length ? { classes: classes.sort() } : {}),
                ...(Object.keys(attrs).length ? { attrs } : {}),
                children,
            };
        };

        return normalize(root);
    }, EDITOR_SELECTOR);
}

async function editorHasFocus(page: Page): Promise<boolean> {
    return page.evaluate((selector) => {
        const root = document.querySelector(selector);
        if (!root) return false;
        const active = document.activeElement as HTMLElement | null;
        if (!active) return false;
        return active === root || !!active.closest(selector);
    }, EDITOR_SELECTOR);
}

async function waitForSyncedEditors(
    sourcePage: Page,
    targetPage: Page,
    scenario: Scenario,
    timeoutMs = 20_000
): Promise<{ sourceSnapshot: Snapshot; targetSnapshot: Snapshot; elapsedMs: number }> {
    const startedAt = Date.now();
    let lastSourceSnapshot: Snapshot | null = null;
    let lastTargetSnapshot: Snapshot | null = null;
    let lastSourceText = "";
    let lastTargetText = "";
    let lastSourceHasExpected = false;
    let lastSourceValid = false;
    let lastParity = false;

    while (Date.now() - startedAt < timeoutMs) {
        const [sourceSnapshot, targetSnapshot] = await Promise.all([
            getEditorSnapshot(sourcePage),
            getEditorSnapshot(targetPage),
        ]);
        const sourceHasExpected = snapshotContainsText(sourceSnapshot, scenario.expectedText);
        const sourceValid = !!sourceSnapshot && scenario.validate(sourceSnapshot);
        const parity = equalSnapshots(sourceSnapshot, targetSnapshot);
        const sourceText = snapshotPlainText(sourceSnapshot);
        const targetText = snapshotPlainText(targetSnapshot);

        lastSourceSnapshot = sourceSnapshot;
        lastTargetSnapshot = targetSnapshot;
        lastSourceText = sourceText;
        lastTargetText = targetText;
        lastSourceHasExpected = sourceHasExpected;
        lastSourceValid = sourceValid;
        lastParity = parity;

        if (
            sourceSnapshot &&
            targetSnapshot &&
            sourceHasExpected &&
            sourceValid &&
            parity
        ) {
            return {
                sourceSnapshot,
                targetSnapshot,
                elapsedMs: Date.now() - startedAt,
            };
        }

        await sourcePage.waitForTimeout(SCROLL_WAIT_MS);
        await targetPage.waitForTimeout(SCROLL_WAIT_MS);
    }

    throw new Error(
        [
            `Timed out waiting for synced editor state for scenario '${scenario.name}'.`,
            `Expected text: ${scenario.expectedText}`,
            `sourceHasExpected=${lastSourceHasExpected}`,
            `sourceValid=${lastSourceValid}`,
            `parity=${lastParity}`,
            `sourceText='${lastSourceText}'`,
            `targetText='${lastTargetText}'`,
            `sourceSnapshot=${JSON.stringify(lastSourceSnapshot)}`,
            `targetSnapshot=${JSON.stringify(lastTargetSnapshot)}`,
        ].join(" ")
    );
}

async function waitForInitialParity(
    sourcePage: Page,
    targetPage: Page,
    timeoutMs = 10_000
): Promise<void> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const [sourceSnapshot, targetSnapshot] = await Promise.all([
            getEditorSnapshot(sourcePage),
            getEditorSnapshot(targetPage),
        ]);

        if (sourceSnapshot && targetSnapshot && equalSnapshots(sourceSnapshot, targetSnapshot)) {
            return;
        }

        await sourcePage.waitForTimeout(SCROLL_WAIT_MS);
        await targetPage.waitForTimeout(SCROLL_WAIT_MS);
    }

    throw new Error("Timed out waiting for initial editor parity before typing.");
}

async function runScenarioDirection(
    browser: Browser,
    baseUrl: string,
    scenario: Scenario,
    direction: Direction
): Promise<RunResult> {
    const safeScenarioId = sanitizeFileSegment(scenario.id || "scenario");
    const safeDirectionId = sanitizeFileSegment(direction.id || "direction");
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const noteFileName = `crdt-e2e-${safeScenarioId}-${safeDirectionId}-${runId}.md`;
    const result: RunResult = {
        scenario: scenario.id,
        direction: direction.label,
        noteFileName,
        sourceUser: direction.sourceUser,
        targetUser: direction.targetUser,
        pass: false,
        keySequence: serializeSteps(scenario.steps),
        screenshots: {
            source: "",
            target: "",
        },
        elapsedMs: 0,
        sourceSnapshot: null,
        targetSnapshot: null,
        logs: [],
    };

    const sourceScreenshot = path.join(
        ARTIFACTS_ROOT,
        `${safeScenarioId}-${safeDirectionId}-source-${runId}.png`
    );
    const targetScreenshot = path.join(
        ARTIFACTS_ROOT,
        `${safeScenarioId}-${safeDirectionId}-target-${runId}.png`
    );

    const context = await browser.newContext({ baseURL: baseUrl });
    await context.addInitScript(() => {
        window.localStorage.setItem("nomendex:crdt-debug", "1");
    });

    let sourcePage: Awaited<ReturnType<typeof context.newPage>> | null = null;
    let targetPage: Awaited<ReturnType<typeof context.newPage>> | null = null;

    try {
        await resetLogs(baseUrl);
        await seedNote(baseUrl, noteFileName, scenario.initialContent ?? "");

        sourcePage = await context.newPage();
        targetPage = await context.newPage();

        if (scenario.requireSyncParity !== false) {
            // Open source first so bootstrap is deterministic (single writer),
            // then open target and wait for both to report sync complete.
            await openEditorForUser(sourcePage, baseUrl, direction.sourceUser);
            await waitForSyncCompleteForUsers(baseUrl, noteFileName, [
                direction.sourceUser,
            ]);

            await openEditorForUser(targetPage, baseUrl, direction.targetUser);
            await waitForSyncCompleteForUsers(baseUrl, noteFileName, [
                direction.sourceUser,
                direction.targetUser,
            ]);
            await waitForInitialParity(sourcePage, targetPage);
        } else {
            await Promise.all([
                openEditorForUser(sourcePage, baseUrl, direction.sourceUser),
                openEditorForUser(targetPage, baseUrl, direction.targetUser),
            ]);
        }

        if (scenario.preTypeDelayMs && scenario.preTypeDelayMs > 0) {
            await sourcePage.waitForTimeout(scenario.preTypeDelayMs);
        }

        await typeSteps(sourcePage, scenario.steps);
        if (scenario.postTypeCheck) {
            await scenario.postTypeCheck(sourcePage);
        }

        if (scenario.requireSyncParity === false) {
            const sourceSnapshot = await getEditorSnapshot(sourcePage);
            const targetSnapshot = await getEditorSnapshot(targetPage);
            const sourceValid =
                !!sourceSnapshot &&
                snapshotContainsText(sourceSnapshot, scenario.expectedText) &&
                scenario.validate(sourceSnapshot);

            if (!sourceValid) {
                throw new Error(
                    `Scenario '${scenario.name}' failed source validation without sync parity.`
                );
            }

            result.sourceSnapshot = sourceSnapshot;
            result.targetSnapshot = targetSnapshot;
            result.elapsedMs = 0;
            result.pass = true;
        } else {
            const sync = await waitForSyncedEditors(sourcePage, targetPage, scenario);
            result.sourceSnapshot = sync.sourceSnapshot;
            result.targetSnapshot = sync.targetSnapshot;
            result.elapsedMs = sync.elapsedMs;
            result.pass = true;
        }

        result.logs = await recentLogs(baseUrl);
        const runtimeErrors = collectRuntimeErrors(result.logs);
        if (runtimeErrors.length > 0) {
            throw new Error(
                `Runtime editor errors detected: ${runtimeErrors.join(" | ")}`
            );
        }

        await Promise.all([
            sourcePage.screenshot({ path: sourceScreenshot, fullPage: true }),
            targetPage.screenshot({ path: targetScreenshot, fullPage: true }),
        ]);

        result.screenshots = {
            source: sourceScreenshot,
            target: targetScreenshot,
        };

        expect(result.pass).toBeTruthy();
    } catch (error) {
        if (sourcePage) {
            await sourcePage.screenshot({
                path: sourceScreenshot,
                fullPage: true,
            });
            result.screenshots.source = sourceScreenshot;
        }

        if (targetPage) {
            await targetPage.screenshot({
                path: targetScreenshot,
                fullPage: true,
            });
            result.screenshots.target = targetScreenshot;
        }

        if (sourcePage && targetPage) {
            result.error = error instanceof Error ? error.message : String(error);
        }

        throw error;
    } finally {
        try {
            result.logs = await recentLogs(baseUrl);
        } catch {
            result.logs = [];
        }

        result.screenshots = {
            source: sourceScreenshot,
            target: targetScreenshot,
        };

        results.push(result);
        await context.close();
    }

    return result;
}

test.beforeAll(async () => {
    await fs.mkdir(ARTIFACTS_ROOT, { recursive: true });
});

test.afterAll(async () => {
    await fs.writeFile(
        REPORT_PATH,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                scenarioResults: results,
            },
            null,
            2
        )
    );
});

for (const scenario of scenarios) {
    for (const direction of directions) {
        test(`${scenario.name} (${direction.label})`, async ({ browser }, testInfo) => {
            const baseUrl = testInfo.project.use.baseURL || DEFAULT_BASE_URL;
            await runScenarioDirection(browser, baseUrl, scenario, direction);
        });
    }
}
