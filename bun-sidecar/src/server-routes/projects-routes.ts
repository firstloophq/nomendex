import {
    listProjects,
    getProject,
    getProjectByName,
    createProject,
    updateProject,
    deleteProject,
    ensureProject,
    getProjectStats,
    renameProject,
    getBoardConfig,
    saveBoardConfig,
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
        async POST(req: Request) {
            const args = await req.json();
            const result = await ensureProject(args);
            return Response.json(result);
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
    "/api/projects/board/get": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await getBoardConfig(args);
            return Response.json(result);
        },
    },
    "/api/projects/board/save": {
        async POST(req: Request) {
            const args = await req.json();
            const result = await saveBoardConfig(args);
            return Response.json(result);
        },
    },
};
