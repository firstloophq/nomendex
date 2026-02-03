import {
    listProjects,
    getProject,
    getProjectByName,
    createProject,
    updateProject,
    deleteProject,
    getProjectStats,
    renameProject,
} from "@/features/projects/fx";

export const projectsRoutes = {
    "/api/projects/list": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await listProjects(args);
            return Response.json(result);
        },
    },
    "/api/projects/get": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await getProject(args);
            return Response.json(result);
        },
    },
    "/api/projects/get-by-name": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await getProjectByName(args);
            return Response.json(result);
        },
    },
    "/api/projects/create": {
        async POST(req: Request) {
            // Only allow project creation from UI (has X-Nomendex-UI header)
            const isFromUI = req.headers.get("X-Nomendex-UI") === "true";
            if (!isFromUI) {
                return Response.json(
                    { error: "Project creation via API is disabled. To create a project, open the 'Projects' view from the sidebar and click 'New Project'." },
                    { status: 403 }
                );
            }

            const args = await req.json();
            const result = await createProject(args);
            return Response.json(result);
        },
    },
    "/api/projects/update": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await updateProject(args);
            return Response.json(result);
        },
    },
    "/api/projects/delete": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await deleteProject(args);
            return Response.json(result);
        },
    },
    "/api/projects/ensure": {
        async POST(_req: Request) {
            return Response.json(
                { error: "Implicit project creation is disabled. To create a project, open the 'Projects' view from the sidebar and click 'New Project'." },
                { status: 403 }
            );
        },
    },
    "/api/projects/stats": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await getProjectStats(args);
            return Response.json(result);
        },
    },
    "/api/projects/rename": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await renameProject(args);
            return Response.json(result);
        },
    },
};
