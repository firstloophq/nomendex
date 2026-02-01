import { useEffect, useState, useRef, useCallback } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Hash, Plus, Trash2 } from "lucide-react";
import { useNotesAPI } from "@/hooks/useNotesAPI";
import { useTheme } from "@/hooks/useTheme";
import { useNativeSubmit } from "@/hooks/useNativeKeyboardBridge";
import { tagsPluginSerial } from "./index";
import type { TagSuggestion } from "@/features/notes/tags-types";
import { cn } from "@/lib/utils";

export function TagsBrowserView({ tabId }: { tabId: string }) {
    if (!tabId) {
        throw new Error("tabId is required");
    }
    const { activeTab, setTabName, addNewTab, setActiveTabId, getViewSelfPlacement, setSidebarTabId } = useWorkspaceContext();
    const { loading, error, setLoading, setError } = usePlugin();
    const [tags, setTags] = useState<TagSuggestion[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedTagIndex, setSelectedTagIndex] = useState(0);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [newTagName, setNewTagName] = useState("");
    const [createError, setCreateError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const { currentTheme } = useTheme();
    const placement = getViewSelfPlacement(tabId);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const newTagInputRef = useRef<HTMLInputElement>(null);
    const hasSetTabNameRef = useRef<boolean>(false);
    const listRef = useRef<HTMLDivElement>(null);

    const notesAPI = useNotesAPI();

    // Set tab name
    useEffect(() => {
        if (activeTab?.id === tabId && !hasSetTabNameRef.current) {
            setTabName(tabId, "Tags");
            hasSetTabNameRef.current = true;
        }
    }, [activeTab?.id, tabId, setTabName]);

    // Auto-focus search input when tab becomes active
    useEffect(() => {
        if (activeTab?.id === tabId && !loading) {
            requestAnimationFrame(() => {
                searchInputRef.current?.focus();
            });
        }
    }, [activeTab?.id, tabId, loading]);

    // Auto-focus new tag input when dialog opens
    useEffect(() => {
        if (showCreateDialog) {
            requestAnimationFrame(() => {
                newTagInputRef.current?.focus();
            });
        }
    }, [showCreateDialog]);

    // Load tags
    useEffect(() => {
        const fetchTags = async () => {
            try {
                setLoading(true);
                setError(null);
                const result = await notesAPI.getAllTags();
                setTags(result);
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : "Failed to fetch tags";
                setError(errorMessage);
            } finally {
                setLoading(false);
            }
        };
        fetchTags();
    }, [notesAPI, setLoading, setError]);

    // Filter tags based on search
    const filteredTags = searchQuery
        ? tags.filter((t) => t.tag.toLowerCase().includes(searchQuery.toLowerCase()))
        : tags;

    // Open tag detail view
    const handleOpenTag = useCallback(
        async (tagName: string) => {
            const newTab = await addNewTab({
                pluginMeta: tagsPluginSerial,
                view: "detail",
                props: { tagName },
            });
            if (newTab) {
                if (placement === "sidebar") {
                    setSidebarTabId(newTab.id);
                } else {
                    setActiveTabId(newTab.id);
                }
            }
        },
        [addNewTab, placement, setActiveTabId, setSidebarTabId]
    );

    // Keyboard navigation
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (filteredTags.length === 0) return;

            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    setSelectedTagIndex((prev) => Math.min(prev + 1, filteredTags.length - 1));
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    setSelectedTagIndex((prev) => Math.max(prev - 1, 0));
                    break;
                case "Enter":
                    e.preventDefault();
                    {
                        const selectedTag = filteredTags[selectedTagIndex];
                        if (selectedTag) {
                            handleOpenTag(selectedTag.tag);
                        }
                    }
                    break;
            }
        },
        [filteredTags, selectedTagIndex, handleOpenTag]
    );

    // Reset selection when search changes
    useEffect(() => {
        setSelectedTagIndex(0);
    }, [searchQuery]);

    // Scroll selected item into view
    useEffect(() => {
        if (listRef.current) {
            const selectedItem = listRef.current.querySelector(`[data-index="${selectedTagIndex}"]`);
            selectedItem?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }, [selectedTagIndex]);

    // Handle creating a new explicit tag
    const handleCreateTag = useCallback(async () => {
        const tagName = newTagName.trim();
        if (!tagName) {
            setCreateError("Tag name cannot be empty");
            return;
        }

        try {
            setCreating(true);
            setCreateError(null);
            await notesAPI.createExplicitTag({ tagName });

            // Reload tags
            const result = await notesAPI.getAllTags();
            setTags(result);

            // Close dialog and reset
            setShowCreateDialog(false);
            setNewTagName("");
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Failed to create tag";
            setCreateError(errorMessage);
        } finally {
            setCreating(false);
        }
    }, [newTagName, notesAPI]);

    // Handle deleting an explicit tag
    const handleDeleteTag = useCallback(async (tagName: string, event: React.MouseEvent) => {
        event.stopPropagation();

        try {
            const { isExplicit } = await notesAPI.isExplicitTag({ tagName });
            if (!isExplicit) {
                return; // Only delete explicit tags
            }

            await notesAPI.deleteExplicitTag({ tagName });

            // Reload tags
            const result = await notesAPI.getAllTags();
            setTags(result);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Failed to delete tag";
            setError(errorMessage);
        }
    }, [notesAPI, setError]);

    // Hook for Cmd+Enter in create dialog
    useNativeSubmit(() => {
        if (showCreateDialog && !creating && newTagName.trim()) {
            handleCreateTag();
        }
    });

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-muted-foreground">Loading tags...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4">
                <Alert variant="destructive">
                    <AlertDescription>Error: {error}</AlertDescription>
                </Alert>
            </div>
        );
    }

    return (
        <div
            className="h-full flex flex-col"
            style={{ backgroundColor: currentTheme.styles.surfacePrimary }}
        >
            {/* Header with search */}
            <div
                className="sticky top-0 z-10 px-4 py-3 border-b"
                style={{
                    backgroundColor: currentTheme.styles.surfacePrimary,
                    borderColor: currentTheme.styles.borderDefault,
                }}
            >
                <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                        <Hash
                            size={20}
                            style={{ color: currentTheme.styles.contentAccent }}
                        />
                        <h1
                            className="text-xl font-semibold"
                            style={{ color: currentTheme.styles.contentPrimary }}
                        >
                            Tags
                        </h1>
                        <span
                            className="text-sm"
                            style={{ color: currentTheme.styles.contentTertiary }}
                        >
                            ({tags.length})
                        </span>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowCreateDialog(true)}
                        className="flex items-center gap-2"
                    >
                        <Plus size={16} />
                        Create Tag
                    </Button>
                </div>

                <div className="relative">
                    <Search
                        className="absolute left-3 top-1/2 -translate-y-1/2"
                        size={16}
                        style={{ color: currentTheme.styles.contentTertiary }}
                    />
                    <Input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search tags..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="pl-9"
                        style={{
                            backgroundColor: currentTheme.styles.surfaceSecondary,
                            borderColor: currentTheme.styles.borderDefault,
                            color: currentTheme.styles.contentPrimary,
                        }}
                    />
                </div>
            </div>

            {/* Tags list */}
            <div
                ref={listRef}
                className="flex-1 overflow-y-auto p-2"
            >
                {filteredTags.length === 0 ? (
                    <div
                        className="text-center py-8"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        {searchQuery ? "No tags found" : "No tags yet"}
                    </div>
                ) : (
                    <div className="space-y-1">
                        {filteredTags.map((tagItem, index) => (
                            <div
                                key={tagItem.tag}
                                data-index={index}
                                className="group relative"
                            >
                                <button
                                    onClick={() => handleOpenTag(tagItem.tag)}
                                    className={cn(
                                        "w-full flex items-center justify-between px-3 py-2 rounded-md transition-colors text-left",
                                        "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-offset-1"
                                    )}
                                    style={{
                                        backgroundColor: index === selectedTagIndex
                                            ? currentTheme.styles.surfaceAccent
                                            : "transparent",
                                        color: currentTheme.styles.contentPrimary,
                                    }}
                                >
                                    <div className="flex items-center gap-2">
                                        <Hash
                                            size={14}
                                            style={{ color: currentTheme.styles.contentAccent }}
                                        />
                                        <span className="font-medium">{tagItem.tag}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span
                                            className="text-sm px-2 py-0.5 rounded-full"
                                            style={{
                                                backgroundColor: currentTheme.styles.surfaceTertiary,
                                                color: currentTheme.styles.contentSecondary
                                            }}
                                        >
                                            {tagItem.count}
                                        </span>
                                    </div>
                                    {tagItem.count === 0 && (
                                        <button
                                            onClick={(e) => handleDeleteTag(tagItem.tag, e)}
                                            className="absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10"
                                            title="Delete explicit tag"
                                        >
                                            <Trash2
                                                size={14}
                                                style={{ color: currentTheme.styles.semanticDestructive }}
                                            />
                                        </button>
                                    )}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Create Tag Dialog */}
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create New Tag</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <Input
                            ref={newTagInputRef}
                            type="text"
                            placeholder="Tag name (without #)"
                            value={newTagName}
                            onChange={(e) => {
                                setNewTagName(e.target.value);
                                setCreateError(null);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !creating && newTagName.trim()) {
                                    handleCreateTag();
                                }
                            }}
                            disabled={creating}
                        />
                        {createError && (
                            <p className="text-sm text-destructive mt-2">{createError}</p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => {
                                setShowCreateDialog(false);
                                setNewTagName("");
                                setCreateError(null);
                            }}
                            disabled={creating}
                            autoFocus
                        >
                            Cancel
                        </Button>
                        <div className="flex flex-col items-center">
                            <Button
                                onClick={handleCreateTag}
                                disabled={creating || !newTagName.trim()}
                            >
                                {creating ? "Creating..." : "Create"}
                            </Button>
                            <span className="text-[10px] text-muted-foreground mt-1">⌘ Enter</span>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default TagsBrowserView;
