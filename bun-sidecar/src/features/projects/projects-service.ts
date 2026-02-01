import { getNomendexPath, hasActiveWorkspace } from "@/storage/root-path";
import path from "path";
import { ProjectsFile, ProjectsFileSchema, ProjectConfig } from "./projects-types";
import { createServiceLogger } from "@/lib/logger";

const logger = createServiceLogger("PROJECTS");

export function getProjectsFilePath(): string {
    return path.join(getNomendexPath(), "projects.json");
}

// Loads all projects
export async function getAllProjects(): Promise<ProjectConfig[]> {
    if (!hasActiveWorkspace()) return [];

    const file = Bun.file(getProjectsFilePath());
    if (!(await file.exists())) {
        return [];
    }

    const data = await file.json();
    const parsed = ProjectsFileSchema.safeParse(data);
    if (!parsed.success) {
        logger.error("Failed to parse projects.json", { error: parsed.error });
        return [];
    }
    return parsed.data.projects;
}

// Loads a single project by name or ID
export async function getProject(identifier: string): Promise<ProjectConfig | null> {
    const projects = await getAllProjects();
    const normalized = identifier.toLowerCase();
    return projects.find(p => p.id === identifier || p.name.toLowerCase() === normalized) || null;
}

// Saves a project (create or update)
export async function saveProject(project: ProjectConfig): Promise<ProjectConfig> {
    const projects = await getAllProjects();
    const index = projects.findIndex(p => p.id === project.id);

    const now = new Date().toISOString();
    const updated = { ...project, updatedAt: now };

    if (index >= 0) {
        projects[index] = updated;
    } else {
        updated.createdAt = now;
        projects.push(updated);
    }

    const file: ProjectsFile = { version: 1, projects };
    await Bun.write(getProjectsFilePath(), JSON.stringify(file, null, 2));

    logger.info(`Saved project: ${project.name}`);
    return updated;
}

// Deletes a project
export async function deleteProject(id: string): Promise<boolean> {
    const projects = await getAllProjects();
    const filtered = projects.filter(p => p.id !== id);

    if (filtered.length === projects.length) return false;

    const file: ProjectsFile = { version: 1, projects: filtered };
    await Bun.write(getProjectsFilePath(), JSON.stringify(file, null, 2));

    logger.info(`Deleted project: ${id}`);
    return true;
}
