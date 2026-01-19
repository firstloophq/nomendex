import { useEffect, useState, useRef, useCallback } from "react";
import type { ReactNode } from "react";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Search, MessageCircle, Plus, Trash2, Maximize2 } from "lucide-react";
import { useCommandDialog } from "@/components/CommandDialogProvider";
import { useTheme } from "@/hooks/useTheme";
import { DeleteChatSessionDialog } from "./delete-chat-session-dialog";
import { reconstructMessages, type SessionMetadata, type ChatMessage } from "./sessionUtils";

type SessionWithSnippet = SessionMetadata & {
    matchSnippet?: { before: string; match: string; after: string };
    titleMatch?: boolean;
};
import { chatPluginSerial } from "./index";
import {
    Message,
    MessageContent,
    MessageResponse,
} from "@/components/ai-elements/message";

// Helper: Format relative time
function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

// Helper: Highlight matching text in content
function highlightMatches(
    text: string,
    query: string,
    accentColor: string
): ReactNode {
    if (!query.trim()) return text;

    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = text.split(regex);

    if (parts.length === 1) return text;

    return parts.map((part, i) => {
        if (part.toLowerCase() === query.toLowerCase()) {
            return (
                <mark
                    key={i}
                    style={{
                        backgroundColor: accentColor + "30",
                        color: "inherit",
                        padding: "0 1px",
                    }}
                >
                    {part}
                </mark>
            );
        }
        return part;
    });
}

