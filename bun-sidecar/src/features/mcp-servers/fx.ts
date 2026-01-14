import { createServiceLogger } from "@/lib/logger";
import { getNoetectPath, hasActiveWorkspace } from "@/storage/root-path";
import { secrets } from "@/lib/secrets";
import { mkdir } from "node:fs/promises";
import path from "path";
import {
    type UserMcpServer,
    type McpServersFile,
    type CreateMcpServerInput,
    type UpdateMcpServerInput,
    UserMcpServerSchema,
    McpServersFileSchema,
} from "./mcp-server-types";

const mcpLogger = createServiceLogger("MCP-SERVERS");

/**
 * Get the path to the MCP servers configuration file
 */
function getMcpServersPath(): string {
    return path.join(getNoetectPath(), "mcp-servers.json");
}

/**
 * Ensure the .noetect directory exists
 */
async function ensureNoetectDir(): Promise<void> {
    if (!hasActiveWorkspace()) {
        throw new Error("No active workspace");
    }
    await mkdir(getNoetectPath(), { recursive: true });
}

/**
 * Load the MCP servers file from disk
 */
async function loadMcpServersFile(): Promise<McpServersFile> {
    try {
        await ensureNoetectDir();
        const file = Bun.file(getMcpServersPath());
        if (await file.exists()) {
            const data = await file.json();
            return McpServersFileSchema.parse(data);
        }
        return { servers: [] };
    } catch (error) {
        mcpLogger.error("Failed to load MCP servers file", { error });
        return { servers: [] };
    }
}

/**
 * Save the MCP servers file to disk
 */
async function saveMcpServersFile(data: McpServersFile): Promise<void> {
    await ensureNoetectDir();
    const fileData: McpServersFile = {
        _comment:
            "User-defined MCP servers. Environment variables like ${SECRET_NAME} or ${VAR:-default} are expanded at runtime.",
        servers: data.servers,
    };
    await Bun.write(getMcpServersPath(), JSON.stringify(fileData, null, 2));
}

/**
 * List all user-defined MCP servers
 */
export async function listUserMcpServers(): Promise<UserMcpServer[]> {
    const file = await loadMcpServersFile();
    return file.servers;
}

/**
 * Get a single MCP server by ID
 */
export async function getUserMcpServer(input: {
    serverId: string;
}): Promise<UserMcpServer | null> {
    const servers = await listUserMcpServers();
    return servers.find((s) => s.id === input.serverId) ?? null;
}

/**
 * Create a new MCP server
 */
export async function createUserMcpServer(
    input: CreateMcpServerInput
): Promise<UserMcpServer> {
    const file = await loadMcpServersFile();

    const now = new Date().toISOString();
    const server: UserMcpServer = {
        ...input,
        id: `mcp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        createdAt: now,
        updatedAt: now,
        enabled: input.enabled ?? true,
    };

    // Validate the server config
    UserMcpServerSchema.parse(server);

    file.servers.push(server);
    await saveMcpServersFile(file);

    mcpLogger.info(`Created MCP server: ${server.id}`, { name: server.name });
    return server;
}

/**
 * Update an existing MCP server
 */
export async function updateUserMcpServer(
    input: UpdateMcpServerInput
): Promise<UserMcpServer | null> {
    const file = await loadMcpServersFile();
    const index = file.servers.findIndex((s) => s.id === input.serverId);

    if (index === -1) {
        return null;
    }

    const existing = file.servers[index];
    const updated: UserMcpServer = {
        ...existing,
        ...input.updates,
        id: input.serverId, // Ensure ID doesn't change
        createdAt: existing.createdAt, // Preserve createdAt
        updatedAt: new Date().toISOString(),
    };

    // Validate the updated server config
    UserMcpServerSchema.parse(updated);

    file.servers[index] = updated;
    await saveMcpServersFile(file);

    mcpLogger.info(`Updated MCP server: ${input.serverId}`);
    return updated;
}

/**
 * Delete an MCP server
 */
export async function deleteUserMcpServer(input: {
    serverId: string;
}): Promise<{ success: boolean }> {
    const file = await loadMcpServersFile();
    const index = file.servers.findIndex((s) => s.id === input.serverId);

    if (index === -1) {
        return { success: false };
    }

    file.servers.splice(index, 1);
    await saveMcpServersFile(file);

    mcpLogger.info(`Deleted MCP server: ${input.serverId}`);
    return { success: true };
}

/**
 * Expand environment variables in a string value.
 * Supports two syntaxes:
 * - ${VAR_NAME} - replaced with the value of VAR_NAME from secrets or process.env
 * - ${VAR_NAME:-default} - replaced with VAR_NAME value, or "default" if not set
 *
 * Secrets are checked first, then process.env.
 */
export async function expandEnvVars(value: string): Promise<string> {
    // Pattern matches ${VAR_NAME} or ${VAR_NAME:-default}
    const pattern = /\$\{([^}:-]+)(?::-([^}]*))?\}/g;

    let result = value;
    const matches = [...value.matchAll(pattern)];

    for (const match of matches) {
        const [fullMatch, varName, defaultValue] = match;

        // Try to get from secrets first, then process.env
        let replacement = await secrets.get(varName);

        if (!replacement && defaultValue !== undefined) {
            replacement = defaultValue;
        }

        if (replacement !== undefined) {
            result = result.replace(fullMatch, replacement);
        }
    }

    return result;
}
