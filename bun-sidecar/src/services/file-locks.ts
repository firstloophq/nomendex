import path from "path";
import { createServiceLogger } from "@/lib/logger";
import { FileLock } from "@/types/FileLock";
import { WorkspaceStateSchema, type WorkspaceState, type WorkspaceTab } from "@/types/Workspace";
import { getNomendexPath, getNotesPath } from "@/storage/root-path";

type InternalFileLock = FileLock & {
    toolUseIds: Set<string>;
};

const locksByFile = new Map<string, InternalFileLock>();
const fileByToolUseId = new Map<string, string>();
const fileLocksLogger = createServiceLogger("FILE_LOCKS");

function getNoteFileNameFromPath(filePath: string): string | null {
    if (!filePath) return null;
    const resolvedPath = path.resolve(filePath);
    const notesRoot = path.resolve(getNotesPath());
    const relativePath = path.relative(notesRoot, resolvedPath);

    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return null;
    }

    return relativePath;
}

async function getWorkspaceState(): Promise<WorkspaceState | null> {
    try {
        const workspaceFile = Bun.file(path.join(getNomendexPath(), "workspace.json"));
        if (!(await workspaceFile.exists())) {
            return null;
        }
        const raw = await workspaceFile.json();
        return WorkspaceStateSchema.parse(raw);
    } catch (error) {
        fileLocksLogger.warn("Failed to read workspace state for file locks", {
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

function getActiveNoteFileNameFromTab(tab: WorkspaceTab | undefined): string | null {
    if (!tab) return null;
    if (tab.pluginInstance.plugin.id !== "notes") return null;
    if (tab.pluginInstance.viewId !== "editor") return null;

    const noteFileName = tab.pluginInstance.instanceProps?.noteFileName;
    return typeof noteFileName === "string" ? noteFileName : null;
}

function getActiveNoteFileNames(workspace: WorkspaceState): Set<string> {
    const activeNotes = new Set<string>();

    if (workspace.layoutMode === "split") {
        for (const pane of workspace.panes) {
            const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId);
            const noteFileName = getActiveNoteFileNameFromTab(activeTab);
            if (noteFileName) {
                activeNotes.add(noteFileName);
            }
        }
        return activeNotes;
    }

    const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId);
    const noteFileName = getActiveNoteFileNameFromTab(activeTab);
    if (noteFileName) {
        activeNotes.add(noteFileName);
    }

    return activeNotes;
}

export async function getActiveNoteFileNameForPath(filePath: string): Promise<string | null> {
    const noteFileName = getNoteFileNameFromPath(filePath);
    if (!noteFileName) {
        return null;
    }

    const workspace = await getWorkspaceState();
    if (!workspace) {
        return null;
    }

    const activeNotes = getActiveNoteFileNames(workspace);
    return activeNotes.has(noteFileName) ? noteFileName : null;
}

export function acquireFileLock(params: {
    noteFileName: string;
    agentId: string;
    agentName: string;
    toolUseId?: string | null;
}): { lock: FileLock; wasCreated: boolean } {
    const { noteFileName, agentId, agentName, toolUseId } = params;
    const existing = locksByFile.get(noteFileName);

    if (existing) {
        if (toolUseId) {
            existing.toolUseIds.add(toolUseId);
            fileByToolUseId.set(toolUseId, noteFileName);
        }
        return {
            lock: {
                noteFileName,
                agentId: existing.agentId,
                agentName: existing.agentName,
                lockedAt: existing.lockedAt,
            },
            wasCreated: false,
        };
    }

    const lock: InternalFileLock = {
        noteFileName,
        agentId,
        agentName,
        lockedAt: Date.now(),
        toolUseIds: new Set<string>(),
    };

    if (toolUseId) {
        lock.toolUseIds.add(toolUseId);
        fileByToolUseId.set(toolUseId, noteFileName);
    }

    locksByFile.set(noteFileName, lock);

    return {
        lock: {
            noteFileName,
            agentId,
            agentName,
            lockedAt: lock.lockedAt,
        },
        wasCreated: true,
    };
}

export function releaseFileLockForToolUse(toolUseId: string): FileLock | null {
    const noteFileName = fileByToolUseId.get(toolUseId);
    if (!noteFileName) {
        return null;
    }

    fileByToolUseId.delete(toolUseId);
    const existing = locksByFile.get(noteFileName);
    if (!existing) {
        return null;
    }

    existing.toolUseIds.delete(toolUseId);
    if (existing.toolUseIds.size > 0) {
        return null;
    }

    locksByFile.delete(noteFileName);
    return {
        noteFileName,
        agentId: existing.agentId,
        agentName: existing.agentName,
        lockedAt: existing.lockedAt,
    };
}

export function clearFileLocks(): void {
    locksByFile.clear();
    fileByToolUseId.clear();
}
