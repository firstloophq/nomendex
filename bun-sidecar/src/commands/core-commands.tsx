import React, { useState, useEffect, useRef, KeyboardEvent } from "react";
import { Command } from "@/types/Commands";
import { Button } from "@/components/ui/button";
import { DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { WorkspaceTab } from "@/types/Workspace";
import { notesAPI } from "@/hooks/useNotesAPI";
import { todosAPI } from "@/hooks/useTodosAPI";
import { logsAPI } from "@/hooks/useLogsAPI";
import { dispatchRefresh } from "@/lib/events";
import { useCommandDialog } from "@/components/CommandDialogProvider";
import { useNativeSubmit } from "@/hooks/useNativeKeyboardBridge";

interface CoreCommandContext {
    openDialog: (config: { title?: string; description?: string; content?: React.ReactNode }) => void;
    closeDialog: () => void;
    closeCommandMenu: () => void;
    navigate: (path: string) => void;
    // Workspace operations
    closeTab: (id: string) => void;
    closeAllTabs: () => void;
    getTabs: () => Array<{ id: string; title: string }>;
    setSidebarTabId: (id: string | null) => void;
    getSidebarTabId: () => string | null;
    setSidebarOpen: (open: boolean) => void;
    isSidebarOpen: () => boolean;
    activeTab?: WorkspaceTab | null;
    // Split layout operations
    toggleLayoutMode: () => void;
    getLayoutMode: () => "single" | "split";
}

/**
 * Dialog component for confirming close all tabs action
 */
function CloseAllTabsDialog({
    tabCount,
    onConfirm,
}: {
    tabCount: number;
    onConfirm: () => void;
}) {
    const { closeDialog } = useCommandDialog();

    const handleConfirm = () => {
        closeDialog();
        // Defer tab closing to after dialog closes
        setTimeout(() => {
            onConfirm();
        }, 0);
    };

    const handleCancel = () => {
        closeDialog();
    };

    // Handle Cmd+Enter from native Mac app
    useNativeSubmit(() => {
        handleConfirm();
    });

    return (
        <>
            <DialogHeader>
                <DialogTitle>Close all tabs?</DialogTitle>
                <DialogDescription>
                    This will close {tabCount} open tab{tabCount === 1 ? "" : "s"}. This action cannot be undone.
                </DialogDescription>
            </DialogHeader>
            <DialogFooter>
                <Button variant="ghost" onClick={handleCancel} autoFocus>
                    Cancel
                </Button>
                <div className="flex flex-col items-center">
                    <Button variant="outline" onClick={handleConfirm}>
                        Close all
                    </Button>
                    <span className="text-[10px] text-muted-foreground mt-1">⌘ Enter</span>
                </div>
            </DialogFooter>
        </>
    );
}

/**
 * Tag Management Dialog - works for both notes and todos
 */
function TagManagementDialog({
    type,
    identifier,
    initialTags,
    closeDialog,
}: {
    type: "note" | "todo";
    identifier: string;
    initialTags: string[];
    closeDialog: () => void;
}) {
    const [tags, setTags] = useState<string[]>(initialTags);
    const [inputValue, setInputValue] = useState("");
    const [allTags, setAllTags] = useState<string[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    // Load all existing tags
    useEffect(() => {
        async function loadTags() {
            try {
                if (type === "note") {
                    const notes = await notesAPI.getNotes();
                    const tagSet = new Set<string>();
                    notes.forEach((note) => {
                        const noteTags = note.frontMatter?.tags;
                        if (Array.isArray(noteTags)) {
                            noteTags.forEach((tag) => {
                                if (typeof tag === "string") tagSet.add(tag);
                            });
                        }
                    });
                    setAllTags(Array.from(tagSet).sort());
                } else {
                    const existingTags = await todosAPI.getTags();
                    setAllTags(existingTags.sort());
                }
            } catch (error) {
                console.error("Failed to load tags:", error);
            }
        }
        loadTags();
    }, [type]);

    // Focus input on mount
    useEffect(() => {
        setTimeout(() => inputRef.current?.focus(), 0);
    }, []);

    // Filter suggestions
    const suggestions = inputValue.trim()
        ? allTags.filter(
              (tag) =>
                  tag.toLowerCase().startsWith(inputValue.toLowerCase()) &&
                  !tags.includes(tag)
          ).slice(0, 5)
        : [];

    const autocompleteSuggestion = inputValue && suggestions.length > 0
        ? suggestions[0]
        : null;

    const addTag = (tagToAdd?: string) => {
        const trimmedValue = (tagToAdd || inputValue).trim();
        if (trimmedValue && !tags.includes(trimmedValue)) {
            setTags([...tags, trimmedValue]);
            setInputValue("");
        }
    };

    const removeTag = (tagToRemove: string) => {
        setTags(tags.filter((tag) => tag !== tagToRemove));
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Tab" && autocompleteSuggestion) {
            e.preventDefault();
            setInputValue(autocompleteSuggestion);
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (e.metaKey || e.ctrlKey) {
                handleSave();
            } else {
                addTag();
            }
        } else if (e.key === "Escape") {
            closeDialog();
        } else if (e.key === "Backspace" && inputValue === "" && tags.length > 0) {
            removeTag(tags[tags.length - 1]);
        }
    };

    const handleSave = async () => {
        try {
            if (type === "note") {
                await notesAPI.updateNoteTags({ fileName: identifier, tags });
                dispatchRefresh({ type: "note", identifier });
            } else {
                await todosAPI.updateTodo({ todoId: identifier, updates: { tags } });
                dispatchRefresh({ type: "todo", identifier });
            }
            closeDialog();
        } catch (error) {
            console.error("Failed to save tags:", error);
        }
    };

    return (
        <>
            <DialogHeader>
                <DialogTitle>Manage Tags</DialogTitle>
                <DialogDescription>
                    Add or remove tags for this {type}.
                </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
                {/* Current tags */}
                {tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                                {tag}
                                <button
                                    onClick={() => removeTag(tag)}
                                    className="ml-1 rounded-sm p-0.5 hover:bg-muted"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </Badge>
                        ))}
                    </div>
                )}

                {/* Input */}
                <div className="relative rounded-md border bg-muted/50">
                    <div className="absolute inset-0 px-3 py-2 text-sm pointer-events-none flex items-center overflow-hidden">
                        <span>{inputValue}</span>
                        {autocompleteSuggestion && (
                            <span className="opacity-40">
                                {autocompleteSuggestion.slice(inputValue.length)}
                            </span>
                        )}
                    </div>
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a tag..."
                        className="w-full px-3 py-2 rounded-md text-sm outline-none bg-transparent"
                        style={{ color: 'transparent', caretColor: 'currentColor' }}
                    />
                </div>

                {/* Suggestions */}
                {suggestions.length > 0 && inputValue && (
                    <div className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                        {suggestions.map((tag, index) => (
                            <span key={tag} className="flex items-center">
                                <button
                                    onClick={() => addTag(tag)}
                                    className="text-primary hover:underline"
                                >
                                    {tag}
                                </button>
                                {index < suggestions.length - 1 && <span className="mx-2">·</span>}
                            </span>
                        ))}
                    </div>
                )}

                {/* Hints */}
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                    <span><kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">Tab</kbd> autocomplete</span>
                    <span><kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">Enter</kbd> add tag</span>
                </div>
            </div>
            <DialogFooter>
                <Button variant="ghost" onClick={closeDialog}>Cancel</Button>
                <div className="flex flex-col items-center">
                    <Button onClick={handleSave}>Save Tags</Button>
                    <span className="text-[10px] text-muted-foreground mt-1">⌘ Enter</span>
                </div>
            </DialogFooter>
        </>
    );
}

