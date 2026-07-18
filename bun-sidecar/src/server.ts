import { serve, type ServerWebSocket } from "bun";
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
import { secretsRoutes } from "./server-routes/secrets-routes";
import { workspacesRoutes } from "./server-routes/workspaces-routes";
import { filesystemRoutes } from "./server-routes/filesystem-routes";
import { uploadsRoutes } from "./server-routes/uploads-routes";
import { versionRoutes } from "./server-routes/version-routes";
import { logsRoutes } from "./server-routes/logs-routes";
import { dictionariesRoutes } from "./server-routes/dictionaries-routes";

type WSData = Record<string, never>;

// Create service-specific logger for the server
const serverLogger = createServiceLogger("SERVER");
const apiLogger = createServiceLogger("API");

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
        ...secretsRoutes,
        ...versionRoutes,
        ...logsRoutes,
        ...dictionariesRoutes,
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
            const msgLen = typeof _message === "string" ? _message.length : (_message as ArrayBuffer).byteLength;
            serverLogger.info("WebSocket message received", { messageType: typeof _message, messageLength: msgLen });
            // Echo the message back to the client
            if (typeof _message === "string") {
                _ws.send(_message);
            } else {
                _ws.send(_message as ArrayBuffer);
            }
            serverLogger.info("WebSocket message echoed back to client");
        },
        open(_ws: ServerWebSocket<WSData>) {
            serverLogger.info("WebSocket client connected");
        },
        close(_ws: ServerWebSocket<WSData>, _code: number, _message: string) {
            serverLogger.info("WebSocket client disconnected", { code: _code, message: _message });
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
