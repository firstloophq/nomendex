import { query, type SDKMessage, type McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { getRootPath, getNomendexPath, getUploadsPath } from "@/storage/root-path";
import { getAgent, getPreferences, savePreferences, addAllowedTool, getAgentAllowedTools } from "@/features/agents/fx";
import { DEFAULT_AGENT, MCP_REGISTRY } from "@/features/agents/index";
import { listUserMcpServers, expandEnvVars } from "@/features/mcp-servers/fx";
import type { AgentConfig } from "@/features/agents/index";
import { createServiceLogger } from "@/lib/logger";
import { secrets } from "@/lib/secrets";
import { uiRendererServer } from "@/mcp-servers/ui-renderer";

// Create logger for chat routes
const chatLogger = createServiceLogger("CHAT");

// Helper to read image from uploads folder and convert to base64
async function readImageAsBase64(imageUrl: string): Promise<{ data: string; mediaType: string } | null> {
    try {
        // Extract filename from URL (e.g., "/api/uploads/image.png" -> "image.png")
        const filename = imageUrl.replace("/api/uploads/", "");
        if (!filename) return null;

        const uploadsPath = getUploadsPath();
        const filePath = join(uploadsPath, filename);
        const file = Bun.file(filePath);

        if (!(await file.exists())) {
            chatLogger.warn(`Image not found: ${filePath}`);
            return null;
        }

        const arrayBuffer = await file.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        const mimeType = file.type || "image/png";

        return { data: base64, mediaType: mimeType };
    } catch (error) {
        chatLogger.error(`Failed to read image: ${imageUrl}`, { error });
        return null;
    }
}

// Build context information for the agent's system prompt
function buildAgentContext(workspaceFolder: string): string {
    const now = new Date();
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayOfWeek = dayNames[now.getDay()];
    const dateStr = now.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });

    return `<agent-context>
Today is ${dayOfWeek}, ${dateStr}.
You are working in the folder: ${workspaceFolder}
</agent-context>`;
}

// Session management types
type SessionMetadata = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    agentId?: string; // Which agent config was used for this session
};

// Map of MCP server IDs to their secret key names
const MCP_SERVER_SECRETS: Record<string, string> = {
    "linear": "LINEAR_OAUTH_TOKEN",
};

// Build MCP servers from agent config - supports stdio, sse, and http transports
// Checks user-defined servers first, then falls back to built-in registry
async function buildMcpServersFromConfig(mcpServerIds: string[]): Promise<Record<string, McpServerConfig>> {
    chatLogger.info("Building MCP servers", { serverIds: mcpServerIds });
    const mcpServers: Record<string, McpServerConfig> = {};

    // Load user-defined servers
    const userServers = await listUserMcpServers();
    chatLogger.info("User-defined MCP servers loaded", { count: userServers.length });

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
                chatLogger.info(`MCP server added (user-defined SSE): ${serverId}`, { url: config.url });
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
                chatLogger.info(`MCP server added (user-defined HTTP): ${serverId}`, { url: config.url });
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
                chatLogger.info(`MCP server added (user-defined stdio): ${serverId}`, { command: config.command });
            }
            continue;
        }

        // Fall back to built-in registry
        const serverDef = MCP_REGISTRY.find((s) => s.id === serverId);
        chatLogger.info(`MCP server lookup in registry: ${serverId}`, { found: !!serverDef });

        if (serverDef) {
            const sourceConfig = serverDef.config;

            // Check if this server needs an OAuth token from secrets
            const secretKey = MCP_SERVER_SECRETS[serverId];
            let authToken: string | undefined;
            if (secretKey) {
                authToken = await secrets.get(secretKey);
                chatLogger.info(`MCP server auth: ${serverId}`, { hasToken: !!authToken });
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
                chatLogger.info(`MCP server added (registry SSE): ${serverId}`, { url: sourceConfig.url, hasAuth: !!authToken });
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
                chatLogger.info(`MCP server added (registry HTTP): ${serverId}`, { url: sourceConfig.url, hasAuth: !!authToken });
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
                chatLogger.info(`MCP server added (registry stdio): ${serverId}`, { command: sourceConfig.command });
            }
        }
    }

    chatLogger.info("Final MCP servers config", { mcpServers });
    return mcpServers;
}

