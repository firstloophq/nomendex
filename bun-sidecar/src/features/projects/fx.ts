import { createServiceLogger } from "@/lib/logger";
import { getNomendexPath, hasActiveWorkspace } from "@/storage/root-path";
import { getTodos, updateTodo, deleteTodo } from "@/features/todos/fx";
import { getNotes, updateNoteProject, deleteNote } from "@/features/notes/fx";
import path from "path";
import {
    ProjectConfig,
    ProjectConfigSchema,
    ProjectsFile,
    ProjectsFileSchema,
} from "./project-types";

const projectsLogger = createServiceLogger("PROJECTS");

let projectsFilePath: string | null = null;

/**
 * Get the path to the projects.json file
 */
function getProjectsFilePath(): string {
    if (!projectsFilePath) {
        throw new Error("Projects service not initialized. Call initializeProjectsService() first.");
    }
    return projectsFilePath;
}

/**
 * Generate a slug ID from a project name
 */
function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

/**
 * Read the projects file from disk
 */
async function readProjectsFile(): Promise<ProjectsFile> {
    const filePath = getProjectsFilePath();
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
        return { version: 1, projects: [] };
    }

    const raw = await file.json();
    return ProjectsFileSchema.parse(raw);
}

/**
 * Write the projects file to disk
 */
async function writeProjectsFile(data: ProjectsFile): Promise<void> {
    const filePath = getProjectsFilePath();
    await Bun.write(filePath, JSON.stringify(data, null, 2));
}

/**
 * Migrate existing projects from todos to the projects file
 */
async function migrateProjectsFromTodos(): Promise<void> {
    projectsLogger.info("Checking for project migration...");

    const filePath = getProjectsFilePath();
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (exists) {
        projectsLogger.info("Projects file exists, skipping migration");
        return;
    }

    projectsLogger.info("Running project migration from todos...");

    // Get all todos to extract unique project names
    const todos = await getTodos({});
    const projectNames = new Set<string>();

    for (const todo of todos) {
        if (todo.project) {
            projectNames.add(todo.project);
        }
    }

    const now = new Date().toISOString();
    const projects: ProjectConfig[] = Array.from(projectNames).map((name) => ({
        id: slugify(name) || `project-${Date.now()}`,
        name,
        createdAt: now,
        updatedAt: now,
    }));

    // Ensure unique IDs
    const seenIds = new Set<string>();
    for (const project of projects) {
        let id = project.id;
        let counter = 1;
        while (seenIds.has(id)) {
            id = `${project.id}-${counter++}`;
        }
        project.id = id;
        seenIds.add(id);
    }

    const projectsFile: ProjectsFile = {
        version: 1,
        projects,
        migratedAt: now,
    };

    await writeProjectsFile(projectsFile);
    projectsLogger.info(`Migrated ${projects.length} projects from todos`);
}

/**
 * Initialize the projects service. Must be called after initializePaths().
 */
export async function initializeProjectsService(): Promise<void> {
    if (!hasActiveWorkspace()) {
        projectsLogger.warn("No active workspace, skipping projects initialization");
        return;
    }

    projectsFilePath = path.join(getNomendexPath(), "projects.json");
    await migrateProjectsFromTodos();
    projectsLogger.info("Projects service initialized");
}

/**
 * List all projects, optionally including archived ones
 */
export async function listProjects(input: {
    includeArchived?: boolean;
}): Promise<ProjectConfig[]> {
    projectsLogger.info(`Listing projects (includeArchived: ${input.includeArchived})`);

    const data = await readProjectsFile();
    let projects = data.projects;

    if (!input.includeArchived) {
        projects = projects.filter((p) => !p.archived);
    }

    // Sort alphabetically by name
    projects.sort((a, b) => a.name.localeCompare(b.name));

    projectsLogger.info(`Found ${projects.length} projects`);
    return projects;
}

/**
 * Get a project by ID
 */
