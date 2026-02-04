import { getNotesPath, getNomendexPath, hasActiveWorkspace } from "@/storage/root-path";
import { WorkspaceStateSchema, type WorkspaceState } from "@/types/Workspace";
import type { CaptureSettings, CreateCaptureInput, CreateCaptureOutput } from "./capture-types";
import { CaptureSettingsSchema } from "./capture-types";
import path from "path";

/**
 * Get capture settings from workspace state
 */
export async function getCaptureSettings(): Promise<CaptureSettings> {
    if (!hasActiveWorkspace()) {
        return CaptureSettingsSchema.parse({});
    }

    try {
        const workspacePath = path.join(getNomendexPath(), "workspace.json");
        const file = Bun.file(workspacePath);
        const exists = await file.exists();
        if (!exists) {
            return CaptureSettingsSchema.parse({});
        }
        const workspaceRaw = await file.json();
        const workspace = WorkspaceStateSchema.parse(workspaceRaw);
        return workspace.captureSettings;
    } catch {
        return CaptureSettingsSchema.parse({});
    }
}

/**
 * Save capture settings to workspace state
 */
export async function saveCaptureSettings(args: { settings: CaptureSettings }): Promise<CaptureSettings> {
    if (!hasActiveWorkspace()) {
        throw new Error("No active workspace");
    }

    const workspacePath = path.join(getNomendexPath(), "workspace.json");
    const file = Bun.file(workspacePath);

    let workspace: WorkspaceState;
    try {
        const exists = await file.exists();
        if (exists) {
            const workspaceRaw = await file.json();
            workspace = WorkspaceStateSchema.parse(workspaceRaw);
        } else {
            workspace = WorkspaceStateSchema.parse({
                tabs: [],
                activeTabId: null,
                sidebarOpen: false,
                sidebarTabId: null,
            });
        }
    } catch {
        workspace = WorkspaceStateSchema.parse({
            tabs: [],
            activeTabId: null,
            sidebarOpen: false,
            sidebarTabId: null,
        });
    }

    workspace.captureSettings = args.settings;
    await Bun.write(workspacePath, JSON.stringify(workspace, null, 2));

    return args.settings;
}

/**
 * Format date as M-D-YYYY for daily note filename
 */
function getDailyNoteFileName(): string {
    const date = new Date();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear();
    return `${month}-${day}-${year}.md`;
}

/**
 * Generate a timestamp-based filename for captures
 */
function generateCaptureFileName(title?: string): string {
    const date = new Date();
    const timestamp = date.toISOString().replace(/[:.]/g, "-").slice(0, 19);

    if (title) {
        // Sanitize title for filename
        const sanitized = title
            .replace(/[^a-zA-Z0-9\s-]/g, "")
            .replace(/\s+/g, "-")
            .slice(0, 50);
        return `${timestamp}-${sanitized}.md`;
    }

    return `${timestamp}.md`;
}

/**
 * Create a text capture
 * Either creates a new note in the Captures folder or appends to daily note
 */
export async function createTextCapture(args: CreateCaptureInput): Promise<CreateCaptureOutput> {
    if (!hasActiveWorkspace()) {
        throw new Error("No active workspace");
    }

    const settings = await getCaptureSettings();
    const notesPath = getNotesPath();

    if (settings.destination === "daily") {
        // Append to daily note
        return await appendToDaily({ content: args.content });
    } else {
        // Create new note in Captures folder
        const captureFolder = settings.captureFolder || "Captures";
        const folderPath = path.join(notesPath, captureFolder);

        // Ensure folder exists
        const dir = Bun.file(folderPath);
        if (!(await dir.exists())) {
            await Bun.$`mkdir -p ${folderPath}`;
        }

        const fileName = generateCaptureFileName(args.title);
        const filePath = path.join(folderPath, fileName);

        await Bun.write(filePath, args.content);

        return {
            fileName: `${captureFolder}/${fileName}`,
            content: args.content,
        };
    }
}

/**
 * Append content to today's daily note
 * Creates the daily note if it doesn't exist
 */
export async function appendToDaily(args: { content: string }): Promise<CreateCaptureOutput> {
    if (!hasActiveWorkspace()) {
        throw new Error("No active workspace");
    }

    const notesPath = getNotesPath();
    const dailyFileName = getDailyNoteFileName();
    const filePath = path.join(notesPath, dailyFileName);

    const file = Bun.file(filePath);
    const exists = await file.exists();

    const timestamp = new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
    });

    const captureBlock = `\n\n---\n**Captured at ${timestamp}**\n\n${args.content}`;

    let newContent: string;
    if (exists) {
        const existingContent = await file.text();
        newContent = existingContent + captureBlock;
    } else {
        // Create new daily note with capture
        const date = new Date();
        const dateStr = date.toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
        });
        newContent = `# ${dateStr}${captureBlock}`;
    }

    await Bun.write(filePath, newContent);

    return {
        fileName: dailyFileName,
        content: newContent,
    };
}
