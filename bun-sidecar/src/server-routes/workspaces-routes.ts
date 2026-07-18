import { globalConfig, type GlobalConfig, type WorkspaceInfo } from "@/storage/global-config";
import { Result, ErrorCodes } from "../types/Result";
import { initializeWorkspaceServices } from "@/services/workspace-init";

export const workspacesRoutes = {
    // List all registered workspaces
    "/api/workspaces": {
        async GET() {
            try {
                const config = await globalConfig.load();
                const response: Result<GlobalConfig> = {
                    success: true,
                    data: config,
                };
                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to load workspaces: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },
    },

    // Get active workspace info
    "/api/workspaces/active": {
        async GET() {
            try {
                const workspace = await globalConfig.getActiveWorkspace();
                const response: Result<WorkspaceInfo | null> = {
                    success: true,
                    data: workspace,
                };
                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to get active workspace: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },
    },

    // Switch to different workspace (triggers client-side reload)
    "/api/workspaces/switch": {
        async POST(req: Request) {
            try {
                const { workspaceId } = (await req.json()) as { workspaceId: string };

                if (!workspaceId) {
                    const response: Result = {
                        success: false,
                        code: ErrorCodes.BAD_REQUEST,
                        message: "workspaceId is required",
                    };
                    return Response.json(response, { status: 400 });
                }

                await globalConfig.setActiveWorkspace(workspaceId);

                // Reinitialize all workspace-dependent services
                await initializeWorkspaceServices();

                const response: Result<{ requiresReload: boolean }> = {
                    success: true,
                    data: { requiresReload: true },
                };
                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to switch workspace: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },
    },

    // Add new workspace (called after native folder picker)
    "/api/workspaces/add": {
        async POST(req: Request) {
            try {
                const { path } = (await req.json()) as { path: string };

                if (!path) {
                    const response: Result = {
                        success: false,
                        code: ErrorCodes.BAD_REQUEST,
                        message: "path is required",
                    };
                    return Response.json(response, { status: 400 });
                }

                const workspace = await globalConfig.addWorkspace(path);

                // Reinitialize all workspace-dependent services for the new workspace
                await initializeWorkspaceServices();

                const response: Result<WorkspaceInfo> = {
                    success: true,
                    data: workspace,
                };
                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to add workspace: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },
    },

    // Remove workspace from list (doesn't delete files)
    "/api/workspaces/remove": {
        async POST(req: Request) {
            try {
                const { workspaceId } = (await req.json()) as { workspaceId: string };

                if (!workspaceId) {
                    const response: Result = {
                        success: false,
                        code: ErrorCodes.BAD_REQUEST,
                        message: "workspaceId is required",
                    };
                    return Response.json(response, { status: 400 });
                }

                await globalConfig.removeWorkspace(workspaceId);

                const response: Result<{ success: boolean }> = {
                    success: true,
                    data: { success: true },
                };
                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to remove workspace: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },
    },

    // Update workspace name
    "/api/workspaces/rename": {
        async POST(req: Request) {
            try {
                const { workspaceId, name } = (await req.json()) as { workspaceId: string; name: string };

                if (!workspaceId || !name) {
                    const response: Result = {
                        success: false,
                        code: ErrorCodes.BAD_REQUEST,
                        message: "workspaceId and name are required",
                    };
                    return Response.json(response, { status: 400 });
                }

                await globalConfig.updateWorkspaceName(workspaceId, name);

                const response: Result<{ success: boolean }> = {
                    success: true,
                    data: { success: true },
                };
                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to rename workspace: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },
    },

};
