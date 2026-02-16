import { resolveAgent, saveSession, listSessions, updateSession, deleteSession, searchSessions, loadSessionHistory } from "@/features/chat/sessions";
import { resolvePermission, hasPending } from "@/services/claude-sdk/permission-manager";
import { executeQuery, cancelQuery } from "@/services/claude-sdk/query-executor";

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

                if (images && images.length > 0) {
                    console.log("[API] Images attached:", images.length);
                }

                const agentConfig = await resolveAgent({ requestAgentId, sessionId });
                console.log("[API] Using agent:", agentConfig.name, "(", agentConfig.id, ")");
                console.log("[API] Agent mcpServers:", agentConfig.mcpServers);

                return await executeQuery({ message, images, sessionId, agentConfig });
            } catch (error) {
                console.error("[API] Chat error:", error);

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

                if (!hasPending(permissionId)) {
                    console.log(`[Permissions] No pending permission found for ${permissionId}`);
                    return Response.json(
                        { error: "No pending permission request found" },
                        { status: 404 }
                    );
                }

                resolvePermission(permissionId, { decision, alwaysAllow, toolName });
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

                const result = cancelQuery(queryTrackingId);
                if (!result.success) {
                    return Response.json(
                        { error: result.error },
                        { status: 404 }
                    );
                }

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

                const result = await saveSession({ id, title, createdAt, updatedAt, messageCount, agentId });
                return Response.json(result);
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
                const sessions = await listSessions();
                return Response.json({ sessions });
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

                await updateSession({ id, title, messageCount });
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

                await deleteSession(id);
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
                const { query: searchQuery } = body;

                if (!searchQuery || typeof searchQuery !== "string") {
                    return Response.json(
                        { error: "Search query is required" },
                        { status: 400 }
                    );
                }

                const sessions = await searchSessions(searchQuery);
                return Response.json({ sessions });
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
                const sessionId = pathParts[pathParts.length - 1];

                const result = await loadSessionHistory(sessionId);
                if ("error" in result) {
                    return Response.json(result, { status: 404 });
                }
                return Response.json(result);
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
