import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, Trash2, PencilRuler } from "lucide-react";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useCanvasAPI } from "@/hooks/useCanvasAPI";
import { useTheme } from "@/hooks/useTheme";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { canvasPluginSerial, type CanvasItem } from "./index";
import { cn } from "@/lib/utils";

interface CanvasBrowserViewProps {
    tabId: string;
}

function formatRelativeDate(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;

    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffHours < 1) return "Updated just now";
    if (diffHours < 24) return `Updated ${diffHours}h ago`;
    if (diffDays < 7) return `Updated ${diffDays}d ago`;
    return `Updated ${date.toLocaleDateString()}`;
}

export function CanvasBrowserView(props: CanvasBrowserViewProps) {
    const { tabId } = props;
    const { activeTab, setTabName, openTab } = useWorkspaceContext();
    const { currentTheme } = useTheme();
    const canvasAPI = useCanvasAPI();

    const [canvases, setCanvases] = useState<CanvasItem[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [newCanvasTitle, setNewCanvasTitle] = useState("");
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const hasSetTabNameRef = useRef(false);

    useEffect(() => {
        if (activeTab?.id === tabId && !hasSetTabNameRef.current) {
            setTabName(tabId, "Canvas");
            hasSetTabNameRef.current = true;
        }
    }, [activeTab?.id, setTabName, tabId]);

    const loadCanvases = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const result = await canvasAPI.listCanvases();
            setCanvases(result);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Failed to load canvases");
        } finally {
            setLoading(false);
        }
    }, [canvasAPI]);

    useEffect(() => {
        void loadCanvases();
    }, [loadCanvases]);

    const filteredCanvases = useMemo(() => {
        if (!searchQuery.trim()) return canvases;
        const query = searchQuery.toLowerCase().trim();
        return canvases.filter((canvas) => canvas.title.toLowerCase().includes(query));
    }, [canvases, searchQuery]);

    const handleOpenCanvas = useCallback((canvasId: string) => {
        openTab({
            pluginMeta: canvasPluginSerial,
            view: "editor",
            props: { canvasId },
        });
    }, [openTab]);

    const handleCreateCanvas = useCallback(async () => {
        try {
            setCreating(true);
            setError(null);
            const created = await canvasAPI.createCanvas({ title: newCanvasTitle.trim() || undefined });
            setCanvases((prev) => [created, ...prev]);
            setNewCanvasTitle("");
            handleOpenCanvas(created.id);
        } catch (createError) {
            setError(createError instanceof Error ? createError.message : "Failed to create canvas");
        } finally {
            setCreating(false);
        }
    }, [canvasAPI, handleOpenCanvas, newCanvasTitle]);

    const handleDeleteCanvas = useCallback(async (canvasId: string) => {
        const didConfirm = window.confirm("Delete this canvas?");
        if (!didConfirm) return;

        try {
            await canvasAPI.deleteCanvas({ canvasId });
            setCanvases((prev) => prev.filter((canvas) => canvas.id !== canvasId));
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : "Failed to delete canvas");
        }
    }, [canvasAPI]);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-muted-foreground">Loading canvases...</div>
            </div>
        );
    }

    return (
        <div
            className="h-full flex flex-col"
            style={{ backgroundColor: currentTheme.styles.surfacePrimary }}
        >
            <div
                className="sticky top-0 z-10 px-4 py-3 border-b"
                style={{
                    backgroundColor: currentTheme.styles.surfacePrimary,
                    borderColor: currentTheme.styles.borderDefault,
                }}
            >
                <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                        <PencilRuler size={18} style={{ color: currentTheme.styles.contentAccent }} />
                        <h1 className="text-lg font-semibold">Canvas</h1>
                        <span
                            className="text-sm"
                            style={{ color: currentTheme.styles.contentSecondary }}
                        >
                            ({canvases.length})
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search
                            className="absolute left-3 top-1/2 -translate-y-1/2"
                            size={16}
                            style={{ color: currentTheme.styles.contentTertiary }}
                        />
                        <Input
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="Search canvases..."
                            className="pl-9"
                        />
                    </div>
                    <Input
                        value={newCanvasTitle}
                        onChange={(event) => setNewCanvasTitle(event.target.value)}
                        placeholder="New canvas title"
                        className="max-w-60"
                    />
                    <Button onClick={() => void handleCreateCanvas()} disabled={creating}>
                        <Plus className="h-4 w-4 mr-1" />
                        Create
                    </Button>
                </div>
            </div>

            {error && (
                <div className="p-4">
                    <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto p-3">
                {filteredCanvases.length === 0 ? (
                    <div
                        className="h-full flex items-center justify-center text-sm"
                        style={{ color: currentTheme.styles.contentSecondary }}
                    >
                        {canvases.length === 0 ? "No canvases yet. Create your first one." : "No canvases match your search."}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {filteredCanvases.map((canvas) => (
                            <button
                                key={canvas.id}
                                className={cn(
                                    "w-full text-left rounded-md border px-3 py-2 transition-colors",
                                    "hover:bg-muted/40"
                                )}
                                style={{
                                    borderColor: currentTheme.styles.borderDefault,
                                }}
                                onClick={() => handleOpenCanvas(canvas.id)}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div
                                            className="font-medium truncate"
                                            style={{ color: currentTheme.styles.contentPrimary }}
                                        >
                                            {canvas.title}
                                        </div>
                                        <div
                                            className="text-xs mt-0.5"
                                            style={{ color: currentTheme.styles.contentSecondary }}
                                        >
                                            {formatRelativeDate(canvas.updatedAt)}
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 flex-shrink-0"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            void handleDeleteCanvas(canvas.id);
                                        }}
                                        title="Delete canvas"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
