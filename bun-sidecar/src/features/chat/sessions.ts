import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { readJSONL, appendJSONL, updateJSONL } from "@/lib/jsonl";
import { getRootPath, getNomendexPath } from "@/storage/root-path";
import { getAgent, getPreferences, savePreferences } from "@/features/agents/fx";
import { DEFAULT_AGENT } from "@/features/agents/index";
import type { AgentConfig } from "@/features/agents/index";
import type { SessionMetadata } from "./index";
import { createServiceLogger } from "@/lib/logger";

const chatLogger = createServiceLogger("CHAT_FX");

// File paths - computed dynamically
export function getSessionsFile(): string {
    return join(getNomendexPath(), "chat-sessions.jsonl");
}

// Claude sessions directory - computed from workspace path
export function getClaudeSessionsDir(): string {
    const workspacePath = getRootPath();
    // Convert path to Claude-compatible format (replace / with -)
    // Claude keeps the leading dash, e.g., /Users/foo -> -Users-foo
    const pathPart = workspacePath.replace(/\//g, "-");
    return `${process.env.HOME}/.claude/projects/${pathPart}`;
}

// Determine which agent to use and load its config
export async function resolveAgent(params: {
    requestAgentId?: string;
    sessionId?: string;
}): Promise<AgentConfig> {
    const { requestAgentId, sessionId } = params;

    let agentId: string;

    if (requestAgentId) {
        agentId = requestAgentId;
    } else if (sessionId) {
        const sessions = await readJSONL<SessionMetadata>(getSessionsFile());
        const sessionMeta = sessions.find((s) => s.id === sessionId);
        agentId = sessionMeta?.agentId || (await getPreferences()).lastUsedAgentId;
    } else {
        agentId = (await getPreferences()).lastUsedAgentId;
    }

    const loadedAgent = await getAgent({ agentId });
    const agentConfig = loadedAgent || DEFAULT_AGENT;

    await savePreferences({ lastUsedAgentId: agentConfig.id });

    return agentConfig;
}

// Session CRUD operations

export async function saveSession(params: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    agentId?: string;
}): Promise<{ success: boolean; session: SessionMetadata }> {
    const existingSessions = await readJSONL<SessionMetadata>(getSessionsFile());
    const existing = existingSessions.find((s) => s.id === params.id);
    if (existing) {
        return { success: true, session: existing };
    }

    const session: SessionMetadata = {
        id: params.id,
        title: params.title,
        createdAt: params.createdAt,
        updatedAt: params.updatedAt,
        messageCount: params.messageCount,
        agentId: params.agentId,
    };

    await appendJSONL(getSessionsFile(), session);
    chatLogger.info("Saved session", { id: params.id });

    return { success: true, session };
}

export async function listSessions(): Promise<SessionMetadata[]> {
    const allSessions = await readJSONL<SessionMetadata>(getSessionsFile());
    const claudeDir = getClaudeSessionsDir();

    // Deduplicate by ID, keeping the most recent entry
    const sessionsMap = new Map<string, SessionMetadata>();
    for (const session of allSessions) {
        const existing = sessionsMap.get(session.id);
        if (!existing || new Date(session.updatedAt) > new Date(existing.updatedAt)) {
            sessionsMap.set(session.id, session);
        }
    }

    // Filter to only sessions with existing history files in this workspace
    const validSessions: SessionMetadata[] = [];
    const staleSessions: string[] = [];

    for (const session of sessionsMap.values()) {
        const historyFile = join(claudeDir, `${session.id}.jsonl`);
        if (existsSync(historyFile)) {
            validSessions.push(session);
        } else {
            staleSessions.push(session.id);
            chatLogger.info("Session history not found, marking as stale", {
                sessionId: session.id,
                expectedPath: historyFile,
            });
        }
    }

    // Clean up stale sessions from the metadata file (async, fire-and-forget)
    if (staleSessions.length > 0) {
        chatLogger.info("Cleaning up stale sessions", { count: staleSessions.length });
        const cleanedSessions = allSessions.filter((s) => !staleSessions.includes(s.id));
        const content = cleanedSessions.map((s) => JSON.stringify(s)).join("\n") + (cleanedSessions.length > 0 ? "\n" : "");
        Bun.write(getSessionsFile(), content).catch((err) => {
            chatLogger.error("Failed to clean up stale sessions", { error: err });
        });
    }

    validSessions.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return validSessions;
}

