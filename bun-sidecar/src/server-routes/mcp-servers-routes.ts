// API routes for user-defined MCP servers

import {
    listUserMcpServers,
    getUserMcpServer,
    createUserMcpServer,
    updateUserMcpServer,
    deleteUserMcpServer,
} from "@/features/mcp-servers/fx";
import { OAUTH_WARNING } from "@/features/mcp-servers/index";
import { MCP_REGISTRY } from "@/features/agents/index";
import type { UserMcpServer } from "@/features/mcp-servers/mcp-server-types";

// Extended type for combined server list (includes isBuiltIn flag)
interface CombinedMcpServer extends UserMcpServer {
    isBuiltIn?: boolean;
}

export const mcpServersRoutes = {
    /**
     * List all user-defined MCP servers
     * Returns servers array and OAuth warning
     */
    "/api/mcp-servers/list": {
        async GET() {
            const servers = await listUserMcpServers();
            return Response.json({ servers, oauthWarning: OAUTH_WARNING });
        },
    },

    /**
     * Get a single MCP server by ID
     */
    "/api/mcp-servers/get": {
        async POST(req: Request) {
            const { serverId } = (await req.json()) as { serverId: string };
            const server = await getUserMcpServer({ serverId });
            if (!server) {
                return Response.json({ error: "Server not found" }, { status: 404 });
            }
            return Response.json(server);
        },
    },

    /**
     * Create a new MCP server
     */
    "/api/mcp-servers/create": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                const server = await createUserMcpServer(args);
                return Response.json(server);
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : "Failed to create server";
                return Response.json({ error: message }, { status: 400 });
            }
        },
    },

    /**
     * Update an existing MCP server
     */
    "/api/mcp-servers/update": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                const server = await updateUserMcpServer(args);
                if (!server) {
                    return Response.json({ error: "Server not found" }, { status: 404 });
                }
                return Response.json(server);
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : "Failed to update server";
                return Response.json({ error: message }, { status: 400 });
            }
        },
    },

    /**
     * Delete an MCP server
     */
    "/api/mcp-servers/delete": {
        async POST(req: Request) {
            const { serverId } = (await req.json()) as { serverId: string };
            const result = await deleteUserMcpServer({ serverId });
            return Response.json(result);
        },
    },

    /**
     * Get all MCP servers (user-defined + built-in registry)
     * User-defined servers take precedence for duplicate IDs
     */
    "/api/mcp-servers/all": {
        async GET() {
            const userServers = await listUserMcpServers();

            // Convert built-in registry to same format as user servers
            const allServers: CombinedMcpServer[] = [...userServers];

            for (const builtIn of MCP_REGISTRY) {
                // Skip if user already defined a server with this ID
                if (allServers.some((s) => s.id === builtIn.id)) {
                    continue;
                }

                // Convert built-in to user format
                allServers.push({
                    id: builtIn.id,
                    name: builtIn.name,
                    description: builtIn.description,
                    transport: builtIn.config,
                    createdAt: "2025-01-01T00:00:00.000Z",
                    updatedAt: "2025-01-01T00:00:00.000Z",
                    enabled: true,
                    isBuiltIn: true,
                });
            }

            return Response.json({ servers: allServers, oauthWarning: OAUTH_WARNING });
        },
    },
};
