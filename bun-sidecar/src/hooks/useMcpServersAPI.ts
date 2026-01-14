import type {
    UserMcpServer,
    CreateMcpServerInput,
    UpdateMcpServerInput,
} from "@/features/mcp-servers/mcp-server-types";

// Extended type for combined server list response
interface CombinedMcpServer extends UserMcpServer {
    isBuiltIn?: boolean;
}

interface ListResponse {
    servers: UserMcpServer[];
    oauthWarning: string;
}

interface AllServersResponse {
    servers: CombinedMcpServer[];
    oauthWarning: string;
}

async function fetchAPI<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`/api/mcp-servers/${endpoint}`, {
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(
            (error as { error?: string }).error ?? `API error: ${response.status}`
        );
    }
    return response.json();
}

// Standalone API object for use outside React components
export const mcpServersAPI = {
    /**
     * List all user-defined MCP servers
     */
    listServers: () => fetchAPI<ListResponse>("list", { method: "GET" }),

    /**
     * Get a single MCP server by ID
     */
    getServer: (args: { serverId: string }) =>
        fetchAPI<UserMcpServer>("get", { method: "POST", body: JSON.stringify(args) }),

    /**
     * Create a new MCP server
     */
    createServer: (args: CreateMcpServerInput) =>
        fetchAPI<UserMcpServer>("create", { method: "POST", body: JSON.stringify(args) }),

    /**
     * Update an existing MCP server
     */
    updateServer: (args: UpdateMcpServerInput) =>
        fetchAPI<UserMcpServer>("update", { method: "POST", body: JSON.stringify(args) }),

    /**
     * Delete an MCP server
     */
    deleteServer: (args: { serverId: string }) =>
        fetchAPI<{ success: boolean }>("delete", {
            method: "POST",
            body: JSON.stringify(args),
        }),

    /**
     * Get all MCP servers (user-defined + built-in registry)
     */
    getAllServers: () => fetchAPI<AllServersResponse>("all", { method: "GET" }),
};

// Hook wrapper for use in React components
export function useMcpServersAPI() {
    return mcpServersAPI;
}
