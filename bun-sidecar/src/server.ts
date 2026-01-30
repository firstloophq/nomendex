import { serve, type ServerWebSocket, type Terminal, type Subprocess } from "bun";
import index from "./index.html";
import { createServiceLogger, getLogFile, startupLog, markStartupComplete, isInStartupMode } from "./lib/logger";
import { initializeWorkspaceServices } from "./services/workspace-init";
import { appendFile } from "node:fs/promises";
import { baseDirRoute } from "./server-routes/base-dir";
import { workspaceRoutes } from "./server-routes/workspace-routes";
import { gitInstalledRoute, gitInitRoute, gitStatusRoute, gitSetupRemoteRoute, gitPullRoute, gitPushRoute, gitCommitRoute, gitFetchStatusRoute, gitConflictsRoute, gitResolveConflictRoute, gitAbortMergeRoute, gitContinueMergeRoute, gitConflictContentRoute } from "./server-routes/git-sync";
// Feature-specific routes (replacing plugin registry)
import { todosRoutes } from "./server-routes/todos-routes";
import { notesRoutes } from "./server-routes/notes-routes";
import { chatRoutes } from "./server-routes/chat-routes";
import { agentsRoutes } from "./server-routes/agents-routes";
import { secretsRoutes } from "./server-routes/secrets-routes";
import { skillsRoutes } from "./server-routes/skills-routes";
import { workspacesRoutes } from "./server-routes/workspaces-routes";
import { mcpServersRoutes } from "./server-routes/mcp-servers-routes";
import { filesystemRoutes } from "./server-routes/filesystem-routes";
import { uploadsRoutes } from "./server-routes/uploads-routes";
import { versionRoutes } from "./server-routes/version-routes";
import { logsRoutes } from "./server-routes/logs-routes";
import { dictionariesRoutes } from "./server-routes/dictionaries-routes";
import { projectsRoutes } from "./server-routes/projects-routes";

// Terminal WebSocket data type
interface TerminalWSData {
    isTerminal: true;
    sessionId: string;
}

// Union type for all WebSocket data types
type WSData = TerminalWSData | Record<string, never>;

interface TerminalSession {
    proc: Subprocess;
    terminal: Terminal;
    clients: Set<ServerWebSocket<TerminalWSData>>;
    history: string;
}

const TERMINAL_CONTROL_PREFIX = "__MCP_CONTROL__";
const SESSION_STATUS_PREFIX = `${TERMINAL_CONTROL_PREFIX}:SESSION_STATUS:`;

// Create service-specific logger for the server
const serverLogger = createServiceLogger("SERVER");
const apiLogger = createServiceLogger("API");

// Map to track PTY sessions and clients by session ID
const terminalSessions = new Map<string, TerminalSession>();
// Map to track WebSocket to session ID
const wsToSessionMap = new Map<ServerWebSocket<TerminalWSData>, string>();

// Initialize workspace paths, secrets, and feature services
startupLog.info('Initializing workspace services...');
try {
    await initializeWorkspaceServices();
    startupLog.info('Workspace services initialized successfully');
} catch (error) {
    startupLog.error('Failed to initialize workspace services', {
        error: error instanceof Error ? error.message : String(error)
    });
    throw error;
}

