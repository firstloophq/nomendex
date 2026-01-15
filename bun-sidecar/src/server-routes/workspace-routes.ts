import { z } from "zod";
import { Result, ErrorCodes } from "../types/Result";
import { WorkspaceState, WorkspaceStateSchema } from "../types/Workspace";
import { getNomendexPath } from "../storage/root-path";

const ThemeRequestSchema = z.object({
    themeName: z.string(),
});

export const workspaceRoutes = {
    "/api/workspace": {
        async GET() {
            try {
                const file = Bun.file(`${getNomendexPath()}/workspace.json`);
                const exists = await file.exists();

                if (!exists) {
                    const defaultWorkspace: WorkspaceState = {
                        tabs: [],
                        activeTabId: null,
                        sidebarTabId: null,
                        sidebarOpen: false,
                        mcpServerConfigs: [],
                        themeName: "Light",
                        projectPreferences: {},
                        gitAuthMode: "local",
                    };
                    await Bun.write(`${getNomendexPath()}/workspace.json`, JSON.stringify(defaultWorkspace, null, 2));

                    const response: Result<WorkspaceState> = {
                        success: true,
                        data: defaultWorkspace,
                    };
                    return Response.json(response);
                }

                const workspaceRaw = await file.json();
                const workspaceValidated = WorkspaceStateSchema.parse(workspaceRaw);

                const response: Result<WorkspaceState> = {
                    success: true,
                    data: workspaceValidated,
                };

                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to read workspace: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },

        async POST(req: Request) {
            try {
                const workspace = await req.json();
                const workspaceValidated = WorkspaceStateSchema.parse(workspace);
                await Bun.write(`${getNomendexPath()}/workspace.json`, JSON.stringify(workspaceValidated, null, 2));

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
                    message: `Failed to save workspace: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },
    },

    "/api/theme": {
        async GET() {
            try {
                const file = Bun.file(`${getNomendexPath()}/workspace.json`);
                const exists = await file.exists();

                if (!exists) {
                    const response: Result<{ themeName: string }> = {
                        success: true,
                        data: { themeName: "Light" },
                    };
                    return Response.json(response);
                }

                const workspaceRaw = await file.json();
                const workspaceValidated = WorkspaceStateSchema.parse(workspaceRaw);

                const response: Result<{ themeName: string }> = {
                    success: true,
                    data: { themeName: workspaceValidated.themeName },
                };
                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to read theme: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },

        async POST(req: Request) {
            try {
                const body = await req.json();
                const { themeName } = ThemeRequestSchema.parse(body);

                const file = Bun.file(`${getNomendexPath()}/workspace.json`);
                const exists = await file.exists();

                let workspace: WorkspaceState;
                if (exists) {
                    const workspaceRaw = await file.json();
                    workspace = WorkspaceStateSchema.parse(workspaceRaw);
                } else {
                    workspace = {
                        tabs: [],
                        activeTabId: null,
                        sidebarTabId: null,
                        sidebarOpen: false,
                        mcpServerConfigs: [],
                        themeName: "Light",
                        projectPreferences: {},
                        gitAuthMode: "local",
                    };
                }

                workspace.themeName = themeName;
                await Bun.write(`${getNomendexPath()}/workspace.json`, JSON.stringify(workspace, null, 2));

                const response: Result<{ themeName: string }> = {
                    success: true,
                    data: { themeName },
                };
                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to save theme: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },
    },
};