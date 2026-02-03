import type { ProjectConfig } from "@/features/projects/project-types";

interface CreateProjectInput {
    name: string;
    description?: string;
    color?: string;
}

interface UpdateProjectInput {
    projectId: string;
    updates: {
        name?: string;
        description?: string;
        color?: string;
        archived?: boolean;
    };
}

async function fetchAPI<T>(endpoint: string, body: object = {}): Promise<T> {
    const response = await fetch(`/api/projects/${endpoint}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Nomendex-UI": "true"
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    return response.json();
}

interface DeleteProjectResult {
    success: boolean;
    deletedTodos: number;
    deletedNotes: number;
}

interface RenameProjectResult {
    project: ProjectConfig;
    updatedTodos: number;
    updatedNotes: number;
}

interface ProjectStats {
    todoCount: number;
    noteCount: number;
}

// Standalone API object for use outside React components
export const projectsAPI = {
    listProjects: (args: { includeArchived?: boolean } = {}) =>
        fetchAPI<ProjectConfig[]>("list", args),
    getProject: (args: { projectId: string }) =>
        fetchAPI<ProjectConfig | null>("get", args),
    getProjectByName: (args: { name: string }) =>
        fetchAPI<ProjectConfig | null>("get-by-name", args),
    createProject: (args: CreateProjectInput) =>
        fetchAPI<ProjectConfig>("create", args),
    updateProject: (args: UpdateProjectInput) =>
        fetchAPI<ProjectConfig>("update", args),
    deleteProject: (args: { projectId: string; cascade?: boolean }) =>
        fetchAPI<DeleteProjectResult>("delete", args),
    ensureProject: (args: { name: string }) =>
        fetchAPI<ProjectConfig>("ensure", args),
    getProjectStats: (args: { projectName: string }) =>
        fetchAPI<ProjectStats>("stats", args),
    renameProject: (args: { projectId: string; newName: string }) =>
        fetchAPI<RenameProjectResult>("rename", args),
};

// Hook wrapper for use in React components
export function useProjectsAPI() {
    return projectsAPI;
}
