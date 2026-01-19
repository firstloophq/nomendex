import { z } from "zod";
import { Result, ErrorCodes } from "../types/Result";
import { WorkspaceState, WorkspaceStateSchema } from "../types/Workspace";
import { getNomendexPath, getRootPath, getNotesPath, getTodosPath, getUploadsPath, getSkillsPath, hasActiveWorkspace, initializePaths } from "../storage/root-path";

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
                        projectPreferences: {},
                        gitAuthMode: "local",
                        notesLocation: "root",
                        autoSync: { enabled: true, syncOnChanges: true, intervalSeconds: 60 },
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
                const file = Bun.file(`${getNomendexPath()}/theme.json`);
                const exists = await file.exists();

                if (!exists) {
                    const response: Result<{ themeName: string }> = {
                        success: true,
                        data: { themeName: "Light" },
                    };
                    return Response.json(response);
                }

                const themeData = await file.json();
                const themeName = ThemeRequestSchema.parse(themeData).themeName;

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

                await Bun.write(`${getNomendexPath()}/theme.json`, JSON.stringify({ themeName }, null, 2));

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

    "/api/workspace/paths": {
        async GET() {
            try {
                if (!hasActiveWorkspace()) {
                    const response: Result = {
                        success: false,
                        code: ErrorCodes.NOT_FOUND,
                        message: "No active workspace configured",
                    };
                    return Response.json(response, { status: 404 });
                }

                const paths = {
                    root: getRootPath(),
                    notes: getNotesPath(),
                    todos: getTodosPath(),
                    uploads: getUploadsPath(),
                    skills: getSkillsPath(),
                };

                const response: Result<typeof paths> = {
                    success: true,
                    data: paths,
                };
                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to get workspace paths: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },
    },

    "/api/workspace/reinitialize": {
        async POST() {
            try {
                await initializePaths();
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
                    message: `Failed to reinitialize paths: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },
    },
};