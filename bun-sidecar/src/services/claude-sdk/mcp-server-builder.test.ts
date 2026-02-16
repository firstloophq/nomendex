import { describe, test, expect, mock } from "bun:test";

// Mock dependencies before importing module under test
mock.module("@/features/mcp-servers/fx", () => ({
    listUserMcpServers: mock(async () => []),
    expandEnvVars: mock(async (v: string) => v),
}));

mock.module("@/features/agents/index", () => ({
    MCP_REGISTRY: [],
}));

mock.module("@/lib/secrets", () => ({
    secrets: { get: mock(async () => undefined) },
}));

mock.module("@/mcp-servers/ui-renderer", () => ({
    uiRendererServer: { type: "stdio" as const, command: "fake-ui-renderer", args: [] },
}));

mock.module("@/lib/logger", () => ({
    createServiceLogger: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
    }),
}));

const { buildMcpServersFromConfig, buildMcpServersForQuery } = await import("./mcp-server-builder");
const { listUserMcpServers } = await import("@/features/mcp-servers/fx");
const agentsIndex = await import("@/features/agents/index");
const { secrets } = await import("@/lib/secrets");

describe("buildMcpServersFromConfig", () => {
    test("empty server list returns empty object", async () => {
        const result = await buildMcpServersFromConfig([]);
        expect(result).toEqual({});
    });

    test("user-defined stdio server", async () => {
        const mockList = listUserMcpServers as ReturnType<typeof mock>;
        mockList.mockImplementationOnce(async () => [
            {
                id: "my-server",
                name: "My Server",
                transport: { command: "node", args: ["server.js"], env: { FOO: "bar" } },
            },
        ]);

        const result = await buildMcpServersFromConfig(["my-server"]);
        expect(result["my-server"]).toEqual({
            command: "node",
            args: ["server.js"],
            env: { FOO: "bar" },
        });
    });

    test("user-defined SSE server with headers", async () => {
        const mockList = listUserMcpServers as ReturnType<typeof mock>;
        mockList.mockImplementationOnce(async () => [
            {
                id: "sse-server",
                name: "SSE Server",
                transport: {
                    type: "sse",
                    url: "https://example.com/sse",
                    headers: { "X-Api-Key": "secret" },
                },
            },
        ]);

        const result = await buildMcpServersFromConfig(["sse-server"]);
        expect(result["sse-server"]).toEqual({
            type: "sse",
            url: "https://example.com/sse",
            headers: { "X-Api-Key": "secret" },
        });
    });

    test("registry fallback stdio", async () => {
        const mockList = listUserMcpServers as ReturnType<typeof mock>;
        mockList.mockImplementationOnce(async () => []);

        // Mutate registry for this test
        const registry = agentsIndex.MCP_REGISTRY as Array<{
            id: string;
            name: string;
            config: { command: string; args: string[] };
        }>;
        registry.push({
            id: "registry-server",
            name: "Registry Server",
            config: { command: "python", args: ["-m", "server"] },
        });

        const result = await buildMcpServersFromConfig(["registry-server"]);
        expect(result["registry-server"]).toEqual({
            command: "python",
            args: ["-m", "server"],
        });

        // Clean up
        registry.pop();
    });

    test("registry SSE with auth token", async () => {
        const mockList = listUserMcpServers as ReturnType<typeof mock>;
        mockList.mockImplementationOnce(async () => []);

        const registry = agentsIndex.MCP_REGISTRY as Array<{
            id: string;
            name: string;
            config: { type: string; url: string; headers?: Record<string, string> };
        }>;
        registry.push({
            id: "linear",
            name: "Linear",
            config: { type: "sse", url: "https://linear.app/mcp" },
        });

        const mockGet = secrets.get as ReturnType<typeof mock>;
        mockGet.mockImplementationOnce(async () => "my-token-123");

        const result = await buildMcpServersFromConfig(["linear"]);
        expect(result["linear"]).toEqual({
            type: "sse",
            url: "https://linear.app/mcp",
            headers: { Authorization: "Bearer my-token-123" },
        });

        // Clean up
        registry.pop();
    });
});

describe("buildMcpServersForQuery", () => {
    test("adds UI renderer entry", async () => {
        const mockList = listUserMcpServers as ReturnType<typeof mock>;
        mockList.mockImplementationOnce(async () => []);

        const result = await buildMcpServersForQuery([]);
        expect(result["noetect-ui"]).toBeDefined();
        expect(result["noetect-ui"]).toEqual({
            type: "stdio",
            command: "fake-ui-renderer",
            args: [],
        });
    });
});