export async function getProject(input: { projectId: string }): Promise<ProjectConfig | null> {
    projectsLogger.info(`Getting project: ${input.projectId}`);

    const data = await readProjectsFile();
    const project = data.projects.find((p) => p.id === input.projectId);

    if (!project) {
        projectsLogger.warn(`Project not found: ${input.projectId}`);
        return null;
    }

    return project;
}

/**
 * Get a project by name
 */
export async function getProjectByName(input: { name: string }): Promise<ProjectConfig | null> {
    projectsLogger.info(`Getting project by name: ${input.name}`);

    const data = await readProjectsFile();
    const project = data.projects.find((p) => p.name === input.name);

    if (!project) {
        projectsLogger.warn(`Project not found by name: ${input.name}`);
        return null;
    }

    return project;
}

/**
 * Create a new project
 */
export async function createProject(input: {
    name: string;
    description?: string;
    color?: string;
}): Promise<ProjectConfig> {
    projectsLogger.info(`Creating project: ${input.name}`);

    const data = await readProjectsFile();

    // Check for duplicate name
    const existing = data.projects.find((p) => p.name === input.name);
    if (existing) {
        throw new Error(`Project with name "${input.name}" already exists`);
    }

    // Generate unique ID
    let id = slugify(input.name) || "project";
    const existingIds = new Set(data.projects.map((p) => p.id));
    let counter = 1;
    while (existingIds.has(id)) {
        id = `${slugify(input.name)}-${counter++}`;
    }

    const now = new Date().toISOString();
    const project: ProjectConfig = ProjectConfigSchema.parse({
        id,
        name: input.name,
        description: input.description,
        color: input.color,
        createdAt: now,
        updatedAt: now,
    });

    data.projects.push(project);
    await writeProjectsFile(data);

    projectsLogger.info(`Created project: ${project.id}`);
    return project;
}

/**
 * Update an existing project
 */
export async function updateProject(input: {
    projectId: string;
    updates: {
        name?: string;
        description?: string;
        color?: string;
        archived?: boolean;
    };
}): Promise<ProjectConfig> {
    projectsLogger.info(`Updating project: ${input.projectId}`);

    const data = await readProjectsFile();
    const index = data.projects.findIndex((p) => p.id === input.projectId);

    if (index === -1) {
        throw new Error(`Project with ID "${input.projectId}" not found`);
    }

    // Check for duplicate name if name is being changed
    if (input.updates.name) {
        const existing = data.projects.find(
            (p) => p.name === input.updates.name && p.id !== input.projectId
        );
        if (existing) {
            throw new Error(`Project with name "${input.updates.name}" already exists`);
        }
    }

    const existingProject = data.projects[index];
    if (!existingProject) {
        throw new Error(`Project with ID "${input.projectId}" not found`);
    }

    const updated: ProjectConfig = {
        ...existingProject,
        ...input.updates,
        updatedAt: new Date().toISOString(),
    };

    data.projects[index] = updated;
    await writeProjectsFile(data);

    projectsLogger.info(`Updated project: ${input.projectId}`);
    return updated;
}

/**
 * Get statistics for a project (counts of todos and notes)
 */
export async function getProjectStats(input: { projectName: string }): Promise<{
    todoCount: number;
    noteCount: number;
}> {
    projectsLogger.info(`Getting stats for project: ${input.projectName}`);

    const [allTodos, allNotes] = await Promise.all([
        getTodos({}),
        getNotes({}),
    ]);

    const todoCount = allTodos.filter((t) => t.project === input.projectName).length;
    const noteCount = allNotes.filter((n) => n.frontMatter?.project === input.projectName).length;

    return { todoCount, noteCount };
}

/**
 * Delete a project with optional cascade to delete associated todos and notes
 */
