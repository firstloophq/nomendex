import { globalConfig } from "./global-config";
import path from "path";
import { WorkspaceStateSchema, NotesLocation } from "@/types/Workspace";

interface PathCache {
    rootPath: string;
    nomendexPath: string;
    todosPath: string;
    notesPath: string;
    agentsPath: string;
    skillsPath: string;
    uploadsPath: string;
}

let paths: PathCache | null = null;

/**
 * Read the notes location setting from workspace.json
 */
async function getNotesLocationSetting(nomendexPath: string): Promise<NotesLocation> {
    try {
        const file = Bun.file(path.join(nomendexPath, "workspace.json"));
        const exists = await file.exists();
        if (!exists) {
            return "root"; // default (Obsidian-compatible)
        }
        const workspaceRaw = await file.json();
        const workspace = WorkspaceStateSchema.parse(workspaceRaw);
        return workspace.notesLocation;
    } catch {
        return "root"; // default (Obsidian-compatible) on error
    }
}

/**
 * Initialize paths from the active workspace in global config.
 * Must be called before any path getters are used.
 */
export async function initializePaths(): Promise<void> {
    const workspace = await globalConfig.getActiveWorkspace();
    if (!workspace) {
        paths = null;
        return;
    }

    const nomendexPath = path.join(workspace.path, ".nomendex");
    const notesLocation = await getNotesLocationSetting(nomendexPath);
    const notesPath = notesLocation === "root"
        ? workspace.path
        : path.join(workspace.path, "notes");

    paths = {
        rootPath: workspace.path,
        nomendexPath,
        todosPath: path.join(workspace.path, "todos"),
        notesPath,
        agentsPath: path.join(workspace.path, "agents"),
        skillsPath: path.join(workspace.path, ".claude", "skills"),
        uploadsPath: path.join(workspace.path, "uploads"),
    };
}

/**
 * Check if an active workspace is configured.
 */
export function hasActiveWorkspace(): boolean {
    return paths !== null;
}

/**
 * Get the root path of the active workspace.
 * @throws Error if no workspace is active
 */
export function getRootPath(): string {
    if (!paths) throw new Error("No active workspace. Call initializePaths() first.");
    return paths.rootPath;
}

/**
 * Get the .nomendex path of the active workspace (for internal files like workspace.json, secrets.json).
 * @throws Error if no workspace is active
 */
export function getNomendexPath(): string {
    if (!paths) throw new Error("No active workspace. Call initializePaths() first.");
    return paths.nomendexPath;
}

/**
 * Get the todos path of the active workspace.
 * @throws Error if no workspace is active
 */
export function getTodosPath(): string {
    if (!paths) throw new Error("No active workspace. Call initializePaths() first.");
    return paths.todosPath;
}

/**
 * Get the notes path of the active workspace.
 * @throws Error if no workspace is active
 */
export function getNotesPath(): string {
    if (!paths) throw new Error("No active workspace. Call initializePaths() first.");
    return paths.notesPath;
}

/**
 * Get the agents path of the active workspace.
 * @throws Error if no workspace is active
 */
export function getAgentsPath(): string {
    if (!paths) throw new Error("No active workspace. Call initializePaths() first.");
    return paths.agentsPath;
}

/**
 * Get the skills path of the active workspace.
 * @throws Error if no workspace is active
 */
export function getSkillsPath(): string {
    if (!paths) throw new Error("No active workspace. Call initializePaths() first.");
    return paths.skillsPath;
}

/**
 * Get the uploads path of the active workspace.
 * @throws Error if no workspace is active
 */
export function getUploadsPath(): string {
    if (!paths) throw new Error("No active workspace. Call initializePaths() first.");
    return paths.uploadsPath;
}
