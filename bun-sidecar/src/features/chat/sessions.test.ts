import { describe, test, expect, beforeEach, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp dirs before module mocks reference them
let tempDir: string;
let nomendexDir: string;
let claudeSessionsDir: string;

beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "chat-fx-test-"));
    nomendexDir = join(tempDir, ".nomendex");
    claudeSessionsDir = join(tempDir, "claude-sessions");
});

// Mock root-path to return temp dirs (include all exports to avoid breaking other test files)
mock.module("@/storage/root-path", () => ({
    getRootPath: () => tempDir,
    getNomendexPath: () => nomendexDir,
    getUploadsPath: () => join(tempDir, "uploads"),
    getTodosPath: () => join(tempDir, "todos"),
    getNotesPath: () => join(tempDir, "notes"),
    getAgentsPath: () => join(tempDir, "agents"),
    getSkillsPath: () => join(tempDir, ".claude", "skills"),
    hasActiveWorkspace: () => true,
    getActiveWorkspacePath: () => tempDir,
    initializePaths: async () => {},
}));

// Mock agents/fx to avoid real file I/O
mock.module("@/features/agents/fx", () => ({
    getAgent: mock(async () => null),
    getPreferences: mock(async () => ({ lastUsedAgentId: "default" })),
    savePreferences: mock(async () => {}),
}));

// Mock logger to suppress output
mock.module("@/lib/logger", () => ({
    createServiceLogger: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
    }),
}));

// Now import the module under test (after mocks are set up)
const { getSessionsFile, getClaudeSessionsDir, saveSession, listSessions, updateSession, deleteSession, resolveAgent } = await import("./sessions");
const { getAgent, getPreferences } = await import("@/features/agents/fx");

describe("getSessionsFile", () => {
    test("returns path under nomendex dir", () => {
        const result = getSessionsFile();
        expect(result).toBe(join(nomendexDir, "chat-sessions.jsonl"));
    });
});

describe("getClaudeSessionsDir", () => {
    test("converts slashes to dashes", () => {
        const result = getClaudeSessionsDir();
        // tempDir is something like /tmp/chat-fx-test-xyz
        // Should become -tmp-chat-fx-test-xyz
        expect(result).toContain(tempDir.replace(/\//g, "-"));
        expect(result).toContain("/.claude/projects/");
    });
});

describe("saveSession", () => {
    test("creates entry in sessions file", async () => {
        const result = await saveSession({
            id: "session-1",
            title: "Test Session",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
            messageCount: 0,
        });
        expect(result.success).toBe(true);
        expect(result.session.id).toBe("session-1");
        expect(result.session.title).toBe("Test Session");
    });

    test("deduplicates by returning existing session", async () => {
        await saveSession({
            id: "session-dup",
            title: "Original",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
            messageCount: 0,
        });
        const result = await saveSession({
            id: "session-dup",
            title: "Duplicate",
            createdAt: "2025-01-02T00:00:00Z",
            updatedAt: "2025-01-02T00:00:00Z",
            messageCount: 5,
        });
        expect(result.session.title).toBe("Original");
    });
});

describe("listSessions", () => {
    test("returns sessions sorted by updatedAt descending, filtering to existing history files", async () => {
        // Create sessions file
        const { mkdirSync } = await import("node:fs");
        mkdirSync(nomendexDir, { recursive: true });
        mkdirSync(claudeSessionsDir, { recursive: true });

        // Save sessions via the module
        await saveSession({
            id: "old",
            title: "Old Session",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
            messageCount: 1,
        });
        await saveSession({
            id: "new",
            title: "New Session",
            createdAt: "2025-01-02T00:00:00Z",
            updatedAt: "2025-01-02T00:00:00Z",
            messageCount: 2,
        });

        // listSessions checks for history files in the claude sessions dir.
        // Create matching history files in the actual claude sessions dir.
        const actualClaudeDir = getClaudeSessionsDir();
        mkdirSync(actualClaudeDir, { recursive: true });
        await Bun.write(join(actualClaudeDir, "old.jsonl"), '{"type":"user"}\n');
        await Bun.write(join(actualClaudeDir, "new.jsonl"), '{"type":"user"}\n');

        const sessions = await listSessions();
        expect(sessions.length).toBe(2);
        expect(sessions[0].id).toBe("new");
        expect(sessions[1].id).toBe("old");
    });
});

describe("updateSession", () => {
    test("modifies fields of matching session", async () => {
        await saveSession({
            id: "update-me",
            title: "Before",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
            messageCount: 0,
        });

        await updateSession({ id: "update-me", title: "After", messageCount: 10 });

        // Read back via JSONL
        const { readJSONL } = await import("@/lib/jsonl");
        type Session = { id: string; title: string; messageCount: number };
        const sessions = await readJSONL<Session>(getSessionsFile());
        const updated = sessions.find((s) => s.id === "update-me");
        expect(updated?.title).toBe("After");
        expect(updated?.messageCount).toBe(10);
    });
});

describe("deleteSession", () => {
    test("removes entry from sessions file", async () => {
        await saveSession({
            id: "keep",
            title: "Keep",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
            messageCount: 0,
        });
        await saveSession({
            id: "delete-me",
            title: "Delete",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
            messageCount: 0,
        });

        await deleteSession("delete-me");

        const { readJSONL } = await import("@/lib/jsonl");
        type Session = { id: string };
        const sessions = await readJSONL<Session>(getSessionsFile());
        expect(sessions.map((s) => s.id)).toEqual(["keep"]);
    });
});

describe("resolveAgent", () => {
    test("uses explicit requestAgentId when provided", async () => {
        const mockGetAgent = getAgent as ReturnType<typeof mock>;
        mockGetAgent.mockImplementationOnce(async () => ({
            id: "custom",
            name: "Custom",
            systemPrompt: "",
            model: "claude-sonnet-4-5-20250929",
            mcpServers: [],
            allowedTools: [],
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
        }));

        const result = await resolveAgent({ requestAgentId: "custom" });
        expect(result.id).toBe("custom");
    });

    test("falls back to preferences when no agentId or sessionId", async () => {
        const mockGetAgent = getAgent as ReturnType<typeof mock>;
        const mockGetPrefs = getPreferences as ReturnType<typeof mock>;

        mockGetPrefs.mockImplementationOnce(async () => ({ lastUsedAgentId: "pref-agent" }));
        mockGetAgent.mockImplementationOnce(async () => null);

        const result = await resolveAgent({});
        // Should fall back to DEFAULT_AGENT since getAgent returns null
        expect(result.id).toBe("default");
        expect(result.name).toBe("General Assistant");
    });
});