// Permission handling types
type PermissionDecision = "allow" | "deny";
type PermissionResponse = {
    decision: PermissionDecision;
    alwaysAllow?: boolean;
    toolName?: string;
};
type PendingPermission = {
    resolve: (response: PermissionResponse) => void;
    toolName: string;
    input: Record<string, unknown>;
    createdAt: number;
};

// Global map to store pending permission requests
const pendingPermissions = new Map<string, PendingPermission>();

// Track active queries for cancellation (only while running)
type ActiveQuery = {
    abortController: AbortController;
    startedAt: number;
};
const activeQueries = new Map<string, ActiveQuery>();

// Clean up stale permissions (older than 5 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [id, permission] of pendingPermissions.entries()) {
        if (now - permission.createdAt > 5 * 60 * 1000) {
            console.log(`[Permissions] Cleaning up stale permission: ${id}`);
            permission.resolve({ decision: "deny" });
            pendingPermissions.delete(id);
        }
    }
}, 60 * 1000);

// File paths - computed dynamically
function getSessionsFile(): string {
    return join(getNomendexPath(), "chat-sessions.jsonl");
}
// Claude sessions directory - computed from workspace path
function getClaudeSessionsDir(): string {
    const workspacePath = getRootPath();
    // Convert path to Claude-compatible format (replace / with -)
    // Claude keeps the leading dash, e.g., /Users/foo -> -Users-foo
    const pathPart = workspacePath.replace(/\//g, "-");
    return `${process.env.HOME}/.claude/projects/${pathPart}`;
}

async function readJSONL<T>(filePath: string): Promise<T[]> {
    if (!existsSync(filePath)) {
        return [];
    }
    const content = await Bun.file(filePath).text();
    return content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
}

async function appendJSONL(filePath: string, data: object): Promise<void> {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    const line = JSON.stringify(data) + "\n";
    await appendFile(filePath, line);
}

async function updateJSONL<T extends { id: string }>(
    filePath: string,
    id: string,
    updater: (item: T) => T
): Promise<void> {
    const items = await readJSONL<T>(filePath);
    const updatedItems = items.map((item) =>
        item.id === id ? updater(item) : item
    );
    const content = updatedItems.map((item) => JSON.stringify(item)).join("\n") + "\n";
    await Bun.write(filePath, content);
}

export const chatRoutes = {
    "/api/chat": {
        async POST(req: Request) {
            console.log("[API] Received chat request");

            try {
                const body = await req.json();
                console.log("[API] Request body:", body);

                const { message, images, sessionId, agentId: requestAgentId } = body as {
                    message: string;
                    images?: string[];
                    sessionId?: string;
                    agentId?: string;
                };

                if (!message && (!images || images.length === 0)) {
                    console.log("[API] Error: No message or images provided");
                    return Response.json(
                        { error: "Message or images required" },
                        { status: 400 }
                    );
                }

                // Log images if present
                if (images && images.length > 0) {
                    console.log("[API] Images attached:", images.length);
                }

                // Determine which agent to use
                let agentId: string;
                let agentConfig: AgentConfig;

                if (requestAgentId) {
                    // Agent explicitly specified in request
                    agentId = requestAgentId;
                } else if (sessionId) {
                    // Try to get agent from existing session metadata
                    const sessions = await readJSONL<SessionMetadata>(getSessionsFile());
                    const sessionMeta = sessions.find((s) => s.id === sessionId);
                    agentId = sessionMeta?.agentId || (await getPreferences()).lastUsedAgentId;
                } else {
                    // New session - use last used agent
                    agentId = (await getPreferences()).lastUsedAgentId;
                }

                // Load agent configuration
                const loadedAgent = await getAgent({ agentId });
                agentConfig = loadedAgent || DEFAULT_AGENT;
                console.log("[API] Using agent:", agentConfig.name, "(", agentConfig.id, ")");
                console.log("[API] Agent mcpServers:", agentConfig.mcpServers);

                // Update last used agent preference
                await savePreferences({ lastUsedAgentId: agentConfig.id });

                const targetDir = getRootPath();
                console.log("[API] User message:", message);
                console.log("[API] Session ID:", sessionId || "none (new session)");
                console.log("[API] Agent ID:", agentConfig.id);
                console.log("[API] Target directory:", targetDir);

                const encoder = new TextEncoder();
                const messageQueue: string[] = [];
                let streamClosed = false;
                let resolveNext: (() => void) | null = null;

                const pushToQueue = (data: object) => {
                    messageQueue.push(`data: ${JSON.stringify(data)}\n\n`);
                    if (resolveNext) {
                        resolveNext();
                        resolveNext = null;
                    }
                };

                // Load allowed tools for this agent
                const agentAllowedTools = await getAgentAllowedTools({ agentId: agentConfig.id });
                console.log(`[Permissions] Agent ${agentConfig.id} has ${agentAllowedTools.length} allowed tools:`, agentAllowedTools);

                const canUseTool = async (
                    toolName: string,
                    input: Record<string, unknown>
                ) => {
                    // Check if tool is already allowed for this agent
                    if (agentAllowedTools.includes(toolName)) {
                        console.log(`[Permissions] Tool "${toolName}" auto-allowed for agent ${agentConfig.id}`);
                        return {
                            behavior: "allow" as const,
                            updatedInput: input,
                        };
                    }

                    const permissionId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    console.log(`[Permissions] Tool "${toolName}" requesting permission, id: ${permissionId}`);

                    pushToQueue({
                        type: "permission_request",
                        permissionId,
                        toolName,
                        input,
                        agentId: agentConfig.id, // Include agentId so frontend knows which agent
                    });

                    const response = await new Promise<PermissionResponse>((resolve) => {
                        pendingPermissions.set(permissionId, {
                            resolve,
                            toolName,
                            input,
                            createdAt: Date.now(),
                        });
                    });

                    pendingPermissions.delete(permissionId);
                    console.log(`[Permissions] Decision for ${permissionId}: ${response.decision}, alwaysAllow: ${response.alwaysAllow}`);

                    if (response.decision === "allow") {
                        // If "Always Allow" was selected, persist the permission for this agent
                        if (response.alwaysAllow) {
                            console.log(`[Permissions] Persisting always-allow for tool: ${toolName} on agent: ${agentConfig.id}`);
                            await addAllowedTool({ agentId: agentConfig.id, toolName });
                            // Also add to our local cache so subsequent calls in this session auto-allow
                            agentAllowedTools.push(toolName);
                        }

                        return {
                            behavior: "allow" as const,
                            updatedInput: input,
                        };
                    } else {
                        return { behavior: "deny" as const, message: "User denied permission" };
                    }
                };

                console.log("[API] Starting SDK query iterator...");

                // Create AbortController for this query
                const abortController = new AbortController();

                // Build MCP servers from agent config
                const mcpServers = await buildMcpServersFromConfig(agentConfig.mcpServers);

                // Add the UI renderer server for skills to render custom UI
                mcpServers["noetect-ui"] = uiRendererServer;

                // Find Claude CLI path - check common locations
                const claudeCliPath = process.env.CLAUDE_CLI_PATH
                    || `${process.env.HOME}/.local/bin/claude`;

                const sdkOptions: {
                    model: string;
                    cwd: string;
                    resume?: string;
                    maxTurns: number;
                    includePartialMessages: boolean;
                    systemPrompt?: string;
                    mcpServers: Record<string, McpServerConfig>;
                    pathToClaudeCodeExecutable: string;
                    settingSources: Array<"user" | "project">;
                } = {
                    model: agentConfig.model,
                    cwd: targetDir,
                    resume: sessionId,
                    maxTurns: 100,
                    includePartialMessages: true,
                    mcpServers,
                    pathToClaudeCodeExecutable: claudeCliPath,
                    settingSources: ["project"], // Load skills from project .claude/skills/, MCP servers come from mcpServers option
                };

                // Build context-aware system prompt
                // Always include agent context (date, workspace folder) for all agents
                const agentContext = buildAgentContext(targetDir);
                if (agentConfig.systemPrompt) {
                    // Custom agent: prepend context to their system prompt
                    sdkOptions.systemPrompt = `${agentContext}\n\n${agentConfig.systemPrompt}`;
                } else {
                    // Default agent: just add context (SDK will use its default prompt)
                    sdkOptions.systemPrompt = agentContext;
                }

                // Log MCP server names (can't stringify SDK servers due to cyclic refs)
                const mcpServerNames = Object.keys(mcpServers);
                console.log("[API] SDK options:", {
                    ...sdkOptions,
                    resume: sessionId || "(new session)",
                    systemPrompt: agentConfig.systemPrompt ? "(custom + context)" : "(context only)",
                    mcpServers: mcpServerNames,
                    pathToClaudeCodeExecutable: claudeCliPath,
                });
                console.log("[API] mcpServers being passed to SDK:", mcpServerNames);

                let queryIterator: AsyncIterable<SDKMessage>;
                // Generate a temporary ID for tracking if no session yet
                const queryTrackingId = sessionId || `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

                try {
                    console.log("[API] Calling query()...");

                    // Build prompt - use multimodal format if images are present
                    type ContentBlock =
                        | { type: "text"; text: string }
                        | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

                    type UserMessageInput = {
                        type: "user";
                        message: { role: "user"; content: ContentBlock[] };
                        parent_tool_use_id: null;
                        session_id: string;
                    };

                    let promptInput: string | AsyncIterable<UserMessageInput>;

                    if (images && images.length > 0) {
                        // Read images and encode as base64
                        const contentBlocks: ContentBlock[] = [];

                        for (const imageUrl of images) {
                            const imageData = await readImageAsBase64(imageUrl);
                            if (imageData) {
                                contentBlocks.push({
                                    type: "image",
                                    source: {
                                        type: "base64",
                                        media_type: imageData.mediaType,
                                        data: imageData.data,
                                    },
                                });
                            }
                        }

                        // Add text content if present
                        if (message) {
                            contentBlocks.push({ type: "text", text: message });
                        }

                        console.log("[API] Images processed:", contentBlocks.filter(b => b.type === "image").length);

                        // Create async iterable for multimodal message
                        async function* generateUserMessage(): AsyncIterable<UserMessageInput> {
                            yield {
                                type: "user" as const,
                                message: {
                                    role: "user" as const,
                                    content: contentBlocks,
                                },
                                parent_tool_use_id: null,
                                session_id: sessionId || "",
                            };
                        }

                        promptInput = generateUserMessage();
                    } else {
                        // Plain text prompt
                        promptInput = message || "";
                    }

                    queryIterator = query({
                        prompt: promptInput,
                        options: {
                            ...sdkOptions,
                            abortController,
                            canUseTool,
                            stderr: (data: string) => {
                                chatLogger.error("SDK STDERR", { data });
                            },
                        },
                    });

                    // Track this query for potential cancellation
                    activeQueries.set(queryTrackingId, {
                        abortController,
                        startedAt: Date.now(),
                    });
                    console.log(`[API] Tracking query: ${queryTrackingId}`);
                    console.log("[API] SDK query() returned:", typeof queryIterator);
                    console.log("[API] SDK query() is AsyncIterable:", Symbol.asyncIterator in queryIterator);
                } catch (sdkInitError) {
                    console.error("[API] SDK query() failed to initialize:", sdkInitError);
                    if (sdkInitError instanceof Error) {
                        console.error("[API] Init error name:", sdkInitError.name);
                        console.error("[API] Init error message:", sdkInitError.message);
                        console.error("[API] Init error stack:", sdkInitError.stack);
                    }
                    // Re-throw with additional context
                    const enhancedError = new Error(
                        `SDK initialization failed: ${sdkInitError instanceof Error ? sdkInitError.message : String(sdkInitError)}`
                    );
                    if (sdkInitError instanceof Error) {
                        enhancedError.cause = sdkInitError;
                        enhancedError.stack = sdkInitError.stack;
                    }
                    throw enhancedError;
                }

                const consumeIterator = async () => {
                    let newSessionId: string | undefined = sessionId;
                    let messageCount = 0;
                    const startTime = Date.now();
                    let currentTrackingId = queryTrackingId;

                    console.log("[API] Starting SDK iterator consumption (outside stream)...");

                    // Heartbeat to detect if we're stuck waiting for first message
                    let receivedFirstMessage = false;
                    const heartbeatInterval = setInterval(() => {
                        if (!receivedFirstMessage) {
                            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
                            console.log(`[API] [Heartbeat] Still waiting for first SDK message... (${elapsed}s elapsed)`);
                        }
                    }, 5000);

                    try {
                        console.log("[API] Entering for-await loop over queryIterator...");
                        console.log("[API] Getting async iterator...");
                        const iterator = queryIterator[Symbol.asyncIterator]();
                        console.log("[API] Got iterator, calling first next()...");

                        let iterResult = await iterator.next();
                        console.log("[API] First next() returned, done:", iterResult.done);

                        while (!iterResult.done) {
                            const msg = iterResult.value;
                            if (!receivedFirstMessage) {
                                receivedFirstMessage = true;
                                clearInterval(heartbeatInterval);
                                console.log(`[API] First message received after ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
                            }
                            messageCount++;
                            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

                            console.log(`[API] [${elapsed}s] Message #${messageCount}: ${msg.type}`);

                            if (msg.type === "system" && msg.subtype === "init") {
                                newSessionId = msg.session_id;
                                chatLogger.info("SDK init message received", { sessionId: newSessionId });

                                // Log MCP server connection status
                                if ("mcp_servers" in msg && Array.isArray(msg.mcp_servers)) {
                                    chatLogger.info("MCP servers status", { servers: msg.mcp_servers });
                                    const failedServers = msg.mcp_servers.filter(
                                        (s: { status: string }) => s.status !== "connected"
                                    );
                                    if (failedServers.length > 0) {
                                        chatLogger.error("MCP servers failed to connect", { failedServers });
                                    }
                                } else {
                                    chatLogger.warn("No MCP servers in init message", { msg: JSON.stringify(msg) });
                                }

                                // Update tracking to use real session ID
                                if (newSessionId && currentTrackingId !== newSessionId) {
                                    const queryData = activeQueries.get(currentTrackingId);
                                    if (queryData) {
                                        activeQueries.delete(currentTrackingId);
                                        activeQueries.set(newSessionId, queryData);
                                        currentTrackingId = newSessionId;
                                        chatLogger.info("Updated query tracking", { from: queryTrackingId, to: newSessionId });
                                    }
                                }
                            } else if (msg.type === "assistant" && 'message' in msg) {
                                const content = (msg.message as { content: Array<{ type: string }> }).content;
                                console.log(`[API]   Content blocks: ${content.map((b) => b.type).join(", ")}`);
                            } else if (msg.type === "result") {
                                console.log(`[API]   Result received`);
                            }

                            pushToQueue({
                                type: "message",
                                data: msg,
                                sessionId: newSessionId,
                                queryTrackingId: currentTrackingId,
                                agentId: agentConfig.id,
                            });

                            if (msg.type === "result") {
                                console.log(`[API] Query complete in ${elapsed}s, ${messageCount} messages`);
                                break;
                            }

                            // Get next message
                            console.log("[API] Calling next()...");
                            iterResult = await iterator.next();
                            console.log("[API] next() returned, done:", iterResult.done);
                        }

                        console.log("[API] Iterator loop finished");
                    } catch (error) {
                        clearInterval(heartbeatInterval);
                        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

                        // Check if this is a user-initiated abort (not an error)
                        const isAbort = error instanceof Error &&
                            (error.message.includes("aborted by user") ||
                             error.name === "AbortError" ||
                             abortController.signal.aborted);

                        if (isAbort) {
                            console.log(`[API] Query cancelled by user after ${elapsed}s, ${messageCount} messages received`);
                            pushToQueue({
                                type: "cancelled",
                            });
                        } else {
                            console.error(`[API] Iterator error after ${elapsed}s, ${messageCount} messages received:`, error);
                            if (error instanceof Error) {
                                console.error("[API] Error name:", error.name);
                                console.error("[API] Error message:", error.message);
                                console.error("[API] Error stack:", error.stack);
                            }
                            pushToQueue({
                                type: "error",
                                error: error instanceof Error ? error.message : String(error),
                            });
                        }
                    } finally {
                        clearInterval(heartbeatInterval);
                        // Clean up active query tracking
                        activeQueries.delete(currentTrackingId);
                        console.log(`[API] Cleaned up query tracking: ${currentTrackingId}`);
                    }

                    pushToQueue({
                        type: "done",
                        sessionId: newSessionId,
                        agentId: agentConfig.id,
                    });
                    streamClosed = true;
                };

                consumeIterator();

                const stream = new ReadableStream({
                    async pull(controller) {
                        while (messageQueue.length === 0 && !streamClosed) {
                            await new Promise<void>((resolve) => {
                                resolveNext = resolve;
                            });
                        }

                        while (messageQueue.length > 0) {
                            const msg = messageQueue.shift()!;
                            controller.enqueue(encoder.encode(msg));
                        }

                        if (streamClosed && messageQueue.length === 0) {
                            controller.close();
                        }
                    },
                });

                return new Response(stream, {
                    headers: {
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive",
                    },
                });
            } catch (error) {
                console.error("[API] Chat error:", error);

                // Build detailed error response
                const errorResponse: {
                    error: string;
                    details: string;
                    name?: string;
                    stack?: string;
                    code?: string;
                    cause?: string;
                    env?: {
                        hasOAuthToken: boolean;
                        hasApiKey: boolean;
                    };
                } = {
                    error: "Failed to process chat message",
                    details: error instanceof Error ? error.message : String(error),
                    env: {
                        hasOAuthToken: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
                        hasApiKey: !!process.env.ANTHROPIC_API_KEY,
                    },
                };

                if (error instanceof Error) {
                    errorResponse.name = error.name;
                    errorResponse.stack = error.stack;
                    if ('code' in error) {
                        errorResponse.code = String(error.code);
                    }
                    if (error.cause) {
                        errorResponse.cause = error.cause instanceof Error
                            ? error.cause.message
                            : String(error.cause);
                    }
                }

                return Response.json(errorResponse, { status: 500 });
            }
        },
    },

    "/api/chat/permission-response": {
        async POST(req: Request) {
            try {
                const body = await req.json();
                const { permissionId, decision, alwaysAllow, toolName } = body;

                console.log(`[Permissions] Received response for ${permissionId}: ${decision}, alwaysAllow: ${alwaysAllow}`);

                if (!permissionId || !decision) {
                    return Response.json(
                        { error: "permissionId and decision are required" },
                        { status: 400 }
                    );
                }

                if (decision !== "allow" && decision !== "deny") {
                    return Response.json(
                        { error: "decision must be 'allow' or 'deny'" },
                        { status: 400 }
                    );
                }

                const pending = pendingPermissions.get(permissionId);
                if (!pending) {
                    console.log(`[Permissions] No pending permission found for ${permissionId}`);
                    return Response.json(
                        { error: "No pending permission request found" },
                        { status: 404 }
                    );
                }

                pending.resolve({ decision, alwaysAllow, toolName });
                console.log(`[Permissions] Resolved permission ${permissionId} with ${decision}, alwaysAllow: ${alwaysAllow}`);

                return Response.json({ success: true });
            } catch (error) {
                console.error("[Permissions] Error processing response:", error);
                return Response.json(
                    { error: "Failed to process permission response" },
                    { status: 500 }
                );
            }
        },
    },

    "/api/chat/cancel": {
        async POST(req: Request) {
            try {
                const body = await req.json();
                const { queryTrackingId } = body;

                if (!queryTrackingId) {
                    return Response.json(
                        { error: "queryTrackingId is required" },
                        { status: 400 }
                    );
                }

                console.log(`[API] Cancel requested for query: ${queryTrackingId}`);

                const activeQuery = activeQueries.get(queryTrackingId);
                if (!activeQuery) {
                    console.log(`[API] No active query found for: ${queryTrackingId}`);
                    return Response.json(
                        { error: "No active query found" },
                        { status: 404 }
                    );
                }

                // Abort the query
                activeQuery.abortController.abort();
                activeQueries.delete(queryTrackingId);

                console.log(`[API] Cancelled query: ${queryTrackingId}`);

                return Response.json({ success: true });
            } catch (error) {
                console.error("[API] Error cancelling query:", error);
                return Response.json(
                    { error: "Failed to cancel query" },
                    { status: 500 }
                );
            }
        },
    },

    "/api/chat/sessions/save": {
        async POST(req: Request) {
            try {
                const body = await req.json();
                const { id, title, createdAt, updatedAt, messageCount, agentId } = body;

                if (!id || !title) {
                    return Response.json(
                        { error: "Session ID and title are required" },
                        { status: 400 }
                    );
                }

                // Check if session already exists to prevent duplicates
                const existingSessions = await readJSONL<SessionMetadata>(getSessionsFile());
                if (existingSessions.some((s) => s.id === id)) {
                    console.log("[API] Session already exists, skipping save:", id);
                    return Response.json({ success: true, session: existingSessions.find((s) => s.id === id) });
                }

                const session: SessionMetadata = {
                    id,
                    title,
                    createdAt,
                    updatedAt,
                    messageCount,
                    agentId,
                };

                await appendJSONL(getSessionsFile(), session);
                console.log("[API] Saved session:", id);

                return Response.json({ success: true, session });
            } catch (error) {
                console.error("[API] Error saving session:", error);
                return Response.json(
                    { error: "Failed to save session" },
                    { status: 500 }
                );
            }
        },
    },

    "/api/chat/sessions/list": {
        async GET() {
            try {
                const allSessions = await readJSONL<SessionMetadata>(getSessionsFile());
                const claudeDir = getClaudeSessionsDir();

                // Deduplicate by ID, keeping the most recent entry
                const sessionsMap = new Map<string, SessionMetadata>();
                for (const session of allSessions) {
                    const existing = sessionsMap.get(session.id);
                    if (!existing || new Date(session.updatedAt) > new Date(existing.updatedAt)) {
                        sessionsMap.set(session.id, session);
                    }
                }

                // Filter to only sessions with existing history files in this workspace
                const validSessions: SessionMetadata[] = [];
                const staleSessions: string[] = [];

                for (const session of sessionsMap.values()) {
                    const historyFile = join(claudeDir, `${session.id}.jsonl`);
                    if (existsSync(historyFile)) {
                        validSessions.push(session);
                    } else {
                        staleSessions.push(session.id);
                        chatLogger.info("Session history not found, marking as stale", {
                            sessionId: session.id,
                            expectedPath: historyFile
                        });
                    }
                }

                // Clean up stale sessions from the metadata file (async, fire-and-forget)
                if (staleSessions.length > 0) {
                    chatLogger.info("Cleaning up stale sessions", { count: staleSessions.length });
                    const cleanedSessions = allSessions.filter(s => !staleSessions.includes(s.id));
                    const content = cleanedSessions.map(s => JSON.stringify(s)).join("\n") + (cleanedSessions.length > 0 ? "\n" : "");
                    Bun.write(getSessionsFile(), content).catch(err => {
                        chatLogger.error("Failed to clean up stale sessions", { error: err });
                    });
                }

                validSessions.sort(
                    (a, b) =>
                        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                );
                return Response.json({ sessions: validSessions });
            } catch (error) {
                console.error("[API] Error listing sessions:", error);
                return Response.json(
                    { error: "Failed to list sessions" },
                    { status: 500 }
                );
            }
        },
    },

    "/api/chat/sessions/update": {
        async PUT(req: Request) {
            try {
                const body = await req.json();
                const { id, title, messageCount } = body;

                if (!id) {
                    return Response.json(
                        { error: "Session ID is required" },
                        { status: 400 }
                    );
                }

                await updateJSONL<SessionMetadata>(getSessionsFile(), id, (session) => ({
                    ...session,
                    ...(title && { title }),
                    ...(messageCount !== undefined && { messageCount }),
                    updatedAt: new Date().toISOString(),
                }));

                console.log("[API] Updated session:", id);
                return Response.json({ success: true });
            } catch (error) {
                console.error("[API] Error updating session:", error);
                return Response.json(
                    { error: "Failed to update session" },
                    { status: 500 }
                );
            }
        },
    },

    "/api/chat/sessions/delete": {
        async POST(req: Request) {
            try {
                const body = await req.json();
                const { id } = body;

                if (!id) {
                    return Response.json(
                        { error: "Session ID is required" },
                        { status: 400 }
                    );
                }

                // Remove from metadata file (soft delete - keeps Claude history file)
                const allSessions = await readJSONL<SessionMetadata>(getSessionsFile());
                const remainingSessions = allSessions.filter(s => s.id !== id);
                const content = remainingSessions.map(s => JSON.stringify(s)).join("\n") + (remainingSessions.length > 0 ? "\n" : "");
                await Bun.write(getSessionsFile(), content);

                chatLogger.info("Removed session from metadata (soft delete)", { id });
                return Response.json({ success: true });
            } catch (error) {
                console.error("[API] Error deleting session:", error);
                return Response.json(
                    { error: "Failed to delete session" },
                    { status: 500 }
                );
            }
        },
    },

    "/api/chat/sessions/search": {
        async POST(req: Request) {
            try {
                const body = await req.json();
                const { query } = body;

                if (!query || typeof query !== "string") {
                    return Response.json(
                        { error: "Search query is required" },
                        { status: 400 }
                    );
                }

                const searchLower = query.toLowerCase();
                const sessions = await readJSONL<SessionMetadata>(getSessionsFile());
                const matchingSessions: Array<SessionMetadata & {
                    matchSnippet?: { before: string; match: string; after: string };
                    titleMatch?: boolean;
                }> = [];

                // Helper to create structured snippet
                const createSnippet = (text: string, matchIdx: number, matchLen: number) => {
                    const contextBefore = 30;
                    const contextAfter = 30;
                    const start = Math.max(0, matchIdx - contextBefore);
                    const end = Math.min(text.length, matchIdx + matchLen + contextAfter);

                    return {
                        before: (start > 0 ? "..." : "") + text.slice(start, matchIdx),
                        match: text.slice(matchIdx, matchIdx + matchLen),
                        after: text.slice(matchIdx + matchLen, end) + (end < text.length ? "..." : ""),
                    };
                };

                for (const session of sessions) {
                    // First check title match
                    const titleIdx = session.title.toLowerCase().indexOf(searchLower);
                    if (titleIdx !== -1) {
                        matchingSessions.push({
                            ...session,
                            titleMatch: true,
                        });
                        continue;
                    }

                    // Then search message content
                    const sessionFile = join(getClaudeSessionsDir(), `${session.id}.jsonl`);
                    if (!existsSync(sessionFile)) continue;

                    try {
                        const messages = await readJSONL<SDKMessage>(sessionFile);
                        let found = false;
                        let matchSnippet: { before: string; match: string; after: string } | undefined;

                        for (const msg of messages) {
                            if (msg.type === "user" && "content" in msg) {
                                const content = String(msg.content);
                                const idx = content.toLowerCase().indexOf(searchLower);
                                if (idx !== -1) {
                                    found = true;
                                    matchSnippet = createSnippet(content, idx, query.length);
                                    break;
                                }
                            } else if (msg.type === "assistant" && "message" in msg) {
                                const message = msg.message as { content?: Array<{ type: string; text?: string }> };
                                if (message.content) {
                                    for (const block of message.content) {
                                        if (block.type === "text" && block.text) {
                                            const idx = block.text.toLowerCase().indexOf(searchLower);
                                            if (idx !== -1) {
                                                found = true;
                                                matchSnippet = createSnippet(block.text, idx, query.length);
                                                break;
                                            }
                                        }
                                    }
                                }
                                if (found) break;
                            }
                        }

                        if (found) {
                            matchingSessions.push({ ...session, matchSnippet });
                        }
                    } catch (err) {
                        console.error(`[API] Error searching session ${session.id}:`, err);
                    }
                }

                // Sort by updatedAt
                matchingSessions.sort(
                    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                );

                return Response.json({ sessions: matchingSessions });
            } catch (error) {
                console.error("[API] Error searching sessions:", error);
                return Response.json(
                    { error: "Failed to search sessions" },
                    { status: 500 }
                );
            }
        },
    },

    // Wildcard route MUST be last to avoid matching specific routes like /delete, /update, /search
    "/api/chat/sessions/history/*": {
        async GET(req: Request) {
            try {
                const url = new URL(req.url);
                const pathParts = url.pathname.split("/");
                // Session ID is at the end: /api/chat/sessions/history/{sessionId}
                const sessionId = pathParts[pathParts.length - 1];
                const claudeDir = getClaudeSessionsDir();
                const sessionFile = join(claudeDir, `${sessionId}.jsonl`);

                chatLogger.info("Loading session history", {
                    sessionId,
                    claudeDir,
                    sessionFile,
                    dirExists: existsSync(claudeDir),
                    fileExists: existsSync(sessionFile)
                });

                if (!existsSync(sessionFile)) {
                    chatLogger.warn("Session file not found", { sessionFile });
                    return Response.json(
                        { error: "Session not found", sessionFile },
                        { status: 404 }
                    );
                }

                const messages = await readJSONL<SDKMessage>(sessionFile);
                console.log(`[API] Loaded ${messages.length} messages for session ${sessionId}`);

                return Response.json({ messages });
            } catch (error) {
                console.error("[API] Error loading session history:", error);
                return Response.json(
                    { error: "Failed to load session history" },
                    { status: 500 }
                );
            }
        },
    },
};