const server = serve<WSData>({
    port: process.env.PORT ? parseInt(process.env.PORT) : 1234,
    idleTimeout: 255, // Maximum timeout in seconds (prevents "request timed out after 10 seconds" errors)

    routes: {
        // Health check endpoint - called by native app to confirm server is ready
        "/health": {
            GET() {
                startupLog.info('Health check passed - server ready');
                markStartupComplete();
                return new Response("OK", { status: 200 });
            },
        },
        ...workspaceRoutes,
        ...workspacesRoutes,
        ...filesystemRoutes,
        ...uploadsRoutes,
        // Feature-specific routes
        ...todosRoutes,
        ...notesRoutes,
        ...chatRoutes,
        ...agentsRoutes,
        ...secretsRoutes,
        ...skillsRoutes,
        ...mcpServersRoutes,
        ...versionRoutes,
        ...logsRoutes,
        ...dictionariesRoutes,
        ...projectsRoutes,
        // WebSocket route handler
        "/ws": {
            GET: (req, server) => {
                serverLogger.info("WebSocket upgrade request received at /ws", { url: req.url });

                // Upgrade the request to a WebSocket
                if (server.upgrade(req, { data: {} })) {
                    serverLogger.info("WebSocket upgrade successful");
                    return; // do not return a Response
                }

                serverLogger.error("WebSocket upgrade failed");
                return new Response("Upgrade failed", { status: 500 });
            },
        },

        // Terminal WebSocket route handler with session ID support
        "/ws/terminal/*": {
            GET: (req, server) => {
                const url = new URL(req.url);
                const pathParts = url.pathname.split("/");
                const sessionId = pathParts[pathParts.length - 1] || "default";

                serverLogger.info("Terminal WebSocket upgrade request received", {
                    url: req.url,
                    sessionId,
                });

                // Upgrade the request to a WebSocket with terminal flag and session ID
                if (server.upgrade(req, { data: { isTerminal: true, sessionId } })) {
                    serverLogger.info("Terminal WebSocket upgrade successful", { sessionId });
                    return; // do not return a Response
                }

                serverLogger.error("Terminal WebSocket upgrade failed");
                return new Response("Upgrade failed", { status: 500 });
            },
        },

        // Frontend logs -> server (persisted by winston)
        "/api/frontend-log": {
            async POST(req: Request) {
                try {
                    const { level = "info", message = "", meta = {} } = await req.json();
                    // Sanitize meta to avoid huge payloads
                    const safeMeta = typeof meta === "object" && meta !== null ? meta : {};
                    switch (level) {
                        case "error":
                            apiLogger.error(String(message), safeMeta);
                            break;
                        case "warn":
                            apiLogger.warn(String(message), safeMeta);
                            break;
                        case "debug":
                            apiLogger.debug(String(message), safeMeta);
                            break;
                        default:
                            apiLogger.info(String(message), safeMeta);
                    }
                    return new Response(null, { status: 204 });
                } catch {
                    return Response.json({ error: "Failed to record log" }, { status: 500 });
                }
            },
        },

        // Custom logs endpoint that writes to workspace logs.txt
        "/api/logs": {
            async POST(req: Request) {
                try {
                    const data = await req.json();
                    const timestamp = new Date().toISOString();
                    const logEntry = JSON.stringify({ timestamp, ...data }) + "\n";

                    // Write to workspace logs.txt
                    const logPath = getLogFile();
                    const file = Bun.file(logPath);
                    if (!file.exists()) {
                        await file.write(logEntry);
                    } else {
                        await appendFile(logPath, logEntry);
                    }

                    return new Response(null, { status: 204 });
                } catch {
                    return Response.json({ error: "Failed to write log" }, { status: 500 });
                }
            },
        },
        "/api/realtime/token": {
            async GET(req: Request) {
                try {
                    const url = new URL(req.url);
                    const provider = url.searchParams.get("provider") || "openai";

                    // For now, only support OpenAI
                    if (provider !== "openai") {
                        return Response.json({ error: "Only OpenAI provider is currently supported" }, { status: 400 });
                    }

                    const apiKey = process.env.OPENAI_API_KEY;
                    console.log("[Server] /api/realtime/token - OPENAI_API_KEY from env:", apiKey?.substring(0, 20) + "..." || "NOT SET");

                    if (!apiKey) {
                        console.error("[Server] OpenAI API key not configured!");
                        return Response.json({ error: "OpenAI API key not configured" }, { status: 500 });
                    }

                    // For OpenAI, we create an ephemeral token
                    // In production, you might want to use a more secure token generation
                    return Response.json({
                        provider: "openai",
                        client_secret: {
                            value: apiKey,
                        },
                    });
                } catch (error) {
                    console.error("Error generating realtime token:", error);
                    return Response.json(
                        {
                            error: "Failed to generate realtime token",
                            details: error instanceof Error ? error.message : "Unknown error",
                        },
                        { status: 500 }
                    );
                }
            },
        },

        // Base directory route
        "/api/base-dir": baseDirRoute,

        // Git sync routes
        "/api/git/installed": gitInstalledRoute,
        "/api/git/init": gitInitRoute,
        "/api/git/status": gitStatusRoute,
        "/api/git/setup-remote": gitSetupRemoteRoute,
        "/api/git/pull": gitPullRoute,
        "/api/git/push": gitPushRoute,
        "/api/git/commit": gitCommitRoute,
        "/api/git/fetch-status": gitFetchStatusRoute,
        "/api/git/conflicts": gitConflictsRoute,
        "/api/git/resolve-conflict": gitResolveConflictRoute,
        "/api/git/abort-merge": gitAbortMergeRoute,
        "/api/git/continue-merge": gitContinueMergeRoute,
        "/api/git/conflict-content": gitConflictContentRoute,

        // This add end to catch all routes and route to frontend
        "/*": index,
    },

    development: process.env.NODE_ENV !== "production" && {
        // Enable browser hot reloading in development
        // hmr: true,

        // Echo console logs from the browser to the server
        console: true,
    },

    websocket: {
        message(_ws: ServerWebSocket<WSData>, _message: string | Buffer | ArrayBuffer) {
            // Check if this is a terminal WebSocket
            if (_ws.data && "isTerminal" in _ws.data && _ws.data.isTerminal) {
                const sessionId = _ws.data.sessionId as string;
                const session = terminalSessions.get(sessionId);
                if (session && typeof _message === "string") {
                    // Check if this is a resize message
                    if (_message.startsWith("RESIZE:")) {
                        const [, cols, rows] = _message.split(":");
                        const colsNum = parseInt(cols || "0");
                        const rowsNum = parseInt(rows || "0");
                        if (!isNaN(colsNum) && !isNaN(rowsNum)) {
                            session.terminal.resize(colsNum, rowsNum);
                            serverLogger.info(`PTY ${sessionId} resized to ${colsNum}x${rowsNum}`);
                        }
                    } else {
                        // Write the message to the PTY
                        session.terminal.write(_message);
                    }
                }
            } else {
                const msgLen = typeof _message === "string" ? _message.length : (_message as ArrayBuffer).byteLength;
                serverLogger.info("WebSocket message received", { messageType: typeof _message, messageLength: msgLen });
                // Echo the message back to the client for non-terminal connections
                if (typeof _message === "string") {
                    _ws.send(_message);
                } else {
                    _ws.send(_message as ArrayBuffer);
                }
                serverLogger.info("WebSocket message echoed back to client");
            }
        },
        open(_ws: ServerWebSocket<WSData>) {
            // Check if this is a terminal WebSocket
            if (_ws.data && "isTerminal" in _ws.data && _ws.data.isTerminal) {
                const sessionId = _ws.data.sessionId as string;
                serverLogger.info("Terminal WebSocket client connected", { sessionId });

                let session = terminalSessions.get(sessionId);
                let isNewSession = false;

                if (session) {
                    serverLogger.info(`Reconnecting to existing PTY session: ${sessionId}`);
                } else {
                    // Get user's shell and inherit environment properly
                    const userShell = process.env.SHELL || "/bin/bash";
                    const shellName = userShell.split("/").pop() || "bash";

                    // Log environment diagnostics
                    serverLogger.info("PTY Environment Diagnostics", {
                        userShell,
                        shellName,
                        PATH: process.env.PATH,
                        TERM: process.env.TERM,
                        cwd: process.cwd(),
                        platform: process.platform,
                        bunVersion: Bun.version,
                    });

                    // Make sure we have a minimal PATH if none exists
                    const minimalPath = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

                    const ptyEnv = {
                        ...process.env,
                        PATH: process.env.PATH || minimalPath,
                        TERM: "xterm-256color",
                        COLORTERM: "truecolor",
                        FORCE_COLOR: "1",
                        CLICOLOR: "1",
                        CLICOLOR_FORCE: "1",
                        LANG: process.env.LANG || "en_US.UTF-8",
                        LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
                    };

                    const clients = new Set<ServerWebSocket<TerminalWSData>>();
                    let sessionHistory = "";

                    try {
                        // Spawn shell with Bun's native PTY support
                        const proc = Bun.spawn([shellName], {
                            cwd: process.cwd(),
                            env: ptyEnv,
                            terminal: {
                                cols: 120,
                                rows: 40,
                                data(_terminal, data) {
                                    const chunk = new TextDecoder().decode(data);
                                    sessionHistory += chunk;
                                    for (const client of clients) {
                                        try {
                                            client.send(chunk);
                                        } catch (error) {
                                            serverLogger.error("Failed to send PTY chunk to client", {
                                                sessionId,
                                                error: error instanceof Error ? error.message : String(error),
                                            });
                                        }
                                    }
                                },
                                exit(_terminal, exitCode, signal) {
                                    serverLogger.info(`PTY process exited for session ${sessionId}`, { exitCode, signal });
                                    terminalSessions.delete(sessionId);
                                    for (const client of clients) {
                                        try {
                                            client.close(1000, "Terminal session ended");
                                        } catch (error) {
                                            serverLogger.error("Failed to close terminal client on PTY exit", {
                                                sessionId,
                                                error: error instanceof Error ? error.message : String(error),
                                            });
                                        }
                                    }
                                },
                            },
                        });

                        if (!proc.terminal) {
                            throw new Error("Terminal not available - PTY support may not be enabled");
                        }

                        const sessionData: TerminalSession = {
                            proc,
                            terminal: proc.terminal,
                            clients,
                            get history() {
                                return sessionHistory;
                            },
                            set history(val: string) {
                                sessionHistory = val;
                            },
                        };

                        session = sessionData;
                        terminalSessions.set(sessionId, sessionData);
                        isNewSession = true;

                        serverLogger.info(`New PTY spawned for session ${sessionId} with PID: ${proc.pid}`);

                        // Send color setup commands immediately
                        const colorSetupCommands = [
                            "export TERM=xterm-256color",
                            "export COLORTERM=truecolor",
                            "export CLICOLOR=1",
                            "export CLICOLOR_FORCE=1",
                            "export FORCE_COLOR=1",
                            "clear",
                        ];

                        for (const cmd of colorSetupCommands) {
                            proc.terminal.write(cmd + "\n");
                        }

                        serverLogger.info("Sent color environment setup commands and cleared terminal");

                        // Handle process exit
                        proc.exited.then((exitCode) => {
                            serverLogger.info(`Shell process exited for session ${sessionId}`, { exitCode });
                        });

                    } catch (error) {
                        const errorMsg = error instanceof Error ? error.message : String(error);
                        serverLogger.error("Failed to spawn PTY:", { error: errorMsg });
                        _ws.close(1011, `PTY spawn failed: ${errorMsg}`.slice(0, 120));
                        return;
                    }
                }

                if (!session) {
                    serverLogger.error("Terminal session missing after initialization", { sessionId });
                    _ws.close(1011, "Terminal session unavailable");
                    return;
                }

                // Store WebSocket to session mapping
                wsToSessionMap.set(_ws as unknown as ServerWebSocket<TerminalWSData>, sessionId);
                session.clients.add(_ws as unknown as ServerWebSocket<TerminalWSData>);

                // Send session status to client before replaying history
                _ws.send(`${SESSION_STATUS_PREFIX}${isNewSession ? "new" : "existing"}`);

                if (!isNewSession && session.history) {
                    _ws.send(session.history);
                }
            } else {
                serverLogger.info("WebSocket client connected");
            }
        },
        close(_ws: ServerWebSocket<WSData>, _code: number, _message: string) {
            // Check if this is a terminal WebSocket
            if (_ws.data && "isTerminal" in _ws.data && _ws.data.isTerminal) {
                const sessionId = wsToSessionMap.get(_ws as unknown as ServerWebSocket<TerminalWSData>);

                // Remove WebSocket to session mapping
                wsToSessionMap.delete(_ws as unknown as ServerWebSocket<TerminalWSData>);

                serverLogger.info("Terminal WebSocket client disconnected", {
                    sessionId,
                    code: _code,
                    message: _message,
                });

                if (sessionId) {
                    const session = terminalSessions.get(sessionId);
                    session?.clients.delete(_ws as unknown as ServerWebSocket<TerminalWSData>);
                }

                // Note: We don't kill the PTY here to allow reconnection
                // PTY will only be killed when it exits naturally or on server shutdown
            } else {
                serverLogger.info("WebSocket client disconnected", { code: _code, message: _message });
            }
        },
        drain(_ws) {
            serverLogger.debug("WebSocket ready to receive more data");
        },
    },
});

// Log server startup (to file during startup)
startupLog.info(`Server listening on port ${server.port}`, { port: server.port });
startupLog.info('Waiting for health check from native app...');

// Write server port to discoverable location for external tools (e.g., Claude skills)
const serverPortPath = `${process.env.HOME}/Library/Application Support/com.firstloop.nomendex/serverport.json`;
await Bun.write(serverPortPath, JSON.stringify({ port: server.port, startedAt: new Date().toISOString() }));
startupLog.info(`Server port written to ${serverPortPath}`);

// Warn if health check not received within 10 seconds (helps diagnose connectivity issues)
setTimeout(() => {
    if (isInStartupMode()) {
        startupLog.warn('Health check not received after 10 seconds - native app may not be connecting');
        startupLog.info('Server is running but native app health check has not been called');
    }
}, 10000);