/**
 * Get core/built-in commands that are always available
 */
export function getCoreCommands(context: CoreCommandContext): Command[] {
    return [
        {
            id: "core.openSettings",
            name: "Open Settings",
            description: "Open the settings page",
            icon: "Settings",
            callback: () => {
                context.closeCommandMenu();
                context.navigate("/settings");
            },
        },
        {
            id: "core.closeAllTabs",
            name: "Close All Tabs",
            description: "Close all open tabs",
            icon: "Trash2",
            callback: () => {
                context.closeCommandMenu();
                const tabs = context.getTabs();
                
                if (tabs.length === 0) {
                    // No tabs to close
                    return;
                }

                context.openDialog({
                    content: (
                        <CloseAllTabsDialog
                            tabCount={tabs.length}
                            onConfirm={() => {
                                // Close all tabs atomically
                                context.closeAllTabs();
                            }}
                        />
                    ),
                });
            },
        },
        {
            id: "core.manageTags",
            name: "Tags",
            description: "Manage tags for the current note",
            icon: "ListTodo",
            when: {
                activePluginId: "notes",
                activeViewId: "editor",
            },
            callback: async () => {
                context.closeCommandMenu();

                const activeTab = context.activeTab;
                if (!activeTab) {
                    console.log("No active tab");
                    return;
                }

                const pluginId = activeTab.pluginInstance?.plugin?.id;
                const viewId = activeTab.pluginInstance?.viewId;
                const props = activeTab.pluginInstance?.instanceProps;

                // Check if we're on a notes editor
                if (pluginId === "notes" && viewId === "editor" && props?.noteFileName) {
                    const noteFileName = props.noteFileName as string;
                    try {
                        const note = await notesAPI.getNoteByFileName({ fileName: noteFileName });
                        const initialTags = Array.isArray(note?.frontMatter?.tags)
                            ? note.frontMatter.tags.filter((t): t is string => typeof t === "string")
                            : [];

                        context.openDialog({
                            content: (
                                <TagManagementDialog
                                    type="note"
                                    identifier={noteFileName}
                                    initialTags={initialTags}
                                    closeDialog={context.closeDialog}
                                />
                            ),
                        });
                    } catch (error) {
                        console.error("Failed to load note for tags:", error);
                    }
                    return;
                }

                // Check if we're on a todos view with a selected todo
                // For now, this command works best when triggered from notes editor
                // Todo support would need additional context about which todo is selected
                console.log("Tags command: Not on a supported view (notes editor)");
            },
        },
        {
            id: "core.logsReveal",
            name: "Reveal Logs in Finder",
            description: "Show the log file in Finder",
            icon: "FileText",
            callback: async () => {
                context.closeCommandMenu();
                await logsAPI.reveal();
            },
        },
        {
            id: "core.logsReset",
            name: "Reset Logs",
            description: "Clear all log entries",
            icon: "Trash",
            callback: async () => {
                context.closeCommandMenu();
                await logsAPI.reset();
            },
        },
        {
            id: "dev.triggerError",
            name: "dev: Trigger Error",
            description: "Throw an error to test the error boundary",
            icon: "AlertTriangle",
            callback: () => {
                context.closeCommandMenu();
                // Dispatch event that DevErrorTrigger listens to
                // This triggers a render-time error that ErrorBoundary can catch
                window.dispatchEvent(new CustomEvent("dev:trigger-error"));
            },
        },
        {
            id: "core.toggleSplitView",
            name: "Toggle Split View",
            description: "Switch between single-pane and split-pane layout",
            icon: "Columns2",
            callback: () => {
                context.closeCommandMenu();
                context.toggleLayoutMode();
            },
        },
    ];
}