export async function updateSession(params: {
    id: string;
    title?: string;
    messageCount?: number;
}): Promise<void> {
    await updateJSONL<SessionMetadata>(getSessionsFile(), params.id, (session) => ({
        ...session,
        ...(params.title && { title: params.title }),
        ...(params.messageCount !== undefined && { messageCount: params.messageCount }),
        updatedAt: new Date().toISOString(),
    }));
    chatLogger.info("Updated session", { id: params.id });
}

export async function deleteSession(id: string): Promise<void> {
    const allSessions = await readJSONL<SessionMetadata>(getSessionsFile());
    const remainingSessions = allSessions.filter((s) => s.id !== id);
    const content = remainingSessions.map((s) => JSON.stringify(s)).join("\n") + (remainingSessions.length > 0 ? "\n" : "");
    await Bun.write(getSessionsFile(), content);
    chatLogger.info("Removed session from metadata (soft delete)", { id });
}

export async function searchSessions(searchQuery: string): Promise<Array<SessionMetadata & {
    matchSnippet?: { before: string; match: string; after: string };
    titleMatch?: boolean;
}>> {
    const searchLower = searchQuery.toLowerCase();
    const sessions = await readJSONL<SessionMetadata>(getSessionsFile());
    const matchingSessions: Array<SessionMetadata & {
        matchSnippet?: { before: string; match: string; after: string };
        titleMatch?: boolean;
    }> = [];

    const createSnippet = (text: string, matchIdx: number, matchLen: number) => {
        const contextBefore = 30;
        const contextAfter = 30;
        const start = Math.max(0, matchIdx - contextBefore);
        const end = Math.min(text.length, matchIdx + matchLen + contextAfter);

        return {
            before: (start > 0 ? "..." : "") + text.slice(start, matchIdx),
            match: text.slice(matchIdx, matchIdx + matchLen),
            after: text.slice(matchIdx + matchLen, end) + (end < text.length ? "..." : ""),
        };
    };

    for (const session of sessions) {
        const titleIdx = session.title.toLowerCase().indexOf(searchLower);
        if (titleIdx !== -1) {
            matchingSessions.push({ ...session, titleMatch: true });
            continue;
        }

        const sessionFile = join(getClaudeSessionsDir(), `${session.id}.jsonl`);
        if (!existsSync(sessionFile)) continue;

        try {
            const messages = await readJSONL<SDKMessage>(sessionFile);
            let found = false;
            let matchSnippet: { before: string; match: string; after: string } | undefined;

            for (const msg of messages) {
                if (msg.type === "user" && "content" in msg) {
                    const content = String(msg.content);
                    const idx = content.toLowerCase().indexOf(searchLower);
                    if (idx !== -1) {
                        found = true;
                        matchSnippet = createSnippet(content, idx, searchQuery.length);
                        break;
                    }
                } else if (msg.type === "assistant" && "message" in msg) {
                    const message = msg.message as { content?: Array<{ type: string; text?: string }> };
                    if (message.content) {
                        for (const block of message.content) {
                            if (block.type === "text" && block.text) {
                                const idx = block.text.toLowerCase().indexOf(searchLower);
                                if (idx !== -1) {
                                    found = true;
                                    matchSnippet = createSnippet(block.text, idx, searchQuery.length);
                                    break;
                                }
                            }
                        }
                    }
                    if (found) break;
                }
            }

            if (found) {
                matchingSessions.push({ ...session, matchSnippet });
            }
        } catch (err) {
            console.error(`[API] Error searching session ${session.id}:`, err);
        }
    }

    matchingSessions.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return matchingSessions;
}

export async function loadSessionHistory(sessionId: string): Promise<{ messages: SDKMessage[] } | { error: string; sessionFile?: string }> {
    const claudeDir = getClaudeSessionsDir();
    const sessionFile = join(claudeDir, `${sessionId}.jsonl`);

    chatLogger.info("Loading session history", {
        sessionId,
        claudeDir,
        sessionFile,
        dirExists: existsSync(claudeDir),
        fileExists: existsSync(sessionFile),
    });

    if (!existsSync(sessionFile)) {
        chatLogger.warn("Session file not found", { sessionFile });
        return { error: "Session not found", sessionFile };
    }

    const messages = await readJSONL<SDKMessage>(sessionFile);
    console.log(`[API] Loaded ${messages.length} messages for session ${sessionId}`);

    return { messages };
}
