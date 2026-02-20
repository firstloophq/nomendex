import { globalConfig, type GlobalConfig, type WorkspaceInfo } from "@/storage/global-config";
import { Result, ErrorCodes } from "../types/Result";
import { initializeWorkspaceServices } from "@/services/workspace-init";
import { createGitClient, type AuthConfig } from "@/lib/git";
import { mkdir, rm } from "node:fs/promises";
import path from "path";

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

    // Set global app mode (solo or team)
    "/api/workspaces/set-app-mode": {
        async POST(req: Request) {
            try {
                const { mode } = (await req.json()) as { mode: "solo" | "team" };

                if (mode !== "solo" && mode !== "team") {
                    const response: Result = {
                        success: false,
                        code: ErrorCodes.BAD_REQUEST,
                        message: "mode must be 'solo' or 'team'",
                    };
                    return Response.json(response, { status: 400 });
                }

                await globalConfig.setAppMode({ mode });

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
                    message: `Failed to set app mode: ${message}`,
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

    // Clone a GitHub repo as a new team workspace
    "/api/workspaces/create-from-github": {
        async POST(req: Request) {
            try {
                const body = (await req.json()) as {
                    repoFullName: string;
                    displayName: string;
                    orgId: string;
                    orgWorkspaceId: string;
                    installationId: string;
                    githubInstallationId: number;
                    defaultBranch: string;
                    authToken: string;
                };

                const {
                    repoFullName,
                    displayName,
                    orgId,
                    orgWorkspaceId,
                    installationId,
                    githubInstallationId,
                    defaultBranch,
                    authToken,
                } = body;

                if (!repoFullName || !authToken || !orgWorkspaceId) {
                    const response: Result = {
                        success: false,
                        code: ErrorCodes.BAD_REQUEST,
                        message: "repoFullName, authToken, and orgWorkspaceId are required",
                    };
                    return Response.json(response, { status: 400 });
                }

                console.log("[create-from-github] Starting:", { repoFullName, orgWorkspaceId, defaultBranch, authTokenLength: authToken.length });

                // Create workspace directory (clean up any partial clone from a previous attempt)
                const home = process.env.HOME || "";
                const teamWsDir = path.join(
                    home,
                    "Library/Application Support/com.firstloop.nomendex/team-workspaces",
                    orgWorkspaceId,
                );
                console.log("[create-from-github] Cleaning up directory:", teamWsDir);
                await rm(teamWsDir, { recursive: true, force: true });
                await mkdir(teamWsDir, { recursive: true });

                const repoUrl = `https://github.com/${repoFullName}.git`;
                const branch = defaultBranch || "main";
                const auth: AuthConfig = { mode: "token", token: authToken };

                // Clone the repo (handles init, fetch, checkout, and upstream in one step)
                console.log("[create-from-github] Cloning repo:", repoUrl, "branch:", branch);
                const gitClient = createGitClient({ dir: teamWsDir });
                await gitClient.clone({ url: repoUrl, auth, ref: branch, singleBranch: true });
                console.log("[create-from-github] Clone complete");

                // Register in global config
                console.log("[create-from-github] Registering workspace in global config");
                const workspace: WorkspaceInfo = {
                    id: crypto.randomUUID(),
                    path: teamWsDir,
                    name: displayName || repoFullName,
                    createdAt: new Date().toISOString(),
                    lastAccessedAt: new Date().toISOString(),
                    orgId,
                    orgWorkspaceId,
                    repoFullName,
                    installationId,
                    githubInstallationId,
                    defaultBranch: branch,
                };

                const config = await globalConfig.load();
                config.workspaces.push(workspace);
                config.activeWorkspaceId = workspace.id;
                await globalConfig.save(config);

                // Reinitialize workspace services for the new workspace
                console.log("[create-from-github] Reinitializing workspace services...");
                await initializeWorkspaceServices();
                console.log("[create-from-github] Done!");

                const response: Result<WorkspaceInfo> = {
                    success: true,
                    data: workspace,
                };
                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error("[create-from-github] Error:", message, error instanceof Error ? error.stack : "");
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to create workspace from GitHub: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },
    },
};
