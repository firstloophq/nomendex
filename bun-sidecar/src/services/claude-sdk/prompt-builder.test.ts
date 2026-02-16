import { describe, test, expect, mock } from "bun:test";

// Mock transitive dependencies before any module that imports them is loaded
mock.module("@/storage/root-path", () => ({
    getUploadsPath: () => "/tmp/uploads",
}));

mock.module("@/lib/logger", () => ({
    createServiceLogger: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
    }),
}));

const { buildAgentContext, buildSystemPrompt } = await import("./prompt-builder");

// Inline the shape needed by buildSystemPrompt to avoid static imports
type TestAgentConfig = {
    id: string;
    name: string;
    systemPrompt: string;
    model: string;
    mcpServers: string[];
    allowedTools: string[];
    createdAt: string;
    updatedAt: string;
};

const makeAgent = (overrides: Partial<TestAgentConfig> = {}): TestAgentConfig => ({
    id: "test",
    name: "Test Agent",
    systemPrompt: "",
    model: "claude-sonnet-4-5-20250929",
    mcpServers: [],
    allowedTools: [],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
});

describe("buildAgentContext", () => {
    test("includes date and workspace folder", () => {
        const result = buildAgentContext("/Users/test/workspace");
        expect(result).toContain("<agent-context>");
        expect(result).toContain("</agent-context>");
        expect(result).toContain("/Users/test/workspace");
        expect(result).toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/);
    });
});

describe("buildSystemPrompt", () => {
    test("with custom system prompt, prepends context", () => {
        const agent = makeAgent({ systemPrompt: "You are a helpful assistant." });
        const result = buildSystemPrompt(agent, "/workspace");
        expect(result).toContain("<agent-context>");
        expect(result).toContain("You are a helpful assistant.");
        const contextIdx = result.indexOf("<agent-context>");
        const customIdx = result.indexOf("You are a helpful assistant.");
        expect(contextIdx).toBeLessThan(customIdx);
    });

    test("with no system prompt, returns context only", () => {
        const agent = makeAgent({ systemPrompt: "" });
        const result = buildSystemPrompt(agent, "/workspace");
        expect(result).toContain("<agent-context>");
        expect(result).not.toContain("\n\n");
        expect(result).toMatch(/^<agent-context>[\s\S]+<\/agent-context>$/);
    });
});
