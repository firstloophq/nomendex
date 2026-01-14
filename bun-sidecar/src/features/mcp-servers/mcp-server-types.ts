import { z } from "zod";

// Transport configurations - matching SDK expectations

/**
 * Stdio transport: External process communicating via stdin/stdout
 * This is the default transport type if not specified
 */
export const StdioTransportSchema = z.object({
    type: z.literal("stdio").optional(),
    command: z.string(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).optional(),
});

/**
 * SSE transport: Server-Sent Events for HTTP streaming
 */
export const SseTransportSchema = z.object({
    type: z.literal("sse"),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
});

/**
 * HTTP transport: REST-based communication
 */
export const HttpTransportSchema = z.object({
    type: z.literal("http"),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
});

/**
 * Combined transport config - discriminated union for type safety
 * Stdio can omit the type field (it's the default)
 */
export const TransportConfigSchema = z.union([
    StdioTransportSchema,
    SseTransportSchema,
    HttpTransportSchema,
]);

/**
 * User-defined MCP server configuration
 */
export const UserMcpServerSchema = z.object({
    id: z.string(),
    name: z.string().min(1),
    description: z.string().optional(),
    transport: TransportConfigSchema,
    // Which secrets this server needs (keys in secrets.json)
    // Used for UI hints - actual values are expanded at runtime via ${SECRET_NAME} syntax
    requiredSecrets: z.array(z.string()).optional(),
    // User-provided notes/documentation
    notes: z.string().optional(),
    // Timestamps
    createdAt: z.string(),
    updatedAt: z.string(),
    // Whether the server is enabled
    enabled: z.boolean().default(true),
});

/**
 * File format for mcp-servers.json
 */
export const McpServersFileSchema = z.object({
    _comment: z.string().optional(),
    servers: z.array(UserMcpServerSchema),
});

// Inferred types
export type StdioTransport = z.infer<typeof StdioTransportSchema>;
export type SseTransport = z.infer<typeof SseTransportSchema>;
export type HttpTransport = z.infer<typeof HttpTransportSchema>;
export type TransportConfig = z.infer<typeof TransportConfigSchema>;
export type UserMcpServer = z.infer<typeof UserMcpServerSchema>;
export type McpServersFile = z.infer<typeof McpServersFileSchema>;

// Input type for creating a server (without auto-generated fields)
export type CreateMcpServerInput = Omit<UserMcpServer, "id" | "createdAt" | "updatedAt">;

// Input type for updating a server
export type UpdateMcpServerInput = {
    serverId: string;
    updates: Partial<Omit<UserMcpServer, "id" | "createdAt" | "updatedAt">>;
};