export default function ChatBrowserView({ tabId }: { tabId: string }) {
    const { setTabName, addNewTab, setActiveTabId, getViewSelfPlacement, setSidebarTabId, activeTab } = useWorkspaceContext();
    const { currentTheme } = useTheme();
    const { openDialog } = useCommandDialog();

    const [sessions, setSessions] = useState<SessionMetadata[]>([]);
    const [filteredSessions, setFilteredSessions] = useState<SessionWithSnippet[]>([]);
    const [isLoadingSessions, setIsLoadingSessions] = useState(true);
    const [isSearching, setIsSearching] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [selectedSession, setSelectedSession] = useState<SessionWithSnippet | null>(null);
    const [selectedMessages, setSelectedMessages] = useState<ChatMessage[]>([]);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const selectedRowRef = useRef<HTMLDivElement | null>(null);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const placement = getViewSelfPlacement(tabId);

    // Set tab name
    useEffect(() => {
        setTabName(tabId, "Chat History");
    }, [tabId, setTabName]);

    // Auto-focus search input when tab becomes active
    // Refetch sessions and focus search when tab becomes active
    useEffect(() => {
        if (activeTab?.id === tabId) {
            loadSessions();
            requestAnimationFrame(() => {
                searchInputRef.current?.focus();
            });
        }
    }, [activeTab?.id, tabId]);

    // Load messages when session is selected
    useEffect(() => {
        if (selectedSession) {
            loadSessionMessages(selectedSession.id);
        } else {
            setSelectedMessages([]);
        }
    }, [selectedSession]);

    // Ensure selected item is visible
    useEffect(() => {
        selectedRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [selectedIndex]);

    async function loadSessions() {
        try {
            setIsLoadingSessions(true);
            const response = await fetch("/api/chat/sessions/list");
            const data = await response.json();
            const sessionList = data.sessions || [];
            setSessions(sessionList);

            // Select first session if available
            if (sessionList.length > 0) {
                setSelectedIndex(0);
                setSelectedSession(sessionList[0]);
            }
        } catch (error) {
            console.error("[ChatBrowser] Failed to load sessions:", error);
        } finally {
            setIsLoadingSessions(false);
        }
    }

    async function loadSessionMessages(sessionId: string) {
        try {
            setIsLoadingMessages(true);
            const response = await fetch(`/api/chat/sessions/history/${sessionId}`);
            if (!response.ok) throw new Error("Failed to load messages");

            const data = await response.json();
            const sdkMessages = data.messages || [];
            const uiMessages = reconstructMessages(sdkMessages);
            setSelectedMessages(uiMessages);
        } catch (error) {
            console.error("[ChatBrowser] Failed to load messages:", error);
            setSelectedMessages([]);
        } finally {
            setIsLoadingMessages(false);
        }
    }

    // Search sessions with debouncing
    useEffect(() => {
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        if (!searchQuery.trim()) {
            // No search query - show all sessions
            setFilteredSessions(sessions);
            if (sessions.length > 0) {
                setSelectedIndex(0);
                setSelectedSession(sessions[0]);
            }
            return;
        }

        setIsSearching(true);
        searchTimeoutRef.current = setTimeout(async () => {
            try {
                const response = await fetch("/api/chat/sessions/search", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: searchQuery }),
                });
                const data = await response.json();
                const results = data.sessions || [];
                setFilteredSessions(results);
                if (results.length > 0) {
                    setSelectedIndex(0);
                    setSelectedSession(results[0]);
                } else {
                    setSelectedSession(null);
                }
            } catch (error) {
                console.error("[ChatBrowser] Search failed:", error);
            } finally {
                setIsSearching(false);
            }
        }, 300);

        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, [searchQuery, sessions]);

    const handleOpenChat = useCallback(
        async (sessionId: string) => {
            const newTab = await addNewTab({
                pluginMeta: chatPluginSerial,
                view: "chat",
                props: { sessionId },
            });
            if (newTab) {
                if (placement === "sidebar") {
                    setSidebarTabId(newTab.id);
                } else {
                    setActiveTabId(newTab.id);
                }
            }
        },
        [addNewTab, setActiveTabId, placement, setSidebarTabId]
    );

    const handleNewChat = useCallback(async () => {
        const newTab = await addNewTab({
            pluginMeta: chatPluginSerial,
            view: "chat",
            props: {},
        });
        if (newTab) {
            if (placement === "sidebar") {
                setSidebarTabId(newTab.id);
            } else {
                setActiveTabId(newTab.id);
            }
        }
    }, [addNewTab, setActiveTabId, placement, setSidebarTabId]);

    const handleDeleteSession = (sessionId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        const handleSuccess = () => {
            // Remove from local state
            setSessions(prev => prev.filter(s => s.id !== sessionId));
            setFilteredSessions(prev => prev.filter(s => s.id !== sessionId));

            // Update selection if needed
            if (selectedSession?.id === sessionId) {
                const remaining = filteredSessions.filter(s => s.id !== sessionId);
                if (remaining.length > 0) {
                    setSelectedIndex(0);
                    setSelectedSession(remaining[0]);
                } else {
                    setSelectedSession(null);
                }
            }
        };

        openDialog({
            content: (
                <DeleteChatSessionDialog
                    sessionId={sessionId}
                    onSuccess={handleSuccess}
                />
            ),
        });
    };

    // Keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (filteredSessions.length === 0) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            const newIndex = (selectedIndex + 1) % filteredSessions.length;
            setSelectedIndex(newIndex);
            setSelectedSession(filteredSessions[newIndex] || null);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            const newIndex = (selectedIndex - 1 + filteredSessions.length) % filteredSessions.length;
            setSelectedIndex(newIndex);
            setSelectedSession(filteredSessions[newIndex] || null);
        } else if (e.key === "Enter" && selectedSession) {
            e.preventDefault();
            handleOpenChat(selectedSession.id);
        } else if (e.key === "Escape") {
            if (searchQuery) {
                setSearchQuery("");
            } else {
                searchInputRef.current?.blur();
            }
        }
    };

    return (
        <div className="h-full flex flex-col">
            {/* Main Content - Split Layout */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left Panel - Session List */}
                <div className="w-72 border-r flex flex-col h-full" style={{ borderColor: currentTheme.styles.borderDefault }}>
                    <div className="px-3 py-3 border-b space-y-2" style={{ borderColor: currentTheme.styles.borderDefault }}>
                        <div className="flex items-center gap-2">
                            <div className="relative flex-1 min-w-0">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: currentTheme.styles.contentSecondary }} />
                                <Input
                                    ref={searchInputRef}
                                    placeholder="Search chats..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    style={{ color: currentTheme.styles.contentPrimary }}
                                    className="pl-7"
                                    autoFocus
                                />
                            </div>
                            <Button size="icon" onClick={handleNewChat} title="New chat">
                                <Plus className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    <div
                        className="flex-1 overflow-hidden outline-none"
                        tabIndex={0}
                        onKeyDown={handleKeyDown}
                    >
                        <ScrollArea className="h-full">
                            <div className="px-2 py-2 space-y-1">
                                {isLoadingSessions ? (
                                    <div className="p-6 text-center" style={{ color: currentTheme.styles.contentSecondary }}>
                                        <p className="text-sm">Loading...</p>
                                    </div>
                                ) : isSearching ? (
                                    <div className="p-6 text-center" style={{ color: currentTheme.styles.contentSecondary }}>
                                        <p className="text-sm">Searching...</p>
                                    </div>
                                ) : filteredSessions.length === 0 ? (
                                    <div className="p-6 text-center" style={{ color: currentTheme.styles.contentSecondary }}>
                                        {searchQuery ? (
                                            <p className="text-sm">No chats match "{searchQuery}"</p>
                                        ) : (
                                            <div className="space-y-2">
                                                <MessageCircle className="h-12 w-12 mx-auto" style={{ color: currentTheme.styles.contentTertiary }} />
                                                <p className="text-sm">No chats yet</p>
                                                <Button size="sm" onClick={handleNewChat}>
                                                    <Plus className="h-4 w-4 mr-1" /> Start a chat
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    filteredSessions.map((session, index) => {
                                        const isSelected = index === selectedIndex;
                                        return (
                                            <div
                                                key={session.id}
                                                ref={isSelected ? selectedRowRef : undefined}
                                                className="group relative px-3 py-2.5 cursor-pointer rounded-md transition-colors"
                                                style={{
                                                    border: isSelected
                                                        ? `2px solid ${currentTheme.styles.contentAccent}`
                                                        : "2px solid transparent",
                                                    color: currentTheme.styles.contentPrimary,
                                                }}
                                                onClick={() => handleOpenChat(session.id)}
                                                onMouseEnter={() => {
                                                    setSelectedIndex(index);
                                                    setSelectedSession(session);
                                                }}
                                            >
                                                {/* Time */}
                                                <div className="flex items-center gap-1.5 mb-1">
                                                    <MessageCircle
                                                        className="h-3 w-3"
                                                        style={{ color: currentTheme.styles.contentTertiary }}
                                                    />
                                                    <span
                                                        className="text-xs"
                                                        style={{ color: currentTheme.styles.contentTertiary }}
                                                    >
                                                        {formatRelativeTime(session.updatedAt)}
                                                    </span>
                                                    <span
                                                        className="text-xs"
                                                        style={{ color: currentTheme.styles.contentTertiary }}
                                                    >
                                                        - {session.messageCount} msgs
                                                    </span>
                                                </div>

                                                {/* Title */}
                                                <div
                                                    className="font-medium text-sm leading-snug line-clamp-2"
                                                    style={{ color: currentTheme.styles.contentPrimary }}
                                                >
                                                    {session.title}
                                                </div>

                                                {/* Match snippet */}
                                                {session.matchSnippet && (
                                                    <div
                                                        className="text-xs mt-1 line-clamp-1"
                                                        style={{ color: currentTheme.styles.contentSecondary }}
                                                    >
                                                        {session.matchSnippet.before}
                                                        <span
                                                            className="font-semibold rounded px-0.5"
                                                            style={{
                                                                backgroundColor: currentTheme.styles.contentAccent + "30",
                                                                color: currentTheme.styles.contentPrimary,
                                                            }}
                                                        >
                                                            {session.matchSnippet.match}
                                                        </span>
                                                        {session.matchSnippet.after}
                                                    </div>
                                                )}

                                                {/* Delete button */}
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    style={{ color: currentTheme.styles.contentTertiary }}
                                                    onClick={(e) => handleDeleteSession(session.id, e)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </ScrollArea>
                    </div>
                </div>

                {/* Right Panel - Chat Preview */}
                <div className="flex-1 flex flex-col overflow-hidden relative">
                    {selectedSession ? (
                        <>
                            {/* Open in new tab button */}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute top-2 right-2 z-20 h-8 w-8"
                                onClick={() => handleOpenChat(selectedSession.id)}
                                title="Open chat in new tab"
                            >
                                <Maximize2 className="h-4 w-4" />
                            </Button>

                            {isLoadingMessages ? (
                                <div className="flex-1 flex items-center justify-center">
                                    <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                        Loading messages...
                                    </p>
                                </div>
                            ) : (
                                <ScrollArea className="flex-1">
                                    <div className="p-4 space-y-4 max-w-3xl mx-auto">
                                        {selectedMessages.map((message) => (
                                            <Message key={message.id} from={message.role}>
                                                <MessageContent isUser={message.role === "user"}>
                                                    {message.blocks.map((block) => {
                                                        if (block.type === "text") {
                                                            // When searching, render plain text with highlights
                                                            // Otherwise use MessageResponse for markdown
                                                            if (searchQuery.trim()) {
                                                                return (
                                                                    <div key={block.id} className="whitespace-pre-wrap">
                                                                        {highlightMatches(
                                                                            block.content,
                                                                            searchQuery,
                                                                            currentTheme.styles.contentAccent
                                                                        )}
                                                                    </div>
                                                                );
                                                            }
                                                            return (
                                                                <MessageResponse key={block.id}>
                                                                    {block.content}
                                                                </MessageResponse>
                                                            );
                                                        }
                                                        if (block.type === "tool") {
                                                            return (
                                                                <div
                                                                    key={block.id}
                                                                    className="text-xs px-2 py-1 rounded"
                                                                    style={{
                                                                        backgroundColor: currentTheme.styles.surfaceSecondary,
                                                                        color: currentTheme.styles.contentSecondary,
                                                                    }}
                                                                >
                                                                    Tool: {block.toolCall.name}
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    })}
                                                </MessageContent>
                                            </Message>
                                        ))}
                                    </div>
                                </ScrollArea>
                            )}
                        </>
                    ) : !isLoadingSessions && sessions.length > 0 ? (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center space-y-2">
                                <MessageCircle className="h-12 w-12 mx-auto" style={{ color: currentTheme.styles.contentTertiary }} />
                                <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                    Select a chat to preview
                                </p>
                            </div>
                        </div>
                    ) : !isLoadingSessions ? (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center space-y-3">
                                <MessageCircle className="h-12 w-12 mx-auto" style={{ color: currentTheme.styles.contentTertiary }} />
                                <p className="text-sm" style={{ color: currentTheme.styles.contentSecondary }}>
                                    No chats yet
                                </p>
                                <Button onClick={handleNewChat}>
                                    <Plus className="h-4 w-4 mr-1" /> Start a new chat
                                </Button>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
