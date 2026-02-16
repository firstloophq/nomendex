import { query, type SDKMessage, type McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { getRootPath } from "@/storage/root-path";
import { addAllowedTool, getAgentAllowedTools } from "@/features/agents/fx";
import type { AgentConfig } from "@/features/agents/index";
import { createServiceLogger } from "@/lib/logger";
import { requestPermission } from "@/services/claude-sdk/permission-manager";
import { buildMcpServersForQuery } from "@/services/claude-sdk/mcp-server-builder";
import { buildSystemPrompt, buildPromptInput } from "@/services/claude-sdk/prompt-builder";
import { createLockHook, createUnlockHook } from "@/services/claude-sdk/hooks";

const queryLogger = createServiceLogger("QUERY_EXECUTOR");

// Track active queries for cancellation (only while running)
type ActiveQuery = {
    abortController: AbortController;
    startedAt: number;
};
const activeQueries = new Map<string, ActiveQuery>();

export type ExecuteQueryParams = {
    message: string;
    images?: string[];
    sessionId?: string;
    agentConfig: AgentConfig;
};

export async function executeQuery(params: ExecuteQueryParams): Promise<Response> {
    const { message, images, sessionId, agentConfig } = params;

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
            agentId: agentConfig.id,
        });

        const response = await requestPermission(permissionId, toolName, input);
        console.log(`[Permissions] Decision for ${permissionId}: ${response.decision}, alwaysAllow: ${response.alwaysAllow}`);

        if (response.decision === "allow") {
            if (response.alwaysAllow) {
                console.log(`[Permissions] Persisting always-allow for tool: ${toolName} on agent: ${agentConfig.id}`);
                await addAllowedTool({ agentId: agentConfig.id, toolName });
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

    const lockOpenNoteFile = createLockHook(agentConfig, pushToQueue);
    const unlockNoteFile = createUnlockHook(pushToQueue);

    console.log("[API] Starting SDK query iterator...");

    // Create AbortController for this query
    const abortController = new AbortController();

    // Build MCP servers from agent config (includes UI renderer)
    const mcpServers = await buildMcpServersForQuery(agentConfig.mcpServers);

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
        settingSources: ["project"],
    };

    // Build context-aware system prompt
    sdkOptions.systemPrompt = buildSystemPrompt(agentConfig, targetDir);

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

        const promptInput = await buildPromptInput({ message, images, sessionId });

        queryIterator = query({
            prompt: promptInput,
            options: {
                ...sdkOptions,
                abortController,
                canUseTool,
                hooks: {
                    PreToolUse: [{ matcher: "Write|Edit|ApplyPatch", hooks: [lockOpenNoteFile] }],
                    PostToolUse: [{ matcher: "Write|Edit|ApplyPatch", hooks: [unlockNoteFile] }],
                    PostToolUseFailure: [{ matcher: "Write|Edit|ApplyPatch", hooks: [unlockNoteFile] }],
                },
                stderr: (data: string) => {
                    queryLogger.error("SDK STDERR", { data });
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
                    queryLogger.info("SDK init message received", { sessionId: newSessionId });

                    // Log MCP server connection status
                    if ("mcp_servers" in msg && Array.isArray(msg.mcp_servers)) {
                        queryLogger.info("MCP servers status", { servers: msg.mcp_servers });
                        const failedServers = msg.mcp_servers.filter(
                            (s: { status: string }) => s.status !== "connected"
                        );
                        if (failedServers.length > 0) {
                            queryLogger.error("MCP servers failed to connect", { failedServers });
                        }
                    } else {
                        queryLogger.warn("No MCP servers in init message", { msg: JSON.stringify(msg) });
                    }

                    // Update tracking to use real session ID
                    if (newSessionId && currentTrackingId !== newSessionId) {
                        const queryData = activeQueries.get(currentTrackingId);
                        if (queryData) {
                            activeQueries.delete(currentTrackingId);
                            activeQueries.set(newSessionId, queryData);
                            currentTrackingId = newSessionId;
                            queryLogger.info("Updated query tracking", { from: queryTrackingId, to: newSessionId });
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
}

export function cancelQuery(queryTrackingId: string): { success: boolean; error?: string } {
    console.log(`[API] Cancel requested for query: ${queryTrackingId}`);

    const activeQuery = activeQueries.get(queryTrackingId);
    if (!activeQuery) {
        console.log(`[API] No active query found for: ${queryTrackingId}`);
        return { success: false, error: "No active query found" };
    }

    activeQuery.abortController.abort();
    activeQueries.delete(queryTrackingId);

    console.log(`[API] Cancelled query: ${queryTrackingId}`);
    return { success: true };
}
