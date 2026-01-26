import { getAllProjects, getProject, saveProject, deleteProject } from "@/features/projects/projects-service";

export const projectsRoutes = {
    "/api/projects/list": {
        async POST() {
            const projects = await getAllProjects();
            return Response.json(projects);
        },
    },
    "/api/projects/get": {
        async POST(req: Request) {
            const { name, id } = await req.json();
            const project = await getProject(name || id);
            return Response.json(project);
        },
    },
    "/api/projects/save": {
        async POST(req: Request) {
            const { project } = await req.json();
            const saved = await saveProject(project);
            return Response.json(saved);
        },
    },
    "/api/projects/delete": {
        async POST(req: Request) {
            const { id } = await req.json();
            const success = await deleteProject(id);
            return Response.json({ success });
        },
    },
};