export async function deleteProject(input: {
    projectId: string;
    cascade?: boolean;
}): Promise<{
    success: boolean;
    deletedTodos: number;
    deletedNotes: number;
}> {
    projectsLogger.info(`Deleting project: ${input.projectId} (cascade: ${input.cascade})`);

    const data = await readProjectsFile();
    const index = data.projects.findIndex((p) => p.id === input.projectId);

    if (index === -1) {
        throw new Error(`Project with ID "${input.projectId}" not found`);
    }

    const project = data.projects[index];
    if (!project) {
        throw new Error(`Project with ID "${input.projectId}" not found`);
    }
    const projectName = project.name;

    let deletedTodos = 0;
    let deletedNotes = 0;

    if (input.cascade) {
        // Delete all todos with this project
        const allTodos = await getTodos({});
        const projectTodos = allTodos.filter((t) => t.project === projectName);
        for (const todo of projectTodos) {
            await deleteTodo({ todoId: todo.id });
            deletedTodos++;
        }
        projectsLogger.info(`Deleted ${deletedTodos} todos for project: ${projectName}`);

        // Delete all notes with this project
        const allNotes = await getNotes({});
        const projectNotes = allNotes.filter((n) => n.frontMatter?.project === projectName);
        for (const note of projectNotes) {
            await deleteNote({ fileName: note.fileName });
            deletedNotes++;
        }
        projectsLogger.info(`Deleted ${deletedNotes} notes for project: ${projectName}`);
    }

    // Delete the project itself
    data.projects.splice(index, 1);
    await writeProjectsFile(data);

    projectsLogger.info(`Deleted project: ${input.projectId}`);
    return { success: true, deletedTodos, deletedNotes };
}

/**
 * Rename a project and cascade the change to all associated todos and notes
 */
export async function renameProject(input: {
    projectId: string;
    newName: string;
}): Promise<{
    project: ProjectConfig;
    updatedTodos: number;
    updatedNotes: number;
}> {
    projectsLogger.info(`Renaming project: ${input.projectId} to ${input.newName}`);

    const data = await readProjectsFile();
    const index = data.projects.findIndex((p) => p.id === input.projectId);

    if (index === -1) {
        throw new Error(`Project with ID "${input.projectId}" not found`);
    }

    // Check for duplicate name
    const existing = data.projects.find(
        (p) => p.name === input.newName && p.id !== input.projectId
    );
    if (existing) {
        throw new Error(`Project with name "${input.newName}" already exists`);
    }

    const existingProject = data.projects[index];
    if (!existingProject) {
        throw new Error(`Project with ID "${input.projectId}" not found`);
    }
    const oldName = existingProject.name;

    // Update todos with this project
    const allTodos = await getTodos({});
    const projectTodos = allTodos.filter((t) => t.project === oldName);
    let updatedTodos = 0;
    for (const todo of projectTodos) {
        await updateTodo({
            todoId: todo.id,
            updates: { project: input.newName },
        });
        updatedTodos++;
    }
    projectsLogger.info(`Updated ${updatedTodos} todos to new project name: ${input.newName}`);

    // Update notes with this project
    const allNotes = await getNotes({});
    const projectNotes = allNotes.filter((n) => n.frontMatter?.project === oldName);
    let updatedNotes = 0;
    for (const note of projectNotes) {
        await updateNoteProject({
            fileName: note.fileName,
            project: input.newName,
        });
        updatedNotes++;
    }
    projectsLogger.info(`Updated ${updatedNotes} notes to new project name: ${input.newName}`);

    // Update the project itself
    const updated: ProjectConfig = {
        ...existingProject,
        name: input.newName,
        updatedAt: new Date().toISOString(),
    };

    data.projects[index] = updated;
    await writeProjectsFile(data);

    projectsLogger.info(`Renamed project: ${input.projectId} to ${input.newName}`);
    return { project: updated, updatedTodos, updatedNotes };
}

/**
 * Ensure a project exists by name, creating it if necessary.
 * Useful for auto-creating projects when creating todos with new project names.
 */
export async function ensureProject(input: { name: string }): Promise<ProjectConfig> {
    projectsLogger.info(`Ensuring project exists: ${input.name}`);

    const existing = await getProjectByName({ name: input.name });
    if (existing) {
        return existing;
    }

    return createProject({ name: input.name });
}
