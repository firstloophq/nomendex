import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { MCP_REGISTRY } from "@/features/agents/index";
import { listUserMcpServers, expandEnvVars } from "@/features/mcp-servers/fx";
import { createServiceLogger } from "@/lib/logger";
import { secrets } from "@/lib/secrets";
import { uiRendererServer } from "@/mcp-servers/ui-renderer";

const mcpLogger = createServiceLogger("MCP_BUILDER");

// Map of MCP server IDs to their secret key names
const MCP_SERVER_SECRETS: Record<string, string> = {
    "linear": "LINEAR_OAUTH_TOKEN",
};

// Build MCP servers from agent config - supports stdio, sse, and http transports
// Checks user-defined servers first, then falls back to built-in registry
export async function buildMcpServersFromConfig(mcpServerIds: string[]): Promise<Record<string, McpServerConfig>> {
    mcpLogger.info("Building MCP servers", { serverIds: mcpServerIds });
    const mcpServers: Record<string, McpServerConfig> = {};

    // Load user-defined servers
    const userServers = await listUserMcpServers();
    mcpLogger.info("User-defined MCP servers loaded", { count: userServers.length });

    for (const serverId of mcpServerIds) {
        // First, check user-defined servers
        const userServer = userServers.find((s) => s.id === serverId);

        if (userServer) {
            // Build config from user-defined server with environment variable expansion
            const transport = userServer.transport;

            if ("type" in transport && transport.type === "sse") {
                const config: McpServerConfig = {
                    type: "sse",
                    url: await expandEnvVars(transport.url),
                };
                if (transport.headers) {
                    config.headers = {};
                    for (const [key, value] of Object.entries(transport.headers)) {
                        config.headers[key] = await expandEnvVars(value);
                    }
                }
                mcpServers[serverId] = config;
                mcpLogger.info(`MCP server added (user-defined SSE): ${serverId}`, { url: config.url });
            } else if ("type" in transport && transport.type === "http") {
                const config: McpServerConfig = {
                    type: "http",
                    url: await expandEnvVars(transport.url),
                };
                if (transport.headers) {
                    config.headers = {};
                    for (const [key, value] of Object.entries(transport.headers)) {
                        config.headers[key] = await expandEnvVars(value);
                    }
                }
                mcpServers[serverId] = config;
                mcpLogger.info(`MCP server added (user-defined HTTP): ${serverId}`, { url: config.url });
            } else if ("command" in transport) {
                // stdio transport
                const config: McpServerConfig = {
                    command: await expandEnvVars(transport.command),
                    args: await Promise.all(transport.args.map((arg) => expandEnvVars(arg))),
                };
                if (transport.env) {
                    config.env = {};
                    for (const [key, value] of Object.entries(transport.env)) {
                        config.env[key] = await expandEnvVars(value);
                    }
                }
                mcpServers[serverId] = config;
                mcpLogger.info(`MCP server added (user-defined stdio): ${serverId}`, { command: config.command });
            }
            continue;
        }

        // Fall back to built-in registry
        const serverDef = MCP_REGISTRY.find((s) => s.id === serverId);
        mcpLogger.info(`MCP server lookup in registry: ${serverId}`, { found: !!serverDef });

        if (serverDef) {
            const sourceConfig = serverDef.config;

            // Check if this server needs an OAuth token from secrets
            const secretKey = MCP_SERVER_SECRETS[serverId];
            let authToken: string | undefined;
            if (secretKey) {
                authToken = await secrets.get(secretKey);
                mcpLogger.info(`MCP server auth: ${serverId}`, { hasToken: !!authToken });
            }

            // Handle different transport types
            if ("type" in sourceConfig && sourceConfig.type === "sse") {
                // SSE transport - no subprocess needed
                const config: McpServerConfig = {
                    type: "sse",
                    url: sourceConfig.url,
                };
                // Merge headers from config and add auth token if available
                const headers: Record<string, string> = { ...sourceConfig.headers };
                if (authToken) {
                    headers["Authorization"] = `Bearer ${authToken}`;
                }
                if (Object.keys(headers).length > 0) {
                    config.headers = headers;
                }
                mcpServers[serverId] = config;
                mcpLogger.info(`MCP server added (registry SSE): ${serverId}`, { url: sourceConfig.url, hasAuth: !!authToken });
            } else if ("type" in sourceConfig && sourceConfig.type === "http") {
                // HTTP transport
                const config: McpServerConfig = {
                    type: "http",
                    url: sourceConfig.url,
                };
                const headers: Record<string, string> = { ...sourceConfig.headers };
                if (authToken) {
                    headers["Authorization"] = `Bearer ${authToken}`;
                }
                if (Object.keys(headers).length > 0) {
                    config.headers = headers;
                }
                mcpServers[serverId] = config;
                mcpLogger.info(`MCP server added (registry HTTP): ${serverId}`, { url: sourceConfig.url, hasAuth: !!authToken });
            } else if ("command" in sourceConfig) {
                // stdio transport (default)
                const config: McpServerConfig = {
                    command: sourceConfig.command,
                    args: sourceConfig.args,
                };
                if (sourceConfig.env) {
                    config.env = sourceConfig.env;
                }
                mcpServers[serverId] = config;
                mcpLogger.info(`MCP server added (registry stdio): ${serverId}`, { command: sourceConfig.command });
            }
        }
    }

    mcpLogger.info("Final MCP servers config", { mcpServers });
    return mcpServers;
}

// Build MCP servers for a query, including the UI renderer server
export async function buildMcpServersForQuery(mcpServerIds: string[]): Promise<Record<string, McpServerConfig>> {
    const mcpServers = await buildMcpServersFromConfig(mcpServerIds);
    // Add the UI renderer server for skills to render custom UI
    mcpServers["noetect-ui"] = uiRendererServer;
    return mcpServers;
}
