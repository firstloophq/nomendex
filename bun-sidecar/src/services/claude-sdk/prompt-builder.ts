import { join } from "node:path";
import { getUploadsPath } from "@/storage/root-path";
import { createServiceLogger } from "@/lib/logger";
import type { AgentConfig } from "@/features/agents/index";

const promptLogger = createServiceLogger("PROMPT_BUILDER");

// Helper to read image from uploads folder and convert to base64
export async function readImageAsBase64(imageUrl: string): Promise<{ data: string; mediaType: string } | null> {
    try {
        // Extract filename from URL (e.g., "/api/uploads/image.png" -> "image.png")
        const filename = imageUrl.replace("/api/uploads/", "");
        if (!filename) return null;

        const uploadsPath = getUploadsPath();
        const filePath = join(uploadsPath, filename);
        const file = Bun.file(filePath);

        if (!(await file.exists())) {
            promptLogger.warn(`Image not found: ${filePath}`);
            return null;
        }

        const arrayBuffer = await file.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        const mimeType = file.type || "image/png";

        return { data: base64, mediaType: mimeType };
    } catch (error) {
        promptLogger.error(`Failed to read image: ${imageUrl}`, { error });
        return null;
    }
}

// Build context information for the agent's system prompt
export function buildAgentContext(workspaceFolder: string): string {
    const now = new Date();
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayOfWeek = dayNames[now.getDay()];
    const dateStr = now.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });

    return `<agent-context>
Today is ${dayOfWeek}, ${dateStr}.
You are working in the folder: ${workspaceFolder}
</agent-context>`;
}

// Build system prompt combining agent context and custom system prompt
export function buildSystemPrompt(agentConfig: AgentConfig, targetDir: string): string {
    const agentContext = buildAgentContext(targetDir);
    if (agentConfig.systemPrompt) {
        return `${agentContext}\n\n${agentConfig.systemPrompt}`;
    }
    return agentContext;
}

// Types for multimodal prompt construction
type ContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

type UserMessageInput = {
    type: "user";
    message: { role: "user"; content: ContentBlock[] };
    parent_tool_use_id: null;
    session_id: string;
};

// Build prompt input - handles multimodal vs text prompt construction
export async function buildPromptInput(params: {
    message: string;
    images?: string[];
    sessionId?: string;
}): Promise<string | AsyncIterable<UserMessageInput>> {
    const { message, images, sessionId } = params;

    if (images && images.length > 0) {
        const contentBlocks: ContentBlock[] = [];

        for (const imageUrl of images) {
            const imageData = await readImageAsBase64(imageUrl);
            if (imageData) {
                contentBlocks.push({
                    type: "image",
                    source: {
                        type: "base64",
                        media_type: imageData.mediaType,
                        data: imageData.data,
                    },
                });
            }
        }

        if (message) {
            contentBlocks.push({ type: "text", text: message });
        }

        console.log("[API] Images processed:", contentBlocks.filter((b) => b.type === "image").length);

        async function* generateUserMessage(): AsyncIterable<UserMessageInput> {
            yield {
                type: "user" as const,
                message: {
                    role: "user" as const,
                    content: contentBlocks,
                },
                parent_tool_use_id: null,
                session_id: sessionId || "",
            };
        }

        return generateUserMessage();
    }

    return message || "";
}
