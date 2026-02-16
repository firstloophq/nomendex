import type { HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { acquireFileLock, getActiveNoteFileNameForPath, releaseFileLockForToolUse } from "@/services/file-locks";
import type { AgentConfig } from "@/features/agents/index";

type ToolInputWithFilePath = {
    file_path?: string;
    filePath?: string;
    path?: string;
};

export function getToolFilePath(toolInput?: ToolInputWithFilePath): string | null {
    if (!toolInput) return null;
    if (typeof toolInput.file_path === "string") return toolInput.file_path;
    if (typeof toolInput.filePath === "string") return toolInput.filePath;
    if (typeof toolInput.path === "string") return toolInput.path;
    return null;
}

export function createLockHook(
    agentConfig: AgentConfig,
    pushToQueue: (data: object) => void
): HookCallback {
    return async (input, toolUseId) => {
        if (input.hook_event_name !== "PreToolUse") return {};
        const preInput = input as PreToolUseHookInput;
        const toolInput = preInput.tool_input as ToolInputWithFilePath | undefined;
        const filePath = getToolFilePath(toolInput);

        if (!filePath) {
            return {};
        }

        const noteFileName = await getActiveNoteFileNameForPath(filePath);
        if (!noteFileName) {
            return {};
        }

        const { lock, wasCreated } = acquireFileLock({
            noteFileName,
            agentId: agentConfig.id,
            agentName: agentConfig.name,
            toolUseId,
        });

        if (wasCreated) {
            pushToQueue({
                type: "file_lock",
                lock,
            });
        }

        return {};
    };
}

export function createUnlockHook(
    pushToQueue: (data: object) => void
): HookCallback {
    return async (_input, toolUseId) => {
        if (!toolUseId) return {};
        const released = releaseFileLockForToolUse(toolUseId);
        if (released) {
            pushToQueue({
                type: "file_unlock",
                noteFileName: released.noteFileName,
            });
        }
        return {};
    };
}
